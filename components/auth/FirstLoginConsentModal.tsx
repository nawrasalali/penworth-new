'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { LEGAL_DOCUMENTS, LEGAL_DOCUMENT_KEYS } from '@/lib/legal/documents';
import { t, type Locale } from '@/lib/i18n/strings';
import { ShieldCheck, ExternalLink } from 'lucide-react';

/**
 * First-login consent modal.
 *
 * Rendered by app/(dashboard)/layout.tsx when the signed-in user has
 * profiles.consent_accepted_at = NULL. Covers the entire viewport with a
 * dimmed backdrop and a centred card; the user cannot dismiss it by
 * clicking outside or pressing Escape. The only paths forward are:
 *   1. Check all three boxes → click "Accept and continue"
 *      → POST /api/legal/consent → stamps consent_accepted_at → modal
 *        hides on next render (no reload needed; we router.refresh()).
 *   2. Click "Sign out instead" → supabase.auth.signOut() → back to /login.
 *
 * After acceptance, the modal never shows for this user again — the
 * gate is a persistent profile timestamp, not session state. If the
 * legal documents' versions bump materially, we can clear
 * consent_accepted_at (or the Compliance Agent can flag the delta) to
 * re-prompt.
 */
export function FirstLoginConsentModal({ locale }: { locale: Locale }) {
  const [checked, setChecked] = useState<Record<string, boolean>>({
    terms: false,
    privacy: false,
    acceptable_use: false,
  });
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const router = useRouter();

  const allChecked = checked.terms && checked.privacy && checked.acceptable_use;

  async function handleAccept() {
    if (!allChecked || submitting) return;
    setSubmitting(true);
    setErrorMsg(null);
    try {
      const res = await fetch('/api/legal/consent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ documents: LEGAL_DOCUMENT_KEYS }),
      });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      // Refresh the server component tree so the wrapper re-reads profile
      // and this modal disappears without a full page reload.
      router.refresh();
    } catch (err) {
      console.error('[first-login-consent] accept failed:', err);
      setErrorMsg(t('firstConsent.error', locale));
      setSubmitting(false);
    }
  }

  async function handleSignOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push('/login');
  }

  const rows: Array<{ key: 'terms' | 'privacy' | 'acceptable_use'; labelKey: 'firstConsent.row.terms' | 'firstConsent.row.privacy' | 'firstConsent.row.acceptableUse' }> = [
    { key: 'terms', labelKey: 'firstConsent.row.terms' },
    { key: 'privacy', labelKey: 'firstConsent.row.privacy' },
    { key: 'acceptable_use', labelKey: 'firstConsent.row.acceptableUse' },
  ];

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="first-consent-title"
    >
      <div className="w-full max-w-lg rounded-2xl bg-white dark:bg-neutral-900 shadow-2xl border border-neutral-200 dark:border-neutral-800 p-6 sm:p-8">
        <div className="flex items-center gap-3 mb-4">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-amber-100 dark:bg-amber-900/40">
            <ShieldCheck className="h-5 w-5 text-amber-600 dark:text-amber-500" />
          </div>
          <div>
            <h2 id="first-consent-title" className="text-lg font-semibold">
              {t('firstConsent.title', locale)}
            </h2>
            <p className="text-xs text-muted-foreground">{t('firstConsent.subtitle', locale)}</p>
          </div>
        </div>

        <p className="text-sm text-muted-foreground mb-6">{t('firstConsent.intro', locale)}</p>

        <div className="space-y-3 mb-4">
          {rows.map((row) => (
            <label
              key={row.key}
              htmlFor={`first-consent-${row.key}`}
              className="flex items-start gap-3 text-sm cursor-pointer select-none group"
            >
              <input
                id={`first-consent-${row.key}`}
                type="checkbox"
                checked={checked[row.key]}
                disabled={submitting}
                onChange={(e) => setChecked((prev) => ({ ...prev, [row.key]: e.target.checked }))}
                className="mt-0.5 h-4 w-4 rounded border-input accent-amber-600"
              />
              <span className="flex-1 leading-relaxed">
                {t(row.labelKey, locale)}{' '}
                <Link
                  href={LEGAL_DOCUMENTS[row.key].path}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-0.5 text-amber-600 dark:text-amber-500 hover:underline whitespace-nowrap"
                  onClick={(e) => e.stopPropagation()}
                >
                  ({t('firstConsent.readLink', locale)} <ExternalLink className="h-3 w-3" />)
                </Link>
              </span>
            </label>
          ))}
        </div>

        {errorMsg && (
          <div className="mb-4 rounded-lg border border-red-200 bg-red-50 dark:bg-red-900/20 dark:border-red-800 p-3 text-sm text-red-700 dark:text-red-400">
            {errorMsg}
          </div>
        )}

        {!allChecked && !errorMsg && (
          <p className="mb-4 text-xs text-muted-foreground">{t('firstConsent.acceptAll', locale)}</p>
        )}

        <div className="flex flex-col-reverse sm:flex-row sm:items-center sm:justify-between gap-3">
          <button
            type="button"
            onClick={handleSignOut}
            disabled={submitting}
            className="text-sm text-muted-foreground hover:text-foreground underline underline-offset-4 disabled:opacity-50"
          >
            {t('firstConsent.signOut', locale)}
          </button>
          <button
            type="button"
            onClick={handleAccept}
            disabled={!allChecked || submitting}
            className="rounded-xl bg-gradient-to-r from-amber-500 to-orange-600 px-5 py-2.5 text-sm font-semibold text-white hover:shadow-lg hover:shadow-amber-500/25 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
          >
            {submitting ? t('firstConsent.accepting', locale) : t('firstConsent.accept', locale)}
          </button>
        </div>
      </div>
    </div>
  );
}
