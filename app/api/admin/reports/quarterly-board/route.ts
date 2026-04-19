/**
 * GET /api/admin/reports/quarterly-board
 *
 * Generates the Quarterly Board Report as a downloadable PDF.
 *
 * Query params:
 *   - quarter (optional): YYYY-Qn to report on (e.g. '2026-Q1').
 *     Defaults to the previous completed quarter.
 *
 * Differences from the Monthly Investor Update:
 *   - 3-month period instead of 1
 *   - Full activity-by-action breakdown (not just critical events)
 *   - Guild tier promotion history in detail
 *   - More narrative framing appropriate for a board discussion
 *   - Month-by-month comparison within the quarter
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { ReportBuilder } from '@/lib/reports/pdf-builder';
import {
  getRevenueBreakdown,
  getUserMetrics,
  getGuildMetrics,
  getActivityEvents,
  quarterPeriod,
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
    const message = err instanceof Error ? err.message : String(err);
    const stack = err instanceof Error ? err.stack : undefined;
    console.error('[reports/quarterly-board] handler error:', message, stack);
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

  // Determine period — default to previous completed quarter
  const url = new URL(request.url);
  const quarterParam = url.searchParams.get('quarter');
  const period = parseQuarterPeriod(quarterParam);

  // Derive the 3 individual months for month-by-month comparison
  const monthsInQuarter = deriveMonthsInQuarter(period);

  // Data fetch — the main quarter period plus per-month revenue
  const [revenue, users, guild, activityEvents, monthlyRevenues] = await Promise.all([
    getRevenueBreakdown(period),
    getUserMetrics(period),
    getGuildMetrics(period),
    getActivityEvents(period, { limit: 200 }),
    Promise.all(monthsInQuarter.map((p) => getRevenueBreakdown(p))),
  ]);

  // Group activity events by action for the aggregate table
  const actionCounts: Record<string, number> = {};
  const severityCounts = { info: 0, warning: 0, critical: 0 };
  for (const e of activityEvents) {
    actionCounts[e.action] = (actionCounts[e.action] || 0) + 1;
    if (e.severity in severityCounts) {
      severityCounts[e.severity as keyof typeof severityCounts]++;
    }
  }

  const builder = await ReportBuilder.create({
    title: 'Penworth.ai',
    subtitle: 'Quarterly Board Report',
    periodLabel: period.label,
    generatedAt: new Date().toISOString(),
    generatedByEmail: profile.email || user.email || 'unknown',
  });

  builder.coverPage();

  // === Summary ===
  builder.section('Executive Summary');

  builder.kpis([
    { label: 'Quarter Net Revenue', value: formatUSD(revenue.netRevenue) },
    { label: 'Total Users', value: users.totalUsers.toLocaleString(), context: `${users.paidUsers.toLocaleString()} paid` },
    { label: 'Guild Members', value: guild.totalMembers.toLocaleString() },
  ]);

  builder.body(
    `This board report covers ${period.label}. Penworth processed ` +
    `${activityEvents.length.toLocaleString()} auditable business events ` +
    `during the quarter, of which ${severityCounts.critical} were ` +
    `classified as critical-severity (requiring board awareness) and ` +
    `${severityCounts.warning} as warning-severity (operational attention). ` +
    `All data pulled from the append-only audit_log; figures independently ` +
    `reconcilable via Stripe dashboard and the underlying Supabase tables.`,
  );

  // === Revenue by Month ===
  builder.section('Revenue by Month');
  builder.table(
    ['Month', 'Subs Events', 'Credit Packs (USD)', 'Refunds (USD)', 'Net (USD)'],
    monthsInQuarter.map((p, i) => {
      const r = monthlyRevenues[i];
      return {
        cells: [
          p.label,
          String(r.counts.subscriptionEvents),
          formatUSD(r.creditPackRevenue),
          `(${formatUSD(r.refundsIssued)})`,
          formatUSD(r.netRevenue),
        ],
      };
    }),
    { columnWidths: [100, 90, 110, 95, 85] },
  );

  builder.body(
    `Total refunds for the quarter: ${formatUSD(revenue.refundsIssued)} across ` +
    `${revenue.counts.refunds} standard refunds and ${revenue.counts.disputes} ` +
    `Stripe disputes. Dispute rate is a KPI to monitor — any quarter showing ` +
    `>1% disputes relative to subscription count warrants a fraud-pattern review.`,
  );

  // === User Growth ===
  builder.section('User Growth');

  builder.kpis([
    { label: 'New Sign-ups', value: users.signupsThisPeriod.toLocaleString() },
    { label: 'Prior Quarter', value: users.signupsLastPeriod.toLocaleString() },
    { label: 'Growth Rate', value: formatPercent(users.growthRate) },
  ]);

  builder.subsection('Plan Distribution');
  builder.table(
    ['Plan', 'Users', '% of Total'],
    [
      { cells: ['Free',       users.planBreakdown.free.toLocaleString(),       pct(users.planBreakdown.free, users.totalUsers)] },
      { cells: ['Pro',        users.planBreakdown.pro.toLocaleString(),        pct(users.planBreakdown.pro, users.totalUsers)] },
      { cells: ['Max',        users.planBreakdown.max.toLocaleString(),        pct(users.planBreakdown.max, users.totalUsers)] },
      { cells: ['Enterprise', users.planBreakdown.enterprise.toLocaleString(), pct(users.planBreakdown.enterprise, users.totalUsers)] },
    ],
    { columnWidths: [180, 150, 130] },
  );

  // === Guild ===
  builder.section('Guild Fellowship');

  builder.kpis([
    { label: 'Applications', value: guild.applicationsThisPeriod.toLocaleString() },
    { label: 'Acceptances', value: guild.acceptancesThisPeriod.toLocaleString() },
    { label: 'Declines', value: guild.declinesThisPeriod.toLocaleString() },
  ]);

  if (Object.keys(guild.membersByTier).length > 0) {
    builder.subsection('Active Member Tier Distribution');
    builder.bulletList(
      Object.entries(guild.membersByTier)
        .sort(([, a], [, b]) => b - a)
        .map(([tier, count]) => `${tier}: ${count.toLocaleString()}`),
    );
  }

  builder.subsection('Payout Status (Quarter)');
  builder.table(
    ['Status', 'Count', 'Total Amount'],
    [
      { cells: ['Queued',    String(guild.payoutsThisPeriod.queued),    '—'] },
      { cells: ['Approved',  String(guild.payoutsThisPeriod.approved),  '—'] },
      { cells: ['Sent',      String(guild.payoutsThisPeriod.sent),      '—'] },
      { cells: ['Confirmed', String(guild.payoutsThisPeriod.confirmed), '—'] },
      { cells: ['TOTAL',     '',                                         formatUSD(guild.payoutsThisPeriod.totalAmountUsd)] },
    ],
    { columnWidths: [170, 140, 150] },
  );

  // === Activity Breakdown ===
  builder.section('Activity Log Breakdown');
  builder.body(
    `Every business event is captured in the append-only audit_log. ` +
    `The table below summarises event counts by canonical action for ` +
    `the quarter. Full event detail is available in the Due Diligence ` +
    `Data Room Export (separate PDF).`,
  );

  const actionRows = Object.entries(actionCounts)
    .sort(([, a], [, b]) => b - a)
    .map(([action, count]) => ({ cells: [action, count.toLocaleString()] }));

  if (actionRows.length > 0) {
    builder.table(
      ['Action', 'Events'],
      actionRows,
      { columnWidths: [300, 160] },
    );
  } else {
    builder.body('No audited events for this period.');
  }

  builder.subsection('Severity Distribution');
  builder.bulletList([
    `Info: ${severityCounts.info.toLocaleString()} events`,
    `Warning: ${severityCounts.warning.toLocaleString()} events`,
    `Critical: ${severityCounts.critical.toLocaleString()} events`,
  ]);

  const pdf = await builder.end();

  void logAuditFromRequest(request, {
    actorType: 'admin',
    actorUserId: user.id,
    action: 'admin.override',
    entityType: 'report',
    entityId: `quarterly-board/${period.label}`,
    metadata: {
      kind: 'generate_quarterly_board_report',
      period_label: period.label,
      period_start: period.startDate,
      period_end: period.endDate,
      pdf_size_bytes: pdf.length,
      activity_events_included: activityEvents.length,
    },
  });

  return new NextResponse(new Uint8Array(pdf), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="Penworth_Quarterly_Board_Report_${period.label.replace(/\s/g, '_')}.pdf"`,
      'Cache-Control': 'no-store',
    },
  });
}

// ----------------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------------

function parseQuarterPeriod(quarterParam: string | null): PeriodRange {
  if (quarterParam && /^\d{4}-Q[1-4]$/.test(quarterParam)) {
    const [yStr, qStr] = quarterParam.split('-');
    const y = Number(yStr);
    const q = Number(qStr.slice(1));
    const middleMonth = (q - 1) * 3 + 1; // 0-indexed
    return quarterPeriod(new Date(Date.UTC(y, middleMonth, 15)));
  }
  // Default: previous completed quarter
  const now = new Date();
  const currentQuarter = Math.floor(now.getUTCMonth() / 3);
  const prevQuarterMiddleMonth =
    currentQuarter === 0
      ? 10 // Oct of previous year
      : (currentQuarter - 1) * 3 + 1;
  const prevQuarterYear = currentQuarter === 0 ? now.getUTCFullYear() - 1 : now.getUTCFullYear();
  return quarterPeriod(new Date(Date.UTC(prevQuarterYear, prevQuarterMiddleMonth, 15)));
}

function deriveMonthsInQuarter(quarter: PeriodRange): PeriodRange[] {
  const start = new Date(quarter.startDate);
  return [0, 1, 2].map((offset) =>
    monthPeriod(new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + offset, 15))),
  );
}

function pct(n: number, total: number): string {
  if (total === 0) return '0%';
  return `${((n / total) * 100).toFixed(1)}%`;
}
