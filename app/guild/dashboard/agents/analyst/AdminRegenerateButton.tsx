'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

/**
 * AdminRegenerateButton — admin-only affordance on the analyst page.
 *
 * Hits POST /api/admin/guild/members/[id]/regenerate-analyst which
 * invokes generateWeeklyAnalystReport() for this one member. Bypasses
 * the Monday cron schedule so an admin can refresh a report while
 * investigating a specific account.
 *
 * Distinct from the member-facing AnalystRefresh button (which hits
 * /api/guild/agents/analyst and populates the legacy daily cache).
 * This one refreshes context.weekly_report directly.
 */
export default function AdminRegenerateButton({
  memberId,
}: {
  memberId: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleRegenerate() {
    setError(null);
    setBusy(true);
    try {
      const res = await fetch(
        `/api/admin/guild/members/${memberId}/regenerate-analyst`,
        { method: 'POST' },
      );
      const json = await res.json();
      if (!res.ok) {
        throw new Error(json.error || `Failed (${res.status})`);
      }
      startTransition(() => router.refresh());
    } catch (e: any) {
      setError(e?.message || 'Regeneration failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={handleRegenerate}
        disabled={busy || pending}
        title="Admin: regenerate this member's weekly analyst report"
        className="inline-flex items-center gap-1.5 rounded-md border border-amber-300 bg-amber-50 px-3 py-1.5 text-xs font-medium text-amber-900 hover:bg-amber-100 disabled:opacity-50"
      >
        {busy ? 'Regenerating…' : 'Regenerate (admin)'}
      </button>
      {error && (
        <div className="max-w-[14rem] text-right text-xs text-red-600">
          {error}
        </div>
      )}
    </div>
  );
}
