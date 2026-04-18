import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';
import { PLAN_LIMITS, CREDIT_PACKS } from '@/lib/plans';
import { getStripeOrError, getWebhookSecretOrError } from '@/lib/stripe/client';
import {
  recordStripeEvent,
  markStripeEventProcessed,
  markStripeEventFailed,
  markStripeEventSkipped,
} from '@/lib/stripe/webhook-idempotency';
import {
  recordFirstPayment,
  recordRenewalPayment,
  handleSubscriptionCancelled as guildHandleCancellation,
  handleRefund as guildHandleRefund,
} from '@/lib/guild/commissions';
import { logAudit } from '@/lib/audit';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST(request: NextRequest) {
  const stripeResult = getStripeOrError();
  if (stripeResult.error) return stripeResult.error;
  const stripe = stripeResult.stripe;

  const secretResult = getWebhookSecretOrError();
  if (secretResult.error) return secretResult.error;
  const webhookSecret = secretResult.secret;

  const body = await request.text();
  const signature = request.headers.get('stripe-signature')!;

  let event: Stripe.Event;

  try {
    event = stripe.webhooks.constructEvent(body, signature, webhookSecret);
  } catch (err: any) {
    console.error('Webhook signature verification failed:', err.message);
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 });
  }

  // Idempotency gate: record this event before any handler runs. If the
  // same stripe_event_id has already been processed, skip — Stripe can
  // retry deliveries and we must never double-commission or double-grant.
  const gate = await recordStripeEvent(supabase, event, 'webhook');
  if (!gate.shouldProcess) {
    console.log(
      `[stripe/webhook] Skipping event ${event.id} (${event.type}): ${gate.reason}`,
    );
    return NextResponse.json({ received: true, duplicate: true });
  }

  try {
    let handled = true;
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session;

        // Guild self-pay deferred balance — handled BEFORE dispatching to
        // handleCheckoutCompleted, because that function early-returns when
        // session.metadata?.userId (camelCase) is missing, and self-pay
        // sessions use user_id (snake_case) per the /api/guild/self-pay-
        // deferred endpoint's metadata contract:
        //   type='guild_self_pay_deferred', member_id, user_id, balance_usd
        //
        // We UPDATE existing non-terminal guild_account_fees rows rather
        // than INSERT a new waiver row — the guild_deferred_balance_usd
        // RPC sums amount_deferred_usd on non-terminal rows; only by
        // zeroing those amounts does the balance reach $0, which fires
        // trg_guild_auto_lift_probation and returns the member to active.
        if (
          session.mode === 'payment' &&
          session.metadata?.type === 'guild_self_pay_deferred'
        ) {
          const memberId = session.metadata.member_id;
          const userId = session.metadata.user_id;

          if (memberId && userId) {
            const { data: feeRows, error: selectErr } = await supabase
              .from('guild_account_fees')
              .select('id, amount_deferred_usd, amount_waived_usd, notes')
              .eq('guildmember_id', memberId)
              .not('status', 'in', '(waived,cancelled,fully_deducted)');

            if (selectErr) {
              console.error(
                '[stripe/webhook] self-pay: select deferred rows failed:',
                selectErr,
              );
              throw selectErr;
            }

            const stripeSessionNote = `stripe_session:${session.id}`;
            const nowIso = new Date().toISOString();

            for (const fee of feeRows || []) {
              const deferred = Number(fee.amount_deferred_usd || 0);
              // Skip rows with no deferred amount — 'pending' rows with
              // status='pending' and zero deferred should stay alone.
              if (deferred <= 0) continue;

              const priorWaived = Number(fee.amount_waived_usd || 0);
              const priorNotes = fee.notes ? `${fee.notes}\n` : '';

              const { error: updateErr } = await supabase
                .from('guild_account_fees')
                .update({
                  status: 'waived',
                  amount_waived_usd: Number(
                    (priorWaived + deferred).toFixed(2),
                  ),
                  amount_deferred_usd: 0,
                  waiver_reason: 'self_paid_via_stripe',
                  waiver_granted_by: userId,
                  notes: `${priorNotes}${stripeSessionNote}`,
                  resolved_at: nowIso,
                })
                .eq('id', fee.id);

              if (updateErr) {
                console.error(
                  `[stripe/webhook] self-pay: update fee ${fee.id} failed:`,
                  updateErr,
                );
                throw updateErr;
              }
            }

            console.log(
              `[stripe/webhook] self-pay: waived ${feeRows?.length ?? 0} deferred fee row(s) for member ${memberId} via session ${session.id}`,
            );
            // The trg_guild_auto_lift_probation trigger fires on every
            // UPDATE to guild_account_fees; when guild_deferred_balance_usd
            // returns 0, it transitions the member from probation → active.
            // Skip handleCheckoutCompleted — self-pay is not a subscription
            // or credit pack, and handleCheckoutCompleted would early-return
            // anyway on missing userId (camelCase).
            break;
          }
        }

        await handleCheckoutCompleted(stripe, session);
        break;
      }

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

      case 'charge.refunded':
        await handleChargeRefunded(event.data.object as Stripe.Charge);
        break;

      case 'charge.dispute.created':
        await handleChargeDispute(stripe, event.data.object as Stripe.Dispute);
        break;

      default:
        handled = false;
        console.log(`Unhandled event type: ${event.type}`);
    }

    if (handled) {
      await markStripeEventProcessed(supabase, event.id);
    } else {
      await markStripeEventSkipped(supabase, event.id, `unhandled event type: ${event.type}`);
    }

    return NextResponse.json({ received: true });
  } catch (error) {
    console.error('Webhook handler error:', error);
    await markStripeEventFailed(supabase, event.id, error);
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
async function handleCheckoutCompleted(stripe: Stripe, session: Stripe.Checkout.Session) {
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

  // Log transaction. Note: credit_transactions schema is {user_id, amount,
  // transaction_type, reference_id, notes} — NOT {type, description, metadata}.
  // Must use allowed enum 'purchase' (subscription_activation is not in the
  // CHECK constraint).
  await supabase.from('credit_transactions').insert({
    user_id: userId,
    amount: limits.monthlyCredits,
    transaction_type: 'purchase',
    reference_id: null,
    notes: `Activated ${plan.charAt(0).toUpperCase() + plan.slice(1)} plan · subscription ${subscriptionId}`,
  });

  console.log(`Subscription activated: ${userId} -> ${plan}`);

  // ---------------------------------------------------------------------
  // Guild commission hook — first payment from a referred user
  // ---------------------------------------------------------------------
  try {
    const invoiceId = typeof subscription.latest_invoice === 'string'
      ? subscription.latest_invoice
      : subscription.latest_invoice?.id || null;

    // Use the actual amount on the Stripe price, not the monthly table value —
    // critical for annual plans where unit_amount is the full annual price
    // (e.g. $190 for Pro Annual) rather than $19/month.
    const unitAmountCents = subscription.items.data[0]?.price.unit_amount;
    const priceOverrideUsd =
      typeof unitAmountCents === 'number' ? unitAmountCents / 100 : undefined;

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
    // Non-fatal — don't break subscription activation
  }
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

  // Log transaction. Schema: {user_id, amount, transaction_type, reference_id, notes}
  await supabase.from('credit_transactions').insert({
    user_id: userId,
    amount: pack.credits,
    transaction_type: 'purchase',
    reference_id: null,
    notes: `Purchased ${pack.name} pack (${pack.credits.toLocaleString()} credits) · session ${session.id} · $${pack.price}`,
  });

  // Audit trail — credit_pack.purchase. Fire-and-forget so a logAudit
  // failure cannot break the webhook (Stripe would then retry the whole
  // event, leading to double-crediting).
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

  // Audit trail — subscription.activate (covers both activations and
  // plan changes; the change_type metadata disambiguates).
  void logAudit({
    actorType: 'stripe_webhook',
    actorUserId: userId,
    action: 'subscription.activate',
    entityType: 'subscription',
    entityId: subscription.id,
    before: { plan: profile?.plan ?? 'free' },
    after: { plan, credits_balance: isUpgrade ? limits.monthlyCredits : profile?.credits_balance ?? 0 },
    metadata: {
      change_type: isUpgrade ? 'upgrade' : (getPlanRank(plan) < getPlanRank(profile?.plan || 'free') ? 'downgrade' : 'renewal_or_update'),
      stripe_price_id: priceId,
      stripe_customer_id: customerId,
      org_id: orgId,
    },
  });

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

  // Log. Using 'admin_adjustment' as a catch-all for non-purchase lifecycle
  // events since the CHECK constraint doesn't allow subscription_canceled.
  await supabase.from('credit_transactions').insert({
    user_id: userId,
    amount: 0,
    transaction_type: 'admin_adjustment',
    reference_id: null,
    notes: `Subscription canceled - reverted to Free plan · subscription ${subscription.id}`,
  });

  // Audit trail — subscription.cancel. This is a severity-info event;
  // routine churn, not an incident. Board reports aggregate monthly
  // cancels from audit_log.
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

  // ---------------------------------------------------------------------
  // Guild cancellation hook
  // ---------------------------------------------------------------------
  try {
    await guildHandleCancellation({ admin: supabase, referredUserId: userId });
  } catch (err) {
    console.error('[guild] handleSubscriptionCancelled failed:', err);
  }
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

  // Log. 'admin_adjustment' is the catch-all enum value for lifecycle
  // events not in the CHECK constraint's allowed set.
  await supabase.from('credit_transactions').insert({
    user_id: userId,
    amount: newCredits,
    transaction_type: 'admin_adjustment',
    reference_id: null,
    notes: `Monthly credits reset (${plan.charAt(0).toUpperCase() + plan.slice(1)} plan) · invoice ${invoice.id}`,
  });

  console.log(`Billing cycle reset: ${userId} credits=${newCredits}`);

  // ---------------------------------------------------------------------
  // Guild commission hook — renewal payment from a referred user
  // ---------------------------------------------------------------------
  try {
    // Use invoice.amount_paid (cents) as the authoritative renewal amount —
    // correct for annual renewals ($190/$490 invoices), mid-cycle proration,
    // and any future price changes.
    const priceOverrideUsd =
      typeof invoice.amount_paid === 'number' && invoice.amount_paid > 0
        ? invoice.amount_paid / 100
        : undefined;

    await recordRenewalPayment({
      admin: supabase,
      referredUserId: userId,
      stripeInvoiceId: invoice.id,
      stripePaymentIntentId: typeof invoice.payment_intent === 'string'
        ? invoice.payment_intent
        : invoice.payment_intent?.id || null,
      priceOverrideUsd,
    });
  } catch (err) {
    console.error('[guild] recordRenewalPayment failed:', err);
  }
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

/**
 * Handle refund — Guild commission clawback for the refunded invoice.
 */
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

  // Audit trail — refund.issue. Refunds go through even when the guild
  // clawback fails (the try/catch above swallows that error), so we log
  // regardless. Amount is in major units (USD) for human readability
  // in the investor report, with minor-unit original preserved in
  // metadata.
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

/**
 * Handle chargeback — claw back entire referral's commissions + mark as refunded.
 */
async function handleChargeDispute(stripe: Stripe, dispute: Stripe.Dispute) {
  const chargeId = typeof dispute.charge === 'string' ? dispute.charge : dispute.charge?.id;
  if (!chargeId) return;

  try {
    // Find the invoice this charge is tied to
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

  // Audit trail — refund.issue with severity=warning. Disputes are
  // always worth a board-report line item: they signal either fraud,
  // service failure, or user dissatisfaction, all of which investors
  // care about tracking. dispute.reason is the Stripe-level code
  // ('fraudulent', 'product_not_received', etc.).
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
