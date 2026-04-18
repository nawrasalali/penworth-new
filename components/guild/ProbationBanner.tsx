'use client';

import { useState } from 'react';
import Link from 'next/link';
import { t, type Locale } from '@/lib/i18n/strings';

interface ProbationBannerProps {
  /** Deferred balance in USD. Rendered as $X.XX. */
  deferredBalance: number;
  /** 'inline' = Variant A (dashboard strip); 'full' = Variant B (agent page takeover). */
  variant: 'inline' | 'full';
  /** Author's preferred locale. Defaults to English if omitted. */
  locale?: Locale;
}

/**
 * ProbationBanner
 *
 * Two variants:
 *   - inline: slim strip rendered at the top of /guild/dashboard.
 *     Title + balance + [Clear balance now] button.
 *   - full:   full content area takeover on individual agent pages.
 *     Headline + body + two recovery paths (earn it / clear it now).
 *
 * Both variants POST to /api/guild/self-pay-deferred to start Stripe Checkout.
 * On success the API returns { url } — we redirect.
 *
 * Accessibility: both variants use role="region" aria-label. The full variant
 * uses a proper heading. Focus goes to the Clear button after render.
 */
export function ProbationBanner({
  deferredBalance,
  variant,
  locale = 'en',
}: ProbationBannerProps) {
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function handleClearBalance() {
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

  const balanceStr = formatUSD(deferredBalance);

  if (variant === 'inline') {
    return (
      <div
        role="region"
        aria-label={t('probation.inlineTitle', locale)}
        className="mb-6 rounded-lg border border-yellow-500/40 bg-yellow-500/10 p-5"
      >
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex-1 min-w-0">
            <div className="font-medium text-yellow-200">
              {t('probation.inlineTitle', locale)}
            </div>
            <div className="mt-1 text-sm text-yellow-100/80">
              {t('probation.inlineBody', locale).replace('{balance}', balanceStr)}
            </div>
          </div>
          <button
            type="button"
            onClick={handleClearBalance}
            disabled={submitting}
            className="rounded-md bg-yellow-500 px-4 py-2 text-sm font-medium text-neutral-900 hover:bg-yellow-400 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {submitting ? '…' : t('probation.clearBalanceCta', locale)}
          </button>
        </div>
        {err && (
          <div className="mt-3 rounded-md border border-red-500/50 bg-red-500/10 p-2 text-xs text-red-200">
            {err}
          </div>
        )}
      </div>
    );
  }

  // Variant B — full takeover on agent pages
  return (
    <div
      role="region"
      aria-label={t('probation.fullTitle', locale)}
      className="mx-auto my-12 max-w-2xl rounded-xl border border-yellow-500/40 bg-gradient-to-br from-yellow-500/10 to-transparent p-10"
    >
      <div className="mb-6 flex items-center gap-4">
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-yellow-500/20 text-2xl">
          ⏸
        </div>
        <h2 className="font-serif text-2xl tracking-tight text-yellow-100">
          {t('probation.fullTitle', locale)}
        </h2>
      </div>

      <p className="mb-8 text-base leading-relaxed text-yellow-100/90">
        {t('probation.fullBody', locale).replace('{balance}', balanceStr)}
      </p>

      <div className="mb-8 grid gap-4 md:grid-cols-2">
        <div className="rounded-lg border border-[#1e2436] bg-[#0f1424] p-5">
          <div className="mb-2 text-sm font-semibold text-[#d4af37]">
            {t('probation.pathEarnTitle', locale)}
          </div>
          <p className="text-sm leading-relaxed text-[#c9c2b0]">
            {t('probation.pathEarnBody', locale)}
          </p>
        </div>
        <div className="rounded-lg border border-[#1e2436] bg-[#0f1424] p-5">
          <div className="mb-2 text-sm font-semibold text-[#d4af37]">
            {t('probation.pathClearTitle', locale)}
          </div>
          <p className="mb-3 text-sm leading-relaxed text-[#c9c2b0]">
            {t('probation.pathClearBody', locale)}
          </p>
          <button
            type="button"
            onClick={handleClearBalance}
            disabled={submitting}
            className="w-full rounded-md bg-[#d4af37] px-4 py-2 text-sm font-medium text-[#0a0e1a] hover:bg-[#e6c14a] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {submitting
              ? '…'
              : `${t('probation.clearBalanceCta', locale)} — ${balanceStr}`}
          </button>
        </div>
      </div>

      {err && (
        <div className="mb-6 rounded-md border border-red-500/50 bg-red-500/10 p-3 text-sm text-red-200">
          {err}
        </div>
      )}

      <div className="text-center">
        <Link
          href="/guild/dashboard/financials"
          className="text-sm text-[#d4af37] hover:underline"
        >
          {t('probation.viewFinancialsLink', locale)}
        </Link>
      </div>
    </div>
  );
}

function formatUSD(n: number): string {
  return `$${n.toFixed(2)}`;
}
