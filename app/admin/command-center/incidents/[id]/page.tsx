import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireAdminRole } from '@/lib/admin/require-admin-role';
import { createServiceClient } from '@/lib/supabase/service';
import { formatDistanceToNow } from 'date-fns';
import { AlertTriangle, CheckCircle2 } from 'lucide-react';
import { IncidentActions } from './incident-actions';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default async function IncidentDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await requireAdminRole();
  const { id } = await params;

  const admin = createServiceClient();
  const { data: incident } = await admin
    .from('pipeline_incidents')
    .select('*')
    .eq('id', id)
    .maybeSingle();

  if (!incident) notFound();

  // Session context so the admin can see exactly which run broke.
  const { data: interview } = incident.session_id
    ? await admin
        .from('interview_sessions')
        .select(
          'id, project_id, pipeline_status, current_agent, failure_count, last_failure_reason, agent_heartbeat_at, agent_started_at',
        )
        .eq('id', incident.session_id)
        .maybeSingle()
    : { data: null };

  // Author email so the admin can reach out manually if needed.
  let authorEmail: string | null = null;
  if (incident.user_id) {
    const { data: profile } = await admin
      .from('profiles')
      .select('email')
      .eq('id', incident.user_id)
      .maybeSingle();
    authorEmail = profile?.email ?? null;
  }

  return (
    <div className="p-6 md:p-8 max-w-3xl mx-auto">
      <Link
        href="/admin/command-center"
        className="text-xs text-muted-foreground hover:text-foreground"
      >
        ← Command Center
      </Link>

      <div className="mt-3 flex items-start gap-3">
        <SeverityBadge severity={incident.severity} />
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl font-bold tracking-tight leading-tight">
            {incident.incident_type.replace(/_/g, ' ')} ·{' '}
            {incident.agent ?? 'unknown agent'}
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Detected{' '}
            {formatDistanceToNow(new Date(incident.detected_at), {
              addSuffix: true,
            })}{' '}
            by {incident.detected_by}
          </p>
        </div>
      </div>

      <dl className="mt-5 grid grid-cols-2 gap-3 text-sm">
        <Metric label="Status" value={incident.resolved ? 'Resolved' : 'Open'} />
        <Metric label="Severity" value={incident.severity.toUpperCase()} />
        <Metric
          label="Session"
          value={incident.session_id ? `${String(incident.session_id).slice(0, 8)}…` : '—'}
        />
        <Metric
          label="Author"
          value={authorEmail ?? (incident.user_id ? String(incident.user_id).slice(0, 8) + '…' : '—')}
        />
        {incident.recovery_action_taken && (
          <Metric label="Recovery action" value={incident.recovery_action_taken} />
        )}
        {incident.user_notified_at && (
          <Metric
            label="User notified"
            value={formatDistanceToNow(new Date(incident.user_notified_at), { addSuffix: true })}
          />
        )}
      </dl>

      {interview && (
        <div className="mt-6 rounded-xl border bg-card p-5">
          <h2 className="text-xs uppercase tracking-wider font-semibold text-muted-foreground mb-3">
            Session state
          </h2>
          <div className="grid grid-cols-2 gap-3 text-sm">
            <KV k="Pipeline status" v={interview.pipeline_status} />
            <KV k="Current agent" v={interview.current_agent} />
            <KV k="Failure count" v={String(interview.failure_count ?? 0)} />
            <KV
              k="Heartbeat"
              v={
                interview.agent_heartbeat_at
                  ? formatDistanceToNow(new Date(interview.agent_heartbeat_at), { addSuffix: true })
                  : '—'
              }
            />
            {interview.last_failure_reason && (
              <KV k="Last failure" v={interview.last_failure_reason} wide />
            )}
          </div>
        </div>
      )}

      {incident.error_details && (
        <div className="mt-4 rounded-xl border bg-card p-5">
          <h2 className="text-xs uppercase tracking-wider font-semibold text-muted-foreground mb-3">
            Error details
          </h2>
          <pre className="whitespace-pre-wrap break-words text-xs font-mono bg-background/50 rounded p-3 overflow-x-auto">
            {JSON.stringify(incident.error_details, null, 2)}
          </pre>
        </div>
      )}

      {incident.resolved ? (
        <div className="mt-6 rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-4 flex items-start gap-3">
          <CheckCircle2 className="h-5 w-5 text-emerald-500 shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-semibold text-emerald-300">
              Resolved
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              {incident.resolved_at
                ? formatDistanceToNow(new Date(incident.resolved_at), {
                    addSuffix: true,
                  })
                : ''}
            </p>
            {incident.resolution_note && (
              <p className="text-xs mt-2">{incident.resolution_note}</p>
            )}
          </div>
        </div>
      ) : (
        <IncidentActions
          incidentId={incident.id}
          sessionId={incident.session_id}
          canForceRetry={session.adminRole === 'super_admin'}
        />
      )}
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

function KV({ k, v, wide }: { k: string; v: string | null; wide?: boolean }) {
  return (
    <div className={wide ? 'col-span-2' : ''}>
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
        {k}
      </div>
      <div className="text-sm font-medium break-words mt-0.5">{v ?? '—'}</div>
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
