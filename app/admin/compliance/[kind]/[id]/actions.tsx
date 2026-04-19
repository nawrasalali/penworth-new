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
