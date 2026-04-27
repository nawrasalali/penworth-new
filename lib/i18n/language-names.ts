/**
 * Client-safe language-name table.
 *
 * Lives separately from `lib/ai/user-language.ts` because that module also
 * exports server-only helpers (`getUserLanguage`) that previously used a
 * value-import of `SupabaseClient` from `@supabase/supabase-js`. When a
 * `'use client'` page imports anything from a module that mixes client-safe
 * data with code that pulls server-only dependencies into the bundle,
 * Next.js 15's React Client Manifest builder can emit a manifest entry
 * pointing at a chunk path that does not survive tree-shaking, producing
 * the runtime error
 *
 *   "Could not find the module … in the React Client Manifest"
 *
 * Reproduced on `/settings` 2026-04-26 (Feras + Nawras both hit it; digest
 * 4115315396; deploy `dpl_JE4Qaby…`, commit `6cff286`). Settings was the
 * only client component importing `LANGUAGE_NAMES` from `user-language.ts`,
 * which is why it was the only broken route.
 *
 * Rule: any client component that needs the language list imports from
 * THIS module, never from `lib/ai/user-language.ts`. Server callers are
 * unchanged — `user-language.ts` re-exports from here.
 */

export const LANGUAGE_NAMES: Record<string, string> = {
  en: 'English',
  ar: 'Arabic (Modern Standard Arabic)',
  es: 'Spanish',
  pt: 'Portuguese (Brazilian)',
  ru: 'Russian',
  zh: 'Chinese (Simplified)',
  bn: 'Bengali',
  hi: 'Hindi',
  id: 'Indonesian (Bahasa Indonesia)',
  fr: 'French',
  vi: 'Vietnamese',
};

export function getLanguageName(lang: string): string {
  return LANGUAGE_NAMES[lang.toLowerCase()] || 'English';
}
