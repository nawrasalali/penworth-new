/**
 * Maps a preferred_language code to the base URL the authenticated user
 * should land on. In production, Arabic/Spanish/etc. users return to their
 * language subdomain (ar.penworth.ai, es.penworth.ai, ...). In development
 * or on preview deploys we stay on the current origin.
 */
const SUPPORTED_LANGS = ['en','ar','es','pt','ru','zh','bn','hi','id','fr','vi'] as const;
export type SupportedLang = typeof SUPPORTED_LANGS[number];

export function isSupportedLang(code: string | null | undefined): code is SupportedLang {
  return !!code && (SUPPORTED_LANGS as readonly string[]).includes(code);
}

/**
 * Resolve the origin a user should return to after auth.
 *   - en or unset -> the primary origin (new.penworth.ai / penworth.ai)
 *   - everything else -> `{lang}.penworth.ai`
 *
 * `currentOrigin` is the URL this request was served from. We only rewrite
 * when we are on a production *.penworth.ai host — on localhost, previews,
 * or vercel.app hosts we keep the user on the current origin so dev stays
 * frictionless.
 */
export function originForLanguage(
  currentOrigin: string,
  lang: string | null | undefined,
): string {
  if (!isSupportedLang(lang) || lang === 'en') return currentOrigin;
  try {
    const url = new URL(currentOrigin);
    // Only rewrite when the apex matches the production domain.
    if (!url.hostname.endsWith('penworth.ai')) return currentOrigin;
    url.hostname = `${lang}.penworth.ai`;
    return url.origin;
  } catch {
    return currentOrigin;
  }
}
