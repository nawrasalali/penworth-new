/**
 * GET /api/admin/reports/dd-data-room
 *
 * Generates the Due Diligence Data Room Export as a downloadable PDF.
 *
 * This is the broadest of the three report templates: a complete
 * audit trail dump paired with aggregate financial history. Default
 * window is the full 7-year Australian Corporations Act retention
 * period. Intended to be run during investor due diligence, legal
 * discovery, or regulator response.
 *
 * Query params:
 *   - days (optional): how many days back to cover. Defaults to 2555
 *     (7 years). Capped at 3650 (10 years) to protect the report from
 *     unbounded generation time.
 *   - maxEvents (optional): cap on raw event rows included. Defaults
 *     to 1000. For full dumps beyond this, use the CSV export route
 *     (future work) — PDFs beyond ~1000 rows become unwieldy.
 *
 * Response: application/pdf
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { ReportBuilder } from '@/lib/reports/pdf-builder';
import {
  getRevenueBreakdown,
  getUserMetrics,
  getGuildMetrics,
  getActivityEvents,
  customPeriod,
  formatUSD,
  formatDateTime,
} from '@/lib/reports/data';
import { logAuditFromRequest } from '@/lib/audit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// This report can be slow — give it room
export const maxDuration = 300; // seconds (Vercel Pro)

export async function GET(request: NextRequest) {
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

  // Parse params with safe defaults + hard caps
  const url = new URL(request.url);
  const daysParam = Number(url.searchParams.get('days') ?? '2555');
  const maxEventsParam = Number(url.searchParams.get('maxEvents') ?? '1000');
  const days = Math.min(Math.max(1, isFinite(daysParam) ? daysParam : 2555), 3650);
  const maxEvents = Math.min(Math.max(50, isFinite(maxEventsParam) ? maxEventsParam : 1000), 5000);

  const period = customPeriod(new Date(), days, formatPeriodLabel(days));

  // Data fetch — for the whole window, in parallel
  const [revenue, users, guild, events] = await Promise.all([
    getRevenueBreakdown(period),
    getUserMetrics(period),
    getGuildMetrics(period),
    getActivityEvents(period, { limit: maxEvents }),
  ]);

  const builder = await ReportBuilder.create({
    title: 'Penworth.ai',
    subtitle: 'Due Diligence Data Room Export',
    periodLabel: period.label,
    generatedAt: new Date().toISOString(),
    generatedByEmail: profile.email || user.email || 'unknown',
  });

  builder.coverPage();

  // === Scope ===
  builder.section('Scope of this Export');
  builder.body(
    `This Due Diligence Data Room Export was generated on ` +
    `${formatDateTime(new Date().toISOString())} by ${profile.email || user.email}. ` +
    `It covers the ${days}-day period preceding generation (${period.label}).`,
  );
  builder.body(
    `Source: the Penworth append-only audit_log table (migration 015), ` +
    `configured with trigger-enforced UPDATE / DELETE / TRUNCATE blocks at ` +
    `the PostgreSQL level. Every row in this report can be cross-referenced ` +
    `to a specific row in the audit_log table by its id field. The audit_log ` +
    `is backed by a 7-year minimum retention policy consistent with ` +
    `Australian Corporations Act s286 and s290.`,
  );
  builder.body(
    `Supplementary data sources: Supabase public.profiles (user state), ` +
    `public.guild_members (Guild state), public.guild_payouts (commission ` +
    `settlement), and public.stripe_webhook_events (Stripe idempotency ` +
    `log). These are live-state tables — their current values reflect the ` +
    `state at export generation time, not the historical state at any prior ` +
    `point during the period.`,
  );

  // === Financials ===
  builder.section('Financial Summary');

  builder.kpis([
    { label: 'Period Net Revenue', value: formatUSD(revenue.netRevenue) },
    { label: 'Subscription Events', value: revenue.counts.subscriptionEvents.toLocaleString() },
    { label: 'Credit Pack Events', value: revenue.counts.creditPackEvents.toLocaleString() },
  ]);

  builder.subsection('Revenue Breakdown');
  builder.table(
    ['Source', 'Event Count', 'Gross Amount (USD)'],
    [
      { cells: ['Subscription events',       String(revenue.counts.subscriptionEvents), formatUSD(revenue.subscriptionRevenue)] },
      { cells: ['Credit pack purchases',     String(revenue.counts.creditPackEvents),   formatUSD(revenue.creditPackRevenue)] },
      { cells: ['Refunds issued',            String(revenue.counts.refunds),            `(${formatUSD(revenue.refundsIssued)})`] },
      { cells: ['Disputes (chargebacks)',    String(revenue.counts.disputes),           '—'] },
      { cells: ['Net revenue',               '',                                         formatUSD(revenue.netRevenue)] },
    ],
    { columnWidths: [210, 110, 140] },
  );

  // === Users ===
  builder.section('User Base');

  builder.table(
    ['Metric', 'Value'],
    [
      { cells: ['Total users (current)',  users.totalUsers.toLocaleString()] },
      { cells: ['Paid users (current)',   users.paidUsers.toLocaleString()] },
      { cells: ['Free users (current)',   users.freeUsers.toLocaleString()] },
      { cells: ['Admin users (current)',  users.adminUsers.toLocaleString()] },
      { cells: ['Sign-ups in period',     users.signupsThisPeriod.toLocaleString()] },
    ],
    { columnWidths: [320, 140] },
  );

  builder.subsection('Plan Distribution (Current)');
  builder.table(
    ['Plan', 'User Count'],
    Object.entries(users.planBreakdown).map(([plan, count]) => ({
      cells: [plan, count.toLocaleString()],
    })),
    { columnWidths: [230, 230] },
  );

  // === Guild ===
  builder.section('Guild Fellowship');

  builder.table(
    ['Metric', 'Value'],
    [
      { cells: ['Active members (current)',   guild.totalMembers.toLocaleString()] },
      { cells: ['Applications in period',     guild.applicationsThisPeriod.toLocaleString()] },
      { cells: ['Acceptances in period',      guild.acceptancesThisPeriod.toLocaleString()] },
      { cells: ['Declines in period',         guild.declinesThisPeriod.toLocaleString()] },
      { cells: ['Total payouts in period',    formatUSD(guild.payoutsThisPeriod.totalAmountUsd)] },
    ],
    { columnWidths: [320, 140] },
  );

  // === Raw Activity Log ===
  builder.section('Raw Activity Log');
  builder.body(
    `The following ${events.length.toLocaleString()} audit events represent ` +
    `${events.length === maxEvents ? `the most recent ${maxEvents} events (export capped to protect PDF size — for complete data, request CSV export)` : `the complete event list for this period`}. ` +
    `Each row corresponds to a single audit_log.id. Full before/after payloads ` +
    `are not included in this PDF — use the audit_log query API for that detail.`,
  );

  if (events.length === 0) {
    builder.body('No audit events in this period.');
  } else {
    builder.table(
      ['Timestamp (UTC)', 'Action', 'Entity', 'Actor Type', 'Sev'],
      events.map((e) => ({
        cells: [
          e.created_at.slice(0, 19).replace('T', ' '),
          e.action,
          `${e.entity_type}${e.entity_id ? '/' + e.entity_id.slice(0, 8) : ''}`,
          e.actor_type,
          severityLabel(e.severity),
        ],
      })),
      { columnWidths: [125, 135, 110, 60, 30] },
    );
  }

  // === Methodology ===
  builder.section('Methodology & Data Integrity');
  builder.bulletList([
    'audit_log is append-only: every INSERT is final. UPDATE and DELETE are blocked by a PL/pgSQL trigger (audit_log_block_mutation).',
    'TRUNCATE is also blocked by trigger, preventing accidental bulk clears.',
    'Row-level security policies restrict reads: admins see all; users see their own actor rows only.',
    'Service-role writes (from Next.js API routes) bypass RLS via createServiceClient() — only server-side code writes to this table.',
    'The 7-year retention is enforced by operational policy backed by the Corporations Act 2001 (Cth) ss286, 290 — not a database TTL.',
    'Timestamps are stored as PostgreSQL TIMESTAMPTZ; displayed in UTC in this report.',
    'Revenue figures in the Financial Summary are pulled from audit_log rows with action = subscription.activate, credit_pack.purchase, and refund.issue. They are independently reconcilable against the Stripe dashboard for the same period.',
  ]);

  const pdf = await builder.end();

  // Audit the report generation itself — DD exports are sensitive and
  // should always be self-documented in the same log they summarise.
  void logAuditFromRequest(request, {
    actorType: 'admin',
    actorUserId: user.id,
    action: 'admin.override',
    entityType: 'report',
    entityId: `dd-data-room/${period.label}`,
    severity: 'warning', // DD exports are higher-stakes than monthly/quarterly
    metadata: {
      kind: 'generate_dd_data_room_export',
      period_label: period.label,
      period_days: days,
      period_start: period.startDate,
      period_end: period.endDate,
      events_included: events.length,
      events_cap: maxEvents,
      pdf_size_bytes: pdf.length,
    },
  });

  return new NextResponse(new Uint8Array(pdf), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="Penworth_DD_Data_Room_Export_${period.label.replace(/\s/g, '_')}.pdf"`,
      'Cache-Control': 'no-store',
    },
  });
}

// ----------------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------------

function formatPeriodLabel(days: number): string {
  if (days === 2555) return '7 years (retention window)';
  if (days === 365)  return 'Last 12 months';
  if (days === 90)   return 'Last 90 days';
  if (days === 30)   return 'Last 30 days';
  return `Last ${days} days`;
}

function severityLabel(s: string): string {
  if (s === 'critical') return 'CRIT';
  if (s === 'warning')  return 'WARN';
  return 'info';
}
