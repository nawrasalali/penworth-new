import { createClient } from '@/lib/supabase/server';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { format } from 'date-fns';
import { ShieldCheck, ArrowLeft, AlertTriangle, Clock } from 'lucide-react';
import { daysUntilDeadline } from '@/lib/compliance';
import { ComplianceRequestActions } from './actions';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

// ============================================================================
// /admin/compliance/[kind]/[id]
// ============================================================================
//
// Per-request detail view. Shows the full request + its timeline +
// state-transition controls. Server component for the data read; the
// transition buttons are a client component that POSTs to
// /api/admin/compliance/requests/[kind]/[id] and refreshes.

export default async function ComplianceRequestDetailPage(props: {
  params: Promise<{ kind: string; id: string }>;
}) {
  const { kind, id } = await props.params;

  if (kind !== 'deletion' && kind !== 'export') {
    notFound();
  }

  const supabase = await createClient();
  const table = kind === 'deletion' ? 'data_deletion_requests' : 'data_exports';

  const { data: request, error } = await supabase
    .from(table)
    .select('*')
    .eq('id', id)
    .maybeSingle();

  if (error || !request) {
    notFound();
  }

  // Pull user profile for context
  const { data: profile } = await supabase
    .from('profiles')
    .select('id, email, full_name, plan, created_at, is_admin')
    .eq('id', request.user_id)
    .maybeSingle();

  // Recent audit entries for this entity
  const entityType =
    kind === 'deletion' ? 'data_deletion_request' : 'data_export_request';
  const { data: auditTrail } = await supabase
    .from('audit_log')
    .select('id, action, actor_type, actor_user_id, before, after, metadata, severity, created_at')
    .eq('entity_type', entityType)
    .eq('entity_id', id)
    .order('created_at', { ascending: false })
    .limit(20);

  const days = daysUntilDeadline(request.statutory_deadline);
  const breached = days < 0;
  const isTerminal =
    request.status === 'completed' ||
    request.status === 'rejected' ||
    request.status === 'delivered' ||
    request.status === 'expired';

  const manifest =
    kind === 'deletion' ? request.deletion_manifest : request.export_manifest;

  return (
    <div className="p-6 md:p-8 max-w-5xl mx-auto">
      {/* Header */}
      <div className="mb-6">
        <Link
          href="/admin/compliance"
          className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground mb-3"
        >
          <ArrowLeft className="h-3 w-3" /> Back to compliance
        </Link>
        <div className="flex items-center gap-2 mb-1">
          <ShieldCheck className="h-5 w-5 text-primary" />
          <span className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">
            {kind === 'deletion' ? 'Right to Erasure' : 'Right to Data Portability'}
          </span>
        </div>
        <h1 className="text-2xl font-bold tracking-tight font-mono break-all">
          {id}
        </h1>
      </div>

      {/* Breach banner */}
      {breached && !isTerminal && (
        <div className="mb-6 rounded-xl border border-red-500/60 bg-red-50 dark:bg-red-950/30 p-4 flex items-start gap-3">
          <AlertTriangle className="h-5 w-5 text-red-600 shrink-0 mt-0.5" />
          <div>
            <div className="font-semibold text-red-900 dark:text-red-200">
              Statutory deadline breached
            </div>
            <div className="text-sm text-red-700 dark:text-red-300 mt-0.5">
              This request is {Math.abs(days)} day{Math.abs(days) === 1 ? '' : 's'} past
              its legal deadline. Complete fulfilment immediately and document
              the cause in the fulfillment notes.
            </div>
          </div>
        </div>
      )}

      {/* Request details + user context */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
        {/* Request */}
        <div className="rounded-xl border bg-card p-5">
          <h2 className="font-semibold mb-4">Request details</h2>
          <dl className="space-y-3 text-sm">
            <Row label="Status" value={<Pill value={request.status} />} />
            <Row
              label="Current deadline"
              value={
                <span
                  className={`inline-flex items-center gap-1.5 ${
                    breached ? 'text-red-600 font-semibold' : ''
                  }`}
                >
                  <Clock className="h-3.5 w-3.5" />
                  {format(new Date(request.statutory_deadline), 'PPP')}
                  <span className="text-muted-foreground">
                    ({breached ? `${Math.abs(days)}d over` : `${days}d left`})
                  </span>
                </span>
              }
            />
            <Row
              label="Requested"
              value={format(new Date(request.requested_at), 'PPP p')}
            />
            {kind === 'deletion' && (
              <>
                <Row label="Source" value={request.request_source} />
                {request.jurisdiction && (
                  <Row label="Jurisdiction" value={request.jurisdiction} />
                )}
              </>
            )}
            {kind === 'export' && (
              <Row label="Format" value={<code>{request.format}</code>} />
            )}
            {request.processing_started_at && (
              <Row
                label="Processing started"
                value={format(new Date(request.processing_started_at), 'PPP p')}
              />
            )}
            {request.completed_at && (
              <Row
                label="Completed"
                value={format(new Date(request.completed_at), 'PPP p')}
              />
            )}
            {request.delivered_at && (
              <Row
                label="Delivered"
                value={format(new Date(request.delivered_at), 'PPP p')}
              />
            )}
            {request.expires_at && (
              <Row
                label="Expires"
                value={format(new Date(request.expires_at), 'PPP p')}
              />
            )}
            {request.rejection_reason && (
              <Row label="Rejection reason" value={request.rejection_reason} />
            )}
            {request.failure_reason && (
              <Row label="Failure reason" value={request.failure_reason} />
            )}
            {kind === 'deletion' && request.fulfillment_notes && (
              <Row label="Notes" value={request.fulfillment_notes} />
            )}
          </dl>
        </div>

        {/* User */}
        <div className="rounded-xl border bg-card p-5">
          <h2 className="font-semibold mb-4">User</h2>
          {profile ? (
            <dl className="space-y-3 text-sm">
              <Row label="Email" value={profile.email} />
              {profile.full_name && <Row label="Name" value={profile.full_name} />}
              <Row label="Plan" value={profile.plan || 'free'} />
              <Row
                label="Account age"
                value={format(new Date(profile.created_at), 'PPP')}
              />
              <Row
                label="User ID"
                value={<code className="text-xs">{profile.id}</code>}
              />
            </dl>
          ) : (
            <div className="text-sm text-muted-foreground">
              User profile not found. Email at request time:{' '}
              <code>{request.user_email}</code>
            </div>
          )}
        </div>
      </div>

      {/* Transition controls (client component) */}
      {!isTerminal && (
        <div className="rounded-xl border bg-card p-5 mb-6">
          <h2 className="font-semibold mb-4">Transition request</h2>
          <ComplianceRequestActions
            kind={kind}
            id={id}
            currentStatus={request.status}
          />
        </div>
      )}

      {/* Manifest */}
      <div className="rounded-xl border bg-card p-5 mb-6">
        <h2 className="font-semibold mb-4">
          {kind === 'deletion' ? 'Deletion manifest' : 'Export manifest'}
        </h2>
        {!manifest || (Array.isArray(manifest) && manifest.length === 0) ? (
          <div className="text-sm text-muted-foreground">
            No entries yet. {kind === 'deletion'
              ? 'Each table cleared during fulfilment should be recorded here.'
              : 'Each table included in the export should be recorded here.'}
          </div>
        ) : (
          <pre className="text-xs bg-muted/50 rounded-lg p-3 overflow-x-auto">
            {JSON.stringify(manifest, null, 2)}
          </pre>
        )}
      </div>

      {/* Audit trail */}
      <div className="rounded-xl border bg-card p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-semibold">Audit trail</h2>
          <span className="text-xs text-muted-foreground">
            {auditTrail?.length ?? 0} event{auditTrail?.length === 1 ? '' : 's'}
          </span>
        </div>
        {(auditTrail ?? []).length === 0 ? (
          <div className="text-sm text-muted-foreground">No audit entries.</div>
        ) : (
          <div className="space-y-2">
            {(auditTrail ?? []).map((e) => (
              <div
                key={e.id}
                className="rounded-lg border bg-background px-3 py-2 text-sm"
              >
                <div className="flex items-center justify-between gap-3 mb-1">
                  <span className="font-semibold">{e.action}</span>
                  <span className="text-xs text-muted-foreground">
                    {format(new Date(e.created_at), 'PPP p')}
                  </span>
                </div>
                <div className="text-xs text-muted-foreground">
                  {e.actor_type}
                  {e.metadata && typeof e.metadata === 'object' && 'transition' in e.metadata ? (
                    <> · <span className="font-mono">{String((e.metadata as any).transition)}</span></>
                  ) : null}
                  {' · '}
                  <span
                    className={
                      e.severity === 'critical'
                        ? 'text-red-600 font-semibold'
                        : e.severity === 'warning'
                        ? 'text-amber-600'
                        : ''
                    }
                  >
                    {e.severity}
                  </span>
                </div>
                {e.metadata && typeof e.metadata === 'object' && (
                  <details className="mt-2">
                    <summary className="text-xs text-muted-foreground cursor-pointer hover:text-foreground">
                      details
                    </summary>
                    <pre className="text-[10px] bg-muted/50 rounded p-2 mt-1 overflow-x-auto">
                      {JSON.stringify(e.metadata, null, 2)}
                    </pre>
                  </details>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <dt className="text-xs uppercase tracking-wider text-muted-foreground font-semibold shrink-0">
        {label}
      </dt>
      <dd className="text-sm text-right">{value}</dd>
    </div>
  );
}

function Pill({ value }: { value: string }) {
  const styles: Record<string, string> = {
    received: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
    processing: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
    completed: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
    delivered: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
    rejected: 'bg-gray-100 text-gray-700 dark:bg-gray-900/30 dark:text-gray-400',
    failed: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
    expired: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
  };
  return (
    <span
      className={`text-[10px] uppercase tracking-wider font-semibold px-2 py-0.5 rounded ${
        styles[value] ?? 'bg-muted text-muted-foreground'
      }`}
    >
      {value}
    </span>
  );
}
