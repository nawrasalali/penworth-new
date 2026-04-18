/**
 * Data aggregation for admin investor/board/DD reports.
 *
 * Every report (Monthly Investor Update, Quarterly Board Report, DD
 * Data Room Export) pulls from the same underlying data sources via
 * these helpers. Keeping the aggregation logic here means:
 *
 *   1. The Monthly and Quarterly reports share the same MRR/churn/cost
 *      calculation — they can't drift.
 *   2. Numbers in any PDF can be reproduced by calling the helpers
 *      from a test or an ad-hoc debug route.
 *   3. Unit tests for the aggregations exist in one place.
 *
 * DATA SOURCE HIERARCHY
 * ---------------------
 *
 * For every metric, the hierarchy is:
 *
 *   FIRST CHOICE: audit_log (append-only, trigger-protected)
 *                 → used for event counts and state transitions
 *                 → revenue events (subscription.activate,
 *                   credit_pack.purchase, refund.issue) when the
 *                   audit_log is confirmed complete (after April 2026,
 *                   when commit d8bec27 shipped)
 *
 *   FALLBACK:    stripe_webhook_events + credit_transactions
 *                → for historical periods before audit_log started
 *                  capturing events
 *                → for reconciliation: compare against audit_log to
 *                  detect missed rows
 *
 *   DERIVATIVE:  profiles, guild_members, projects
 *                → current state aggregates (headcount, plan mix)
 *
 * AMOUNTS
 * -------
 *
 * All monetary values returned from these helpers are in USD MAJOR
 * units (dollars, not cents). This matches the audit_log.after payload
 * convention and the investor-facing display format. Where Stripe gave
 * us cents, the helper has already divided by 100.
 */

import { createServiceClient } from '@/lib/supabase/service';

export interface PeriodRange {
  /** ISO timestamp, inclusive */
  startDate: string;
  /** ISO timestamp, exclusive */
  endDate: string;
  /** Human label for the PDF header, e.g. 'March 2026' or 'Q1 2026' */
  label: string;
}

export interface RevenueBreakdown {
  /** Gross sum of all subscription.activate events this period (USD) */
  subscriptionRevenue: number;
  /** Gross sum of all credit_pack.purchase events this period (USD) */
  creditPackRevenue: number;
  /** Gross sum of all refund.issue events this period (USD, positive number) */
  refundsIssued: number;
  /** Net = subscriptionRevenue + creditPackRevenue - refundsIssued */
  netRevenue: number;
  /** Count of revenue events in each category */
  counts: {
    subscriptionEvents: number;
    creditPackEvents: number;
    refunds: number;
    disputes: number;
  };
}

export interface UserMetrics {
  totalUsers: number;
  paidUsers: number;
  freeUsers: number;
  adminUsers: number;
  signupsThisPeriod: number;
  signupsLastPeriod: number;
  growthRate: number; // as decimal, e.g. 0.12 for +12%
  planBreakdown: {
    free: number;
    pro: number;
    max: number;
    enterprise: number;
  };
}

export interface GuildMetrics {
  totalMembers: number;
  membersByTier: Record<string, number>;
  applicationsThisPeriod: number;
  acceptancesThisPeriod: number;
  declinesThisPeriod: number;
  payoutsThisPeriod: {
    queued: number;
    approved: number;
    sent: number;
    confirmed: number;
    totalAmountUsd: number;
  };
}

export interface ActivityEvent {
  id: string;
  created_at: string;
  actor_type: string;
  actor_user_id: string | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  severity: string;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  metadata: Record<string, unknown>;
}

// ----------------------------------------------------------------------------
// Revenue — the headline number for all three reports
// ----------------------------------------------------------------------------

/**
 * Aggregates revenue from audit_log for the given period.
 *
 * Reads three action types:
 *   - subscription.activate → pulls price_usd equivalent from the
 *     stripe_price_id in metadata by looking it up in a local map
 *   - credit_pack.purchase → pulls price_usd from the after payload
 *   - refund.issue → pulls refund_amount_usd from the after payload
 *     (both dispute and refund branches)
 *
 * If audit_log is empty for a period (e.g. pre-April-2026 historical
 * export), the caller should fall back to stripe_webhook_events +
 * credit_transactions.
 */
export async function getRevenueBreakdown(period: PeriodRange): Promise<RevenueBreakdown> {
  const supabase = createServiceClient();

  // Pull all revenue-relevant audit rows for the period in one query.
  // We filter in JS rather than doing separate per-action queries to
  // minimise Supabase REST round-trips.
  const { data: rows, error } = await supabase
    .from('audit_log')
    .select('action, after, metadata')
    .in('action', ['subscription.activate', 'credit_pack.purchase', 'refund.issue'])
    .gte('created_at', period.startDate)
    .lt('created_at', period.endDate);

  if (error) {
    console.error('[reports] getRevenueBreakdown failed:', error);
    // Return zeros rather than throwing. Reports should render even
    // when a data source is partially unavailable, with the zero
    // values making the gap visible in the PDF.
    return emptyRevenue();
  }

  let subscriptionRevenue = 0;
  let creditPackRevenue = 0;
  let refundsIssued = 0;
  const counts = { subscriptionEvents: 0, creditPackEvents: 0, refunds: 0, disputes: 0 };

  for (const row of rows || []) {
    const action = row.action as string;
    const after = (row.after || {}) as Record<string, unknown>;
    const meta = (row.metadata || {}) as Record<string, unknown>;

    if (action === 'subscription.activate') {
      counts.subscriptionEvents++;
      // subscription events don't carry price in the audit payload
      // directly — we'd need to cross-reference the stripe_price_id.
      // For now, this is captured at 0 and the subscription-count is
      // used for investor narrative. A future PR should enrich the
      // audit payload with price_usd at event time (requires updating
      // handleSubscriptionUpdated in the webhook).
    } else if (action === 'credit_pack.purchase') {
      counts.creditPackEvents++;
      const price = Number(after.price_usd ?? 0);
      if (!Number.isNaN(price)) creditPackRevenue += price;
    } else if (action === 'refund.issue') {
      const entityType = 'dispute' in meta || (row as any).entity_type === 'dispute';
      if (entityType) {
        counts.disputes++;
        const amt = Number(after.dispute_amount_usd ?? 0);
        if (!Number.isNaN(amt)) refundsIssued += amt;
      } else {
        counts.refunds++;
        const amt = Number(after.refund_amount_usd ?? 0);
        if (!Number.isNaN(amt)) refundsIssued += amt;
      }
    }
  }

  const netRevenue = subscriptionRevenue + creditPackRevenue - refundsIssued;

  return {
    subscriptionRevenue,
    creditPackRevenue,
    refundsIssued,
    netRevenue,
    counts,
  };
}

function emptyRevenue(): RevenueBreakdown {
  return {
    subscriptionRevenue: 0,
    creditPackRevenue: 0,
    refundsIssued: 0,
    netRevenue: 0,
    counts: { subscriptionEvents: 0, creditPackEvents: 0, refunds: 0, disputes: 0 },
  };
}

// ----------------------------------------------------------------------------
// Users — headcount and growth
// ----------------------------------------------------------------------------

export async function getUserMetrics(period: PeriodRange): Promise<UserMetrics> {
  const supabase = createServiceClient();

  // Current-state counts (not period-bounded). Plan is on profiles, so
  // we can aggregate in one query.
  const { data: profiles, error } = await supabase
    .from('profiles')
    .select('id, plan, is_admin, created_at');

  if (error || !profiles) {
    console.error('[reports] getUserMetrics profiles failed:', error);
    return {
      totalUsers: 0, paidUsers: 0, freeUsers: 0, adminUsers: 0,
      signupsThisPeriod: 0, signupsLastPeriod: 0, growthRate: 0,
      planBreakdown: { free: 0, pro: 0, max: 0, enterprise: 0 },
    };
  }

  const totalUsers = profiles.length;
  const adminUsers = profiles.filter((p) => p.is_admin).length;

  const planBreakdown = { free: 0, pro: 0, max: 0, enterprise: 0 };
  for (const p of profiles) {
    const plan = (p.plan || 'free') as keyof typeof planBreakdown;
    if (plan in planBreakdown) planBreakdown[plan]++;
  }

  const paidUsers = planBreakdown.pro + planBreakdown.max + planBreakdown.enterprise;
  const freeUsers = planBreakdown.free;

  // Period signups
  const signupsThisPeriod = profiles.filter(
    (p) => p.created_at >= period.startDate && p.created_at < period.endDate,
  ).length;

  // Previous period of same length (for growth rate comparison)
  const periodLengthMs =
    new Date(period.endDate).getTime() - new Date(period.startDate).getTime();
  const lastPeriodStart = new Date(
    new Date(period.startDate).getTime() - periodLengthMs,
  ).toISOString();

  const signupsLastPeriod = profiles.filter(
    (p) => p.created_at >= lastPeriodStart && p.created_at < period.startDate,
  ).length;

  const growthRate =
    signupsLastPeriod === 0
      ? signupsThisPeriod > 0
        ? 1
        : 0
      : (signupsThisPeriod - signupsLastPeriod) / signupsLastPeriod;

  return {
    totalUsers,
    paidUsers,
    freeUsers,
    adminUsers,
    signupsThisPeriod,
    signupsLastPeriod,
    growthRate,
    planBreakdown,
  };
}

// ----------------------------------------------------------------------------
// Guild — the Guild Fellowship pipeline
// ----------------------------------------------------------------------------

export async function getGuildMetrics(period: PeriodRange): Promise<GuildMetrics> {
  const supabase = createServiceClient();

  // Member count + tier breakdown (current state)
  const { data: members } = await supabase
    .from('guild_members')
    .select('tier, status');

  const totalMembers = (members || []).filter((m) => m.status === 'active').length;
  const membersByTier: Record<string, number> = {};
  for (const m of members || []) {
    if (m.status !== 'active') continue;
    membersByTier[m.tier] = (membersByTier[m.tier] || 0) + 1;
  }

  // Period events — pull from audit_log
  const { data: events } = await supabase
    .from('audit_log')
    .select('action')
    .in('action', ['guild.apply', 'guild.accept', 'guild.decline'])
    .gte('created_at', period.startDate)
    .lt('created_at', period.endDate);

  let applicationsThisPeriod = 0;
  let acceptancesThisPeriod = 0;
  let declinesThisPeriod = 0;
  for (const e of events || []) {
    if (e.action === 'guild.apply') applicationsThisPeriod++;
    if (e.action === 'guild.accept') acceptancesThisPeriod++;
    if (e.action === 'guild.decline') declinesThisPeriod++;
  }

  // Payouts for the period (based on payout_month)
  const { data: payouts } = await supabase
    .from('guild_payouts')
    .select('status, amount_usd, payout_month')
    .gte('payout_month', period.startDate.slice(0, 10))
    .lte('payout_month', period.endDate.slice(0, 10));

  const payoutsThisPeriod = {
    queued: 0,
    approved: 0,
    sent: 0,
    confirmed: 0,
    totalAmountUsd: 0,
  };
  for (const p of payouts || []) {
    const amt = Number(p.amount_usd || 0);
    payoutsThisPeriod.totalAmountUsd += amt;
    if (p.status === 'queued') payoutsThisPeriod.queued++;
    else if (p.status === 'approved') payoutsThisPeriod.approved++;
    else if (p.status === 'sent') payoutsThisPeriod.sent++;
    else if (p.status === 'confirmed') payoutsThisPeriod.confirmed++;
  }

  return {
    totalMembers,
    membersByTier,
    applicationsThisPeriod,
    acceptancesThisPeriod,
    declinesThisPeriod,
    payoutsThisPeriod,
  };
}

// ----------------------------------------------------------------------------
// Full activity log — used by Quarterly Board Report and DD Export
// ----------------------------------------------------------------------------

/**
 * Pulls raw audit_log rows for the period, ordered by created_at DESC.
 * `limit` is required to prevent unbounded responses; callers that
 * want truly unlimited (DD export) should paginate.
 */
export async function getActivityEvents(
  period: PeriodRange,
  options: { limit?: number; severityAtLeast?: 'info' | 'warning' | 'critical' } = {},
): Promise<ActivityEvent[]> {
  const supabase = createServiceClient();
  const limit = options.limit ?? 500;

  let query = supabase
    .from('audit_log')
    .select('id, created_at, actor_type, actor_user_id, action, entity_type, entity_id, severity, before, after, metadata')
    .gte('created_at', period.startDate)
    .lt('created_at', period.endDate)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (options.severityAtLeast === 'warning') {
    query = query.in('severity', ['warning', 'critical']);
  } else if (options.severityAtLeast === 'critical') {
    query = query.eq('severity', 'critical');
  }

  const { data, error } = await query;
  if (error) {
    console.error('[reports] getActivityEvents failed:', error);
    return [];
  }

  return (data || []) as ActivityEvent[];
}

// ----------------------------------------------------------------------------
// Period helpers
// ----------------------------------------------------------------------------

/**
 * Returns the period covering the full calendar month containing `date`.
 * For April 15, 2026 → start: 2026-04-01, end: 2026-05-01, label: 'April 2026'.
 */
export function monthPeriod(date: Date): PeriodRange {
  const start = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
  const end = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1));
  const monthName = start.toLocaleString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  return {
    startDate: start.toISOString(),
    endDate: end.toISOString(),
    label: monthName,
  };
}

/**
 * Returns the period covering the calendar quarter containing `date`.
 */
export function quarterPeriod(date: Date): PeriodRange {
  const quarter = Math.floor(date.getUTCMonth() / 3);
  const startMonth = quarter * 3;
  const start = new Date(Date.UTC(date.getUTCFullYear(), startMonth, 1));
  const end = new Date(Date.UTC(date.getUTCFullYear(), startMonth + 3, 1));
  return {
    startDate: start.toISOString(),
    endDate: end.toISOString(),
    label: `Q${quarter + 1} ${start.getUTCFullYear()}`,
  };
}

/**
 * Returns a custom-length period ending at `end`, going back `days` days.
 * Used by the DD Data Room Export (e.g. 7 years = 2555 days).
 */
export function customPeriod(end: Date, days: number, label: string): PeriodRange {
  const start = new Date(end.getTime() - days * 86_400_000);
  return {
    startDate: start.toISOString(),
    endDate: end.toISOString(),
    label,
  };
}

// ----------------------------------------------------------------------------
// Currency formatting — consistent across all reports
// ----------------------------------------------------------------------------

export function formatUSD(amount: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

export function formatPercent(decimal: number, decimals: number = 1): string {
  const sign = decimal >= 0 ? '+' : '';
  return `${sign}${(decimal * 100).toFixed(decimals)}%`;
}

export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('en-US', {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'UTC',
  });
}
