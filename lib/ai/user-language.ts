import { SupabaseClient } from '@supabase/supabase-js';

/**
 * Read the user's preferred language from profiles.preferred_language.
 * Defaults to 'en' if the profile row or column is missing.
 */
export async function getUserLanguage(
  supabase: SupabaseClient,
  userId: string,
): Promise<string> {
  const { data } = await supabase
    .from('profiles')
    .select('preferred_language')
    .eq('id', userId)
    .single();
  return (data?.preferred_language || 'en').toLowerCase();
}

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

/**
 * Build a language directive paragraph to prepend to any AI system prompt.
 * Returns an empty string for English (no directive needed — model default).
 */
export function languageDirective(lang: string): string {
  const code = lang.toLowerCase();
  if (code === 'en' || !LANGUAGE_NAMES[code]) return '';
  const name = LANGUAGE_NAMES[code];
  return `## LANGUAGE — CRITICAL
This user writes in ${name}. EVERY output (titles, prose, questions, scores, summaries, suggestions, options) MUST be in ${name} — not English. Think in ${name} from the first word. Do not code-switch. Do not translate from an English draft. Write natively in ${name} as if the content was conceived in that language.

`;
}
