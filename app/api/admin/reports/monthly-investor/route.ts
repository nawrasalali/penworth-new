/**
 * GET /api/admin/reports/monthly-investor
 *
 * Generates the Monthly Investor Update as a downloadable PDF.
 *
 * Query params:
 *   - month (optional): YYYY-MM to report on. Defaults to the previous
 *     complete calendar month (not the current one — you almost never
 *     want to send an investor update covering a half-finished month).
 *
 * Response: application/pdf with Content-Disposition: attachment
 *
 * The report is four pages:
 *   1. Cover (title, period, confidentiality)
 *   2. Headline KPIs + narrative (MRR, user growth, key events)
 *   3. Revenue detail + plan mix
 *   4. Guild + platform activity summary
 *
 * Admin-only: gated by the /admin layout redirect, plus explicit
 * is_admin check in this route because API routes bypass layouts.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { ReportBuilder } from '@/lib/reports/pdf-builder';
import {
  getRevenueBreakdown,
  getUserMetrics,
  getGuildMetrics,
  getActivityEvents,
  monthPeriod,
  formatUSD,
  formatPercent,
  type PeriodRange,
} from '@/lib/reports/data';
import { logAuditFromRequest } from '@/lib/audit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    return await handleGet(request);
  } catch (err) {
    // Return the error body so admins can see what broke without
    // needing Vercel log access. Also logs to console.error so it
    // shows up in the Vercel runtime logs with a real stack trace.
    const message = err instanceof Error ? err.message : String(err);
    const stack = err instanceof Error ? err.stack : undefined;
    console.error('[reports/monthly-investor] handler error:', message, stack);
    return NextResponse.json(
      { error: 'report_generation_failed', message, stack },
      { status: 500 },
    );
  }
}

async function handleGet(request: NextRequest): Promise<NextResponse> {
  // Admin gate
  const supabase = await createClient();
  const { data: { user }, error: authErr } = await supabase.auth.getUser();
  if (authErr || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const { data: profile } = await supabase
    .from('profiles')
    .select('id, email, is_admin')
    .eq('id', user.id)
    .single();
  if (!profile?.is_admin) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  // Determine period — default to previous complete month
  const url = new URL(request.url);
  const monthParam = url.searchParams.get('month'); // YYYY-MM
  const period = parseMonthPeriod(monthParam);

  // Data fetch — run in parallel where possible
  const [revenue, users, guild, criticalEvents] = await Promise.all([
    getRevenueBreakdown(period),
    getUserMetrics(period),
    getGuildMetrics(period),
    getActivityEvents(period, { limit: 20, severityAtLeast: 'critical' }),
  ]);

  // Build the PDF
  const builder = await ReportBuilder.create({
    title: 'Penworth.ai',
    subtitle: 'Monthly Investor Update',
    periodLabel: period.label,
    generatedAt: new Date().toISOString(),
    generatedByEmail: profile.email || user.email || 'unknown',
  });

  builder.coverPage();

  // === Page 2: Headline KPIs + narrative ===
  builder.section('Summary');

  builder.kpis([
    {
      label: 'Net Revenue',
      value: formatUSD(revenue.netRevenue),
      context: `${revenue.counts.subscriptionEvents} subs · ${revenue.counts.creditPackEvents} packs`,
    },
    {
      label: 'New Sign-ups',
      value: users.signupsThisPeriod.toLocaleString(),
      context: `${formatPercent(users.growthRate)} vs prior period`,
    },
    {
      label: 'Paid Users',
      value: users.paidUsers.toLocaleString(),
      context: `${users.totalUsers.toLocaleString()} total`,
    },
  ]);

  builder.body(
    `This report covers the period of ${period.label}. Data is pulled from ` +
    `the append-only audit_log (Australian Corporations Act s286/s290 ` +
    `retention) and verified against the Stripe webhook event store. ` +
    `All monetary values are in USD.`,
  );

  // === Page 3: Revenue detail ===
  builder.section('Revenue');

  builder.subsection('Gross Revenue Breakdown');
  builder.table(
    ['Source', 'Events', 'Amount (USD)'],
    [
      { cells: ['Subscriptions', String(revenue.counts.subscriptionEvents), formatUSD(revenue.subscriptionRevenue)] },
      { cells: ['Credit Packs',  String(revenue.counts.creditPackEvents),  formatUSD(revenue.creditPackRevenue)] },
      { cells: ['Refunds (−)',   String(revenue.counts.refunds + revenue.counts.disputes), `(${formatUSD(revenue.refundsIssued)})`] },
      { cells: ['Net Revenue',   '',                                        formatUSD(revenue.netRevenue)] },
    ],
    { columnWidths: [210, 90, 160] },
  );

  builder.body(
    revenue.counts.subscriptionEvents === 0
      ? 'Subscription revenue is not captured in audit_log historically — ' +
        'the subscription.activate event was instrumented in April 2026 ' +
        '(commit f7e6c6e) and did not include a price_usd field initially. ' +
        'Subscription count for the period is accurate; amount is reconciled ' +
        'separately in the Stripe dashboard.'
      : `${revenue.counts.subscriptionEvents} subscription events fired this ` +
        `period — a mix of activations, upgrades, and renewals. Disambiguation ` +
        `between those categories requires reading the change_type metadata ` +
        `field from audit_log, summarised in the Activity section below.`,
  );

  builder.subsection('Plan Mix (Current)');
  builder.table(
    ['Plan', 'Users', '% of Paid'],
    [
      { cells: ['Free',       users.planBreakdown.free.toLocaleString(),       '—'] },
      { cells: ['Pro',        users.planBreakdown.pro.toLocaleString(),        formatShareOfPaid(users.planBreakdown.pro, users.paidUsers)] },
      { cells: ['Max',        users.planBreakdown.max.toLocaleString(),        formatShareOfPaid(users.planBreakdown.max, users.paidUsers)] },
      { cells: ['Enterprise', users.planBreakdown.enterprise.toLocaleString(), formatShareOfPaid(users.planBreakdown.enterprise, users.paidUsers)] },
    ],
    { columnWidths: [180, 150, 130] },
  );

  // === Page 4: Guild + critical events ===
  builder.section('Guild Fellowship');

  builder.kpis([
    { label: 'Total Members', value: guild.totalMembers.toLocaleString() },
    { label: 'New Applications', value: guild.applicationsThisPeriod.toLocaleString() },
    { label: 'Acceptances', value: guild.acceptancesThisPeriod.toLocaleString() },
  ]);

  if (Object.keys(guild.membersByTier).length > 0) {
    builder.subsection('Members by Tier');
    builder.bulletList(
      Object.entries(guild.membersByTier)
        .sort(([, a], [, b]) => b - a)
        .map(([tier, count]) => `${tier}: ${count.toLocaleString()}`),
    );
  }

  builder.subsection('Payouts for Period');
  builder.table(
    ['Status', 'Count', 'Amount'],
    [
      { cells: ['Queued',    String(guild.payoutsThisPeriod.queued),    '—'] },
      { cells: ['Approved',  String(guild.payoutsThisPeriod.approved),  '—'] },
      { cells: ['Sent',      String(guild.payoutsThisPeriod.sent),      '—'] },
      { cells: ['Confirmed', String(guild.payoutsThisPeriod.confirmed), '—'] },
      { cells: ['Total',     '',                                         formatUSD(guild.payoutsThisPeriod.totalAmountUsd)] },
    ],
    { columnWidths: [160, 140, 160] },
  );

  // Critical events table — only if any exist
  if (criticalEvents.length > 0) {
    builder.section('Critical Events');
    builder.body(
      `${criticalEvents.length} critical-severity event${criticalEvents.length === 1 ? '' : 's'} ` +
      `during this period. These are events that require board-level ` +
      `awareness: disputes, failed payouts, unauthorized admin attempts.`,
    );
    builder.table(
      ['Date (UTC)', 'Action', 'Entity'],
      criticalEvents.slice(0, 15).map((e) => ({
        cells: [
          e.created_at.slice(0, 16).replace('T', ' '),
          e.action,
          `${e.entity_type}/${(e.entity_id ?? '').slice(0, 12)}`,
        ],
      })),
      { columnWidths: [140, 180, 140] },
    );
  } else {
    builder.section('Critical Events');
    builder.body('No critical-severity events during this period.');
  }

  const pdf = await builder.end();

  // Audit the report generation itself — who ran it, for what period
  void logAuditFromRequest(request, {
    actorType: 'admin',
    actorUserId: user.id,
    action: 'admin.override',
    entityType: 'report',
    entityId: `monthly-investor/${period.label}`,
    metadata: {
      kind: 'generate_monthly_investor_report',
      period_label: period.label,
      period_start: period.startDate,
      period_end: period.endDate,
      pdf_size_bytes: pdf.length,
    },
  });

  return new NextResponse(new Uint8Array(pdf), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="Penworth_Monthly_Investor_Update_${period.label.replace(/\s/g, '_')}.pdf"`,
      'Cache-Control': 'no-store',
    },
  });
}

// ----------------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------------

function parseMonthPeriod(monthParam: string | null): PeriodRange {
  if (monthParam && /^\d{4}-\d{2}$/.test(monthParam)) {
    const [y, m] = monthParam.split('-').map(Number);
    return monthPeriod(new Date(Date.UTC(y, m - 1, 15)));
  }
  // Default: previous complete month
  const now = new Date();
  const prev = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 15));
  return monthPeriod(prev);
}

function formatShareOfPaid(planCount: number, totalPaid: number): string {
  if (totalPaid === 0) return '0%';
  return `${((planCount / totalPaid) * 100).toFixed(1)}%`;
}
