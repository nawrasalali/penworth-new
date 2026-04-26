'use client';

import { useState, Suspense } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { BookOpen, CheckCircle2 } from 'lucide-react';
import { t, isSupportedLocale, type Locale } from '@/lib/i18n/strings';
import { mapAuthError, mapAuthErrorKey } from '@/lib/auth/error-map';
import { logAuthError } from '@/lib/auth/telemetry';

function ForgotPasswordForm() {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const searchParams = useSearchParams();
  const lang = searchParams.get('lang');
  const locale: Locale = isSupportedLocale(lang ?? 'en') ? (lang ?? 'en') as Locale : 'en';

  const loginHref = lang && lang !== 'en' ? `/login?lang=${lang}` : '/login';

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (loading || sent) return;
    setLoading(true);
    setErrorMsg(null);
    try {
      const supabase = createClient();
      // Redirect target after the user clicks the link in the email.
      // This goes to /reset-password which reads the access token from
      // the URL hash, sets the session, and shows the password update form.
      const langSuffix = lang && lang !== 'en' ? `?lang=${lang}` : '';
      const redirectTo = `${window.location.origin}/reset-password${langSuffix}`;
      const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo });
      if (error) {
        console.error('[forgot-password] resetPasswordForEmail failed:', error);
        logAuthError({ context: 'forgot_password', kind: 'returned', email, error });
        // Show the success state even on failure for accounts that don't
        // exist — don't leak which emails are registered. The only error
        // we expose is rate-limiting, since that's user-correctable (wait
        // and retry) and the user needs to know their attempt didn't land.
        if (mapAuthErrorKey(error) === 'auth.err.rateLimit') {
          setErrorMsg(mapAuthError(error, locale));
          setLoading(false);
          return;
        }
      }
      setSent(true);
    } catch (err) {
      console.error('[forgot-password] unexpected exception:', err);
      logAuthError({ context: 'forgot_password', kind: 'thrown', email, error: err });
      setErrorMsg(t('auth.forgot.error', locale));
    } finally {
      setLoading(false);
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
          {!sent ? (
            <>
              <div className="text-center mb-6">
                <h1 className="text-2xl font-bold mb-2">{t('auth.forgot.title', locale)}</h1>
                <p className="text-neutral-600 dark:text-neutral-400 text-sm">
                  {t('auth.forgot.subtitle', locale)}
                </p>
              </div>

              {errorMsg && (
                <div className="mb-4 p-3 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-400 text-sm">
                  {errorMsg}
                </div>
              )}

              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <label htmlFor="email" className="block text-sm font-medium mb-2">
                    {t('auth.email', locale)}
                  </label>
                  <input
                    id="email"
                    type="email"
                    placeholder="you@example.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    autoFocus
                    className="w-full rounded-xl border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-800 px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-transparent transition-all"
                  />
                </div>

                <button
                  type="submit"
                  disabled={loading || !email}
                  className="w-full rounded-xl bg-gradient-to-r from-amber-500 to-orange-600 py-3 text-sm font-semibold text-white hover:shadow-lg hover:shadow-amber-500/25 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                >
                  {loading ? t('auth.forgot.sending', locale) : t('auth.forgot.sendReset', locale)}
                </button>
              </form>

              <p className="mt-6 text-center text-sm text-neutral-600 dark:text-neutral-400">
                <Link href={loginHref} className="text-amber-600 dark:text-amber-400 hover:underline font-medium">
                  {t('auth.forgot.backToLogin', locale)}
                </Link>
              </p>
            </>
          ) : (
            <div className="text-center py-4">
              <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-green-100 dark:bg-green-900/40">
                <CheckCircle2 className="h-6 w-6 text-green-600 dark:text-green-500" />
              </div>
              <h1 className="text-2xl font-bold mb-2">{t('auth.forgot.sentTitle', locale)}</h1>
              <p className="text-neutral-600 dark:text-neutral-400 text-sm mb-6 leading-relaxed">
                {t('auth.forgot.sentBody', locale)}
              </p>
              <Link
                href={loginHref}
                className="inline-block rounded-xl border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-800 px-5 py-2.5 text-sm font-medium hover:bg-neutral-50 dark:hover:bg-neutral-700 transition-colors"
              >
                {t('auth.forgot.backToLogin', locale)}
              </Link>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function ForgotPasswordPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center bg-white dark:bg-neutral-950">
        <div className="animate-pulse text-neutral-500">…</div>
      </div>
    }>
      <ForgotPasswordForm />
    </Suspense>
  );
}
