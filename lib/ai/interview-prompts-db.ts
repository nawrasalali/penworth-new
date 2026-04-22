/**
 * Penworth Interview Prompts — DB-backed loader.
 *
 * Replaces the hardcoded question bank at lib/ai/interview-questions.ts for every
 * content_type that has a row in public.interview_prompts. Calls the
 * resolve_interview_prompt() RPC, which:
 *   • Direct-maps 10 seeded types (non-fiction, fiction, memoir, business_plan,
 *     proposal, thesis, dissertation, paper, academic, poetry)
 *   • Falls back to the nearest neighbour for unseeded types and returns
 *     is_fallback=true so the UI can reason about fidelity later
 *
 * Founder directive 2026-04-23 (CEO-033 + CEO-034a): every interview must be
 * specific to the document type. The hardcoded generic "audience / tone /
 * chapter_count" questions are the exact thing this module replaces.
 *
 * Process-local cache keeps per-content_type bundles in memory; the key is
 * `content_type:version`. Cache lifetime matches the process — for Next.js
 * client components that's the tab session. DB updates to interview_prompts
 * will not hot-reload clients; that's intentional (version bump + server
 * revalidation is the supported path when the Founder iterates on prompts).
 */

import { createClient } from '@/lib/supabase/client';

// -----------------------------------------------------------------------------
// DB-shape types (mirror interview_prompts.question_bank JSONB)
// -----------------------------------------------------------------------------

export interface DbInterviewMcOption {
  id: string;
  label: string;
  /** Optional lead-in text the UI can prepend to the free-text answer. */
  prefix?: string;
  /** Optional sub-copy under the label. */
  hint?: string;
  /**
   * When true, this option is a free-text entry (typically the "Other /
   * Something else" escape hatch). Surfaces a text input instead of a button.
   */
  is_free_text?: boolean;
}

export interface DbInterviewQuestion {
  id: string;
  category: string;
  required: boolean;
  question_text: string;
  /** Internal guidance for the LLM — never shown to the user. */
  notes?: string;
  /** Whether the author can also add free text after picking an option. */
  accepts_free_text: boolean;
  mc_options: DbInterviewMcOption[];
}

export interface DbCompletionCriteria {
  min_required_answers: number;
  non_skippable_question_ids: string[];
}

export interface InterviewBundle {
  documentType: string;
  version: number;
  isFallback: boolean;
  systemPrompt: string;
  openingPromptTemplate: string;
  questions: DbInterviewQuestion[];
  completionCriteria: DbCompletionCriteria;
  /** Exact JSONB Claude will emit at approval time. Kept for agent plumbing. */
  outputSchema: Record<string, unknown>;
}

// -----------------------------------------------------------------------------
// Legacy UI shape (what InterviewScreen + editor page currently consume)
// -----------------------------------------------------------------------------

export interface LegacyUiQuestion {
  id: string;
  question: string;
  type: 'open' | 'multiple_choice';
  options?: string[];
  helpText?: string;
  followUp?: string;
  multi?: boolean;
}

// -----------------------------------------------------------------------------
// Cache
// -----------------------------------------------------------------------------

const bundleCache = new Map<string, InterviewBundle>();

function cacheKey(contentType: string, version: number): string {
  return `${contentType}:${version}`;
}

// -----------------------------------------------------------------------------
// Loader
// -----------------------------------------------------------------------------

/**
 * Fetch the interview bundle for a content type from the DB. Returns null if
 * the RPC returns no row (no seed + no fallback match — should not happen given
 * resolve_interview_prompt()'s ultimate 'non-fiction' fallback, but treated
 * defensively).
 *
 * Safe to call from browser-side code; the RPC runs with the caller's RLS
 * context and interview_prompts has an authenticated-read policy for
 * is_active rows.
 */
export async function fetchInterviewBundle(
  contentType: string
): Promise<InterviewBundle | null> {
  const supabase = createClient();

  const { data, error } = await supabase.rpc('resolve_interview_prompt', {
    p_content_type: contentType,
  });

  if (error) {
    // eslint-disable-next-line no-console
    console.error('[interview-prompts-db] resolve_interview_prompt failed', {
      contentType,
      error: error.message,
    });
    return null;
  }

  // RPC returns TABLE(...); Supabase returns an array.
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) return null;

  const bundle: InterviewBundle = {
    documentType: row.resolved_document_type,
    version: row.resolved_version,
    isFallback: Boolean(row.is_fallback),
    systemPrompt: row.system_prompt,
    openingPromptTemplate: row.opening_prompt_template,
    questions: (row.question_bank ?? []) as DbInterviewQuestion[],
    completionCriteria: row.completion_criteria as DbCompletionCriteria,
    outputSchema: row.output_schema as Record<string, unknown>,
  };

  bundleCache.set(
    cacheKey(bundle.documentType, bundle.version),
    bundle
  );
  // Also cache by the requested content_type so unseeded types hit the
  // cache even though the underlying bundle is the fallback target.
  bundleCache.set(cacheKey(contentType, bundle.version), bundle);

  return bundle;
}

/**
 * Synchronous cache peek. Returns undefined if not yet fetched. Useful for
 * UI code that wants to avoid awaiting on every render after the initial load.
 */
export function getCachedBundle(
  contentType: string,
  version: number = 1
): InterviewBundle | undefined {
  return bundleCache.get(cacheKey(contentType, version));
}

// -----------------------------------------------------------------------------
// Legacy-shape flattener — maps the rich DB question into what the current
// InterviewScreen consumes. Prefix + is_free_text fidelity is lost here and
// tracked in CEO-036 for a richer UI update. Every option label becomes a
// plain string in `options`, with the "free text" escape hatch last (unless
// the question is pure text).
// -----------------------------------------------------------------------------

export function flattenQuestionsForLegacyUi(
  bundle: InterviewBundle
): LegacyUiQuestion[] {
  return bundle.questions.map((q) => {
    // "Pure text" questions have a single free-text MC option (e.g. the key_finding
    // question on 'paper' where the only option is "I'll describe in my own words").
    // Render these as open-ended instead of a one-button multiple-choice.
    const isPureText =
      q.mc_options.length === 1 &&
      (q.mc_options[0].is_free_text ?? false);

    if (isPureText) {
      return {
        id: q.id,
        question: q.question_text,
        type: 'open' as const,
        helpText: q.notes,
      };
    }

    // Otherwise render as multiple-choice. Options are the ordered labels.
    // The free-text "other" option (is_free_text=true) becomes the visible
    // escape hatch label — InterviewScreen already knows to reveal a text
    // input when the user picks an "Other …" type option.
    const options = q.mc_options.map((o) => o.label);

    return {
      id: q.id,
      question: q.question_text,
      type: 'multiple_choice' as const,
      options,
      helpText: q.notes,
      // Most DB questions allow a combination of MC + free text. We don't
      // currently surface `multi-select` distinctly in this flattening —
      // the editor page relies on InterviewScreen's behaviour. If a future
      // question needs explicit multi-select, uncomment the next line and
      // source the flag from a new DB field.
      // multi: q.multi === true,
    };
  });
}

/**
 * Convenience for call sites that just want the question list quickly. Returns
 * an empty array on any failure — callers should treat this like "no data"
 * and, if necessary, surface an explicit "Failed to load interview" state to
 * the user rather than falling back to the legacy hardcoded bank.
 */
export async function fetchLegacyUiQuestions(
  contentType: string
): Promise<LegacyUiQuestion[]> {
  const bundle = await fetchInterviewBundle(contentType);
  if (!bundle) return [];
  return flattenQuestionsForLegacyUi(bundle);
}
