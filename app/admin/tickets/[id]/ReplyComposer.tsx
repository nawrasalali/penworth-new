'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

/**
 * ReplyComposer — client island for posting a reply on a ticket.
 *
 * Internal note toggle: when true, is_internal_note=true is set on the
 * inserted row. The user will not see the reply; other admins will.
 *
 * author_id + author_role are NOT provided by the client — the server
 * derives author_id from the authenticated session and sets
 * author_role='admin' (the admin layout gates this whole surface to
 * is_admin users).
 *
 * Body is treated as markdown source; rendering is the consumer's
 * responsibility. We don't sanitize client-side because the server
 * stores-as-is and the render surface decides what to do.
 */
export function ReplyComposer({ ticketId }: { ticketId: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [body, setBody] = useState('');
  const [isInternal, setIsInternal] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit() {
    setError(null);
    if (body.trim().length === 0) {
      setError('Reply cannot be empty.');
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch(`/api/admin/tickets/${ticketId}/replies`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          body: body.trim(),
          is_internal_note: isInternal,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        throw new Error(json.error || `Request failed (${res.status})`);
      }
      setBody('');
      setIsInternal(false);
      startTransition(() => router.refresh());
    } catch (e: any) {
      setError(e?.message || 'Failed to post reply');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="rounded-lg border bg-card p-4">
      <div className="mb-2 text-xs uppercase tracking-widest text-muted-foreground">
        Reply
      </div>
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder="Markdown supported."
        rows={6}
        disabled={submitting || pending}
        className="w-full rounded-md border bg-background px-3 py-2 text-sm disabled:opacity-50"
      />
      <div className="mt-3 flex items-center justify-between gap-3">
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={isInternal}
            onChange={(e) => setIsInternal(e.target.checked)}
            disabled={submitting || pending}
            className="h-4 w-4"
          />
          <span>Internal note (hidden from user)</span>
        </label>
        <button
          type="button"
          onClick={handleSubmit}
          disabled={submitting || pending || body.trim().length === 0}
          className="rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {submitting ? 'Posting…' : isInternal ? 'Post internal note' : 'Post reply'}
        </button>
      </div>
      {error && (
        <div className="mt-3 rounded-md border border-red-500/40 bg-red-500/10 p-2 text-xs text-red-400">
          {error}
        </div>
      )}
    </section>
  );
}
