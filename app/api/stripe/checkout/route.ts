import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';
import { createClient } from '@/lib/supabase/server';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2025-02-24.acacia',
});

// v2 Pricing: Free / Pro / Max (no Starter, Publisher, Agency)
const PRICE_IDS: Record<string, { monthly: string; annual: string }> = {
  pro: {
    monthly: process.env.STRIPE_PRICE_PRO_MONTHLY || '',
    annual: process.env.STRIPE_PRICE_PRO_ANNUAL || '',
  },
  max: {
    monthly: process.env.STRIPE_PRICE_MAX_MONTHLY || '',
    annual: process.env.STRIPE_PRICE_MAX_ANNUAL || '',
  },
};

// Credit packs (one-time purchases, Pro/Max only)
const CREDIT_PACK_PRICES: Record<string, string> = {
  v2_credits_1000: process.env.STRIPE_PRICE_CREDITS_1000 || '',
  v2_credits_3000: process.env.STRIPE_PRICE_CREDITS_3000 || '',
  v2_credits_10000: process.env.STRIPE_PRICE_CREDITS_10000 || '',
};

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { planId, billingPeriod = 'annual', creditPackId } = body;

    // Handle credit pack purchase
    if (creditPackId) {
      return handleCreditPackPurchase(user.id, creditPackId, supabase);
    }

    // Handle subscription
    if (!PRICE_IDS[planId]) {
      return NextResponse.json({ error: 'Invalid plan. Choose pro or max.' }, { status: 400 });
    }

    // Get or create Stripe customer
    const { data: profile } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', user.id)
      .single();

    let customerId: string;

    // Check if user's org has a Stripe customer
    const { data: orgMember } = await supabase
      .from('org_members')
      .select('organizations(stripe_customer_id)')
      .eq('user_id', user.id)
      .single();

    const existingCustomerId = (orgMember?.organizations as any)?.stripe_customer_id;

    if (existingCustomerId) {
      customerId = existingCustomerId;
    } else {
      // Create new Stripe customer
      const customer = await stripe.customers.create({
        email: user.email!,
        name: profile?.full_name,
        metadata: {
          supabase_user_id: user.id,
        },
      });
      customerId = customer.id;

      // Save customer ID to organization (or create org if needed)
      let orgId = (orgMember?.organizations as any)?.id;

      if (!orgId) {
        // Create organization for user
        const { data: newOrg } = await supabase
          .from('organizations')
          .insert({
            name: profile?.full_name ? `${profile.full_name}'s Workspace` : 'My Workspace',
            slug: `workspace-${user.id.slice(0, 8)}`,
            industry: 'general',
            stripe_customer_id: customerId,
          })
          .select()
          .single();

        if (newOrg) {
          // Add user as owner
          await supabase.from('org_members').insert({
            org_id: newOrg.id,
            user_id: user.id,
            role: 'owner',
          });
          orgId = newOrg.id;
        }
      } else {
        // Update existing org with customer ID
        await supabase
          .from('organizations')
          .update({ stripe_customer_id: customerId })
          .eq('id', orgId);
      }
    }

    // Create checkout session
    const priceId = PRICE_IDS[planId][billingPeriod as 'monthly' | 'annual'];
    
    if (!priceId) {
      return NextResponse.json(
        { error: 'Price not configured. Please contact support.' },
        { status: 500 }
      );
    }

    const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://new.penworth.ai';

    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      payment_method_types: ['card'],
      line_items: [
        {
          price: priceId,
          quantity: 1,
        },
      ],
      mode: 'subscription',
      success_url: `${appUrl}/billing?success=true`,
      cancel_url: `${appUrl}/billing?canceled=true`,
      metadata: {
        user_id: user.id,
        plan_id: planId,
      },
      subscription_data: {
        trial_period_days: 14,
        metadata: {
          user_id: user.id,
          plan_id: planId,
        },
      },
      allow_promotion_codes: true,
    });

    return NextResponse.json({ url: session.url });
  } catch (error) {
    console.error('Checkout error:', error);
    return NextResponse.json(
      { error: 'Failed to create checkout session' },
      { status: 500 }
    );
  }
}

async function handleCreditPackPurchase(
  userId: string,
  creditPackId: string,
  supabase: any
) {
  // Check user is Pro or Max (free users cannot buy credits)
  const { data: profile } = await supabase
    .from('profiles')
    .select('plan')
    .eq('id', userId)
    .single();

  if (!profile || profile.plan === 'free') {
    return NextResponse.json(
      { error: 'Credit packs are only available for Pro and Max subscribers. Please upgrade first.' },
      { status: 403 }
    );
  }

  const priceId = CREDIT_PACK_PRICES[creditPackId];
  if (!priceId) {
    return NextResponse.json({ error: 'Invalid credit pack' }, { status: 400 });
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://new.penworth.ai';

  // Get customer ID
  const { data: orgMember } = await supabase
    .from('org_members')
    .select('organizations(stripe_customer_id)')
    .eq('user_id', userId)
    .single();

  const customerId = (orgMember?.organizations as any)?.stripe_customer_id;

  if (!customerId) {
    return NextResponse.json({ error: 'No billing account found' }, { status: 400 });
  }

  const session = await stripe.checkout.sessions.create({
    customer: customerId,
    payment_method_types: ['card'],
    line_items: [
      {
        price: priceId,
        quantity: 1,
      },
    ],
    mode: 'payment',
    success_url: `${appUrl}/billing?credits=success`,
    cancel_url: `${appUrl}/billing?credits=canceled`,
    metadata: {
      user_id: userId,
      credit_pack_id: creditPackId,
    },
  });

  return NextResponse.json({ url: session.url });
}
