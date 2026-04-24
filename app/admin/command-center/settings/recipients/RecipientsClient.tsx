'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import RecipientForm, { type Recipient } from './RecipientForm';

interface Props {
  initialRecipients: Recipient[];
  allowedCategories: readonly string[];
}

export default function RecipientsClient({ initialRecipients, allowedCategories }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [modal, setModal] = useState<
    { mode: 'create' } | { mode: 'edit'; recipient: Recipient } | null
  >(null);

  const handleDeactivate = (recipient: Recipient) => {
    if (!confirm(`Deactivate ${recipient.email}?\n\nThey will no longer receive alerts.`)) {
      return;
    }
    startTransition(async () => {
      let response: Response;
      try {
        response = await fetch(`/api/admin/recipients/${recipient.id}`, { method: 'DELETE' });
      } catch {
        toast.error('Network error — please retry.');
        return;
      }
      if (!response.ok) {
        let message = 'Deactivate failed.';
        try {
          const body = (await response.json()) as { message?: string; error?: string };
          message = body.message ?? body.error ?? message;
        } catch {
          // keep default
        }
        toast.error(message);
        return;
      }
      toast.success('Recipient deactivated.');
      router.refresh();
    });
  };

  const handleReactivate = (recipient: Recipient) => {
    startTransition(async () => {
      let response: Response;
      try {
        response = await fetch(`/api/admin/recipients/${recipient.id}`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ active: true }),
        });
      } catch {
        toast.error('Network error — please retry.');
        return;
      }
      if (!response.ok) {
        let message = 'Reactivate failed.';
        try {
          const body = (await response.json()) as { message?: string; error?: string };
          message = body.message ?? body.error ?? message;
        } catch {
          // keep default
        }
        toast.error(message);
        return;
      }
      toast.success('Recipient reactivated.');
      router.refresh();
    });
  };

  return (
    <>
      <div className="mb-4 flex items-center justify-between">
        <div className="text-sm text-muted-foreground">
          {initialRecipients.filter((r) => r.active).length} active ·{' '}
          {initialRecipients.filter((r) => !r.active).length} inactive
        </div>
        <button
          type="button"
          onClick={() => setModal({ mode: 'create' })}
          className="px-3 py-2 rounded bg-primary text-primary-foreground text-sm font-semibold hover:opacity-90"
        >
          Add recipient
        </button>
      </div>

      <div className="rounded-lg border overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left">
            <tr>
              <th className="px-3 py-2 font-medium">Email</th>
              <th className="px-3 py-2 font-medium">Name</th>
              <th className="px-3 py-2 font-medium">Severities</th>
              <th className="px-3 py-2 font-medium">Categories</th>
              <th className="px-3 py-2 font-medium">Quiet hours</th>
              <th className="px-3 py-2 font-medium">Status</th>
              <th className="px-3 py-2 font-medium text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {initialRecipients.length === 0 && (
              <tr>
                <td colSpan={7} className="px-3 py-8 text-center text-muted-foreground">
                  No recipients yet. Add one to start receiving alerts.
                </td>
              </tr>
            )}
            {initialRecipients.map((r) => (
              <tr key={r.id} className="border-t">
                <td className="px-3 py-2 font-mono text-xs">{r.email}</td>
                <td className="px-3 py-2">{r.full_name ?? '—'}</td>
                <td className="px-3 py-2">
                  <span className="flex gap-1">
                    {r.receives_p0 && <SevChip label="P0" tone="red" />}
                    {r.receives_p1 && <SevChip label="P1" tone="amber" />}
                    {r.receives_p2 && <SevChip label="P2" tone="slate" />}
                  </span>
                </td>
                <td className="px-3 py-2 text-xs text-muted-foreground">
                  {r.categories.length === allowedCategories.length
                    ? 'all'
                    : r.categories.join(', ')}
                </td>
                <td className="px-3 py-2 text-xs">
                  {r.quiet_hours_start && r.quiet_hours_end
                    ? `${r.quiet_hours_start.slice(0, 5)}–${r.quiet_hours_end.slice(0, 5)} ${r.timezone ?? ''}`
                    : '—'}
                </td>
                <td className="px-3 py-2">
                  {r.active ? (
                    <span className="inline-block rounded-full bg-green-500/15 text-green-700 px-2 py-0.5 text-[11px] font-medium">
                      active
                    </span>
                  ) : (
                    <span className="inline-block rounded-full bg-muted text-muted-foreground px-2 py-0.5 text-[11px] font-medium">
                      inactive
                    </span>
                  )}
                </td>
                <td className="px-3 py-2 text-right">
                  <div className="inline-flex gap-2">
                    <button
                      type="button"
                      onClick={() => setModal({ mode: 'edit', recipient: r })}
                      disabled={pending}
                      className="text-xs px-2 py-1 rounded border hover:bg-muted"
                    >
                      Edit
                    </button>
                    {r.active ? (
                      <button
                        type="button"
                        onClick={() => handleDeactivate(r)}
                        disabled={pending}
                        className="text-xs px-2 py-1 rounded border text-red-600 hover:bg-red-500/10"
                      >
                        Deactivate
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => handleReactivate(r)}
                        disabled={pending}
                        className="text-xs px-2 py-1 rounded border hover:bg-muted"
                      >
                        Reactivate
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {modal && (
        <RecipientForm
          mode={modal.mode}
          recipient={modal.mode === 'edit' ? modal.recipient : undefined}
          allowedCategories={allowedCategories}
          onClose={() => setModal(null)}
          onSaved={() => setModal(null)}
        />
      )}
    </>
  );
}

function SevChip({ label, tone }: { label: string; tone: 'red' | 'amber' | 'slate' }) {
  const cls =
    tone === 'red'
      ? 'bg-red-500/15 text-red-700'
      : tone === 'amber'
        ? 'bg-amber-500/15 text-amber-700'
        : 'bg-slate-500/15 text-slate-700';
  return (
    <span className={`inline-block rounded px-1.5 py-0.5 text-[10px] font-semibold ${cls}`}>
      {label}
    </span>
  );
}
