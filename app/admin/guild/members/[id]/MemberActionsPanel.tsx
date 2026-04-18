'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

/**
 * MemberActionsPanel — four admin actions on a Guild member.
 *
 * All four POST to server endpoints that call SECURITY DEFINER RPCs. No
 * direct table UPDATEs. Every action produces an auditable side effect
 * (guild_tier_promotions row for promotion, probation_started_at stamp
 * for probation changes, guild_members.terminated_at stamp for offboard).
 *
 * Tier enum per migration 010: apprentice | journeyman | artisan |
 * master | fellow | emeritus. No 'council'.
 */

type Action = 'trigger_probation' | 'lift_probation' | 'promote_tier' | 'offboard' | null;

const TIER_OPTIONS = [
  'apprentice',
  'journeyman',
  'artisan',
  'master',
  'fellow',
  'emeritus',
];

export function MemberActionsPanel({
  memberId,
  currentStatus,
  currentTier,
}: {
  memberId: string;
  currentStatus: string;
  currentTier: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [openAction, setOpenAction] = useState<Action>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const [probationReason, setProbationReason] = useState('');
  const [liftNote, setLiftNote] = useState('');
  const [newTier, setNewTier] = useState(currentTier);
  const [promoteReason, setPromoteReason] = useState('');
  const [offboardType, setOffboardType] = useState<'resigned' | 'terminated'>('resigned');
  const [offboardReason, setOffboardReason] = useState('');

  async function callAction(url: string, payload: Record<string, unknown>, successMsg: string) {
    setError(null);
    setSuccess(null);
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const json = await res.json();
      if (!res.ok) {
        throw new Error(json.error || `Request failed (${res.status})`);
      }
      setSuccess(successMsg);
      setOpenAction(null);
      startTransition(() => router.refresh());
    } catch (e: any) {
      setError(e?.message || 'Action failed');
    }
  }

  return (
    <section className="rounded-lg border bg-card p-4">
      <div className="mb-3 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
        Admin actions
      </div>

      {error && (
        <div className="mb-3 rounded-md border border-red-500/40 bg-red-500/10 p-2 text-xs text-red-400">
          {error}
        </div>
      )}
      {success && (
        <div className="mb-3 rounded-md border border-green-500/40 bg-green-500/10 p-2 text-xs text-green-400">
          {success}
        </div>
      )}

      <div className="space-y-2">
        {currentStatus === 'active' && (
          <ActionButton
            label="Trigger probation"
            onClick={() => setOpenAction('trigger_probation')}
          />
        )}

        {currentStatus === 'probation' && (
          <ActionButton
            label="Lift probation"
            onClick={() => setOpenAction('lift_probation')}
          />
        )}

        <ActionButton
          label="Promote / change tier"
          onClick={() => setOpenAction('promote_tier')}
        />

        {(currentStatus === 'active' || currentStatus === 'probation') && (
          <ActionButton
            label="Offboard member"
            onClick={() => setOpenAction('offboard')}
            danger
          />
        )}
      </div>

      {openAction === 'trigger_probation' && (
        <ActionForm
          title="Trigger probation"
          onCancel={() => setOpenAction(null)}
          onSubmit={() =>
            callAction(
              `/api/admin/guild/members/${memberId}/trigger-probation`,
              { reason: probationReason.trim() },
              'Probation triggered.',
            )
          }
          submitLabel="Trigger probation"
          disabled={probationReason.trim().length === 0 || pending}
        >
          <label className="block text-xs">
            <span className="text-muted-foreground">Reason (visible to member)</span>
            <textarea
              value={probationReason}
              onChange={(e) => setProbationReason(e.target.value)}
              rows={3}
              className="mt-1 w-full rounded-md border bg-background px-2 py-1.5 text-sm"
            />
          </label>
        </ActionForm>
      )}

      {openAction === 'lift_probation' && (
        <ActionForm
          title="Lift probation"
          onCancel={() => setOpenAction(null)}
          onSubmit={() =>
            callAction(
              `/api/admin/guild/members/${memberId}/lift-probation`,
              { note: liftNote.trim() },
              'Probation lifted.',
            )
          }
          submitLabel="Lift probation"
          disabled={pending}
        >
          <label className="block text-xs">
            <span className="text-muted-foreground">Internal note (optional)</span>
            <textarea
              value={liftNote}
              onChange={(e) => setLiftNote(e.target.value)}
              rows={3}
              className="mt-1 w-full rounded-md border bg-background px-2 py-1.5 text-sm"
            />
          </label>
        </ActionForm>
      )}

      {openAction === 'promote_tier' && (
        <ActionForm
          title="Change tier"
          onCancel={() => setOpenAction(null)}
          onSubmit={() =>
            callAction(
              `/api/admin/guild/members/${memberId}/promote-tier`,
              { new_tier: newTier, reason: promoteReason.trim() },
              `Tier changed to ${newTier}.`,
            )
          }
          submitLabel="Apply"
          disabled={newTier === currentTier || promoteReason.trim().length === 0 || pending}
        >
          <label className="block text-xs">
            <span className="text-muted-foreground">New tier</span>
            <select
              value={newTier}
              onChange={(e) => setNewTier(e.target.value)}
              className="mt-1 w-full rounded-md border bg-background px-2 py-1.5 text-sm"
            >
              {TIER_OPTIONS.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </label>
          <label className="mt-3 block text-xs">
            <span className="text-muted-foreground">Reason (audit log)</span>
            <textarea
              value={promoteReason}
              onChange={(e) => setPromoteReason(e.target.value)}
              rows={3}
              className="mt-1 w-full rounded-md border bg-background px-2 py-1.5 text-sm"
            />
          </label>
        </ActionForm>
      )}

      {openAction === 'offboard' && (
        <ActionForm
          title="Offboard member"
          onCancel={() => setOpenAction(null)}
          onSubmit={() =>
            callAction(
              `/api/admin/guild/members/${memberId}/offboard`,
              { offboard_type: offboardType, reason: offboardReason.trim() },
              `Member offboarded (${offboardType}).`,
            )
          }
          submitLabel={`Confirm ${offboardType}`}
          disabled={offboardReason.trim().length === 0 || pending}
          danger
        >
          <label className="block text-xs">
            <span className="text-muted-foreground">Offboard type</span>
            <select
              value={offboardType}
              onChange={(e) => setOffboardType(e.target.value as 'resigned' | 'terminated')}
              className="mt-1 w-full rounded-md border bg-background px-2 py-1.5 text-sm"
            >
              <option value="resigned">Resigned</option>
              <option value="terminated">Terminated</option>
            </select>
          </label>
          <label className="mt-3 block text-xs">
            <span className="text-muted-foreground">Reason (required)</span>
            <textarea
              value={offboardReason}
              onChange={(e) => setOffboardReason(e.target.value)}
              rows={3}
              className="mt-1 w-full rounded-md border bg-background px-2 py-1.5 text-sm"
            />
          </label>
          <p className="mt-2 text-xs text-red-400">
            This action expires all unused showcase grants and cannot be
            undone without a manual SQL fix-up.
          </p>
        </ActionForm>
      )}
    </section>
  );
}

function ActionButton({
  label,
  onClick,
  danger,
}: {
  label: string;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full rounded-md border px-3 py-2 text-sm text-left transition-colors ${
        danger
          ? 'border-red-500/30 hover:bg-red-500/10 hover:border-red-500/60'
          : 'hover:bg-muted'
      }`}
    >
      {label}
    </button>
  );
}

function ActionForm({
  title,
  children,
  onCancel,
  onSubmit,
  submitLabel,
  disabled,
  danger,
}: {
  title: string;
  children: React.ReactNode;
  onCancel: () => void;
  onSubmit: () => void;
  submitLabel: string;
  disabled?: boolean;
  danger?: boolean;
}) {
  return (
    <div className="mt-4 rounded-md border bg-muted/30 p-3">
      <div className="mb-2 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
        {title}
      </div>
      {children}
      <div className="mt-3 flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="rounded-md border px-3 py-1.5 text-xs hover:bg-muted"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={onSubmit}
          disabled={disabled}
          className={`rounded-md px-3 py-1.5 text-xs text-primary-foreground disabled:cursor-not-allowed disabled:opacity-50 ${
            danger ? 'bg-red-500 hover:bg-red-600' : 'bg-primary hover:opacity-90'
          }`}
        >
          {submitLabel}
        </button>
      </div>
    </div>
  );
}
