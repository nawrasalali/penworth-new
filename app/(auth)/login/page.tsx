'use client';

import { useState, Suspense, useEffect } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { BookOpen } from 'lucide-react';
import { t, isSupportedLocale, type Locale } from '@/lib/i18n/strings';

function LoginForm() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();
  const searchParams = useSearchParams();
  const redirect = searchParams.get('redirect') || '/dashboard';
  // Language passed from a landing page subdomain (e.g. ar.penworth.ai/login?lang=ar).
  // Carries through OAuth so returning users land back on their language subdomain.
  const lang = searchParams.get('lang');
  const locale: Locale = isSupportedLocale(lang ?? 'en') ? (lang ?? 'en') as Locale : 'en';
  // ?message=... is set by /signup after a successful submit so we can confirm
  // "check your email". Value is URL-encoded and may already be translated.
  const message = searchParams.get('message');

  const callbackQuery = (() => {
    const qs = new URLSearchParams();
    qs.set('redirect', redirect);
    if (lang) qs.set('lang', lang);
    return qs.toString();
  })();

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const supabase = createClient();
      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (error) {
        setError(error.message);
        return;
      }

      // If the user just came from ar.penworth.ai, send them home to ar.penworth.ai
      // by hitting the callback route which reads preferred_language and rewrites
      // the origin. Fall back to local redirect for English/no-lang users so we
      // don't force an unnecessary full-page nav.
      if (lang && lang !== 'en') {
        window.location.href = `${window.location.origin}/auth/callback?${callbackQuery}&skip_code=1`;
        return;
      }

      // Also check the user's stored preferred_language in case they're returning
      // on the English host but signed up through another language originally.
      if (data?.user?.id) {
        const { data: profile } = await supabase
          .from('profiles')
          .select('preferred_language')
          .eq('id', data.user.id)
          .single();
        if (profile?.preferred_language && profile.preferred_language !== 'en') {
          window.location.href = `${window.location.origin}/auth/callback?redirect=${redirect}&lang=${profile.preferred_language}&skip_code=1`;
          return;
        }
      }

      router.push(redirect);
      router.refresh();
    } catch (err) {
      setError(t('auth.genericError', locale));
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleLogin = async () => {
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: `${window.location.origin}/auth/callback?${callbackQuery}`,
      },
    });

    if (error) {
      setError(error.message);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-white dark:bg-neutral-950 px-4">
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
            <h1 className="text-2xl font-bold mb-2">{t('auth.welcomeBack', locale)}</h1>
            <p className="text-neutral-600 dark:text-neutral-400">{t('auth.welcomeBackSubtitle', locale)}</p>
          </div>

          {message && (
            <div className="mb-4 p-3 rounded-lg bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 text-green-700 dark:text-green-400 text-sm">
              {message}
            </div>
          )}

          {error && (
            <div className="mb-4 p-3 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-400 text-sm">
              {error}
            </div>
          )}

          <form onSubmit={handleLogin} className="space-y-4">
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
              <div className="flex items-center justify-between mb-2">
                <label htmlFor="password" className="text-sm font-medium">{t('auth.password', locale)}</label>
                <Link href="/forgot-password" className="text-sm text-amber-600 dark:text-amber-400 hover:underline">
                  {t('auth.forgotPassword', locale)}
                </Link>
              </div>
              <input
                id="password"
                type="password"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                className="w-full rounded-xl border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-800 px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-transparent transition-all"
              />
            </div>
            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-xl bg-gradient-to-r from-amber-500 to-orange-600 py-3 text-sm font-semibold text-white hover:shadow-lg hover:shadow-amber-500/25 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
            >
              {loading ? t('auth.signingIn', locale) : t('auth.signIn', locale)}
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
            onClick={handleGoogleLogin}
            className="w-full flex items-center justify-center gap-2 rounded-xl border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-800 py-3 text-sm font-medium hover:bg-neutral-50 dark:hover:bg-neutral-700 transition-colors"
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
            {t('auth.noAccount', locale)}{' '}
            <Link href={lang && lang !== 'en' ? `/signup?lang=${lang}` : '/signup'} className="text-amber-600 dark:text-amber-400 hover:underline font-medium">
              {t('auth.signUp', locale)}
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center bg-white dark:bg-neutral-950">…</div>}>
      <LoginForm />
    </Suspense>
  );
}
