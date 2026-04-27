// Shared Stripe event processor.
//
// Authored: 2026-04-27 by CTO security/ops pass (CEO-179).
//
// Why this exists:
//   The webhook handler at app/api/stripe/webhook/route.ts used to keep all
//   the per-event-type business logic file-local. That blocked the Stripe
//   reconcile cron (CEO-178) from auto-replaying failed events without
//   reaching back through the webhook URL (which would fail signature
//   verification, since the cron has the body as JSON and not the original
//   raw signed payload). Extracting the dispatch into this module gives
//   both the webhook route AND the reconcile cron a clean, shared call site.
//
// Idempotency contract:
//   Idempotency is the caller's responsibility — by stripe_event_id.
//     - The webhook route uses recordStripeEvent + markStripeEventProcessed
//     - The reconcile cron only replays rows with processing_status='failed'
//       and bumps retry_count + flips status='replayed' on success.
//   This module's handlers themselves are NOT individually idempotent
//   (e.g. handleCreditPackPurchase will double-credit if called twice for
//   the same session.id). Always gate with the dedup key before calling.

import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';
import { PLAN_LIMITS, CREDIT_PACKS } from '@/lib/plans';
import { getStripeOrError } from '@/lib/stripe/client';
import {
  recordFirstPayment,
  recordRenewalPayment,
  handleSubscriptionCancelled as guildHandleCancellation,
  handleRefund as guildHandleRefund,
} from '@/lib/guild/commissions';
import { logAudit } from '@/lib/audit';

// Module-local service-role client. Both the webhook route (which runs in
// the Next.js Node runtime with NEXT_PUBLIC_SUPABASE_URL +
// SUPABASE_SERVICE_ROLE_KEY available) and the reconcile cron (which runs
// inside Inngest with the same env) hit this. createServiceClient from
// lib/supabase/service.ts could be used too, but the existing pattern in
// the webhook used a local createClient() — preserving for behavioural
// equivalence.
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

// ─────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────

/**
 * Possible outcomes of dispatching a single Stripe event.
 *
 * - 'handled'   → an event-specific handler ran (return path of switch case)
 * - 'skipped'   → recognised but intentionally not acted on (e.g. self-pay
 *                 deferred branch returning early after waiving fees;
 *                 invoice.payment_succeeded with billing_reason !=
 *                 'subscription_cycle'). Caller should record the row as
 *                 'processed' or 'skipped' depending on its policy.
 * - 'unhandled' → event type not in the switch case. Caller should record
 *                 the row as 'skipped' with a "unhandled event type" note.
 */
export type ProcessOutcome = 'handled' | 'skipped' | 'unhandled';

/**
 * Dispatch a Stripe event to its handler. Throws on handler error so the
 * caller can mark the row as 'failed' and capture the message.
 *
 * The caller is responsible for idempotency (see file-level comment).
 */
export async function processStripeEvent(event: Stripe.Event): Promise<ProcessOutcome> {
  const stripeResult = getStripeOrError();
  if (stripeResult.error) {
    throw new Error('Stripe client unavailable: STRIPE_SECRET_KEY missing');
  }
  const stripe = stripeResult.stripe;

  switch (event.type) {
    case 'checkout.session.completed': {
      const session = event.data.object as Stripe.Checkout.Session;
      // Self-pay-deferred special case (CEO-031 era contract): a payment
      // session with metadata.type='guild_self_pay_deferred' UPDATEs
      // existing non-terminal guild_account_fees rows rather than
      // dispatching to the generic checkout handler. handleCheckoutCompleted
      // expects metadata.userId (camelCase); self-pay sessions use
      // member_id + user_id (snake_case) per /api/guild/self-pay-deferred.
      if (
        session.mode === 'payment' &&
        session.metadata?.type === 'guild_self_pay_deferred'
      ) {
        const handled = await handleSelfPayDeferred(session);
        return handled ? 'handled' : 'skipped';
      }
      await handleCheckoutCompleted(stripe, session);
      return 'handled';
    }
    case 'customer.subscription.updated':
      await handleSubscriptionUpdated(event.data.object as Stripe.Subscription);
      return 'handled';
    case 'customer.subscription.deleted':
      await handleSubscriptionDeleted(event.data.object as Stripe.Subscription);
      return 'handled';
    case 'invoice.payment_succeeded':
      // handlePaymentSucceeded itself early-returns on non-subscription_cycle
      // billing_reason; we still consider that 'handled' (we evaluated it
      // and decided not to act).
      await handlePaymentSucceeded(event.data.object as Stripe.Invoice);
      return 'handled';
    case 'invoice.payment_failed':
      await handlePaymentFailed(event.data.object as Stripe.Invoice);
      return 'handled';
    case 'charge.refunded':
      await handleChargeRefunded(event.data.object as Stripe.Charge);
      return 'handled';
    case 'charge.dispute.created':
      await handleChargeDispute(stripe, event.data.object as Stripe.Dispute);
      return 'handled';
    default:
      return 'unhandled';
  }
}

// ─────────────────────────────────────────────────────────────────────
// Customer / org lookup helpers
// ─────────────────────────────────────────────────────────────────────

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

async function findOrgByCustomerId(customerId: string): Promise<string | null> {
  const { data: org } = await supabase
    .from('organizations')
    .select('id')
    .eq('stripe_customer_id', customerId)
    .single();
  return org?.id || null;
}

function getPlanFromPriceId(priceId: string): 'pro' | 'max' | null {
  const priceMap: Record<string, 'pro' | 'max'> = {
    [process.env.STRIPE_PRICE_PRO_MONTHLY!]: 'pro',
    [process.env.STRIPE_PRICE_PRO_ANNUAL!]: 'pro',
    [process.env.STRIPE_PRICE_MAX_MONTHLY!]: 'max',
    [process.env.STRIPE_PRICE_MAX_ANNUAL!]: 'max',
  };
  return priceMap[priceId] || null;
}

function getPlanRank(plan: string): number {
  const ranks: Record<string, number> = { free: 0, pro: 1, max: 2 };
  return ranks[plan] || 0;
}

// ─────────────────────────────────────────────────────────────────────
// Event handlers (extracted verbatim from the original webhook route,
// other than module-level state references which now reach the local
// `supabase` client of this module).
// ─────────────────────────────────────────────────────────────────────

/**
 * Self-pay deferred fee waiver. Returns true if any rows were waived,
 * false if the session had no member/user metadata or no deferred rows.
 */
async function handleSelfPayDeferred(session: Stripe.Checkout.Session): Promise<boolean> {
  const memberId = session.metadata?.member_id;
  const userId = session.metadata?.user_id;
  if (!memberId || !userId) return false;

  const { data: feeRows, error: selectErr } = await supabase
    .from('guild_account_fees')
    .select('id, amount_deferred_usd, amount_waived_usd, notes')
    .eq('guildmember_id', memberId)
    .not('status', 'in', '(waived,cancelled,fully_deducted)');
  if (selectErr) {
    console.error('[stripe/process] self-pay: select deferred rows failed:', selectErr);
    throw selectErr;
  }

  const stripeSessionNote = `stripe_session:${session.id}`;
  const nowIso = new Date().toISOString();

  for (const fee of feeRows || []) {
    const deferred = Number(fee.amount_deferred_usd || 0);
    if (deferred <= 0) continue;
    const priorWaived = Number(fee.amount_waived_usd || 0);
    const priorNotes = fee.notes ? `${fee.notes}\n` : '';
    const { error: updateErr } = await supabase
      .from('guild_account_fees')
      .update({
        status: 'waived',
        amount_waived_usd: Number((priorWaived + deferred).toFixed(2)),
        amount_deferred_usd: 0,
        waiver_reason: 'self_paid_via_stripe',
        waiver_granted_by: userId,
        notes: `${priorNotes}${stripeSessionNote}`,
        resolved_at: nowIso,
      })
      .eq('id', fee.id);
    if (updateErr) {
      console.error(`[stripe/process] self-pay: update fee ${fee.id} failed:`, updateErr);
      throw updateErr;
    }
  }

  console.log(
    `[stripe/process] self-pay: waived ${feeRows?.length ?? 0} deferred fee row(s) for member ${memberId} via session ${session.id}`,
  );
  return true;
}

async function handleCheckoutCompleted(stripe: Stripe, session: Stripe.Checkout.Session) {
  const userId = session.metadata?.userId;
  if (!userId) {
    console.error('No userId in checkout session metadata');
    return;
  }
  if (session.metadata?.creditPackId) {
    await handleCreditPackPurchase(userId, session);
    return;
  }
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

  await supabase
    .from('profiles')
    .update({
      plan,
      credits_balance: limits.monthlyCredits,
      documents_this_month: 0,
      documents_reset_at: new Date().toISOString(),
    })
    .eq('id', userId);

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

  await supabase.from('credit_transactions').insert({
    user_id: userId,
    amount: limits.monthlyCredits,
    transaction_type: 'purchase',
    reference_id: null,
    notes: `Activated ${plan.charAt(0).toUpperCase() + plan.slice(1)} plan · subscription ${subscriptionId}`,
  });

  console.log(`Subscription activated: ${userId} -> ${plan}`);

  try {
    const invoiceId = typeof subscription.latest_invoice === 'string'
      ? subscription.latest_invoice
      : subscription.latest_invoice?.id || null;
    const unitAmountCents = subscription.items.data[0]?.price.unit_amount;
    const priceOverrideUsd = typeof unitAmountCents === 'number' ? unitAmountCents / 100 : undefined;
    await recordFirstPayment({
      admin: supabase,
      referredUserId: userId,
      plan,
      stripeInvoiceId: invoiceId,
      stripePaymentIntentId: null,
      priceOverrideUsd,
    });
  } catch (err) {
    console.error('[guild] recordFirstPayment failed:', err);
  }
}

async function handleCreditPackPurchase(userId: string, session: Stripe.Checkout.Session) {
  const packId = session.metadata?.creditPackId;
  const pack = CREDIT_PACKS.find((p) => p.id === packId);
  if (!pack) {
    console.error('Unknown credit pack:', packId);
    return;
  }
  const { data: profile } = await supabase
    .from('profiles')
    .select('credits_purchased')
    .eq('id', userId)
    .single();
  const newPurchased = (profile?.credits_purchased || 0) + pack.credits;
  await supabase.from('profiles').update({ credits_purchased: newPurchased }).eq('id', userId);
  await supabase.from('credit_transactions').insert({
    user_id: userId,
    amount: pack.credits,
    transaction_type: 'purchase',
    reference_id: null,
    notes: `Purchased ${pack.name} pack (${pack.credits.toLocaleString()} credits) · session ${session.id} · $${pack.price}`,
  });
  void logAudit({
    actorType: 'stripe_webhook',
    actorUserId: userId,
    action: 'credit_pack.purchase',
    entityType: 'credit_transaction',
    entityId: session.id,
    after: {
      credits_added: pack.credits,
      price_usd: pack.price,
      pack_id: pack.id,
      pack_name: pack.name,
      credits_purchased_new_total: newPurchased,
    },
    metadata: {
      stripe_session_id: session.id,
      stripe_customer_id: typeof session.customer === 'string' ? session.customer : null,
    },
  });
  console.log(`Credit pack purchased: ${userId} +${pack.credits} credits`);
}

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
  const { data: profile } = await supabase
    .from('profiles')
    .select('plan, credits_balance')
    .eq('id', userId)
    .single();
  const isUpgrade = getPlanRank(plan) > getPlanRank(profile?.plan || 'free');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const updates: any = { plan };
  if (isUpgrade) {
    updates.credits_balance = limits.monthlyCredits;
    updates.documents_this_month = 0;
  }
  await supabase.from('profiles').update(updates).eq('id', userId);
  const orgId = await findOrgByCustomerId(customerId);
  if (orgId) {
    await supabase.from('organizations').update({ subscription_tier: plan }).eq('id', orgId);
  }
  void logAudit({
    actorType: 'stripe_webhook',
    actorUserId: userId,
    action: 'subscription.activate',
    entityType: 'subscription',
    entityId: subscription.id,
    before: { plan: profile?.plan ?? 'free' },
    after: {
      plan,
      credits_balance: isUpgrade ? limits.monthlyCredits : profile?.credits_balance ?? 0,
    },
    metadata: {
      change_type: isUpgrade
        ? 'upgrade'
        : getPlanRank(plan) < getPlanRank(profile?.plan || 'free')
          ? 'downgrade'
          : 'renewal_or_update',
      stripe_price_id: priceId,
      stripe_customer_id: customerId,
      org_id: orgId,
    },
  });
  console.log(`Subscription ${isUpgrade ? 'upgraded' : 'changed'}: ${userId} -> ${plan}`);
}

async function handleSubscriptionDeleted(subscription: Stripe.Subscription) {
  const customerId = subscription.customer as string;
  const userId = await findUserByCustomerId(customerId);
  if (!userId) return;
  const freeLimits = PLAN_LIMITS.free;
  await supabase
    .from('profiles')
    .update({
      plan: 'free',
      credits_balance: Math.min(freeLimits.monthlyCredits, 1000),
    })
    .eq('id', userId);
  const orgId = await findOrgByCustomerId(customerId);
  if (orgId) {
    await supabase
      .from('organizations')
      .update({ subscription_tier: 'free', stripe_subscription_id: null })
      .eq('id', orgId);
  }
  await supabase.from('credit_transactions').insert({
    user_id: userId,
    amount: 0,
    transaction_type: 'admin_adjustment',
    reference_id: null,
    notes: `Subscription canceled - reverted to Free plan · subscription ${subscription.id}`,
  });
  void logAudit({
    actorType: 'stripe_webhook',
    actorUserId: userId,
    action: 'subscription.cancel',
    entityType: 'subscription',
    entityId: subscription.id,
    after: { plan: 'free' },
    metadata: {
      stripe_customer_id: customerId,
      org_id: orgId,
      cancel_reason: subscription.cancellation_details?.reason ?? null,
    },
  });
  console.log(`Subscription canceled: ${userId} -> free`);
  try {
    await guildHandleCancellation({ admin: supabase, referredUserId: userId });
  } catch (err) {
    console.error('[guild] handleSubscriptionCancelled failed:', err);
  }
}

async function handlePaymentSucceeded(invoice: Stripe.Invoice) {
  if (invoice.billing_reason !== 'subscription_cycle') return;
  const customerId = invoice.customer as string;
  const userId = await findUserByCustomerId(customerId);
  if (!userId) return;
  const { data: profile } = await supabase
    .from('profiles')
    .select('plan, credits_balance')
    .eq('id', userId)
    .single();
  const plan = (profile?.plan as keyof typeof PLAN_LIMITS) || 'free';
  const limits = PLAN_LIMITS[plan];
  let newCredits = limits.monthlyCredits;
  if (plan === 'max' && limits.creditRollover) {
    const rollover = Math.min(profile?.credits_balance || 0, limits.creditRollover);
    newCredits = limits.monthlyCredits + rollover;
  }
  await supabase
    .from('profiles')
    .update({
      credits_balance: newCredits,
      documents_this_month: 0,
      documents_reset_at: new Date().toISOString(),
    })
    .eq('id', userId);
  await supabase.from('credit_transactions').insert({
    user_id: userId,
    amount: newCredits,
    transaction_type: 'admin_adjustment',
    reference_id: null,
    notes: `Monthly credits reset (${plan.charAt(0).toUpperCase() + plan.slice(1)} plan) · invoice ${invoice.id}`,
  });
  console.log(`Billing cycle reset: ${userId} credits=${newCredits}`);
  const previousBalance = profile?.credits_balance ?? 0;
  const rolloverAmount =
    plan === 'max' && limits.creditRollover
      ? Math.min(previousBalance, limits.creditRollover)
      : 0;
  void logAudit({
    actorType: 'stripe_webhook',
    actorUserId: userId,
    action: 'credit.grant',
    entityType: 'profile',
    entityId: userId,
    before: { credits_balance: previousBalance },
    after: { credits_balance: newCredits },
    metadata: {
      kind: 'monthly_renewal',
      plan,
      monthly_grant: limits.monthlyCredits,
      rollover_applied: rolloverAmount,
      rollover_cap: plan === 'max' ? limits.creditRollover ?? 0 : 0,
      stripe_invoice_id: invoice.id,
      stripe_customer_id: customerId,
      invoice_amount_paid_cents:
        typeof invoice.amount_paid === 'number' ? invoice.amount_paid : null,
      billing_reason: invoice.billing_reason,
    },
  });
  try {
    const priceOverrideUsd =
      typeof invoice.amount_paid === 'number' && invoice.amount_paid > 0
        ? invoice.amount_paid / 100
        : undefined;
    await recordRenewalPayment({
      admin: supabase,
      referredUserId: userId,
      stripeInvoiceId: invoice.id,
      stripePaymentIntentId:
        typeof invoice.payment_intent === 'string'
          ? invoice.payment_intent
          : invoice.payment_intent?.id || null,
      priceOverrideUsd,
    });
  } catch (err) {
    console.error('[guild] recordRenewalPayment failed:', err);
  }
}

async function handlePaymentFailed(invoice: Stripe.Invoice) {
  const customerId = invoice.customer as string;
  const userId = await findUserByCustomerId(customerId);
  if (!userId) return;
  await supabase
    .from('profiles')
    .update({
      payment_status: 'past_due',
      payment_grace_ends: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    })
    .eq('id', userId);
  console.log(`Payment failed for user ${userId} - starting 7-day grace period`);
}

async function handleChargeRefunded(charge: Stripe.Charge) {
  const invoiceId = typeof charge.invoice === 'string' ? charge.invoice : charge.invoice?.id;
  if (!invoiceId) {
    console.log('[guild] Refund without linked invoice, skipping');
    return;
  }
  try {
    const result = await guildHandleRefund({
      admin: supabase,
      stripeInvoiceId: invoiceId,
      clawbackAll: false,
    });
    if (result) {
      console.log(`[guild] Refund clawback processed for invoice ${invoiceId}`);
    }
  } catch (err) {
    console.error('[guild] Refund clawback failed:', err);
  }
  void logAudit({
    actorType: 'stripe_webhook',
    action: 'refund.issue',
    entityType: 'charge',
    entityId: charge.id,
    after: {
      refund_amount_usd: (charge.amount_refunded ?? 0) / 100,
      charge_amount_usd: (charge.amount ?? 0) / 100,
      is_partial: (charge.amount_refunded ?? 0) < (charge.amount ?? 0),
    },
    metadata: {
      stripe_charge_id: charge.id,
      stripe_invoice_id: invoiceId,
      refund_amount_cents: charge.amount_refunded,
      charge_amount_cents: charge.amount,
      currency: charge.currency,
    },
  });
}

async function handleChargeDispute(stripe: Stripe, dispute: Stripe.Dispute) {
  const chargeId = typeof dispute.charge === 'string' ? dispute.charge : dispute.charge?.id;
  if (!chargeId) return;
  try {
    const charge = await stripe.charges.retrieve(chargeId);
    const invoiceId = typeof charge.invoice === 'string' ? charge.invoice : charge.invoice?.id;
    if (!invoiceId) return;
    const result = await guildHandleRefund({
      admin: supabase,
      stripeInvoiceId: invoiceId,
      clawbackAll: true,
    });
    if (result) {
      console.log(`[guild] Chargeback clawback processed for invoice ${invoiceId}`);
    }
  } catch (err) {
    console.error('[guild] Dispute clawback failed:', err);
  }
  void logAudit({
    actorType: 'stripe_webhook',
    action: 'refund.issue',
    entityType: 'dispute',
    entityId: dispute.id,
    severity: 'warning',
    after: {
      dispute_amount_usd: (dispute.amount ?? 0) / 100,
      status: dispute.status,
      reason: dispute.reason,
    },
    metadata: {
      stripe_dispute_id: dispute.id,
      stripe_charge_id: chargeId,
      dispute_amount_cents: dispute.amount,
      currency: dispute.currency,
      is_charge_refundable: dispute.is_charge_refundable,
    },
  });
}
