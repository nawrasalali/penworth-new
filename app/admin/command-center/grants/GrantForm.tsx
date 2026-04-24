'use client';

import { useState, useTransition } from 'react';
import { grantCreditsAction } from './actions';

type Result =
  | { ok: true; email: string; amountGranted: number; newBalance: number | null; ledgerId: string | null }
  | { ok: false; error: string }
  | null;

export function GrantForm() {
  const [result, setResult] = useState<Result>(null);
  const [pending, startTransition] = useTransition();

  async function onSubmit(formData: FormData) {
    setResult(null);
    startTransition(async () => {
      const res = await grantCreditsAction(formData);
      setResult(res);
    });
  }

  return (
    <form
      action={onSubmit}
      className="space-y-4"
      onReset={() => setResult(null)}
    >
      <div className="grid sm:grid-cols-2 gap-4">
        <div>
          <label htmlFor="email" className="block text-sm font-medium mb-1.5">
            Recipient email
          </label>
          <input
            id="email"
            name="email"
            type="email"
            required
            autoComplete="off"
            placeholder="thomas@example.com"
            className="w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </div>
        <div>
          <label htmlFor="amount" className="block text-sm font-medium mb-1.5">
            Credits
          </label>
          <input
            id="amount"
            name="amount"
            type="number"
            min={1}
            step={1}
            required
            placeholder="1000"
            className="w-full rounded-md border bg-background px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </div>
      </div>

      <div>
        <label htmlFor="reason" className="block text-sm font-medium mb-1.5">
          Reason <span className="text-muted-foreground font-normal">(appears in ledger)</span>
        </label>
        <input
          id="reason"
          name="reason"
          type="text"
          placeholder="Thank-you grant"
          className="w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
        />
      </div>

      <div className="flex items-center gap-3 pt-2">
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {pending ? 'Granting…' : 'Grant credits'}
        </button>
        <button
          type="reset"
          disabled={pending}
          className="rounded-md border px-4 py-2 text-sm font-medium hover:bg-muted disabled:opacity-50"
        >
          Reset
        </button>
      </div>

      {result && result.ok && (
        <div className="rounded-md border border-green-500/40 bg-green-500/10 p-3 text-sm">
          <div className="font-medium text-green-700 dark:text-green-300">
            Granted {result.amountGranted.toLocaleString()} credits to {result.email}.
          </div>
          {result.newBalance !== null && (
            <div className="text-xs text-muted-foreground mt-0.5">
              New balance: {result.newBalance.toLocaleString()} · ledger {result.ledgerId?.slice(0, 8)}
            </div>
          )}
        </div>
      )}
      {result && !result.ok && (
        <div className="rounded-md border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-700 dark:text-red-300">
          {result.error}
        </div>
      )}
    </form>
  );
}
