import { NextResponse } from 'next/server';
import Stripe from 'stripe';

/**
 * Eager server-side Stripe instance. Kept for backward compat with the
 * helpers below (createCheckoutSession / createBillingPortalSession). New
 * routes should prefer getStripeOrError() — see the note on that function.
 *
 * If STRIPE_SECRET_KEY is missing at import time, this is an empty-string
 * Stripe client that will reject with a clear Stripe-side error on first
 * API call rather than crashing the whole route. Prefer the lazy helper.
 */
export const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || 'sk_missing', {
  apiVersion: '2025-02-24.acacia',
});

/**
 * Lazy Stripe client with specific-missing-env diagnostics.
 *
 * Previously our Stripe routes did `new Stripe(process.env.STRIPE_SECRET_KEY!)`
 * at module top level. That pattern crashes the entire route at first-import
 * time when the secret is missing, and the user sees a generic 500 with no
 * signal about what's broken. This helper defers instantiation to request
 * time and returns a structured error identifying the exact missing var, so
 * frontends can surface the exact missing env var in the network tab.
 */
export function getStripeOrError():
  | { stripe: Stripe; error?: undefined }
  | { stripe?: undefined; error: NextResponse } {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) {
    return {
      error: NextResponse.json(
        {
          error:
            'Billing is not configured. STRIPE_SECRET_KEY is missing on the server. ' +
            'Contact support@penworth.ai.',
          code: 'missing_env:STRIPE_SECRET_KEY',
        },
        { status: 503 },
      ),
    };
  }
  return { stripe: new Stripe(key, { apiVersion: '2025-02-24.acacia' }) };
}

/**
 * Same pattern for the webhook secret — resolved lazily so a missing secret
 * doesn't take down module import, just returns a clear 503 at request time.
 */
export function getWebhookSecretOrError():
  | { secret: string; error?: undefined }
  | { secret?: undefined; error: NextResponse } {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) {
    return {
      error: NextResponse.json(
        {
          error: 'Webhook is not configured. STRIPE_WEBHOOK_SECRET is missing.',
          code: 'missing_env:STRIPE_WEBHOOK_SECRET',
        },
        { status: 503 },
      ),
    };
  }
  return { secret };
}

// Price IDs
export const PRICES = {
  PRO_MONTHLY: process.env.STRIPE_PRICE_PRO_MONTHLY!,
  TEAM_MONTHLY: process.env.STRIPE_PRICE_TEAM_MONTHLY!,
} as const;

// Create checkout session for subscription
export async function createCheckoutSession({
  userId,
  orgId,
  priceId,
  successUrl,
  cancelUrl,
  customerEmail,
}: {
  userId?: string;
  orgId?: string;
  priceId: string;
  successUrl: string;
  cancelUrl: string;
  customerEmail?: string;
}) {
  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    payment_method_types: ['card'],
    line_items: [
      {
        price: priceId,
        quantity: 1,
      },
    ],
    success_url: successUrl,
    cancel_url: cancelUrl,
    customer_email: customerEmail,
    metadata: {
      user_id: userId || '',
      org_id: orgId || '',
    },
    subscription_data: {
      metadata: {
        user_id: userId || '',
        org_id: orgId || '',
      },
    },
  });

  return session;
}

// Create billing portal session
export async function createBillingPortalSession({
  customerId,
  returnUrl,
}: {
  customerId: string;
  returnUrl: string;
}) {
  const session = await stripe.billingPortal.sessions.create({
    customer: customerId,
    return_url: returnUrl,
  });

  return session;
}

// Get subscription details
export async function getSubscription(subscriptionId: string) {
  return await stripe.subscriptions.retrieve(subscriptionId);
}

// Cancel subscription
export async function cancelSubscription(subscriptionId: string) {
  return await stripe.subscriptions.cancel(subscriptionId);
}
