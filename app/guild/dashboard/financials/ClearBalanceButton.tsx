'use client';

import { useState } from 'react';

/**
 * ClearBalanceButton — client island used by the Fee Posture card on the
 * financials page. POSTs to /api/guild/self-pay-deferred and redirects to
 * the Stripe Checkout URL returned.
 *
 * Kept as a separate file (rather than inline in page.tsx) because the
 * financials page is a Server Component and cannot hold onClick handlers.
 */
export default function ClearBalanceButton({
  amountUsd,
  label,
}: {
  amountUsd: number;
  label?: string;
}) {
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function handle() {
    setSubmitting(true);
    setErr(null);
    try {
      const res = await fetch('/api/guild/self-pay-deferred', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
      if (!data.url) throw new Error('Stripe returned no checkout URL');
      window.location.href = data.url;
    } catch (e: any) {
      setErr(e?.message || 'Unknown error');
      setSubmitting(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={handle}
        disabled={submitting || amountUsd <= 0}
        className="rounded-md bg-[#d4af37] px-5 py-2 text-sm font-medium text-[#0a0e1a] hover:bg-[#e6c14a] disabled:cursor-not-allowed disabled:opacity-50"
      >
        {submitting ? 'Opening Stripe…' : (label || `Clear now — $${amountUsd.toFixed(2)}`)}
      </button>
      {err && (
        <div className="mt-2 rounded-md border border-red-500/50 bg-red-500/10 p-2 text-xs text-red-200">
          {err}
        </div>
      )}
    </>
  );
}
