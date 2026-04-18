'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

/**
 * TicketControls — client island for status change and assignee change.
 *
 * Status vocabulary per Phase 2 pre-flight A8:
 *   UI label         →  DB value
 *   Open             →  open
 *   In Progress      →  in_progress
 *   Awaiting User    →  awaiting_user
 *   Resolved         →  resolved
 *   Closed           →  closed_no_response
 * 'merged' is NOT in the dropdown — that's set automatically by the
 * /api/admin/tickets/[id]/merge endpoint.
 *
 * Assignee dropdown per A9: populated from profiles where is_admin=true.
 * Server validates is_admin before saving (defense in depth — a user
 * editing the DOM to inject a non-admin id should still be rejected).
 */

const STATUS_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'open', label: 'Open' },
  { value: 'in_progress', label: 'In Progress' },
  { value: 'awaiting_user', label: 'Awaiting User' },
  { value: 'resolved', label: 'Resolved' },
  { value: 'closed_no_response', label: 'Closed' },
];

export function TicketControls({
  ticketId,
  currentStatus,
  currentAssignedTo,
  adminProfiles,
}: {
  ticketId: string;
  currentStatus: string;
  currentAssignedTo: string | null;
  adminProfiles: Array<{ id: string; email: string; full_name: string | null }>;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  async function updateTicket(patch: {
    status?: string;
    assigned_to?: string | null;
  }) {
    setError(null);
    try {
      const res = await fetch(`/api/admin/tickets/${ticketId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      const json = await res.json();
      if (!res.ok) {
        throw new Error(json.error || `Request failed (${res.status})`);
      }
      startTransition(() => router.refresh());
    } catch (e: any) {
      setError(e?.message || 'Update failed');
    }
  }

  return (
    <section className="rounded-lg border bg-card p-4">
      <div className="grid gap-4 md:grid-cols-2">
        <label className="flex flex-col gap-1 text-xs">
          <span className="text-muted-foreground uppercase tracking-widest">Status</span>
          <select
            defaultValue={currentStatus}
            disabled={pending}
            onChange={(e) => updateTicket({ status: e.target.value })}
            className="rounded-md border bg-background px-2 py-1.5 text-sm disabled:opacity-50"
          >
            {STATUS_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1 text-xs">
          <span className="text-muted-foreground uppercase tracking-widest">Assignee</span>
          <select
            defaultValue={currentAssignedTo || ''}
            disabled={pending}
            onChange={(e) =>
              updateTicket({
                assigned_to: e.target.value === '' ? null : e.target.value,
              })
            }
            className="rounded-md border bg-background px-2 py-1.5 text-sm disabled:opacity-50"
          >
            <option value="">— unassigned —</option>
            {adminProfiles.map((a) => (
              <option key={a.id} value={a.id}>
                {a.full_name || a.email}
              </option>
            ))}
          </select>
        </label>
      </div>

      {error && (
        <div className="mt-3 rounded-md border border-red-500/40 bg-red-500/10 p-2 text-xs text-red-400">
          {error}
        </div>
      )}
    </section>
  );
}
