import Link from 'next/link';
import { requireAdminRole } from '@/lib/admin/require-admin-role';
import { createServiceClient } from '@/lib/supabase/service';
import { formatDistanceToNow } from 'date-fns';
import { Bell, CheckCircle2, AlertTriangle } from 'lucide-react';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

/**
 * /admin/command-center/alerts
 *
 * Full alert log, most recent first. Any admin role can read via the
 * alert_log_admin_read RLS policy (USING has_admin_role(auth.uid())),
 * so scoping here mirrors that: every admin sees the list, resolution
 * actions are gated per-alert by category (pipeline → ops; financial
 * → finance; etc.) but that gating lives in the ack API, not here.
 *
 * First 200 rows shown. Pagination is follow-up work — if the alert
 * volume ever reaches a point where 200 isn't enough on one screen,
 * the founder has bigger problems than pagination.
 */
export default async function AlertsListPage() {
  await requireAdminRole(); // any admin

  const admin = createServiceClient();
  const { data: alerts } = await admin
    .from('alert_log')
    .select(
      'id, source_type, severity, category, title, sent_at, acknowledged_at, acknowledged_by, delivery_status',
    )
    .order('sent_at', { ascending: false })
    .limit(200);

  const rows = alerts ?? [];
  const unackCount = rows.filter((r) => r.acknowledged_at === null).length;

  return (
    <div className="p-6 md:p-8 max-w-6xl mx-auto">
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <Link
            href="/admin/command-center"
            className="text-xs text-muted-foreground hover:text-foreground"
          >
            ← Command Center
          </Link>
          <div className="flex items-center gap-2 mt-2 mb-1">
            <Bell className="h-5 w-5 text-primary" />
            <h1 className="text-2xl font-bold tracking-tight">Alerts</h1>
          </div>
          <p className="text-sm text-muted-foreground">
            {rows.length} total · {unackCount} unacknowledged
          </p>
        </div>
      </div>

      <div className="rounded-xl border bg-card overflow-hidden">
        {rows.length === 0 ? (
          <div className="p-8 text-center text-sm text-muted-foreground">
            No alerts yet. The pipeline-health cron fires here when it
            catches a stuck session.
          </div>
        ) : (
          <div className="divide-y">
            {rows.map((a) => (
              <Link
                key={a.id}
                href={`/admin/command-center/alerts/${a.id}`}
                className={`flex items-center justify-between gap-4 px-4 py-3 hover:bg-muted/50 transition-colors ${
                  !a.acknowledged_at ? 'bg-amber-500/5' : ''
                }`}
              >
                <div className="min-w-0 flex-1 flex items-center gap-3">
                  <SeverityBadge severity={a.severity} />
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium truncate">
                      {a.title}
                    </div>
                    <div className="text-xs text-muted-foreground flex items-center gap-2 mt-0.5">
                      <span>{a.category}</span>
                      <span>·</span>
                      <span>{a.source_type}</span>
                      <span>·</span>
                      <span>
                        {formatDistanceToNow(new Date(a.sent_at), {
                          addSuffix: true,
                        })}
                      </span>
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <DeliveryStatusBadge status={a.delivery_status} />
                  {a.acknowledged_at ? (
                    <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                  ) : (
                    <AlertTriangle className="h-4 w-4 text-amber-500" />
                  )}
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function SeverityBadge({ severity }: { severity: string }) {
  const map: Record<string, string> = {
    p0: 'bg-red-500 text-white',
    p1: 'bg-orange-500 text-white',
    p2: 'bg-amber-500 text-black',
    p3: 'bg-muted text-muted-foreground',
  };
  return (
    <span
      className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${map[severity] ?? map.p3}`}
    >
      {severity}
    </span>
  );
}

function DeliveryStatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    pending: 'text-amber-500',
    sent: 'text-emerald-500',
    failed: 'text-red-500',
    deduplicated: 'text-muted-foreground',
    suppressed_quiet_hours: 'text-muted-foreground',
  };
  return (
    <span className={`text-[10px] uppercase tracking-wider font-semibold ${map[status] ?? ''}`}>
      {status.replace('_', ' ')}
    </span>
  );
}
