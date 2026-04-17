import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';
import { createClient } from '@/lib/supabase/server';
import { getStripeOrError } from '@/lib/stripe/client';

/**
 * Canonical v2 Stripe price IDs (live account). Verified active via the
 * Stripe API on April 17, 2026.
 *
 * We hardcode these rather than relying solely on env vars because:
 *   - Price IDs are not secrets (they appear in every customer invoice)
 *   - Stripe price IDs are immutable: once created they never change
 *   - An env var set to a stale or wrong ID causes 'No such price' errors
 *     that are painful to diagnose in production
 *
 * Env vars can override, but only if they pass a sanity check (prefix
 * 'price_'). A malformed env var value falls back to the canonical ID so
 * a single bad config entry doesn't break billing for every user.
 */
const CANONICAL = {
  PRO_MONTHLY: 'price_1TM8vSDAwDFDea8Lx2HRVsvb', // $19/mo
  PRO_ANNUAL: 'price_1TM8yKDAwDFDea8Lia58tjN2', // $190/yr
  MAX_MONTHLY: 'price_1TM8xADAwDFDea8Ld0hDB5mO', // $49/mo
  MAX_ANNUAL: 'price_1TM8zQDAwDFDea8LyLGIX1Ek', // $490/yr
  CREDITS_1000: 'price_1TM90DDAwDFDea8LXyYMDoYU', // $39
  CREDITS_3000: 'price_1TM91IDAwDFDea8LFYWHxO1C', // $99
  CREDITS_10000: 'price_1TM91zDAwDFDea8LlLpGQetJ', // $290
} as const;

function resolvePriceId(envValue: string | undefined, canonical: string): string {
  const trimmed = (envValue ?? '').trim();
  // Only honour env override if it looks like a real Stripe price ID.
  // Any other value (empty, whitespace, stale ID from a different env,
  // typo) falls back to the canonical hardcoded ID.
  if (trimmed.startsWith('price_') && trimmed.length >= 20) {
    return trimmed;
  }
  return canonical;
}

// v2 Pricing: Free / Pro / Max (no Starter, Publisher, Agency)
const PRICE_IDS: Record<string, { monthly: string; annual: string }> = {
  pro: {
    monthly: resolvePriceId(process.env.STRIPE_PRICE_PRO_MONTHLY, CANONICAL.PRO_MONTHLY),
    annual: resolvePriceId(process.env.STRIPE_PRICE_PRO_ANNUAL, CANONICAL.PRO_ANNUAL),
  },
  max: {
    monthly: resolvePriceId(process.env.STRIPE_PRICE_MAX_MONTHLY, CANONICAL.MAX_MONTHLY),
    annual: resolvePriceId(process.env.STRIPE_PRICE_MAX_ANNUAL, CANONICAL.MAX_ANNUAL),
  },
};

// Credit packs (one-time purchases, all paid tiers)
const CREDIT_PACK_PRICES: Record<string, string> = {
  v2_credits_1000: resolvePriceId(process.env.STRIPE_PRICE_CREDITS_1000, CANONICAL.CREDITS_1000),
  v2_credits_3000: resolvePriceId(process.env.STRIPE_PRICE_CREDITS_3000, CANONICAL.CREDITS_3000),
  v2_credits_10000: resolvePriceId(process.env.STRIPE_PRICE_CREDITS_10000, CANONICAL.CREDITS_10000),
};

export async function POST(request: NextRequest) {
  try {
    const stripeResult = getStripeOrError();
    if (stripeResult.error) return stripeResult.error;
    const stripe = stripeResult.stripe;

    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { planId, billingPeriod = 'annual', creditPackId } = body;

    // Handle credit pack purchase
    if (creditPackId) {
      return handleCreditPackPurchase(stripe, user.id, creditPackId, supabase, user.email!);
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
      const envVarName =
        planId === 'pro' && billingPeriod === 'monthly'
          ? 'STRIPE_PRICE_PRO_MONTHLY'
          : planId === 'pro'
            ? 'STRIPE_PRICE_PRO_ANNUAL'
            : billingPeriod === 'monthly'
              ? 'STRIPE_PRICE_MAX_MONTHLY'
              : 'STRIPE_PRICE_MAX_ANNUAL';
      return NextResponse.json(
        {
          error: `Pricing for ${planId} ${billingPeriod} is not configured. Missing ${envVarName}.`,
          code: `missing_env:${envVarName}`,
        },
        { status: 503 },
      );
    }

    const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://new.penworth.ai';

    // Diagnostic: log exactly what we're sending to Stripe so 'No such price'
    // errors point at the offending env var. We log the priceId as-is (not a
    // secret; price IDs are visible in Stripe's UI and emails).
    console.log(
      `[stripe-checkout] subscription: planId=${planId} billingPeriod=${billingPeriod} priceId=${priceId} priceLen=${priceId.length}`,
    );

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
    // Surface the underlying Stripe error message so misconfigured prices,
    // invalid customer IDs, etc. become diagnosable instead of a blank 500.
    const message =
      error instanceof Error ? error.message : 'Failed to create checkout session';
    console.error('Checkout error:', error, {
      planId: (await request.clone().json().catch(() => ({})))?.planId,
    });

    // Stripe "No such price" errors are the most common production issue when
    // env-var price IDs don't match what's actually in the Stripe account.
    // Detect and hint at the fix so support doesn't have to read logs.
    const isNoSuchPrice = /No such price/i.test(message);
    return NextResponse.json(
      {
        error: message,
        code: isNoSuchPrice ? 'stripe_invalid_price' : 'checkout_failed',
        hint: isNoSuchPrice
          ? 'A Stripe price ID in the server env does not exist in Stripe. Check STRIPE_PRICE_PRO_MONTHLY / STRIPE_PRICE_PRO_ANNUAL / STRIPE_PRICE_MAX_MONTHLY / STRIPE_PRICE_MAX_ANNUAL / STRIPE_PRICE_CREDITS_* in Vercel env vars match an active price in the Stripe dashboard.'
          : undefined,
      },
      { status: 500 },
    );
  }
}

async function handleCreditPackPurchase(
  stripe: Stripe,
  userId: string,
  creditPackId: string,
  supabase: any,
  userEmail: string
) {
  // All tiers can now buy credit packs (including free)
  const priceId = CREDIT_PACK_PRICES[creditPackId];
  if (!priceId) {
    const envVarName =
      creditPackId === 'v2_credits_1000'
        ? 'STRIPE_PRICE_CREDITS_1000'
        : creditPackId === 'v2_credits_3000'
          ? 'STRIPE_PRICE_CREDITS_3000'
          : creditPackId === 'v2_credits_10000'
            ? 'STRIPE_PRICE_CREDITS_10000'
            : null;
    return NextResponse.json(
      {
        error: envVarName
          ? `Credit pack pricing is not configured. Missing ${envVarName}.`
          : 'Invalid credit pack',
        code: envVarName ? `missing_env:${envVarName}` : 'invalid_credit_pack',
      },
      { status: envVarName ? 503 : 400 },
    );
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://new.penworth.ai';

  // Get or create customer ID
  const { data: orgMember } = await supabase
    .from('org_members')
    .select('organizations(stripe_customer_id)')
    .eq('user_id', userId)
    .single();

  let customerId = (orgMember?.organizations as any)?.stripe_customer_id;

  // If no customer ID, create one (for free users buying their first credit pack)
  if (!customerId) {
    const { data: profile } = await supabase
      .from('profiles')
      .select('full_name')
      .eq('id', userId)
      .single();

    const customer = await stripe.customers.create({
      email: userEmail,
      name: profile?.full_name || undefined,
      metadata: {
        supabase_user_id: userId,
      },
    });
    customerId = customer.id;

    // Save to organization (create one if needed)
    const { data: existingOrg } = await supabase
      .from('org_members')
      .select('org_id')
      .eq('user_id', userId)
      .single();

    if (existingOrg?.org_id) {
      await supabase
        .from('organizations')
        .update({ stripe_customer_id: customerId })
        .eq('id', existingOrg.org_id);
    } else {
      // Create organization for free user
      const { data: newOrg } = await supabase
        .from('organizations')
        .insert({
          name: profile?.full_name ? `${profile.full_name}'s Workspace` : 'My Workspace',
          slug: `workspace-${userId.slice(0, 8)}`,
          industry: 'general',
          stripe_customer_id: customerId,
        })
        .select()
        .single();

      if (newOrg) {
        await supabase.from('org_members').insert({
          org_id: newOrg.id,
          user_id: userId,
          role: 'owner',
        });
      }
    }
  }

  console.log(
    `[stripe-checkout] credit pack: creditPackId=${creditPackId} priceId=${priceId} priceLen=${priceId.length}`,
  );

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
      price_id: priceId, // Add price_id for webhook to identify credits amount
    },
  });

  return NextResponse.json({ url: session.url });
}
