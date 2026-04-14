import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';
import { PLAN_LIMITS, CREDIT_PACKS } from '@/lib/plans';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2024-12-18.acacia',
});

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST(request: NextRequest) {
  const body = await request.text();
  const signature = request.headers.get('stripe-signature')!;

  let event: Stripe.Event;

  try {
    event = stripe.webhooks.constructEvent(
      body,
      signature,
      process.env.STRIPE_WEBHOOK_SECRET!
    );
  } catch (err: any) {
    console.error('Webhook signature verification failed:', err.message);
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 });
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed':
        await handleCheckoutCompleted(event.data.object as Stripe.Checkout.Session);
        break;

      case 'customer.subscription.updated':
        await handleSubscriptionUpdated(event.data.object as Stripe.Subscription);
        break;

      case 'customer.subscription.deleted':
        await handleSubscriptionDeleted(event.data.object as Stripe.Subscription);
        break;

      case 'invoice.payment_succeeded':
        await handlePaymentSucceeded(event.data.object as Stripe.Invoice);
        break;

      case 'invoice.payment_failed':
        await handlePaymentFailed(event.data.object as Stripe.Invoice);
        break;

      default:
        console.log(`Unhandled event type: ${event.type}`);
    }

    return NextResponse.json({ received: true });
  } catch (error) {
    console.error('Webhook handler error:', error);
    return NextResponse.json({ error: 'Webhook handler failed' }, { status: 500 });
  }
}

/**
 * Helper: Find user ID from Stripe customer ID via org_members
 */
async function findUserByCustomerId(customerId: string): Promise<string | null> {
  const { data: org } = await supabase
    .from('organizations')
    .select('id')
    .eq('stripe_customer_id', customerId)
    .single();

  if (!org) return null;

  const { data: ownerMember } = await supabase
    .from('org_members')
    .select('user_id')
    .eq('org_id', org.id)
    .eq('role', 'owner')
    .single();

  return ownerMember?.user_id || null;
}

/**
 * Helper: Find org ID from Stripe customer ID
 */
async function findOrgByCustomerId(customerId: string): Promise<string | null> {
  const { data: org } = await supabase
    .from('organizations')
    .select('id')
    .eq('stripe_customer_id', customerId)
    .single();

  return org?.id || null;
}

/**
 * Handle successful checkout - activate subscription or add credits
 */
async function handleCheckoutCompleted(session: Stripe.Checkout.Session) {
  const userId = session.metadata?.userId;
  if (!userId) {
    console.error('No userId in checkout session metadata');
    return;
  }

  // Check if this is a credit pack purchase
  if (session.metadata?.creditPackId) {
    await handleCreditPackPurchase(userId, session);
    return;
  }

  // Handle subscription activation
  const subscriptionId = session.subscription as string;
  if (!subscriptionId) return;

  const subscription = await stripe.subscriptions.retrieve(subscriptionId);
  const priceId = subscription.items.data[0]?.price.id;
  const plan = getPlanFromPriceId(priceId);

  if (!plan) {
    console.error('Unknown price ID:', priceId);
    return;
  }

  const limits = PLAN_LIMITS[plan];

  // Update user profile
  await supabase
    .from('profiles')
    .update({
      plan,
      credits_balance: limits.monthlyCredits,
      documents_this_month: 0,
      documents_reset_at: new Date().toISOString(),
    })
    .eq('id', userId);

  // Update organization if exists - find by user's org membership
  const { data: orgMember } = await supabase
    .from('org_members')
    .select('org_id')
    .eq('user_id', userId)
    .eq('role', 'owner')
    .single();

  if (orgMember?.org_id) {
    await supabase
      .from('organizations')
      .update({
        subscription_tier: plan,
        stripe_subscription_id: subscriptionId,
        stripe_customer_id: session.customer as string,
      })
      .eq('id', orgMember.org_id);
  }

  // Log transaction
  await supabase.from('credit_transactions').insert({
    user_id: userId,
    amount: limits.monthlyCredits,
    type: 'subscription_activation',
    description: `Activated ${plan.charAt(0).toUpperCase() + plan.slice(1)} plan`,
    metadata: { subscriptionId, priceId },
  });

  console.log(`Subscription activated: ${userId} -> ${plan}`);
}

/**
 * Handle credit pack purchase
 */
async function handleCreditPackPurchase(userId: string, session: Stripe.Checkout.Session) {
  const packId = session.metadata?.creditPackId;
  const pack = CREDIT_PACKS.find(p => p.id === packId);

  if (!pack) {
    console.error('Unknown credit pack:', packId);
    return;
  }

  // Get current purchased credits
  const { data: profile } = await supabase
    .from('profiles')
    .select('credits_purchased')
    .eq('id', userId)
    .single();

  const newPurchased = (profile?.credits_purchased || 0) + pack.credits;

  // Add to purchased credits (never expire)
  await supabase
    .from('profiles')
    .update({ credits_purchased: newPurchased })
    .eq('id', userId);

  // Log transaction
  await supabase.from('credit_transactions').insert({
    user_id: userId,
    amount: pack.credits,
    type: 'credit_purchase',
    description: `Purchased ${pack.name} pack (${pack.credits.toLocaleString()} credits)`,
    metadata: { 
      packId, 
      price: pack.price,
      sessionId: session.id,
    },
  });

  console.log(`Credit pack purchased: ${userId} +${pack.credits} credits`);
}

/**
 * Handle subscription changes (upgrade/downgrade)
 */
async function handleSubscriptionUpdated(subscription: Stripe.Subscription) {
  const customerId = subscription.customer as string;
  
  const userId = await findUserByCustomerId(customerId);
  if (!userId) {
    console.error('No user found for customer:', customerId);
    return;
  }

  const priceId = subscription.items.data[0]?.price.id;
  const plan = getPlanFromPriceId(priceId);

  if (!plan) {
    console.error('Unknown price ID:', priceId);
    return;
  }

  const limits = PLAN_LIMITS[plan];

  // Get current profile to check for upgrade vs downgrade
  const { data: profile } = await supabase
    .from('profiles')
    .select('plan, credits_balance')
    .eq('id', userId)
    .single();

  const isUpgrade = getPlanRank(plan) > getPlanRank(profile?.plan || 'free');

  // On upgrade, immediately give new credit allowance
  const updates: any = { plan };
  
  if (isUpgrade) {
    updates.credits_balance = limits.monthlyCredits;
    updates.documents_this_month = 0;
  }

  await supabase.from('profiles').update(updates).eq('id', userId);

  // Update organization
  const orgId = await findOrgByCustomerId(customerId);
  if (orgId) {
    await supabase
      .from('organizations')
      .update({ subscription_tier: plan })
      .eq('id', orgId);
  }

  console.log(`Subscription ${isUpgrade ? 'upgraded' : 'changed'}: ${userId} -> ${plan}`);
}

/**
 * Handle subscription cancellation - revert to free
 */
async function handleSubscriptionDeleted(subscription: Stripe.Subscription) {
  const customerId = subscription.customer as string;
  
  const userId = await findUserByCustomerId(customerId);
  if (!userId) return;

  const freeLimits = PLAN_LIMITS.free;

  // Revert to free tier
  await supabase
    .from('profiles')
    .update({
      plan: 'free',
      credits_balance: Math.min(freeLimits.monthlyCredits, 1000),
    })
    .eq('id', userId);

  // Update organization
  const orgId = await findOrgByCustomerId(customerId);
  if (orgId) {
    await supabase
      .from('organizations')
      .update({
        subscription_tier: 'free',
        stripe_subscription_id: null,
      })
      .eq('id', orgId);
  }

  // Log
  await supabase.from('credit_transactions').insert({
    user_id: userId,
    amount: 0,
    type: 'subscription_canceled',
    description: 'Subscription canceled - reverted to Free plan',
    metadata: { subscriptionId: subscription.id },
  });

  console.log(`Subscription canceled: ${userId} -> free`);
}

/**
 * Handle successful payment - reset monthly credits
 */
async function handlePaymentSucceeded(invoice: Stripe.Invoice) {
  // Only process subscription renewals (not first payment)
  if (invoice.billing_reason !== 'subscription_cycle') return;

  const customerId = invoice.customer as string;
  
  const userId = await findUserByCustomerId(customerId);
  if (!userId) return;

  // Get current plan
  const { data: profile } = await supabase
    .from('profiles')
    .select('plan, credits_balance')
    .eq('id', userId)
    .single();

  const plan = (profile?.plan as keyof typeof PLAN_LIMITS) || 'free';
  const limits = PLAN_LIMITS[plan];

  // Handle credit rollover for Max plan
  let newCredits = limits.monthlyCredits;
  
  if (plan === 'max' && limits.creditRollover) {
    const rollover = Math.min(profile?.credits_balance || 0, limits.creditRollover);
    newCredits = limits.monthlyCredits + rollover;
  }

  // Reset monthly credits and document count
  await supabase
    .from('profiles')
    .update({
      credits_balance: newCredits,
      documents_this_month: 0,
      documents_reset_at: new Date().toISOString(),
    })
    .eq('id', userId);

  // Log
  await supabase.from('credit_transactions').insert({
    user_id: userId,
    amount: newCredits,
    type: 'billing_cycle_reset',
    description: `Monthly credits reset (${plan.charAt(0).toUpperCase() + plan.slice(1)} plan)`,
    metadata: { invoiceId: invoice.id },
  });

  console.log(`Billing cycle reset: ${userId} credits=${newCredits}`);
}

/**
 * Handle failed payment - start grace period
 */
async function handlePaymentFailed(invoice: Stripe.Invoice) {
  const customerId = invoice.customer as string;
  
  const userId = await findUserByCustomerId(customerId);
  if (!userId) return;

  // Mark profile as past_due (7-day grace period)
  await supabase
    .from('profiles')
    .update({
      payment_status: 'past_due',
      payment_grace_ends: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    })
    .eq('id', userId);

  console.log(`Payment failed for user ${userId} - starting 7-day grace period`);
}

/**
 * Map Stripe price ID to plan name
 */
function getPlanFromPriceId(priceId: string): 'pro' | 'max' | null {
  const priceMap: Record<string, 'pro' | 'max'> = {
    [process.env.STRIPE_PRICE_PRO_MONTHLY!]: 'pro',
    [process.env.STRIPE_PRICE_PRO_ANNUAL!]: 'pro',
    [process.env.STRIPE_PRICE_MAX_MONTHLY!]: 'max',
    [process.env.STRIPE_PRICE_MAX_ANNUAL!]: 'max',
  };
  return priceMap[priceId] || null;
}

/**
 * Get plan rank for comparison
 */
function getPlanRank(plan: string): number {
  const ranks: Record<string, number> = { free: 0, pro: 1, max: 2 };
  return ranks[plan] || 0;
}
