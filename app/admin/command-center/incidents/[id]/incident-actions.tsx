'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Loader2, RefreshCw, Zap } from 'lucide-react';

/**
 * Resolve actions, per brief:
 *   retry        — kick the auto-recovery path (cron will pick it up)
 *   escalate     — mark escalated, leave for manual follow-up
 *   user_fault   — user abandoned / out of credits / similar
 *   known_issue  — tracked elsewhere; close the row
 *
 * Plus a super-admin-only Force Retry that bypasses the decision
 * function entirely and fires the restart event directly.
 */
type ResolutionAction = 'retry' | 'escalate' | 'user_fault' | 'known_issue';

export function IncidentActions({
  incidentId,
  sessionId,
  canForceRetry,
}: {
  incidentId: string;
  sessionId: string | null;
  canForceRetry: boolean;
}) {
  const [note, setNote] = useState('');
  const [action, setAction] = useState<ResolutionAction>('retry');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [forcing, setForcing] = useState(false);
  const router = useRouter();

  const resolve = async () => {
    setError(null);
    if (note.trim().length < 3) {
      setError('Add a resolution note — at least three characters.');
      return;
    }

    try {
      const res = await fetch(`/api/admin/incidents/${incidentId}/resolve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ note: note.trim(), action }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body?.error ?? `Resolve failed (${res.status}).`);
        return;
      }
      startTransition(() => router.refresh());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error.');
    }
  };

  const forceRetry = async () => {
    if (!sessionId) {
      setError('Force retry needs a session id.');
      return;
    }
    setError(null);
    setForcing(true);
    try {
      const res = await fetch(`/api/admin/incidents/${incidentId}/force-retry`, {
        method: 'POST',
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body?.error ?? `Force retry failed (${res.status}).`);
        return;
      }
      startTransition(() => router.refresh());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error.');
    } finally {
      setForcing(false);
    }
  };

  const actionsMeta: Record<ResolutionAction, { label: string; hint: string }> = {
    retry:       { label: 'Retry (queued)',  hint: 'Leave the session for the next pipeline-health cron cycle' },
    escalate:    { label: 'Escalate',         hint: 'Mark for manual follow-up; no automated action' },
    user_fault:  { label: 'User fault',       hint: 'Abandoned or user-side issue; not a pipeline bug' },
    known_issue: { label: 'Known issue',      hint: 'Duplicate of something tracked elsewhere' },
  };

  return (
    <div className="mt-6 space-y-4">
      <div className="rounded-xl border bg-card p-5">
        <h2 className="text-xs uppercase tracking-wider font-semibold text-muted-foreground mb-3">
          Resolve
        </h2>

        <div className="space-y-2 mb-3">
          {(Object.entries(actionsMeta) as [ResolutionAction, { label: string; hint: string }][]).map(
            ([key, meta]) => (
              <label
                key={key}
                className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                  action === key ? 'bg-primary/5 border-primary' : 'bg-background hover:bg-muted/50'
                }`}
              >
                <input
                  type="radio"
                  name="action"
                  value={key}
                  checked={action === key}
                  onChange={() => setAction(key)}
                  className="mt-1"
                  disabled={pending}
                />
                <div>
                  <div className="text-sm font-medium">{meta.label}</div>
                  <div className="text-xs text-muted-foreground">{meta.hint}</div>
                </div>
              </label>
            ),
          )}
        </div>

        <Textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="What happened? Any follow-up needed?"
          rows={3}
          className="mb-3"
          disabled={pending}
        />

        {error && <p className="text-xs text-red-400 mb-3">{error}</p>}

        <Button onClick={resolve} disabled={pending} size="sm">
          {pending ? (
            <>
              <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
              Resolving…
            </>
          ) : (
            <>
              <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
              Mark resolved
            </>
          )}
        </Button>
      </div>

      {canForceRetry && sessionId && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-5">
          <h2 className="text-xs uppercase tracking-wider font-semibold text-amber-400 mb-3">
            Super-admin: Force retry
          </h2>
          <p className="text-xs text-muted-foreground mb-3 leading-relaxed">
            Bypasses the pipeline_should_auto_retry decision and fires
            the restart event directly. Use when the normal decider has
            declined to retry but you have out-of-band context
            suggesting the next attempt will succeed.
          </p>
          <Button
            onClick={forceRetry}
            disabled={forcing}
            size="sm"
            className="bg-amber-500 hover:bg-amber-600 text-black"
          >
            {forcing ? (
              <>
                <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                Firing…
              </>
            ) : (
              <>
                <Zap className="h-3.5 w-3.5 mr-1.5" />
                Force retry now
              </>
            )}
          </Button>
        </div>
      )}
    </div>
  );
}
