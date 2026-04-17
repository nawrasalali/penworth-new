'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

type Status =
  | 'queued'
  | 'approved'
  | 'processing'
  | 'sent'
  | 'confirmed'
  | 'failed'
  | 'cancelled';

interface Action {
  to: Status;
  label: string;
  tone: 'primary' | 'neutral' | 'danger' | 'success';
  requiresReference?: boolean;
  requiresReason?: boolean;
}

/**
 * State machine for the admin-driven half of the payout lifecycle.
 * Queue creation is done by runMonthlyClose; only admin actions live here.
 */
function actionsFor(status: Status): Action[] {
  switch (status) {
    case 'queued':
      return [
        { to: 'approved', label: 'Approve', tone: 'primary' },
        { to: 'cancelled', label: 'Cancel', tone: 'danger', requiresReason: true },
      ];
    case 'approved':
      return [
        { to: 'processing', label: 'Mark processing', tone: 'neutral' },
        { to: 'queued', label: 'Un-approve', tone: 'neutral' },
      ];
    case 'processing':
      return [
        { to: 'sent', label: 'Mark sent', tone: 'success', requiresReference: true },
        { to: 'failed', label: 'Mark failed', tone: 'danger', requiresReason: true },
      ];
    case 'sent':
      return [{ to: 'confirmed', label: 'Confirm receipt', tone: 'success' }];
    case 'failed':
      return [{ to: 'queued', label: 'Retry (→ queued)', tone: 'neutral' }];
    default:
      return [];
  }
}

export default function PayoutActions({
  payoutId,
  currentStatus,
}: {
  payoutId: string;
  currentStatus: Status;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const actions = actionsFor(currentStatus);

  if (actions.length === 0) {
    return <span className="text-xs text-neutral-400">—</span>;
  }

  async function perform(action: Action) {
    setError(null);

    let reference: string | null = null;
    let reason: string | null = null;

    if (action.requiresReference) {
      const input = window.prompt(`Reference number for this payout:`);
      if (!input) return;
      reference = input.trim();
    }
    if (action.requiresReason) {
      const input = window.prompt(
        action.to === 'cancelled' ? 'Reason for cancellation:' : 'Failure reason:',
      );
      if (!input) return;
      reason = input.trim();
    }

    startTransition(async () => {
      try {
        const res = await fetch(`/api/admin/guild/payouts/${payoutId}`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            to: action.to,
            reference,
            reason,
          }),
        });
        const data = await res.json();
        if (!res.ok) {
          setError(data?.error ?? 'Failed');
          return;
        }
        router.refresh();
      } catch (err: any) {
        setError(err?.message ?? 'Network error');
      }
    });
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex flex-wrap justify-end gap-1">
        {actions.map((a) => {
          const toneClass =
            a.tone === 'primary'
              ? 'bg-neutral-900 text-white hover:bg-neutral-800'
              : a.tone === 'success'
                ? 'bg-emerald-600 text-white hover:bg-emerald-700'
                : a.tone === 'danger'
                  ? 'border border-red-200 bg-white text-red-700 hover:bg-red-50'
                  : 'border border-neutral-200 bg-white text-neutral-700 hover:bg-neutral-50';
          return (
            <button
              key={a.to}
              onClick={() => perform(a)}
              disabled={isPending}
              className={`rounded-md px-2.5 py-1 text-xs font-medium transition disabled:opacity-50 ${toneClass}`}
            >
              {a.label}
            </button>
          );
        })}
      </div>
      {error && <div className="text-[10px] text-red-600">{error}</div>}
    </div>
  );
}
