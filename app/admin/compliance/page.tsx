import { createClient } from '@/lib/supabase/server';
import Link from 'next/link';
import { formatDistanceToNow, format } from 'date-fns';
import {
  ShieldCheck,
  AlertTriangle,
  Clock,
  Trash2,
  Download,
  FileText,
  CheckCircle2,
  XCircle,
} from 'lucide-react';
import { daysUntilDeadline } from '@/lib/compliance';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

// ============================================================================
// /admin/compliance
// ============================================================================
//
// GDPR/PDPA compliance dashboard. Shows every pending data-subject-rights
// request (deletion + export), ordered by deadline urgency — so the
// founder or admin can see at a glance what will breach legal deadlines
// next.
//
// This is the human fulfilment surface. The actual "walk 32 tables and
// delete the user's rows" logic is a separate work item (next session).
// For now, an admin reads a request, manually fulfils it (via Supabase
// SQL), records what they did in the fulfillment_notes + manifest, and
// transitions the request to 'completed' via the PATCH endpoint.
//
// Request urgency legend (matches `daysUntilDeadline` output):
//   breached    (< 0 days)   — LEGAL BREACH, critical
//   critical    (≤ 3 days)   — emergency
//   warning     (≤ 10 days)  — prioritize
//   normal      (> 10 days)  — routine

export default async function AdminCompliancePage() {
  const supabase = await createClient();

  // Admin gate relies on the layout — but the RLS policies also gate
  // these tables. If the user isn't admin, the queries return [].

  // ---------- DELETION REQUESTS ----------
  const { data: pendingDeletions } = await supabase
    .from('data_deletion_requests')
    .select(
      'id, user_email, request_source, jurisdiction, status, requested_at, statutory_deadline, processed_by',
    )
    .in('status', ['received', 'processing'])
    .order('statutory_deadline', { ascending: true });

  const { data: completedDeletions } = await supabase
    .from('data_deletion_requests')
    .select(
      'id, user_email, status, requested_at, completed_at, statutory_deadline',
    )
    .in('status', ['completed', 'rejected', 'failed'])
    .order('updated_at', { ascending: false })
    .limit(10);

  // ---------- EXPORT REQUESTS ----------
  const { data: pendingExports } = await supabase
    .from('data_exports')
    .select(
      'id, user_email, format, status, requested_at, statutory_deadline, processed_by',
    )
    .in('status', ['received', 'processing'])
    .order('statutory_deadline', { ascending: true });

  const { data: completedExports } = await supabase
    .from('data_exports')
    .select(
      'id, user_email, format, status, requested_at, delivered_at, statutory_deadline',
    )
    .in('status', ['delivered', 'expired', 'failed'])
    .order('updated_at', { ascending: false })
    .limit(10);

  // ---------- METRICS ----------
  const now = Date.now();
  const deletionRows = pendingDeletions ?? [];
  const exportRows = pendingExports ?? [];

  const breachedCount =
    deletionRows.filter((r) => new Date(r.statutory_deadline).getTime() < now).length +
    exportRows.filter((r) => new Date(r.statutory_deadline).getTime() < now).length;

  const approachingCount =
    deletionRows.filter((r) => {
      const d = daysUntilDeadline(r.statutory_deadline);
      return d >= 0 && d <= 5;
    }).length +
    exportRows.filter((r) => {
      const d = daysUntilDeadline(r.statutory_deadline);
      return d >= 0 && d <= 5;
    }).length;

  return (
    <div className="p-6 md:p-8 max-w-7xl mx-auto">
      {/* Header */}
      <div className="mb-8 flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <ShieldCheck className="h-5 w-5 text-primary" />
            <span className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">
              Command Center
            </span>
          </div>
          <h1 className="text-3xl font-bold tracking-tight">Compliance</h1>
          <p className="text-muted-foreground mt-1">
            GDPR Article 17 (erasure) &amp; Article 20 (portability) request log.
            Every request has a statutory 30-day deadline. Breaches = legal risk.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href="/admin"
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-semibold border hover:bg-muted"
          >
            ← Founder view
          </Link>
        </div>
      </div>

      {/* Top metrics */}
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-4 mb-6">
        <MetricCard
          label="Breached deadlines"
          value={breachedCount.toLocaleString()}
          sub={breachedCount === 0 ? 'All clear' : 'Act immediately'}
          icon={AlertTriangle}
          accent={breachedCount > 0 ? 'text-red-600' : 'text-emerald-600'}
          highlight={breachedCount > 0}
        />
        <MetricCard
          label="Approaching (≤ 5d)"
          value={approachingCount.toLocaleString()}
          sub="Prioritise these"
          icon={Clock}
          accent={approachingCount > 0 ? 'text-amber-600' : 'text-muted-foreground'}
        />
        <MetricCard
          label="Pending deletions"
          value={deletionRows.length.toLocaleString()}
          sub={`${deletionRows.filter(r => r.status === 'processing').length} in progress`}
          icon={Trash2}
          accent="text-rose-600"
        />
        <MetricCard
          label="Pending exports"
          value={exportRows.length.toLocaleString()}
          sub={`${exportRows.filter(r => r.status === 'processing').length} in progress`}
          icon={Download}
          accent="text-blue-600"
        />
      </div>

      {/* Pending deletions */}
      <div className="rounded-xl border bg-card p-5 mb-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-semibold flex items-center gap-2">
            <Trash2 className="h-4 w-4 text-rose-600" /> Pending deletion requests
          </h2>
          <span className="text-xs text-muted-foreground">
            {deletionRows.length} open · sorted by deadline
          </span>
        </div>

        {deletionRows.length === 0 ? (
          <div className="text-sm text-muted-foreground text-center py-6">
            No pending deletion requests.
          </div>
        ) : (
          <div className="space-y-2">
            {deletionRows.map((r) => (
              <RequestRow
                key={r.id}
                kind="deletion"
                id={r.id}
                email={r.user_email}
                meta={
                  <>
                    <span>{r.request_source}</span>
                    {r.jurisdiction && <> · <span>{r.jurisdiction}</span></>}
                  </>
                }
                status={r.status}
                requestedAt={r.requested_at}
                statutoryDeadline={r.statutory_deadline}
              />
            ))}
          </div>
        )}
      </div>

      {/* Pending exports */}
      <div className="rounded-xl border bg-card p-5 mb-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-semibold flex items-center gap-2">
            <Download className="h-4 w-4 text-blue-600" /> Pending export requests
          </h2>
          <span className="text-xs text-muted-foreground">
            {exportRows.length} open · sorted by deadline
          </span>
        </div>

        {exportRows.length === 0 ? (
          <div className="text-sm text-muted-foreground text-center py-6">
            No pending export requests.
          </div>
        ) : (
          <div className="space-y-2">
            {exportRows.map((r) => (
              <RequestRow
                key={r.id}
                kind="export"
                id={r.id}
                email={r.user_email}
                meta={<span>format: {r.format}</span>}
                status={r.status}
                requestedAt={r.requested_at}
                statutoryDeadline={r.statutory_deadline}
              />
            ))}
          </div>
        )}
      </div>

      {/* Recent completions */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="rounded-xl border bg-card p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4" /> Recent deletion outcomes
            </h2>
            <span className="text-xs text-muted-foreground">Last 10</span>
          </div>
          <div className="space-y-2">
            {(completedDeletions ?? []).length === 0 ? (
              <div className="text-sm text-muted-foreground text-center py-4">
                No history yet
              </div>
            ) : (
              (completedDeletions ?? []).map((r) => (
                <HistoryRow
                  key={r.id}
                  email={r.user_email}
                  status={r.status}
                  finalAt={r.completed_at ?? r.requested_at}
                  deadline={r.statutory_deadline}
                />
              ))
            )}
          </div>
        </div>

        <div className="rounded-xl border bg-card p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold flex items-center gap-2">
              <FileText className="h-4 w-4" /> Recent export outcomes
            </h2>
            <span className="text-xs text-muted-foreground">Last 10</span>
          </div>
          <div className="space-y-2">
            {(completedExports ?? []).length === 0 ? (
              <div className="text-sm text-muted-foreground text-center py-4">
                No history yet
              </div>
            ) : (
              (completedExports ?? []).map((r) => (
                <HistoryRow
                  key={r.id}
                  email={r.user_email}
                  status={r.status}
                  finalAt={r.delivered_at ?? r.requested_at}
                  deadline={r.statutory_deadline}
                  extra={`· ${r.format}`}
                />
              ))
            )}
          </div>
        </div>
      </div>

      {/* Footer help */}
      <div className="mt-6 rounded-xl border bg-muted/30 p-5 text-sm text-muted-foreground">
        <p className="font-semibold text-foreground mb-1">Fulfilment workflow (interim)</p>
        <p>
          Click any row above to open its detail page, where you can transition
          the request through its state machine. For now, the actual data
          deletion / export file generation is manual (SQL against Supabase).
          Automated fulfilment is the next build.
        </p>
      </div>
    </div>
  );
}

// ============================================================================
// HELPERS
// ============================================================================

function MetricCard({
  label,
  value,
  sub,
  icon: Icon,
  accent,
  highlight,
}: {
  label: string;
  value: string;
  sub?: string;
  icon: React.ComponentType<{ className?: string }>;
  accent: string;
  highlight?: boolean;
}) {
  return (
    <div
      className={`rounded-xl border bg-card p-5 ${
        highlight ? 'border-red-500/60 bg-red-50/50 dark:bg-red-950/20' : ''
      }`}
    >
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">
          {label}
        </span>
        <Icon className={`h-4 w-4 ${accent}`} />
      </div>
      <div className="text-2xl font-bold tabular-nums">{value}</div>
      {sub && <div className="text-xs text-muted-foreground mt-1">{sub}</div>}
    </div>
  );
}

function RequestRow({
  kind,
  id,
  email,
  meta,
  status,
  requestedAt,
  statutoryDeadline,
}: {
  kind: 'deletion' | 'export';
  id: string;
  email: string;
  meta: React.ReactNode;
  status: string;
  requestedAt: string;
  statutoryDeadline: string;
}) {
  const days = daysUntilDeadline(statutoryDeadline);
  const urgency =
    days < 0 ? 'breached' : days <= 3 ? 'critical' : days <= 10 ? 'warning' : 'normal';

  const urgencyStyles: Record<string, string> = {
    breached:
      'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400 border-red-500/40',
    critical:
      'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400 border-orange-500/30',
    warning:
      'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400 border-amber-500/30',
    normal:
      'bg-muted text-muted-foreground border-transparent',
  };

  return (
    <Link
      href={`/admin/compliance/${kind}/${id}`}
      className="flex items-center justify-between gap-3 rounded-lg border bg-background px-3 py-2 hover:border-primary transition-colors"
    >
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium truncate">{email}</div>
        <div className="text-xs text-muted-foreground truncate">
          {meta} · requested {formatDistanceToNow(new Date(requestedAt), { addSuffix: true })}
        </div>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <span
          className={`text-[10px] uppercase tracking-wider font-semibold px-2 py-0.5 rounded border ${urgencyStyles[urgency]}`}
        >
          {urgency === 'breached'
            ? `${Math.abs(days)}d over`
            : `${days}d left`}
        </span>
        <span className="text-[10px] uppercase tracking-wider font-semibold px-2 py-0.5 rounded bg-muted text-muted-foreground">
          {status}
        </span>
      </div>
    </Link>
  );
}

function HistoryRow({
  email,
  status,
  finalAt,
  deadline,
  extra,
}: {
  email: string;
  status: string;
  finalAt: string;
  deadline: string;
  extra?: string;
}) {
  // Was it completed before or after the statutory deadline?
  const onTime = new Date(finalAt).getTime() <= new Date(deadline).getTime();
  const bad = status === 'rejected' || status === 'failed' || status === 'expired';

  const statusStyles: Record<string, string> = {
    completed: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
    delivered: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
    rejected: 'bg-gray-100 text-gray-700 dark:bg-gray-900/30 dark:text-gray-400',
    failed: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
    expired: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
  };

  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border bg-background px-3 py-2">
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium truncate">{email}</div>
        <div className="text-xs text-muted-foreground truncate">
          {format(new Date(finalAt), 'PP')} {extra}
        </div>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        {!bad && (
          onTime ? (
            <span className="text-[10px] uppercase tracking-wider font-semibold text-emerald-600">
              on-time
            </span>
          ) : (
            <span className="text-[10px] uppercase tracking-wider font-semibold text-red-600">
              late
            </span>
          )
        )}
        <span
          className={`text-[10px] uppercase tracking-wider font-semibold px-2 py-0.5 rounded ${
            statusStyles[status] ?? 'bg-muted text-muted-foreground'
          }`}
        >
          {status}
        </span>
      </div>
    </div>
  );
}
