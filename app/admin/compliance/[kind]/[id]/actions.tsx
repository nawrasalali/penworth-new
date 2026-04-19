'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

// Same state machines as the PATCH endpoint. Keep in sync if either changes.
const DELETION_TRANSITIONS: Record<string, string[]> = {
  received: ['processing', 'rejected'],
  processing: ['completed', 'failed', 'rejected'],
  failed: ['processing', 'rejected'],
};

const EXPORT_TRANSITIONS: Record<string, string[]> = {
  received: ['processing', 'failed'],
  processing: ['delivered', 'failed'],
  failed: ['processing'],
  delivered: ['expired'],
};

const TRANSITION_LABELS: Record<string, string> = {
  processing: 'Start processing',
  completed: 'Mark completed',
  delivered: 'Mark delivered',
  rejected: 'Reject request',
  failed: 'Mark failed',
  expired: 'Mark expired',
};

const TRANSITION_STYLES: Record<string, string> = {
  processing: 'bg-amber-600 hover:bg-amber-700 text-white',
  completed: 'bg-emerald-600 hover:bg-emerald-700 text-white',
  delivered: 'bg-emerald-600 hover:bg-emerald-700 text-white',
  rejected: 'bg-gray-600 hover:bg-gray-700 text-white',
  failed: 'bg-red-600 hover:bg-red-700 text-white',
  expired: 'bg-amber-600 hover:bg-amber-700 text-white',
};

export function ComplianceRequestActions({
  kind,
  id,
  currentStatus,
}: {
  kind: 'deletion' | 'export';
  id: string;
  currentStatus: string;
}) {
  const router = useRouter();
  const transitions = kind === 'deletion' ? DELETION_TRANSITIONS : EXPORT_TRANSITIONS;
  const allowed = transitions[currentStatus] ?? [];

  const [selectedTo, setSelectedTo] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (allowed.length === 0) {
    return (
      <div className="text-sm text-muted-foreground">
        No transitions available from status <code>{currentStatus}</code>. The
        request has reached a terminal state.
      </div>
    );
  }

  async function handleSubmit() {
    if (!selectedTo) return;

    if (selectedTo === 'rejected' && !reason.trim()) {
      setError('Rejection reason is required.');
      return;
    }
    if (selectedTo === 'failed' && !reason.trim()) {
      setError('Failure reason is required.');
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      const body: Record<string, unknown> = {
        to: selectedTo,
      };
      if (note.trim()) body.note = note.trim();
      if (selectedTo === 'rejected') body.rejection_reason = reason.trim();
      if (selectedTo === 'failed') body.failure_reason = reason.trim();

      const res = await fetch(`/api/admin/compliance/requests/${kind}/${id}`, {
        method: 'PATCH',
        credentials: 'include',
        cache: 'no-store',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });

      const json = await res.json();
      if (!res.ok) {
        setError(json.error || json.message || 'Transition failed.');
        setSubmitting(false);
        return;
      }

      // Success — refresh server data so the page reflects the new status
      router.refresh();
      setSelectedTo(null);
      setNote('');
      setReason('');
      setSubmitting(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-4">
      {/* Auto-fulfil card — exports only, received|failed states */}
      {kind === 'export' && (currentStatus === 'received' || currentStatus === 'failed') && (
        <AutoFulfilExport id={id} currentStatus={currentStatus} />
      )}

      {/* Transition buttons */}
      <div className="flex flex-wrap gap-2">
        {allowed.map((to) => (
          <button
            key={to}
            type="button"
            onClick={() => {
              setSelectedTo(to);
              setError(null);
              setReason('');
              setNote('');
            }}
            className={`text-sm font-semibold px-3 py-2 rounded-lg transition-colors ${
              selectedTo === to
                ? TRANSITION_STYLES[to]
                : 'border bg-background hover:bg-muted'
            }`}
          >
            {TRANSITION_LABELS[to] ?? to}
          </button>
        ))}
      </div>

      {/* Conditional form fields */}
      {selectedTo && (
        <div className="space-y-3 rounded-lg border bg-background p-4">
          <div className="text-xs text-muted-foreground">
            Transitioning <code>{currentStatus}</code> →{' '}
            <code className="font-semibold">{selectedTo}</code>
          </div>

          {(selectedTo === 'rejected' || selectedTo === 'failed') && (
            <div>
              <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                {selectedTo === 'rejected' ? 'Rejection reason' : 'Failure reason'}
                <span className="text-red-600"> *</span>
              </label>
              <textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                rows={2}
                className="mt-1 w-full rounded-lg border bg-background px-3 py-2 text-sm"
                placeholder={
                  selectedTo === 'rejected'
                    ? 'Why is this request being refused? (e.g. legal hold, pseudonymisation chosen, invalid request)'
                    : 'What went wrong during processing? This will be logged and may be referenced later.'
                }
              />
            </div>
          )}

          {kind === 'deletion' && (
            <div>
              <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Fulfilment notes (optional)
              </label>
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                rows={2}
                className="mt-1 w-full rounded-lg border bg-background px-3 py-2 text-sm"
                placeholder="e.g. 'Tables cleared: projects, ai_sessions, usage. Retained consent_records for legal basis.'"
              />
            </div>
          )}

          {error && (
            <div className="rounded-lg border border-red-500/40 bg-red-50 dark:bg-red-950/30 px-3 py-2 text-sm text-red-700 dark:text-red-300">
              {error}
            </div>
          )}

          <div className="flex gap-2">
            <button
              type="button"
              onClick={handleSubmit}
              disabled={submitting}
              className={`text-sm font-semibold px-4 py-2 rounded-lg ${TRANSITION_STYLES[selectedTo]} disabled:opacity-50 disabled:cursor-not-allowed`}
            >
              {submitting ? 'Submitting...' : `Confirm ${TRANSITION_LABELS[selectedTo]?.toLowerCase()}`}
            </button>
            <button
              type="button"
              onClick={() => {
                setSelectedTo(null);
                setError(null);
                setReason('');
                setNote('');
              }}
              disabled={submitting}
              className="text-sm font-semibold px-4 py-2 rounded-lg border hover:bg-muted disabled:opacity-50"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ----------------------------------------------------------------------------
// AutoFulfilExport — runs the full export workflow in one click
// ----------------------------------------------------------------------------

function AutoFulfilExport({
  id,
  currentStatus,
}: {
  id: string;
  currentStatus: string;
}) {
  const router = useRouter();
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<null | {
    ok: boolean;
    file_path?: string;
    signed_url?: string;
    email_sent?: boolean;
    email_error?: string | null;
    manifest_summary?: {
      tables_attempted: number;
      tables_succeeded: number;
      tables_empty: number;
      tables_failed: number;
    };
    failure_reason?: string;
    error?: string;
  }>(null);

  async function run() {
    setRunning(true);
    setResult(null);
    try {
      const res = await fetch(`/api/admin/compliance/requests/export/${id}/fulfil`, {
        method: 'POST',
        credentials: 'include',
        cache: 'no-store',
      });
      const body = await res.json();
      setResult(body);
      // Only refresh on success — on failure, the user wants to see the error
      // surfaced here AND in the audit trail below, which a refresh will load.
      if (body.ok) {
        setTimeout(() => router.refresh(), 500);
      }
    } catch (e) {
      setResult({
        ok: false,
        error: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="rounded-lg border bg-gradient-to-br from-indigo-50 to-violet-50 dark:from-indigo-950/30 dark:to-violet-950/30 p-4">
      <div className="flex items-start justify-between gap-4 mb-3">
        <div>
          <div className="text-sm font-semibold">
            Auto-fulfil export
          </div>
          <div className="text-xs text-muted-foreground mt-0.5">
            Builds JSON dump across 45 user-scoped tables, uploads to
            private storage, generates a 7-day signed URL, and emails
            the user. {currentStatus === 'failed' && 'This will retry from the previous failed attempt.'}
          </div>
        </div>
        <button
          type="button"
          onClick={run}
          disabled={running}
          className="shrink-0 text-sm font-semibold px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {running ? 'Running...' : 'Run fulfilment'}
        </button>
      </div>

      {result && (
        <div
          className={`text-xs rounded-md p-3 ${
            result.ok
              ? 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-900 dark:text-emerald-200 border border-emerald-500/30'
              : 'bg-red-50 dark:bg-red-950/40 text-red-900 dark:text-red-200 border border-red-500/30'
          }`}
        >
          {result.ok ? (
            <>
              <div className="font-semibold mb-1">Delivered ✓</div>
              <div>
                Attempted {result.manifest_summary?.tables_attempted} tables ·
                succeeded {result.manifest_summary?.tables_succeeded} ·
                empty {result.manifest_summary?.tables_empty} ·
                failed {result.manifest_summary?.tables_failed}
              </div>
              <div className="mt-1">
                Email to user:{' '}
                {result.email_sent ? (
                  <span className="font-semibold">sent</span>
                ) : (
                  <span className="font-semibold text-amber-700 dark:text-amber-400">
                    FAILED — manually relay the signed URL
                  </span>
                )}
              </div>
              {result.signed_url && (
                <details className="mt-2">
                  <summary className="cursor-pointer font-semibold">
                    signed_url (click to expand)
                  </summary>
                  <code className="mt-1 block break-all bg-black/5 dark:bg-white/5 p-2 rounded">
                    {result.signed_url}
                  </code>
                </details>
              )}
            </>
          ) : (
            <>
              <div className="font-semibold mb-1">Failed</div>
              <div>{result.failure_reason || result.error || 'Unknown error'}</div>
              <div className="mt-1 opacity-70">
                Request is now in status=failed and may be retried.
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
