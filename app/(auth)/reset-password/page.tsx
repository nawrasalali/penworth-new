'use client';

import { useState, useEffect, Suspense } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { BookOpen, CheckCircle2, AlertTriangle } from 'lucide-react';
import { t, isSupportedLocale, type Locale } from '@/lib/i18n/strings';
import { mapAuthError } from '@/lib/auth/error-map';

/**
 * ResetPasswordForm
 * ------------------
 * Landing page for the password-reset email link. Supabase appends the
 * recovery tokens to the URL hash (e.g. #access_token=...&refresh_token=...
 * &type=recovery). We extract them, establish a session, then show the
 * new-password form. On success, updateUser signs the user in with the
 * new password and we redirect to /dashboard.
 *
 * Failure modes handled:
 *   - Missing / malformed hash → invalid link state with a CTA to request
 *     a fresh reset email.
 *   - setSession rejection (expired token) → same invalid link state.
 *   - updateUser rejection → inline error using mapAuthError.
 *   - Passwords mismatch / too short → client-side validation before submit.
 */
function ResetPasswordForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const lang = searchParams.get('lang');
  const locale: Locale = isSupportedLocale(lang ?? 'en') ? (lang ?? 'en') as Locale : 'en';

  const [stage, setStage] = useState<'loading' | 'ready' | 'invalid' | 'success'>('loading');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const forgotHref = lang && lang !== 'en' ? `/forgot-password?lang=${lang}` : '/forgot-password';

  // On mount: read the URL hash, extract tokens, establish session.
  useEffect(() => {
    async function initFromHash() {
      if (typeof window === 'undefined') return;

      const hash = window.location.hash;
      if (!hash || !hash.includes('access_token')) {
        setStage('invalid');
        return;
      }

      // Hash format: #access_token=x&refresh_token=y&expires_in=3600&type=recovery
      const params = new URLSearchParams(hash.slice(1));
      const accessToken = params.get('access_token');
      const refreshToken = params.get('refresh_token');
      const type = params.get('type');

      if (!accessToken || !refreshToken || type !== 'recovery') {
        console.error('[reset-password] missing or wrong-type tokens in hash');
        setStage('invalid');
        return;
      }

      try {
        const supabase = createClient();
        const { error } = await supabase.auth.setSession({
          access_token: accessToken,
          refresh_token: refreshToken,
        });
        if (error) {
          console.error('[reset-password] setSession failed:', error);
          setStage('invalid');
          return;
        }
        // Clear the hash so the tokens aren't visible in the URL bar.
        window.history.replaceState(null, '', window.location.pathname + window.location.search);
        setStage('ready');
      } catch (err) {
        console.error('[reset-password] unexpected exception establishing session:', err);
        setStage('invalid');
      }
    }
    void initFromHash();
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting) return;
    setErrorMsg(null);

    if (password.length < 8) {
      setErrorMsg(t('auth.reset.tooShort', locale));
      return;
    }
    if (password !== confirm) {
      setErrorMsg(t('auth.reset.mismatch', locale));
      return;
    }

    setSubmitting(true);
    try {
      const supabase = createClient();
      const { error } = await supabase.auth.updateUser({ password });
      if (error) {
        console.error('[reset-password] updateUser failed:', error);
        setErrorMsg(mapAuthError(error, locale));
        setSubmitting(false);
        return;
      }
      setStage('success');
    } catch (err) {
      console.error('[reset-password] unexpected exception updating password:', err);
      setErrorMsg(t('auth.reset.tooShort', locale)); // fallback generic
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-white dark:bg-neutral-950 px-4 py-12">
      <div className="w-full max-w-md">
        <Link href="/" className="flex items-center justify-center gap-2.5 mb-8">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-amber-500 to-orange-600 shadow-lg shadow-amber-500/20">
            <BookOpen className="h-5 w-5 text-white" />
          </div>
          <span className="text-2xl font-semibold tracking-tight">Penworth</span>
        </Link>

        <div className="rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-8 shadow-xl">
          {stage === 'loading' && (
            <div className="text-center py-6">
              <div className="mx-auto mb-4 h-10 w-10 rounded-full border-2 border-amber-500 border-t-transparent animate-spin" />
              <p className="text-sm text-neutral-500">…</p>
            </div>
          )}

          {stage === 'invalid' && (
            <div className="text-center py-4">
              <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-amber-100 dark:bg-amber-900/40">
                <AlertTriangle className="h-6 w-6 text-amber-600 dark:text-amber-500" />
              </div>
              <h1 className="text-2xl font-bold mb-2">{t('auth.reset.invalidLinkTitle', locale)}</h1>
              <p className="text-neutral-600 dark:text-neutral-400 text-sm mb-6 leading-relaxed">
                {t('auth.reset.invalidLinkBody', locale)}
              </p>
              <Link
                href={forgotHref}
                className="inline-block rounded-xl bg-gradient-to-r from-amber-500 to-orange-600 px-5 py-2.5 text-sm font-semibold text-white hover:shadow-lg hover:shadow-amber-500/25 transition-all"
              >
                {t('auth.reset.requestNewLink', locale)}
              </Link>
            </div>
          )}

          {stage === 'ready' && (
            <>
              <div className="text-center mb-6">
                <h1 className="text-2xl font-bold mb-2">{t('auth.reset.title', locale)}</h1>
                <p className="text-neutral-600 dark:text-neutral-400 text-sm">
                  {t('auth.reset.subtitle', locale)}
                </p>
              </div>

              {errorMsg && (
                <div className="mb-4 p-3 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-400 text-sm">
                  {errorMsg}
                </div>
              )}

              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <label htmlFor="new-password" className="block text-sm font-medium mb-2">
                    {t('auth.reset.newPasswordLabel', locale)}
                  </label>
                  <input
                    id="new-password"
                    type="password"
                    placeholder={t('auth.reset.newPasswordPlaceholder', locale)}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    autoFocus
                    minLength={8}
                    autoComplete="new-password"
                    className="w-full rounded-xl border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-800 px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-transparent transition-all"
                  />
                </div>

                <div>
                  <label htmlFor="confirm-password" className="block text-sm font-medium mb-2">
                    {t('auth.reset.confirmPasswordLabel', locale)}
                  </label>
                  <input
                    id="confirm-password"
                    type="password"
                    placeholder={t('auth.reset.confirmPasswordPlaceholder', locale)}
                    value={confirm}
                    onChange={(e) => setConfirm(e.target.value)}
                    required
                    minLength={8}
                    autoComplete="new-password"
                    className="w-full rounded-xl border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-800 px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-transparent transition-all"
                  />
                </div>

                <button
                  type="submit"
                  disabled={submitting || !password || !confirm}
                  className="w-full rounded-xl bg-gradient-to-r from-amber-500 to-orange-600 py-3 text-sm font-semibold text-white hover:shadow-lg hover:shadow-amber-500/25 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                >
                  {submitting ? t('auth.reset.submitting', locale) : t('auth.reset.submit', locale)}
                </button>
              </form>
            </>
          )}

          {stage === 'success' && (
            <div className="text-center py-4">
              <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-green-100 dark:bg-green-900/40">
                <CheckCircle2 className="h-6 w-6 text-green-600 dark:text-green-500" />
              </div>
              <h1 className="text-2xl font-bold mb-2">{t('auth.reset.successTitle', locale)}</h1>
              <p className="text-neutral-600 dark:text-neutral-400 text-sm mb-6 leading-relaxed">
                {t('auth.reset.successBody', locale)}
              </p>
              <button
                onClick={() => router.push('/dashboard')}
                className="inline-block rounded-xl bg-gradient-to-r from-amber-500 to-orange-600 px-5 py-2.5 text-sm font-semibold text-white hover:shadow-lg hover:shadow-amber-500/25 transition-all"
              >
                {t('auth.reset.goToDashboard', locale)}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center bg-white dark:bg-neutral-950">
        <div className="animate-pulse text-neutral-500">…</div>
      </div>
    }>
      <ResetPasswordForm />
    </Suspense>
  );
}
