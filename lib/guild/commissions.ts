/**
 * The Penworth Guild Commission Engine
 *
 * Core business logic for calculating commission, recording referrals,
 * handling retention gates, and processing refund clawbacks.
 *
 * Invariants (from Penworth_Guild_Complete_Specification.md §8):
 *
 * 1. Commission is paid on the FIRST PLAN only. Upgrades don't increase
 *    commission. Credit packs don't generate commission.
 *
 * 2. Commission window is 12 months from the referred user's first PAID
 *    month. After that, the user remains a customer but the window closes.
 *
 * 3. Rate is LOCKED at the tier held at referral time. Promotions apply to
 *    new referrals only.
 *
 * 4. A referral counts toward advancement only after 60 days of continuous
 *    paid subscription. Before then, it's "active_paid" but not
 *    "retention_qualified".
 *
 * 5. Refunds trigger clawback. Clawback cannot go negative against unpaid
 *    balance — Penworth absorbs any shortfall.
 */

import { SupabaseClient } from '@supabase/supabase-js';

// ---------------------------------------------------------------------------
// Tier → commission rate mapping
// ---------------------------------------------------------------------------

export const TIER_RATES: Record<string, number> = {
  apprentice: 0.20,
  journeyman: 0.25,
  artisan:    0.30,
  master:     0.35,
  fellow:     0.40,
  emeritus:   0.40,  // Fellows in emeritus keep their rate on old referrals
};

export function rateForTier(tier: string): number {
  return TIER_RATES[tier] ?? 0.20;
}

// ---------------------------------------------------------------------------
// Plan price map (USD per month)
// Canonical source of plan economics for commission calculation.
// ---------------------------------------------------------------------------

export function planPriceUsd(plan: string): number {
  switch (plan) {
    case 'pro':
      return 19;
    case 'max':
      return 49;
    // Legacy or aliased plans
    case 'starter':
      return 19;
    case 'publisher':
      return 49;
    case 'agency':
      return 349;
    default:
      return 0;
  }
}

// ---------------------------------------------------------------------------
// Referral tracking at signup
// ---------------------------------------------------------------------------

interface CreateReferralParams {
  admin: SupabaseClient;
  referralCode: string;       // raw code from URL or profile, e.g. "GUILD-MARIA1234"
  referredUserId: string;      // the new auth user id
  signupCountry?: string | null;
  signupSourceUrl?: string | null;
}

/**
 * Creates a guild_referrals row linking a new signup to the referring
 * Guildmember. Idempotent — if a row already exists for this referred user,
 * it is NOT overwritten (attribution is immutable per spec §5).
 *
 * Returns null if the code doesn't resolve to an active Guildmember.
 */
export async function createReferralOnSignup(params: CreateReferralParams) {
  const { admin, referralCode, referredUserId, signupCountry, signupSourceUrl } = params;

  // Normalize code
  const code = referralCode.trim().toUpperCase();
  if (!code.startsWith('GUILD-')) return null;

  // Idempotency check
  const { data: existing } = await admin
    .from('guild_referrals')
    .select('id, guildmember_id')
    .eq('referred_user_id', referredUserId)
    .maybeSingle();

  if (existing) {
    console.log(`[commissions] Referral already exists for user ${referredUserId}`);
    return existing;
  }

  // Look up the Guildmember by referral code
  const { data: member } = await admin
    .from('guild_members')
    .select('id, tier, status, referral_code')
    .eq('referral_code', code)
    .maybeSingle();

  if (!member) {
    console.log(`[commissions] No Guildmember with code ${code}`);
    return null;
  }

  if (member.status !== 'active' && member.status !== 'probation') {
    console.log(`[commissions] Guildmember ${member.id} not active (status: ${member.status})`);
    return null;
  }

  // Anti-fraud: self-referral detection
  const { data: memberProfile } = await admin
    .from('guild_members')
    .select('user_id')
    .eq('id', member.id)
    .single();

  if (memberProfile?.user_id === referredUserId) {
    await admin.from('guild_fraud_flags').insert({
      guildmember_id: member.id,
      flag_type: 'self_referral_suspected',
      severity: 'high',
      payload: {
        reason: 'user_id matches guildmember.user_id',
        referred_user_id: referredUserId,
      },
      status: 'open',
    });
    console.warn(`[commissions] Self-referral attempt flagged: member ${member.id}`);
    return null;
  }

  // Create the referral row — commission rate locked at current tier
  const commissionRate = rateForTier(member.tier);

  const { data: created, error } = await admin
    .from('guild_referrals')
    .insert({
      guildmember_id: member.id,
      referred_user_id: referredUserId,
      referral_code_used: code,
      signup_source_url: signupSourceUrl ?? null,
      signup_country: signupCountry ?? null,
      tier_at_referral: member.tier,
      commission_rate_locked: commissionRate,
      status: 'signed_up',
    })
    .select('id')
    .single();

  if (error) {
    console.error('[commissions] Failed to create referral row:', error);
    return null;
  }

  console.log(
    `[commissions] Referral created: ${code} → user ${referredUserId} (rate locked at ${commissionRate})`,
  );
  return created;
}

// ---------------------------------------------------------------------------
// First-payment commission (subscription_create)
// Fires when a referred user first subscribes.
// ---------------------------------------------------------------------------

interface FirstPaymentParams {
  admin: SupabaseClient;
  referredUserId: string;
  plan: string;
  stripeInvoiceId?: string | null;
  stripePaymentIntentId?: string | null;
  /**
   * Actual amount paid in USD for this billing period, taken from Stripe.
   * REQUIRED for correct annual-plan commissions. For a Pro Annual subscription
   * ($190 paid upfront), this must be 190 — NOT the $19/month table price.
   * If omitted, falls back to planPriceUsd(plan) which assumes monthly.
   */
  priceOverrideUsd?: number;
}

export async function recordFirstPayment(params: FirstPaymentParams) {
  const {
    admin,
    referredUserId,
    plan,
    stripeInvoiceId,
    stripePaymentIntentId,
    priceOverrideUsd,
  } = params;

  // Load referral (if any)
  const { data: referral } = await admin
    .from('guild_referrals')
    .select('*')
    .eq('referred_user_id', referredUserId)
    .maybeSingle();

  if (!referral) {
    // Not a Guild referral — no commission
    return null;
  }

  if (referral.first_paid_at) {
    console.log(`[commissions] First payment already recorded for referral ${referral.id}`);
    return referral;
  }

  // Prefer the actual Stripe-paid amount (handles annual plans, promos, tax).
  // Fall back to the monthly price table only if no override is passed — this
  // preserves legacy behaviour but is NOT correct for annual subscriptions.
  const price =
    typeof priceOverrideUsd === 'number' && priceOverrideUsd > 0
      ? priceOverrideUsd
      : planPriceUsd(plan);

  if (price <= 0) {
    console.warn(`[commissions] Unknown plan "${plan}" for referral ${referral.id}`);
    return null;
  }

  const now = new Date();
  const commissionWindowEnd = new Date(now);
  commissionWindowEnd.setMonth(commissionWindowEnd.getMonth() + 12);

  // Update the referral
  await admin
    .from('guild_referrals')
    .update({
      first_paid_at: now.toISOString(),
      first_plan: plan,
      first_plan_price_usd: price,
      commission_window_ends_at: commissionWindowEnd.toISOString(),
      status: 'active_paid',
    })
    .eq('id', referral.id);

  // Create the first commission event
  return await createCommissionEvent({
    admin,
    referralId: referral.id,
    guildmemberId: referral.guildmember_id,
    subscriptionPriceUsd: price,
    commissionRate: Number(referral.commission_rate_locked),
    stripeInvoiceId: stripeInvoiceId ?? null,
    stripePaymentIntentId: stripePaymentIntentId ?? null,
    eventMonth: now,
  });
}

// ---------------------------------------------------------------------------
// Recurring commission (subscription_cycle)
// Fires on each monthly renewal.
// ---------------------------------------------------------------------------

interface RenewalParams {
  admin: SupabaseClient;
  referredUserId: string;
  stripeInvoiceId?: string | null;
  stripePaymentIntentId?: string | null;
  /**
   * Actual amount paid in USD for this renewal cycle, taken from
   * Stripe's invoice.amount_paid. REQUIRED for correct annual-plan commissions —
   * an annual renewal is a single $190 or $490 invoice, not $19/$49.
   * If omitted, falls back to referral.first_plan_price_usd.
   */
  priceOverrideUsd?: number;
}

export async function recordRenewalPayment(params: RenewalParams) {
  const {
    admin,
    referredUserId,
    stripeInvoiceId,
    stripePaymentIntentId,
    priceOverrideUsd,
  } = params;

  const { data: referral } = await admin
    .from('guild_referrals')
    .select('*')
    .eq('referred_user_id', referredUserId)
    .maybeSingle();

  if (!referral || !referral.first_paid_at) {
    return null; // not a Guild referral or never activated
  }

  // Check commission window
  if (!referral.commission_window_ends_at) return null;
  const windowEnd = new Date(referral.commission_window_ends_at);
  if (Date.now() > windowEnd.getTime()) {
    console.log(`[commissions] Commission window closed for referral ${referral.id}`);
    return null;
  }

  // No commission if status is cancelled/refunded/flagged
  if (['cancelled', 'refunded', 'flagged'].includes(referral.status)) {
    return null;
  }

  // Idempotency: don't create a duplicate commission for the same stripe invoice
  if (stripeInvoiceId) {
    const { data: existing } = await admin
      .from('guild_commissions')
      .select('id')
      .eq('stripe_invoice_id', stripeInvoiceId)
      .maybeSingle();
    if (existing) {
      console.log(`[commissions] Commission already exists for invoice ${stripeInvoiceId}`);
      return existing;
    }
  }

  // Prefer the actual Stripe-paid amount (handles annual plans, proration,
  // mid-cycle plan changes). Fall back to the stored first-plan price.
  const basePrice =
    typeof priceOverrideUsd === 'number' && priceOverrideUsd > 0
      ? priceOverrideUsd
      : Number(referral.first_plan_price_usd);

  const now = new Date();
  return await createCommissionEvent({
    admin,
    referralId: referral.id,
    guildmemberId: referral.guildmember_id,
    subscriptionPriceUsd: basePrice,
    commissionRate: Number(referral.commission_rate_locked),
    stripeInvoiceId: stripeInvoiceId ?? null,
    stripePaymentIntentId: stripePaymentIntentId ?? null,
    eventMonth: now,
  });
}

// ---------------------------------------------------------------------------
// Create commission event (shared)
// ---------------------------------------------------------------------------

interface CommissionEventParams {
  admin: SupabaseClient;
  referralId: string;
  guildmemberId: string;
  subscriptionPriceUsd: number;
  commissionRate: number;
  stripeInvoiceId: string | null;
  stripePaymentIntentId: string | null;
  eventMonth: Date;
}

async function createCommissionEvent(params: CommissionEventParams) {
  const {
    admin,
    referralId,
    guildmemberId,
    subscriptionPriceUsd,
    commissionRate,
    stripeInvoiceId,
    stripePaymentIntentId,
    eventMonth,
  } = params;

  const commissionAmount = Math.round(subscriptionPriceUsd * commissionRate * 100) / 100;
  const month = eventMonth.toISOString().slice(0, 7); // YYYY-MM

  const { data: created, error } = await admin
    .from('guild_commissions')
    .insert({
      guildmember_id: guildmemberId,
      referral_id: referralId,
      stripe_invoice_id: stripeInvoiceId,
      stripe_payment_intent_id: stripePaymentIntentId,
      subscription_price_usd: subscriptionPriceUsd,
      commission_rate: commissionRate,
      commission_amount_usd: commissionAmount,
      commission_month: month,
      status: 'pending', // becomes 'locked' at 60-day retention + monthly close
      earned_at: eventMonth.toISOString(),
    })
    .select('id, commission_amount_usd')
    .single();

  if (error) {
    console.error('[commissions] Failed to create commission event:', error);
    return null;
  }

  // Update the running total on the referral
  await admin.rpc('increment_referral_commission', {
    p_referral_id: referralId,
    p_amount: commissionAmount,
  }).then(
    () => {},
    async (rpcErr: any) => {
      // If RPC doesn't exist yet, fall back to select + update
      console.log('[commissions] RPC not available, falling back to manual increment', rpcErr?.message);
      const { data: ref } = await admin
        .from('guild_referrals')
        .select('total_commission_earned_usd')
        .eq('id', referralId)
        .single();
      const newTotal = Number(ref?.total_commission_earned_usd || 0) + commissionAmount;
      await admin
        .from('guild_referrals')
        .update({ total_commission_earned_usd: newTotal })
        .eq('id', referralId);
    },
  );

  console.log(
    `[commissions] Event: $${commissionAmount} for referral ${referralId} (member ${guildmemberId})`,
  );

  return created;
}

// ---------------------------------------------------------------------------
// Cancellation handling
// ---------------------------------------------------------------------------

export async function handleSubscriptionCancelled(params: {
  admin: SupabaseClient;
  referredUserId: string;
}) {
  const { admin, referredUserId } = params;

  const { data: referral } = await admin
    .from('guild_referrals')
    .select('id, status, first_paid_at')
    .eq('referred_user_id', referredUserId)
    .maybeSingle();

  if (!referral) return null;

  // Update status to cancelled (but keep past commissions — they were earned)
  await admin
    .from('guild_referrals')
    .update({
      status: 'cancelled',
      cancelled_at: new Date().toISOString(),
    })
    .eq('id', referral.id);

  console.log(`[commissions] Referral ${referral.id} marked cancelled`);
  return referral;
}

// ---------------------------------------------------------------------------
// Refund / chargeback clawback
// ---------------------------------------------------------------------------

export async function handleRefund(params: {
  admin: SupabaseClient;
  stripeInvoiceId: string;
  clawbackAll?: boolean; // true for chargebacks — claws back the entire referral's commissions
}) {
  const { admin, stripeInvoiceId, clawbackAll } = params;

  if (clawbackAll) {
    // Chargeback: find the referral via the invoice, claw back ALL commissions
    const { data: commission } = await admin
      .from('guild_commissions')
      .select('referral_id, guildmember_id')
      .eq('stripe_invoice_id', stripeInvoiceId)
      .maybeSingle();

    if (!commission) return null;

    await admin
      .from('guild_commissions')
      .update({
        status: 'clawed_back',
        clawback_reason: 'chargeback',
        clawback_at: new Date().toISOString(),
      })
      .eq('referral_id', commission.referral_id);

    await admin
      .from('guild_referrals')
      .update({
        status: 'refunded',
      })
      .eq('id', commission.referral_id);

    return { clawed_back_all: true, referral_id: commission.referral_id };
  }

  // Regular refund: claw back just this invoice's commission
  const { data: rows } = await admin
    .from('guild_commissions')
    .update({
      status: 'clawed_back',
      clawback_reason: 'refund',
      clawback_at: new Date().toISOString(),
    })
    .eq('stripe_invoice_id', stripeInvoiceId)
    .select('id, commission_amount_usd');

  return { clawed_back_count: rows?.length || 0 };
}

// ---------------------------------------------------------------------------
// Retention qualification (60 day check)
// Run this as a daily cron.
// ---------------------------------------------------------------------------

export async function runRetentionCheck(admin: SupabaseClient) {
  const sixtyDaysAgo = new Date();
  sixtyDaysAgo.setDate(sixtyDaysAgo.getDate() - 60);

  // Find referrals paid for >= 60 days that haven't qualified yet
  const { data: candidates } = await admin
    .from('guild_referrals')
    .select('id, guildmember_id, first_paid_at')
    .eq('status', 'active_paid')
    .is('retention_qualified_at', null)
    .lte('first_paid_at', sixtyDaysAgo.toISOString());

  if (!candidates || candidates.length === 0) {
    return { qualified: 0 };
  }

  const ids = candidates.map((c) => c.id);
  await admin
    .from('guild_referrals')
    .update({
      status: 'retention_qualified',
      retention_qualified_at: new Date().toISOString(),
    })
    .in('id', ids);

  console.log(`[commissions] Retention qualified: ${ids.length} referrals`);
  return { qualified: ids.length, referral_ids: ids };
}

// ---------------------------------------------------------------------------
// Monthly close
// Locks eligible 'pending' commissions into 'locked' state, ready for payout.
// A commission becomes 'locked' when:
//   - Its referral has reached retention_qualified (60 days paid), AND
//   - Its status is 'pending'
// ---------------------------------------------------------------------------

export async function runMonthlyClose(admin: SupabaseClient, closeMonth: string) {
  // closeMonth is YYYY-MM, the month being closed

  // Get all pending commissions in this month whose referral is retention-qualified
  const { data: eligible } = await admin
    .from('guild_commissions')
    .select(`
      id,
      guildmember_id,
      commission_amount_usd,
      referral:guild_referrals!inner(id, status, retention_qualified_at)
    `)
    .eq('commission_month', closeMonth)
    .eq('status', 'pending');

  if (!eligible || eligible.length === 0) {
    return { locked: 0, queued_payouts: 0 };
  }

  // Filter to only retention-qualified referrals
  const lockable = eligible.filter((c: any) => {
    const ref = Array.isArray(c.referral) ? c.referral[0] : c.referral;
    return ref?.retention_qualified_at !== null && ref?.status !== 'refunded';
  });

  const ids = lockable.map((c: any) => c.id);
  if (ids.length > 0) {
    await admin.from('guild_commissions').update({ status: 'locked' }).in('id', ids);
  }

  // Aggregate locked commissions per Guildmember into payouts
  const memberTotals = new Map<string, number>();
  for (const c of lockable) {
    const current = memberTotals.get(c.guildmember_id) || 0;
    memberTotals.set(c.guildmember_id, current + Number(c.commission_amount_usd));
  }

  let queuedCount = 0;
  const memberEntries = Array.from(memberTotals.entries());
  for (const [guildmemberId, total] of memberEntries) {
    // $50 minimum payout threshold (rolls forward otherwise)
    if (total < 50) continue;

    const { data: member } = await admin
      .from('guild_members')
      .select('payout_method, payout_details_encrypted')
      .eq('id', guildmemberId)
      .single();

    const method = member?.payout_method || 'pending';
    if (method === 'pending') continue; // can't queue without payout method set

    const masked = maskDestination(member?.payout_details_encrypted, method);

    await admin.from('guild_payouts').upsert(
      {
        guildmember_id: guildmemberId,
        payout_month: closeMonth,
        amount_usd: total,
        method,
        destination_masked: masked,
        fee_usd: 0, // computed at send time
        net_amount_usd: total,
        status: 'queued',
      },
      { onConflict: 'guildmember_id,payout_month' },
    );
    queuedCount++;
  }

  return { locked: ids.length, queued_payouts: queuedCount };
}

function maskDestination(encrypted: string | null | undefined, method: string): string {
  if (!encrypted) return method === 'wise' ? '****@****.***' : '0x…';
  // For now, we don't actually decrypt — just show a generic mask
  return method === 'wise' ? '****@****.***' : '0x…';
}
