'use client';

import { useState, useEffect, Suspense } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { BookOpen, Check, Gift } from 'lucide-react';
import { t, isSupportedLocale, type Locale } from '@/lib/i18n/strings';
import { mapAuthError } from '@/lib/auth/error-map';
import { logAuthError } from '@/lib/auth/telemetry';
import AuthorRefCapture from '@/components/AuthorRefCapture';

function SignupForm() {
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [referralCode, setReferralCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();
  const searchParams = useSearchParams();
  const plan = searchParams.get('plan');
  // Language passed from the landing page subdomain (e.g. ar.penworth.ai/signup?lang=ar)
  const lang = searchParams.get('lang') || 'en';
  // Resolved locale for t() — defaults to 'en' for any unsupported value.
  const locale: Locale = isSupportedLocale(lang) ? lang : 'en';
  const qs = new URLSearchParams();
  if (plan) qs.set('plan', plan);
  if (lang && lang !== 'en') qs.set('lang', lang);
  const callbackQuery = qs.toString() ? `?${qs.toString()}` : '';

  // Prefill referral code from ?ref= URL param. Guild-prefixed codes
  // are handled by GuildRefCapture (cookie path) and not shown in this
  // input — the user does not need to see a Guild code to apply it.
  useEffect(() => {
    const ref = searchParams.get('ref');
    if (!ref) return;
    const normalized = ref.trim().toUpperCase();
    if (normalized.startsWith('GUILD-')) return;
    if (/^[A-Z0-9]{6,12}$/.test(normalized)) {
      setReferralCode(normalized);
    }
  }, [searchParams]);

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const supabase = createClient();

      const trimmedCode = referralCode.trim().toUpperCase();
      const validCode =
        trimmedCode &&
        !trimmedCode.startsWith('GUILD-') &&
        /^[A-Z0-9]{6,12}$/.test(trimmedCode)
          ? trimmedCode
          : null;

      // Persist the code in cookie + localStorage so /auth/callback can
      // apply it after email confirmation, even if the user came in
      // without ?ref= and typed it manually.
      if (validCode) {
        try {
          const maxAgeSeconds = 60 * 60 * 24 * 30;
          const host = window.location.hostname;
          const domainAttr = host.endsWith('penworth.ai')
            ? '; domain=.penworth.ai; secure'
            : '';
          document.cookie = `penworth_author_ref=${encodeURIComponent(validCode)}; path=/; max-age=${maxAgeSeconds}; samesite=lax${domainAttr}`;
          localStorage.setItem('penworth_author_ref', validCode);
        } catch {
          // Best effort — auth callback also accepts metadata fallback
        }
      }

      const { data: signUpData, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: {
            full_name: fullName,
            preferred_language: lang,
            ...(validCode ? { referral_code: validCode } : {}),
          },
          emailRedirectTo: `${window.location.origin}/auth/callback${callbackQuery}`,
        },
      });

      if (error) {
        console.error('[signup] signUp failed:', error);
        logAuthError({ context: 'signup', kind: 'returned', email, error });
        setError(mapAuthError(error, locale));
        return;
      }

      // Best-effort immediate profile update (the auth callback also writes
      // it, so this is redundant but safer if the trigger has race conditions).
      // We do NOT record legal consent here anymore — that happens via the
      // first-login modal once the user is fully authenticated. Recording
      // consent at signup time was fragile: email-verify users didn't have
      // a session yet, so the POST /api/legal/consent would 401 silently.
      if (signUpData?.user?.id) {
        await supabase
          .from('profiles')
          .update({ preferred_language: lang })
          .eq('id', signUpData.user.id);
      }

      router.push(`/login?lang=${lang}&message=${encodeURIComponent(t('auth.checkEmailForConfirm', locale))}`);
    } catch (err) {
      // supabase-js can THROW (rather than return a structured error) on
      // network failures, CORS preflight rejects, and some 5xx responses.
      // Pipe the thrown value through mapAuthError so users see "rate
      // limited" / "network issue" / etc instead of a generic error, and
      // log it for diagnostics so we can see which subclass actually fires.
      console.error('[signup] unexpected exception:', err);
      logAuthError({ context: 'signup', kind: 'thrown', email, error: err });
      setError(mapAuthError(err as { message?: string; status?: number; code?: string }, locale));
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleSignup = async () => {
    try {
      const supabase = createClient();
      const result = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: `${window.location.origin}/auth/callback${callbackQuery}`,
        },
      });

      console.log('[signup] signInWithOAuth result:', result);

      if (result.error) {
        console.error('[signup] signInWithOAuth error:', result.error);
        logAuthError({ context: 'signup_oauth', kind: 'returned', error: result.error });
        setError(mapAuthError(result.error, locale));
      } else if (!result.data?.url) {
        console.error('[signup] signInWithOAuth returned no URL — provider likely disabled in Supabase');
        logAuthError({
          context: 'signup_oauth',
          kind: 'returned',
          error: { message: 'no redirect URL', code: 'no_redirect_url' },
        });
        setError(t('auth.err.oauthUnavailable', locale));
      }
    } catch (err) {
      console.error('[signup] signInWithOAuth threw:', err);
      logAuthError({ context: 'signup_oauth', kind: 'thrown', error: err });
      setError(mapAuthError(err as { message?: string; status?: number; code?: string }, locale));
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-white dark:bg-neutral-950 px-4 py-12">
      <AuthorRefCapture />
      <div className="w-full max-w-md">
        {/* Logo */}
        <Link href="/" className="flex items-center justify-center gap-2.5 mb-8">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-amber-500 to-orange-600 shadow-lg shadow-amber-500/20">
            <BookOpen className="h-5 w-5 text-white" />
          </div>
          <span className="text-2xl font-semibold tracking-tight">Penworth</span>
        </Link>

        {/* Card */}
        <div className="rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-8 shadow-xl">
          <div className="text-center mb-6">
            <h1 className="text-2xl font-bold mb-2">{t('auth.signupTitle', locale)}</h1>
            <p className="text-neutral-600 dark:text-neutral-400">{t('auth.signupSubtitle', locale)}</p>
          </div>

          {/* What you get */}
          <div className="mb-6 p-4 rounded-xl bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800">
            <p className="text-sm font-medium text-amber-800 dark:text-amber-200 mb-2">{t('auth.freeAccountTitle', locale)}</p>
            <div className="space-y-1">
              <p className="text-xs text-amber-700 dark:text-amber-300 flex items-center gap-2">
                <Check className="h-3 w-3" />{t('auth.freeAccountBullet1', locale)}
              </p>
              <p className="text-xs text-amber-700 dark:text-amber-300 flex items-center gap-2">
                <Check className="h-3 w-3" />{t('auth.freeAccountBullet2', locale)}
              </p>
              <p className="text-xs text-amber-700 dark:text-amber-300 flex items-center gap-2">
                <Check className="h-3 w-3" />{t('auth.freeAccountBullet3', locale)}
              </p>
            </div>
          </div>

          {error && (
            <div className="mb-4 p-3 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-400 text-sm">
              {error}
            </div>
          )}

          <form onSubmit={handleSignup} className="space-y-4">
            <div>
              <label htmlFor="fullName" className="block text-sm font-medium mb-2">{t('auth.fullName', locale)}</label>
              <input
                id="fullName"
                type="text"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                required
                className="w-full rounded-xl border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-800 px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-transparent transition-all"
              />
            </div>
            <div>
              <label htmlFor="email" className="block text-sm font-medium mb-2">{t('auth.email', locale)}</label>
              <input
                id="email"
                type="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                className="w-full rounded-xl border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-800 px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-transparent transition-all"
              />
            </div>
            <div>
              <label htmlFor="password" className="block text-sm font-medium mb-2">{t('auth.password', locale)}</label>
              <input
                id="password"
                type="password"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={8}
                className="w-full rounded-xl border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-800 px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-transparent transition-all"
              />
              <p className="text-xs text-neutral-500 mt-1.5">{t('auth.passwordMin', locale)}</p>
            </div>

            {/* Optional referral code — autofills from ?ref=, but visible
                so users can paste a code a friend texted them. */}
            <div>
              <label
                htmlFor="referralCode"
                className="block text-sm font-medium mb-2 flex items-center gap-2"
              >
                <Gift className="h-3.5 w-3.5 text-amber-500" />
                Referral code
                <span className="text-xs text-neutral-500 font-normal">
                  (optional, +100 credits)
                </span>
              </label>
              <input
                id="referralCode"
                type="text"
                value={referralCode}
                onChange={(e) =>
                  setReferralCode(e.target.value.toUpperCase().slice(0, 12))
                }
                placeholder="e.g. ABC12345"
                autoComplete="off"
                className="w-full rounded-xl border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-800 px-4 py-3 text-sm font-mono tracking-wider focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-transparent transition-all uppercase"
              />
              <p className="text-xs text-neutral-500 mt-1.5">
                Were you invited by a Penworth author? Enter their code to
                claim 100 welcome credits.
              </p>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-xl bg-gradient-to-r from-amber-500 to-orange-600 py-3 text-sm font-semibold text-white hover:shadow-lg hover:shadow-amber-500/25 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
            >
              {loading ? t('auth.creatingAccount', locale) : t('auth.createAccount', locale)}
            </button>
          </form>

          <div className="relative my-6">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-neutral-200 dark:border-neutral-800" />
            </div>
            <div className="relative flex justify-center text-xs uppercase">
              <span className="bg-white dark:bg-neutral-900 px-3 text-neutral-500">{t('auth.orContinueWith', locale)}</span>
            </div>
          </div>

          <button
            type="button"
            onClick={handleGoogleSignup}
            className="w-full flex items-center justify-center gap-2 rounded-xl border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-800 py-3 text-sm font-medium hover:bg-neutral-50 dark:hover:bg-neutral-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            <svg className="h-5 w-5" viewBox="0 0 24 24">
              <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
              <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
              <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
              <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
            </svg>
            Google
          </button>

          <p className="mt-6 text-center text-sm text-neutral-600 dark:text-neutral-400">
            {t('auth.alreadyHaveAccount', locale)}{' '}
            <Link href={lang !== 'en' ? `/login?lang=${lang}` : '/login'} className="text-amber-600 dark:text-amber-400 hover:underline font-medium">
              {t('auth.signIn', locale)}
            </Link>
          </p>

          <p className="mt-4 text-center text-xs text-neutral-500">
            {t('auth.termsPreamble', locale)}{' '}
            <Link href="/legal/terms" className="underline hover:text-neutral-900 dark:hover:text-white">{t('auth.terms', locale)}</Link>
            ,{' '}
            <Link href="/legal/privacy" className="underline hover:text-neutral-900 dark:hover:text-white">{t('auth.privacyPolicy', locale)}</Link>
            ,{' '}
            <Link href="/legal/acceptable-use" className="underline hover:text-neutral-900 dark:hover:text-white">{t('auth.acceptableUsePolicy', locale)}</Link>
          </p>
        </div>
      </div>
    </div>
  );
}

export default function SignupPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center bg-white dark:bg-neutral-950">
        <div className="animate-pulse text-neutral-500">…</div>
      </div>
    }>
      <SignupForm />
    </Suspense>
  );
}
