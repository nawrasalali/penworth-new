'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

interface Props {
  initialMethod: 'wise' | 'usdt';
  initialTaxResidency: string;
}

export default function SettingsForm({ initialMethod, initialTaxResidency }: Props) {
  const router = useRouter();
  const [method, setMethod] = useState<'wise' | 'usdt'>(initialMethod);
  const [value, setValue] = useState('');
  const [taxResidency, setTaxResidency] = useState(initialTaxResidency);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    setSaving(true);

    try {
      const res = await fetch('/api/guild/settings/payout', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          method,
          value: value.trim(),
          tax_residency: taxResidency.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data?.error ?? 'Failed to save');
        return;
      }
      setSuccess(`Saved. Stored as ${data.masked}.`);
      setValue(''); // clear plaintext from DOM
      router.refresh();
    } catch (err: any) {
      setError(err?.message ?? 'Network error');
    } finally {
      setSaving(false);
    }
  }

  const placeholder =
    method === 'wise'
      ? 'name@example.com'
      : 'T… (TRC20, 34 chars) or 0x… (ERC20/BEP20, 42 chars)';

  const inputMode = method === 'wise' ? 'email' : 'text';

  return (
    <form onSubmit={onSubmit} className="space-y-5">
      <fieldset>
        <legend className="mb-2 block text-sm font-medium text-neutral-900">
          Method
        </legend>
        <div className="flex gap-2">
          {(['wise', 'usdt'] as const).map((m) => (
            <label
              key={m}
              className={`flex-1 cursor-pointer rounded-md border px-4 py-2.5 text-sm transition ${
                method === m
                  ? 'border-neutral-900 bg-neutral-900 text-white'
                  : 'border-neutral-200 bg-white text-neutral-700 hover:border-neutral-300'
              }`}
            >
              <input
                type="radio"
                name="method"
                value={m}
                checked={method === m}
                onChange={() => setMethod(m)}
                className="sr-only"
              />
              <span className="block text-center font-medium uppercase tracking-wide">
                {m}
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      <div>
        <label
          htmlFor="payout-value"
          className="mb-1.5 block text-sm font-medium text-neutral-900"
        >
          {method === 'wise' ? 'Wise email address' : 'USDT wallet address'}
        </label>
        <input
          id="payout-value"
          type={inputMode}
          inputMode={inputMode}
          autoComplete="off"
          spellCheck={false}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={placeholder}
          className="w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900 placeholder-neutral-400 focus:border-neutral-900 focus:outline-none focus:ring-1 focus:ring-neutral-900"
          required
        />
        <p className="mt-1.5 text-xs text-neutral-500">
          {method === 'wise'
            ? 'The email address registered with your Wise account.'
            : 'Sending USDT to the wrong chain is unrecoverable. Verify the chain on your wallet before saving.'}
        </p>
      </div>

      <div>
        <label
          htmlFor="tax-residency"
          className="mb-1.5 block text-sm font-medium text-neutral-900"
        >
          Tax residency <span className="font-normal text-neutral-500">(optional)</span>
        </label>
        <input
          id="tax-residency"
          type="text"
          maxLength={2}
          value={taxResidency}
          onChange={(e) => setTaxResidency(e.target.value.toUpperCase())}
          placeholder="ISO-2 country code (e.g. AU, US, VN)"
          className="w-32 rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm uppercase text-neutral-900 placeholder-neutral-400 focus:border-neutral-900 focus:outline-none focus:ring-1 focus:ring-neutral-900"
        />
      </div>

      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          {error}
        </div>
      )}
      {success && (
        <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          {success}
        </div>
      )}

      <button
        type="submit"
        disabled={saving || value.trim().length < 3}
        className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-neutral-800 disabled:cursor-not-allowed disabled:bg-neutral-300"
      >
        {saving ? 'Saving…' : 'Save payout settings'}
      </button>
    </form>
  );
}
