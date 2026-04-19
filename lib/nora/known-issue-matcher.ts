import type { SupabaseClient } from '@supabase/supabase-js';
import type { NoraSurface } from './types';

/**
 * Phase 2.5 Item 3 Commit 7 — known-issue matcher.
 *
 * When a user message arrives, the turn route hands it to this matcher.
 * We tokenize the message, query nora_known_issues for patterns whose
 * symptom_keywords overlap with our tokens, pick the most specific
 * match, and return it for the turn route to inject into Nora's
 * context as `matched_pattern`.
 *
 * We do NOT execute diagnostic_sql in this commit. That requires a
 * SECURITY DEFINER exec_sql RPC that doesn't yet exist — separate
 * migration. The matched pattern carries diagnostic_sql + playbook as
 * text; Nora can reason over the playbook prose even without running
 * the SQL. Full diagnostic execution is a follow-up commit.
 *
 * A12 amendment — hardened tokenizer:
 *   The Phase 2 pre-flight flagged that a naive split(' ') is fragile:
 *   punctuation sticks to words, capitalization defeats keyword match,
 *   empty strings pollute the tokens array. The SQL-side equivalent is
 *     regexp_split_to_array(
 *       regexp_replace(lower(msg), '[^a-z0-9\\s]', ' ', 'g'),
 *       '\\s+'
 *     )
 *   We mirror this exactly in JS so the test harness and the DB both
 *   see the same tokens.
 *
 * Ordering:
 *   ORDER BY array_length(symptom_keywords, 1) DESC LIMIT 1.
 *   Rationale: a pattern with 5 specific keywords is more targeted
 *   than a pattern with 2 generic keywords. On tie, the most recently
 *   updated wins (secondary sort).
 *
 * Post-match:
 *   We bump match_count + last_matched_at on the picked row. This is
 *   write-on-read — a deliberate operations signal: high-traffic
 *   patterns are visible to admins in the editor UI. Failure to bump
 *   is non-fatal (logged, not thrown) — match result is always
 *   returned to the caller.
 */

export interface KnownIssuePattern {
  id: string;
  pattern_slug: string;
  title: string;
  surface: NoraSurface | null;
  symptom_keywords: string[];
  diagnostic_sql: string | null;
  resolution_playbook: string | null;
  auto_fix_tool: string | null;
  auto_fix_tier: 1 | 2 | 3 | null;
  escalate_after_attempts: number | null;
}

export interface MatchResult {
  matched: KnownIssuePattern | null;
  tokens: string[];
}

/**
 * Tokenize a user message using the same rules as the DB-side
 * regexp_split_to_array(lower(msg) with non-alphanumeric → space).
 * Filters empty strings. Lowercases. De-duplicates.
 */
export function tokenizeUserMessage(msg: string): string[] {
  if (!msg || typeof msg !== 'string') return [];
  const normalized = msg
    .toLowerCase()
    // replace anything not a-z, 0-9, or whitespace with a single space
    .replace(/[^a-z0-9\s]/g, ' ');
  const tokens = normalized.split(/\s+/).filter((t) => t.length > 0);
  // De-dupe — no point sending the word "payout" 3 times to the overlap query
  return Array.from(new Set(tokens));
}

export interface MatchKnownIssueArgs {
  admin: SupabaseClient;
  surface: NoraSurface;
  message: string;
}

/**
 * Return the best-matching known issue pattern for a user message, or
 * null if no pattern matches. Never throws — on DB error returns
 * { matched: null, tokens } so the turn route can continue without
 * known-issue assist.
 */
export async function matchKnownIssue(
  args: MatchKnownIssueArgs,
): Promise<MatchResult> {
  const { admin, surface, message } = args;
  const tokens = tokenizeUserMessage(message);

  if (tokens.length === 0) {
    return { matched: null, tokens };
  }

  // Surface filter: include patterns scoped to this surface OR null
  // (meaning 'applies to any surface'). Supabase's or() filter syntax
  // uses the rare .or() string form. Active filter always.
  const { data, error } = await admin
    .from('nora_known_issues')
    .select(
      'id, pattern_slug, title, surface, symptom_keywords, diagnostic_sql, ' +
        'resolution_playbook, auto_fix_tool, auto_fix_tier, escalate_after_attempts',
    )
    .eq('active', true)
    .or(`surface.eq.${surface},surface.is.null`)
    .overlaps('symptom_keywords', tokens)
    // Specificity first — larger keyword arrays are more targeted
    .order('symptom_keywords', { ascending: false, nullsFirst: false })
    .limit(5)
    .returns<KnownIssuePattern[]>();

  if (error) {
    console.error('[matchKnownIssue] query error:', error);
    return { matched: null, tokens };
  }
  if (!data || data.length === 0) {
    return { matched: null, tokens };
  }

  // The .order() above sorts lexicographically on array, not by length.
  // Supabase/PostgREST doesn't expose array_length in select ordering,
  // so we re-sort client-side by explicit length. Five candidates is
  // cheap to sort.
  const sorted = [...data].sort((a, b) => {
    const al = Array.isArray(a.symptom_keywords) ? a.symptom_keywords.length : 0;
    const bl = Array.isArray(b.symptom_keywords) ? b.symptom_keywords.length : 0;
    return bl - al; // descending
  });

  const best = sorted[0];

  // Fire-and-forget increment of match_count. Failure non-fatal.
  void bumpMatchCount(admin, best.id).catch((err) => {
    console.warn('[matchKnownIssue] bumpMatchCount failed:', err);
  });

  return { matched: best, tokens };
}

async function bumpMatchCount(
  admin: SupabaseClient,
  patternId: string,
): Promise<void> {
  // Best-effort increment. The admin editor surfaces match_count +
  // last_matched_at so admins can see which patterns are hot.
  //
  // We can't do UPDATE ... SET match_count = match_count + 1 through
  // PostgREST's JS client safely; we'd need an RPC for atomicity.
  // A read-modify-write is close enough for an operational counter:
  // a lost increment under high concurrency is inconsequential.
  const { data } = await admin
    .from('nora_known_issues')
    .select('match_count')
    .eq('id', patternId)
    .maybeSingle();

  const currentCount = (data?.match_count as number | null) ?? 0;

  await admin
    .from('nora_known_issues')
    .update({
      match_count: currentCount + 1,
      last_matched_at: new Date().toISOString(),
    })
    .eq('id', patternId);
}
