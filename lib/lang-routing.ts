/**
 * Language routing helper.
 *
 * Historically this module rewrote the post-auth redirect to the user's
 * language subdomain (e.g. ar.penworth.ai after login with lang=ar). That
 * design was wrong: each language subdomain is a separate Vercel project
 * hosting a STATIC MARKETING LANDING PAGE only. Those projects have no
 * /login, /auth/callback, or /dashboard routes. The authenticated app
 * lives exclusively on new.penworth.ai.
 *
 * When a user signed in with lang=es, we'd redirect them to
 * https://es.penworth.ai/dashboard — which doesn't exist — and they'd
 * bounce back to login. Session cookies were scoped host-only to
 * new.penworth.ai, so even if the subdomain had routes, cookies wouldn't
 * travel across origins.
 *
 * Fix: always keep authenticated users on the origin they authenticated
 * against. The in-app shell (sidebar, editor, settings, etc.) already
 * localises based on profiles.preferred_language, so a Spanish user
 * signed in on new.penworth.ai sees Spanish chrome end-to-end without
 * needing to be on es.penworth.ai.
 *
 * Language subdomains remain useful for:
 *   - SEO in each language
 *   - Pre-signup landing pages in the user's language
 *   - Marketing attribution (where did this signup come from)
 *
 * The `lang` URL param still flows through auth so we can save it to
 * profiles.preferred_language on first sign-in — we just don't rewrite
 * the origin anymore.
 */

const SUPPORTED_LANGS = ['en', 'ar', 'es', 'pt', 'ru', 'zh', 'bn', 'hi', 'id', 'fr', 'vi'] as const;
export type SupportedLang = typeof SUPPORTED_LANGS[number];

export function isSupportedLang(code: string | null | undefined): code is SupportedLang {
  return !!code && (SUPPORTED_LANGS as readonly string[]).includes(code);
}

/**
 * Resolve the origin a user should return to after auth.
 *
 * Always returns `currentOrigin` unchanged. The second argument is kept
 * for API compatibility with existing callers (app/(auth)/callback/route.ts,
 * app/auth/callback/route.ts, app/api/user/language/route.ts).
 */
export function originForLanguage(
  currentOrigin: string,
  _lang: string | null | undefined,
): string {
  return currentOrigin;
}
