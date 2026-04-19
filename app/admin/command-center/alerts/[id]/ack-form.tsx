'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Loader2 } from 'lucide-react';

/**
 * Acknowledge form for an alert.
 *
 * Client component because the parent alert detail page is server-
 * rendered. On submit: POST to /api/admin/alerts/{id}/ack with the
 * note, router.refresh() so the server component re-queries and shows
 * the "Acknowledged" state without a hard navigation.
 *
 * The note is required because the brief calls out "Acknowledgement
 * requires the user to enter a brief note" — a blank "seen" isn't
 * useful audit. Min 3 chars enforced client-side; API validates again.
 */
export function AckAlertForm({ alertId }: { alertId: string }) {
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  const submit = async () => {
    setError(null);
    if (note.trim().length < 3) {
      setError('Add a brief note — at least three characters.');
      return;
    }

    try {
      const res = await fetch(`/api/admin/alerts/${alertId}/ack`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ note: note.trim() }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body?.error ?? `Acknowledge failed (${res.status}).`);
        return;
      }
      startTransition(() => router.refresh());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error.');
    }
  };

  return (
    <div className="rounded-xl border bg-card p-5">
      <h2 className="text-xs uppercase tracking-wider font-semibold text-muted-foreground mb-3">
        Acknowledge
      </h2>
      <Textarea
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="Investigating / Expected behaviour / Fix deployed"
        rows={3}
        className="mb-3"
        disabled={pending}
      />
      {error && (
        <p className="text-xs text-red-400 mb-3">{error}</p>
      )}
      <Button onClick={submit} disabled={pending} size="sm">
        {pending ? (
          <>
            <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
            Acknowledging…
          </>
        ) : (
          'Acknowledge'
        )}
      </Button>
      <p className="text-[10px] text-muted-foreground mt-3">
        This row stays in the audit log permanently. Acknowledging stops
        re-evaluation for 24 hours.
      </p>
    </div>
  );
}
