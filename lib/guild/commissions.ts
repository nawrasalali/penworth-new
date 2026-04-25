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
import { maskPayoutDestinationSafe } from './payout-encryption';

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
// Monthly close — the complete Guild economy state machine
// ---------------------------------------------------------------------------
//
// Runs once per month (vercel.json: `30 13 1 * *` — 13:30 UTC on the 1st
// of each month, closing the month that just ended in Adelaide time).
//
// For each active or probation member, the close performs five stages:
//
//   1. Lock commissions:   Every 'pending' commission for this month whose
//                          referral is retention_qualified (60+ days paid)
//                          becomes 'locked'.
//
//   2. Assess fee:         If account_fee_starts_at <= now and tier != emeritus,
//                          upsert a guild_account_fees row for this month
//                          using guild_compute_account_fee(tier). Starts as
//                          'pending'. Emeritus members pay $0 and get no row.
//
//   3. Compute position:   C = sum(locked commissions this month)
//                          U = sum(fee_amount - deducted - waived) over the
//                              member's unresolved fee rows (pending +
//                              partially_deducted + fully_deferred). This
//                              includes BOTH this month's freshly-upserted
//                              fee row AND any older fees that never got
//                              paid out or deferred.
//                          payout_amount = C - U
//
//   4. Branch on three cases:
//
//      Case A — payout_amount >= $50 AND payout_method is set:
//        - Create guild_payouts row, status='queued'.
//        - Mark every locked commission for this month as 'paid', stamp
//          payout_id and paid_at.
//        - Walk every unresolved fee row oldest-first. For each row, move
//          (fee_amount - deducted - waived) from amount_deferred into
//          amount_deducted, mark status='fully_deducted', stamp
//          deducted_from_payout_id and resolved_at.
//
//      Case B — 0 < payout_amount < $50, OR payout_method not set:
//        - No payout. Commissions stay 'locked'. Fee rows stay where they
//          were. Everything rolls to next month. Note: because the fee for
//          *this* month was upserted as 'pending' in stage 2, next month's
//          close will still see it as an unresolved obligation (pending
//          rows count toward U). This is intentional — the $50 threshold
//          defers reconciliation, not assessment.
//
//      Case C — payout_amount <= 0:
//        - No payout. Commissions stay 'locked'. But we now mark *this
//          month's* fee row as 'fully_deferred' with amount_deferred equal
//          to the fee amount. This is what grows the member's deferred
//          balance (older unresolved fees don't move to fully_deferred
//          here — they stay in whatever state they already had, and their
//          amount_deferred already counts). The $90 probation trigger is
//          evaluated on this new balance.
//
//   5. Probation trigger:  After fee processing, if
//                          guild_deferred_balance_usd(member) > $90 AND
//                          status = 'active', flip to 'probation'. The
//                          inverse (auto-lift on balance reaching $0) is
//                          already handled by the guild_auto_lift_probation
//                          trigger on guild_account_fees.
//
// The entire run is recorded in guild_monthly_close_runs. UNIQUE(run_month)
// makes a second invocation for the same month fail fast with
// `already_closed=true` — no member is ever processed twice.
// ---------------------------------------------------------------------------

interface MemberCloseResult {
  guildmember_id: string;
  case: 'A' | 'B' | 'C' | 'skipped';
  reason?: string;
  commissions_locked: number;
  commission_total_usd: number;
  fee_assessed_usd: number;
  fee_deducted_usd: number;
  fee_deferred_usd: number;
  payout_created: boolean;
  payout_amount_usd: number;
  probation_triggered: boolean;
}

export interface MonthlyCloseSummary {
  closed_month: string;
  already_closed: boolean;
  run_id: string | null;
  members_considered: number;
  members_processed: number;
  members_errored: number;
  commissions_locked: number;
  payouts_created: number;
  total_paid_usd: number;
  fees_assessed_usd: number;
  fees_deducted_usd: number;
  fees_deferred_usd: number;
  probations_triggered: number;
  errors: Array<{ guildmember_id: string; error: string }>;
  // Legacy-compat fields for existing callers:
  locked: number;
  queued_payouts: number;
}

export async function runMonthlyClose(
  admin: SupabaseClient,
  closeMonth: string,
  options: { triggeredBy?: 'cron' | 'manual' | 'test' } = {},
): Promise<MonthlyCloseSummary> {
  const triggeredBy = options.triggeredBy || 'cron';

  // ---- Idempotency: claim the run slot for this month ----
  // UNIQUE(run_month) in guild_monthly_close_runs ensures a second attempt
  // for the same month fails at the DB. We catch that specifically.
  const { data: runRow, error: runInsertErr } = await admin
    .from('guild_monthly_close_runs')
    .insert({ run_month: closeMonth, triggered_by: triggeredBy, status: 'running' })
    .select('id, status')
    .single();

  if (runInsertErr) {
    if ((runInsertErr as any).code === '23505') {
      // Already closed (or currently running). Check which.
      const { data: existing } = await admin
        .from('guild_monthly_close_runs')
        .select('id, status, completed_at')
        .eq('run_month', closeMonth)
        .single();
      console.log(
        `[commissions] Monthly close for ${closeMonth} already exists (status=${existing?.status}). Skipping.`,
      );
      return {
        closed_month: closeMonth,
        already_closed: true,
        run_id: existing?.id || null,
        members_considered: 0,
        members_processed: 0,
        members_errored: 0,
        commissions_locked: 0,
        payouts_created: 0,
        total_paid_usd: 0,
        fees_assessed_usd: 0,
        fees_deducted_usd: 0,
        fees_deferred_usd: 0,
        probations_triggered: 0,
        errors: [],
        locked: 0,
        queued_payouts: 0,
      };
    }
    throw runInsertErr;
  }

  const runId = runRow.id as string;

  // ---- Gather candidate members ----
  // Everyone who is active or on probation. Terminated/resigned members
  // are excluded entirely (they can't earn commissions or be charged fees).
  const { data: members } = await admin
    .from('guild_members')
    .select('id, user_id, tier, status, payout_method, payout_details_encrypted, account_fee_starts_at')
    .in('status', ['active', 'probation']);

  const results: MemberCloseResult[] = [];
  const errors: Array<{ guildmember_id: string; error: string }> = [];

  for (const member of members || []) {
    try {
      const result = await closeMemberMonth(admin, member, closeMonth);
      results.push(result);
    } catch (err: any) {
      console.error(`[commissions] Error closing member ${member.id}:`, err);
      errors.push({
        guildmember_id: member.id,
        error: err?.message || String(err),
      });
    }
  }

  // ---- Aggregate + persist run summary ----
  const summary: MonthlyCloseSummary = {
    closed_month: closeMonth,
    already_closed: false,
    run_id: runId,
    members_considered: (members || []).length,
    members_processed: results.length,
    members_errored: errors.length,
    commissions_locked: results.reduce((s, r) => s + r.commissions_locked, 0),
    payouts_created: results.filter((r) => r.payout_created).length,
    total_paid_usd: round2(
      results.reduce((s, r) => s + (r.payout_created ? r.payout_amount_usd : 0), 0),
    ),
    fees_assessed_usd: round2(results.reduce((s, r) => s + r.fee_assessed_usd, 0)),
    fees_deducted_usd: round2(results.reduce((s, r) => s + r.fee_deducted_usd, 0)),
    fees_deferred_usd: round2(results.reduce((s, r) => s + r.fee_deferred_usd, 0)),
    probations_triggered: results.filter((r) => r.probation_triggered).length,
    errors,
    // Legacy compatibility
    locked: results.reduce((s, r) => s + r.commissions_locked, 0),
    queued_payouts: results.filter((r) => r.payout_created).length,
  };

  await admin
    .from('guild_monthly_close_runs')
    .update({
      completed_at: new Date().toISOString(),
      status: errors.length > (members || []).length * 0.05 ? 'failed' : 'completed',
      members_considered: summary.members_considered,
      members_processed: summary.members_processed,
      members_errored: summary.members_errored,
      commissions_locked: summary.commissions_locked,
      payouts_created: summary.payouts_created,
      total_paid_usd: summary.total_paid_usd,
      fees_assessed_usd: summary.fees_assessed_usd,
      fees_deducted_usd: summary.fees_deducted_usd,
      fees_deferred_usd: summary.fees_deferred_usd,
      probations_triggered: summary.probations_triggered,
      errors: errors as any,
    })
    .eq('id', runId);

  console.log(
    `[commissions] Monthly close ${closeMonth} complete: ` +
      `${summary.payouts_created} payouts (${summary.total_paid_usd} USD), ` +
      `${summary.fees_deducted_usd} fees deducted, ` +
      `${summary.fees_deferred_usd} deferred, ` +
      `${summary.probations_triggered} probations.`,
  );

  return summary;
}

/**
 * Close a single member's month. Isolated so one bad member can't take
 * the whole close down. Returns a structured result.
 */
async function closeMemberMonth(
  admin: SupabaseClient,
  member: {
    id: string;
    user_id: string;
    tier: string;
    status: string;
    payout_method: string | null;
    payout_details_encrypted: string | null;
    account_fee_starts_at: string | null;
  },
  closeMonth: string,
): Promise<MemberCloseResult> {
  const now = new Date();

  // ---- Stage 1: lock this month's eligible pending commissions ----
  const { data: eligible } = await admin
    .from('guild_commissions')
    .select(
      `id, commission_amount_usd, referral:guild_referrals!inner(status, retention_qualified_at)`,
    )
    .eq('guildmember_id', member.id)
    .eq('commission_month', closeMonth)
    .eq('status', 'pending');

  const lockable = (eligible || []).filter((c: any) => {
    const ref = Array.isArray(c.referral) ? c.referral[0] : c.referral;
    return ref?.retention_qualified_at !== null && ref?.status !== 'refunded';
  });

  if (lockable.length > 0) {
    await admin
      .from('guild_commissions')
      .update({ status: 'locked' })
      .in(
        'id',
        lockable.map((c: any) => c.id),
      );
  }

  // Total of locked commissions for this member THIS month (what we just locked).
  // Older locked commissions from prior months are not rolled in here — they
  // should already have been handled in their own close. This keeps each
  // month's close self-contained and auditable.
  const C = round2(
    lockable.reduce((s: number, c: any) => s + Number(c.commission_amount_usd), 0),
  );

  // ---- Stage 2: assess this month's account fee ----
  // NOTE (migration 028): the legacy guild_compute_account_fee() now always
  // returns 0, so this block is effectively a no-op. Kept to avoid breaking
  // the close-row schema for historical guild_account_fees inspection.
  // Membership compliance is now enforced via Stage 2.5 below.
  const feeAssessed = shouldAssessFee(member, now)
    ? Number(
        (
          await admin.rpc('guild_compute_account_fee', { p_tier: member.tier })
        ).data as number,
      )
    : 0;

  if (feeAssessed > 0) {
    // Upsert — idempotent on (guildmember_id, fee_month) if that constraint
    // exists, otherwise the insert may create a duplicate. Add the constraint
    // in a follow-up migration if needed. For now we do a manual check:
    const { data: existingFee } = await admin
      .from('guild_account_fees')
      .select('id, status')
      .eq('guildmember_id', member.id)
      .eq('fee_month', closeMonth)
      .maybeSingle();

    if (!existingFee) {
      await admin.from('guild_account_fees').insert({
        guildmember_id: member.id,
        fee_month: closeMonth,
        tier_at_time: member.tier,
        fee_rate_pct: feeAssessed, // naming quirk: the check constraint
        fee_amount_usd: feeAssessed, // fee_matches_rate requires these equal
        amount_deducted_usd: 0,
        amount_deferred_usd: 0,
        amount_waived_usd: 0,
        status: 'pending',
      });
    }
  }

  // ---- Stage 2.5: paid-author compliance check ----
  // Per migration 028 / Founder decision 2026-04-25: Guildmembers must be
  // paying authors themselves (Pro or Max plan) once they pass their 90-day
  // grace window. This replaces the old monthly Guild fee. Authentic
  // ("walk the talk") and aligns Guild incentives with Penworth's core
  // revenue product.
  //
  // Behaviour:
  //   - 'compliant'   → no-op
  //   - 'pre_grace'   → no-op (still in 90-day window)
  //   - 'non_paying'  → flip status='probation' (auto-lift triggers when
  //                     they upgrade; existing trg_guild_auto_lift_probation
  //                     handles the unflip on payment)
  //   - 'no_profile'  → log loudly; orphan record needs ops attention
  if (member.status === 'active') {
    const { data: paidAuthorStatus } = await admin.rpc(
      'guild_assess_paid_author_status',
      { p_user_id: member.user_id },
    );

    if (paidAuthorStatus === 'non_paying') {
      console.log(
        `[guild.close] member ${member.id} is past grace and not on a paid plan; moving to probation`,
      );
      await admin
        .from('guild_members')
        .update({ status: 'probation' })
        .eq('id', member.id);
    } else if (paidAuthorStatus === 'no_profile') {
      console.error(
        `[guild.close] member ${member.id} has no matching profile row; surfacing for ops`,
      );
    }
  }

  // ---- Stage 3: compute total unresolved fee obligation ----
  const { data: unresolvedFees } = await admin
    .from('guild_account_fees')
    .select('id, fee_month, fee_amount_usd, amount_deducted_usd, amount_deferred_usd, amount_waived_usd, status')
    .eq('guildmember_id', member.id)
    .in('status', ['pending', 'partially_deducted', 'fully_deferred'])
    .order('fee_month', { ascending: true });

  const U = round2(
    (unresolvedFees || []).reduce(
      (s, f: any) =>
        s +
        (Number(f.fee_amount_usd) -
          Number(f.amount_deducted_usd || 0) -
          Number(f.amount_waived_usd || 0)),
      0,
    ),
  );

  const payoutAmount = round2(C - U);
  const hasPayoutMethod =
    member.payout_method === 'wise' || member.payout_method === 'usdt';

  // ---- Stage 4: three-case branch ----
  const result: MemberCloseResult = {
    guildmember_id: member.id,
    case: 'B',
    commissions_locked: lockable.length,
    commission_total_usd: C,
    fee_assessed_usd: feeAssessed,
    fee_deducted_usd: 0,
    fee_deferred_usd: 0,
    payout_created: false,
    payout_amount_usd: 0,
    probation_triggered: false,
  };

  if (payoutAmount >= 50 && hasPayoutMethod) {
    // ---- Case A: pay out ----
    result.case = 'A';

    const masked = maskPayoutDestinationSafe(
      member.payout_method as any,
      member.id,
      member.payout_details_encrypted,
    );

    const { data: payout, error: payoutErr } = await admin
      .from('guild_payouts')
      .upsert(
        {
          guildmember_id: member.id,
          payout_month: closeMonth,
          amount_usd: payoutAmount,
          method: member.payout_method,
          destination_masked: masked,
          fee_usd: 0,
          net_amount_usd: payoutAmount,
          status: 'queued',
        },
        { onConflict: 'guildmember_id,payout_month' },
      )
      .select('id')
      .single();

    if (payoutErr || !payout) {
      throw new Error(`Payout upsert failed: ${payoutErr?.message}`);
    }

    result.payout_created = true;
    result.payout_amount_usd = payoutAmount;

    // Mark every commission we just locked as 'paid' against this payout.
    if (lockable.length > 0) {
      await admin
        .from('guild_commissions')
        .update({
          status: 'paid',
          payout_id: payout.id,
          paid_at: now.toISOString(),
        })
        .in(
          'id',
          lockable.map((c: any) => c.id),
        );
    }

    // Resolve unresolved fees oldest-first, against this payout.
    for (const fee of unresolvedFees || []) {
      const remaining = round2(
        Number(fee.fee_amount_usd) -
          Number(fee.amount_deducted_usd || 0) -
          Number(fee.amount_waived_usd || 0),
      );
      if (remaining <= 0) continue;

      await admin
        .from('guild_account_fees')
        .update({
          amount_deducted_usd: round2(Number(fee.amount_deducted_usd || 0) + remaining),
          amount_deferred_usd: 0,
          status: 'fully_deducted',
          deducted_from_payout_id: payout.id,
          resolved_at: now.toISOString(),
        })
        .eq('id', fee.id);

      result.fee_deducted_usd = round2(result.fee_deducted_usd + remaining);
    }
  } else if (payoutAmount > 0) {
    // ---- Case B: positive net but below $50, OR no payout method set ----
    result.case = 'B';
    if (!hasPayoutMethod) {
      result.reason = 'payout_method_not_set';
    } else {
      result.reason = 'below_payout_threshold';
    }
    // Nothing else to do — commissions stay locked, fees stay pending.
    // The member's unresolved obligations carry forward to next month.
  } else {
    // ---- Case C: fees exceed commissions ----
    result.case = 'C';

    // Defer this month's fee — it's the new one we just upserted (if any).
    // Older fees already have their amount_deferred set from previous closes.
    if (feeAssessed > 0) {
      await admin
        .from('guild_account_fees')
        .update({
          status: 'fully_deferred',
          amount_deferred_usd: feeAssessed,
        })
        .eq('guildmember_id', member.id)
        .eq('fee_month', closeMonth);

      result.fee_deferred_usd = feeAssessed;
    }
  }

  // ---- Stage 5: probation trigger ----
  // guild_deferred_balance_usd sums amount_deferred_usd over rows NOT in
  // (waived, cancelled, fully_deducted). This is the authoritative balance.
  const { data: balanceData } = await admin.rpc('guild_deferred_balance_usd', {
    p_guildmember_id: member.id,
  });
  const deferredBalance = Number(balanceData || 0);

  if (deferredBalance > 90 && member.status === 'active') {
    await admin
      .from('guild_members')
      .update({
        status: 'probation',
        probation_started_at: now.toISOString(),
        probation_reason: 'deferred_fees_exceed_90',
      })
      .eq('id', member.id)
      .eq('status', 'active'); // race-condition guard
    result.probation_triggered = true;
  }

  return result;
}

/**
 * Fee is assessed this close if the member is past their 90-day grace
 * period AND their tier isn't emeritus (emeritus fee = $0).
 */
function shouldAssessFee(
  member: { tier: string; account_fee_starts_at: string | null },
  now: Date,
): boolean {
  if (member.tier === 'emeritus') return false;
  if (!member.account_fee_starts_at) return false;
  return new Date(member.account_fee_starts_at).getTime() <= now.getTime();
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
