'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';

export interface Recipient {
  id: string;
  email: string;
  full_name: string | null;
  receives_p0: boolean;
  receives_p1: boolean;
  receives_p2: boolean;
  categories: string[];
  quiet_hours_start: string | null;
  quiet_hours_end: string | null;
  timezone: string | null;
  active: boolean;
}

interface Props {
  mode: 'create' | 'edit';
  recipient?: Recipient;
  allowedCategories: readonly string[];
  onClose: () => void;
  onSaved: () => void;
}

export default function RecipientForm({
  mode,
  recipient,
  allowedCategories,
  onClose,
  onSaved,
}: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [email, setEmail] = useState(recipient?.email ?? '');
  const [fullName, setFullName] = useState(recipient?.full_name ?? '');
  const [receivesP0, setReceivesP0] = useState(recipient?.receives_p0 ?? true);
  const [receivesP1, setReceivesP1] = useState(recipient?.receives_p1 ?? true);
  const [receivesP2, setReceivesP2] = useState(recipient?.receives_p2 ?? false);
  const [categories, setCategories] = useState<string[]>(
    recipient?.categories ?? [...allowedCategories],
  );
  const [quietStart, setQuietStart] = useState(recipient?.quiet_hours_start ?? '');
  const [quietEnd, setQuietEnd] = useState(recipient?.quiet_hours_end ?? '');
  const [timezone, setTimezone] = useState(recipient?.timezone ?? 'Australia/Adelaide');
  const [error, setError] = useState<string | null>(null);

  const toggleCategory = (cat: string) => {
    setCategories((prev) =>
      prev.includes(cat) ? prev.filter((c) => c !== cat) : [...prev, cat],
    );
  };

  const handleSubmit = () => {
    setError(null);

    // Client-side sanity check before round-trip.
    if (!email.trim()) {
      setError('Email is required.');
      return;
    }
    if (!receivesP0 && !receivesP1 && !receivesP2) {
      setError('Pick at least one severity channel.');
      return;
    }
    if (categories.length === 0) {
      setError('Pick at least one category.');
      return;
    }
    if ((quietStart === '') !== (quietEnd === '')) {
      setError('Quiet-hours start and end must both be set or both empty.');
      return;
    }

    const payload = {
      email: email.trim(),
      full_name: fullName.trim() || null,
      receives_p0: receivesP0,
      receives_p1: receivesP1,
      receives_p2: receivesP2,
      categories,
      quiet_hours_start: quietStart || null,
      quiet_hours_end: quietEnd || null,
      timezone,
    };

    startTransition(async () => {
      const url =
        mode === 'create'
          ? '/api/admin/recipients'
          : `/api/admin/recipients/${recipient!.id}`;
      const method = mode === 'create' ? 'POST' : 'PATCH';

      let response: Response;
      try {
        response = await fetch(url, {
          method,
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(payload),
        });
      } catch (err) {
        setError('Network error — please retry.');
        return;
      }

      if (!response.ok) {
        let message = 'Save failed.';
        try {
          const body = (await response.json()) as { message?: string; error?: string };
          message = body.message ?? body.error ?? message;
        } catch {
          // keep default
        }
        setError(message);
        return;
      }

      toast.success(mode === 'create' ? 'Recipient added.' : 'Recipient updated.');
      onSaved();
      router.refresh();
      onClose();
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-2xl rounded-lg bg-background p-6 shadow-xl border">
        <div className="flex items-start justify-between mb-4">
          <h2 className="text-xl font-bold">
            {mode === 'create' ? 'Add recipient' : 'Edit recipient'}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground"
            aria-label="Close"
          >
            ×
          </button>
        </div>

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1">Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded border bg-background px-3 py-2 text-sm"
              placeholder="ops@penworth.ai"
              disabled={pending}
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">
              Full name <span className="text-muted-foreground">(optional)</span>
            </label>
            <input
              type="text"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              className="w-full rounded border bg-background px-3 py-2 text-sm"
              placeholder="On-call operator"
              disabled={pending}
            />
          </div>

          <div>
            <span className="block text-sm font-medium mb-1">Severity channels</span>
            <div className="flex flex-wrap gap-3 text-sm">
              <label className="inline-flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={receivesP0}
                  onChange={(e) => setReceivesP0(e.target.checked)}
                  disabled={pending}
                />
                <span>P0 (critical)</span>
              </label>
              <label className="inline-flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={receivesP1}
                  onChange={(e) => setReceivesP1(e.target.checked)}
                  disabled={pending}
                />
                <span>P1 (high)</span>
              </label>
              <label className="inline-flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={receivesP2}
                  onChange={(e) => setReceivesP2(e.target.checked)}
                  disabled={pending}
                />
                <span>P2 (routine)</span>
              </label>
            </div>
          </div>

          <div>
            <span className="block text-sm font-medium mb-1">Categories</span>
            <div className="flex flex-wrap gap-2">
              {allowedCategories.map((cat) => {
                const active = categories.includes(cat);
                return (
                  <button
                    type="button"
                    key={cat}
                    onClick={() => toggleCategory(cat)}
                    disabled={pending}
                    className={
                      'px-3 py-1 rounded-full border text-xs ' +
                      (active
                        ? 'bg-primary text-primary-foreground border-primary'
                        : 'bg-background hover:bg-muted')
                    }
                  >
                    {cat}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div>
              <label className="block text-sm font-medium mb-1">Quiet hours start</label>
              <input
                type="time"
                value={quietStart}
                onChange={(e) => setQuietStart(e.target.value)}
                className="w-full rounded border bg-background px-3 py-2 text-sm"
                disabled={pending}
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Quiet hours end</label>
              <input
                type="time"
                value={quietEnd}
                onChange={(e) => setQuietEnd(e.target.value)}
                className="w-full rounded border bg-background px-3 py-2 text-sm"
                disabled={pending}
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Timezone</label>
              <input
                type="text"
                value={timezone}
                onChange={(e) => setTimezone(e.target.value)}
                className="w-full rounded border bg-background px-3 py-2 text-sm"
                placeholder="Australia/Adelaide"
                disabled={pending}
              />
            </div>
          </div>

          {error && (
            <div className="rounded border border-red-500/50 bg-red-500/10 px-3 py-2 text-sm text-red-600">
              {error}
            </div>
          )}

          <div className="flex items-center justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              disabled={pending}
              className="px-3 py-2 rounded border text-sm hover:bg-muted"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSubmit}
              disabled={pending}
              className="px-3 py-2 rounded bg-primary text-primary-foreground text-sm font-semibold hover:opacity-90 disabled:opacity-60"
            >
              {pending ? 'Saving…' : mode === 'create' ? 'Add recipient' : 'Save changes'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
