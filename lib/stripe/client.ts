import Stripe from 'stripe';

// Server-side Stripe instance
export const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2025-02-24.acacia',
});

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
