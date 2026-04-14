import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';
import { createClient } from '@/lib/supabase/server';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2024-06-20',
});

const PRICE_IDS: Record<string, { monthly: string; annual: string }> = {
  pro: {
    monthly: process.env.STRIPE_PRICE_PRO_MONTHLY || 'price_pro_monthly',
    annual: process.env.STRIPE_PRICE_PRO_ANNUAL || 'price_pro_annual',
  },
  team: {
    monthly: process.env.STRIPE_PRICE_TEAM_MONTHLY || 'price_team_monthly',
    annual: process.env.STRIPE_PRICE_TEAM_ANNUAL || 'price_team_annual',
  },
};

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { planId, billingPeriod = 'monthly' } = body;

    if (!PRICE_IDS[planId]) {
      return NextResponse.json({ error: 'Invalid plan' }, { status: 400 });
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
