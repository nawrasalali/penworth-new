import type { SupabaseClient } from '@supabase/supabase-js';

import {
  LANGUAGE_NAMES,
  getLanguageName,
} from '@/lib/i18n/language-names';

// Re-export so existing server callers (api/ai/* routes) keep working.
export { LANGUAGE_NAMES, getLanguageName };

/**
 * Read the user's preferred language from `profiles.preferred_language`.
 * Defaults to `'en'` if the profile row or column is missing.
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
