import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireAdminRole } from '@/lib/admin/require-admin-role';
import { createServiceClient } from '@/lib/supabase/service';
import { formatDistanceToNow } from 'date-fns';
import { Bell, CheckCircle2 } from 'lucide-react';
import { AckAlertForm } from './ack-form';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default async function AlertDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireAdminRole();
  const { id } = await params;

  const admin = createServiceClient();
  const { data: alert } = await admin
    .from('alert_log')
    .select('*')
    .eq('id', id)
    .maybeSingle();

  if (!alert) notFound();

  // Resolve the acknowledger's name if there is one. Private-looking
  // info (acknowledger email) stays inside the admin surface only.
  let ackName: string | null = null;
  if (alert.acknowledged_by) {
    const { data: profile } = await admin
      .from('profiles')
      .select('email, full_name')
      .eq('id', alert.acknowledged_by)
      .maybeSingle();
    ackName = profile?.full_name ?? profile?.email ?? null;
  }

  return (
    <div className="p-6 md:p-8 max-w-3xl mx-auto">
      <Link
        href="/admin/command-center/alerts"
        className="text-xs text-muted-foreground hover:text-foreground"
      >
        ← Back to alerts
      </Link>

      <div className="mt-3 flex items-start gap-3">
        <SeverityBadge severity={alert.severity} />
        <h1 className="text-2xl font-bold tracking-tight leading-tight">
          {alert.title}
        </h1>
      </div>

      <dl className="mt-5 grid grid-cols-2 gap-3 text-sm">
        <Metric label="Source" value={alert.source_type} />
        <Metric label="Category" value={alert.category} />
        <Metric label="Severity" value={alert.severity.toUpperCase()} />
        <Metric label="Delivery" value={alert.delivery_status.replace('_', ' ')} />
        <Metric
          label="Sent"
          value={`${formatDistanceToNow(new Date(alert.sent_at), {
            addSuffix: true,
          })} · ${new Date(alert.sent_at).toISOString()}`}
        />
        <Metric
          label="Recipients"
          value={`${Array.isArray(alert.recipients_json) ? alert.recipients_json.length : 0}`}
        />
      </dl>

      <div className="mt-6 rounded-xl border bg-card p-5">
        <h2 className="text-xs uppercase tracking-wider font-semibold text-muted-foreground mb-3">
          Message
        </h2>
        <pre className="whitespace-pre-wrap break-words text-sm font-sans leading-relaxed">
          {alert.body}
        </pre>
      </div>

      {alert.delivery_error && (
        <div className="mt-4 rounded-xl border border-red-500/30 bg-red-500/5 p-5">
          <h2 className="text-xs uppercase tracking-wider font-semibold text-red-500 mb-2">
            Delivery error
          </h2>
          <pre className="whitespace-pre-wrap break-words text-sm font-mono text-red-400">
            {alert.delivery_error}
          </pre>
        </div>
      )}

      <div className="mt-6">
        {alert.acknowledged_at ? (
          <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-4 flex items-start gap-3">
            <CheckCircle2 className="h-5 w-5 text-emerald-500 shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-semibold text-emerald-300">
                Acknowledged
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                By {ackName ?? 'an admin'} ·{' '}
                {formatDistanceToNow(new Date(alert.acknowledged_at), {
                  addSuffix: true,
                })}
              </p>
            </div>
          </div>
        ) : (
          <AckAlertForm alertId={alert.id} />
        )}
      </div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border bg-card p-3">
      <dt className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
        {label}
      </dt>
      <dd className="mt-0.5 text-sm font-medium break-words">{value}</dd>
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
      className={`inline-flex items-center px-2 py-1 rounded text-xs font-bold uppercase tracking-wider shrink-0 ${map[severity] ?? map.p3}`}
    >
      {severity}
    </span>
  );
}
