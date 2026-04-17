/**
 * Central AI model routing.
 *
 * Rule: quality first, cost second.
 * - Opus  → tasks where output quality directly equals product value
 *           (long-form writing, voice preservation, final chapter prose).
 * - Sonnet → tasks needing strong reasoning but not artistic output
 *           (validation, idea improvement, outline structuring,
 *            interview orchestration, QA content review).
 * - Haiku → fast extraction / classification / formatting
 *           (follow-up question selection, keyword extraction, JSON
 *            cleanup, publishing metadata).
 *
 * Model IDs as of April 2026:
 *   Opus:   claude-opus-4-7
 *   Sonnet: claude-sonnet-4-6
 *   Haiku:  claude-haiku-4-5-20251001
 *
 * To swap a model globally for a task family, change it here — nowhere else.
 */

export type ModelTier = 'opus' | 'sonnet' | 'haiku';

export const MODEL_IDS: Record<ModelTier, string> = {
  opus: 'claude-opus-4-7',
  sonnet: 'claude-sonnet-4-6',
  haiku: 'claude-haiku-4-5-20251001',
};

/**
 * Pricing per million tokens (USD) as of April 2026.
 * Used for cost logging only — not for routing decisions.
 */
export const MODEL_PRICING: Record<ModelTier, { input: number; output: number }> = {
  opus:   { input: 15.00, output: 75.00 },
  sonnet: { input:  3.00, output: 15.00 },
  haiku:  { input:  1.00, output:  5.00 },
};

/**
 * Every named task in the pipeline and which tier handles it.
 * Add new tasks here before calling any Anthropic endpoint.
 */
export type AITask =
  // Validation
  | 'validate_idea'          // Score the author's idea on 6 dimensions
  | 'propose_stronger_idea'  // Rewrite the idea to score higher, with reasoning
  // Interview
  | 'interview_followup'     // Pick next question based on prior answers
  | 'interview_deepdive'     // Generate clarifying sub-questions on weak answers
  | 'interview_summary'      // Distill interview into a structured brief
  // Research
  | 'research_synthesis'     // Generate credible research points from interview
  | 'research_citation_check'// Verify a claim looks plausible
  // Outline
  | 'outline_generate'       // Build full outline from brief + research
  | 'outline_refine'         // Revise outline based on author feedback
  // Writing — this is where quality matters most
  | 'write_chapter'          // Main chapter prose (streaming)
  | 'write_frontmatter'      // Preface, introduction
  | 'write_backmatter'       // Conclusion, references
  | 'rewrite_section'        // Author-requested rewrite of a passage
  // QA
  | 'qa_readability'         // Readability + tone check (fast)
  | 'qa_coherence'           // Cross-chapter coherence (deeper)
  | 'qa_factcheck'           // Flag dubious factual claims
  // Cover & publishing
  | 'cover_prompt_generate'  // Build Ideogram prompt from book metadata
  | 'publishing_metadata'    // Generate KDP description, keywords, categories
  | 'publishing_guide'       // Per-platform submission guide
  // Guild agents (member-facing coaching/analysis/strategy)
  | 'guild_mentor_turn'      // Conversational reply in weekly check-in
  | 'guild_mentor_summary'   // Distil session into journal entry
  | 'guild_analyst_report'   // Analyse referral performance → insights
  | 'guild_strategist_plan'; // Recommend next-period actions

export const TASK_MODEL: Record<AITask, ModelTier> = {
  // Sonnet: reasoning + structure, not prose
  validate_idea:           'sonnet',
  propose_stronger_idea:   'sonnet',
  interview_summary:       'sonnet',
  research_synthesis:      'sonnet',
  outline_generate:        'sonnet',
  outline_refine:          'sonnet',
  qa_coherence:            'sonnet',
  qa_factcheck:            'sonnet',

  // Opus: prose quality is the product
  write_chapter:           'opus',
  write_frontmatter:       'opus',
  write_backmatter:        'opus',
  rewrite_section:         'opus',

  // Haiku: fast, bounded, cheap
  interview_followup:      'haiku',
  interview_deepdive:      'haiku',
  research_citation_check: 'haiku',
  qa_readability:          'haiku',
  cover_prompt_generate:   'haiku',
  publishing_metadata:     'haiku',
  publishing_guide:        'haiku',

  // Guild agents: sonnet — reasoning + empathy over member data, not prose art
  guild_mentor_turn:       'sonnet',
  guild_mentor_summary:    'sonnet',
  guild_analyst_report:    'sonnet',
  guild_strategist_plan:   'sonnet',
};

/**
 * Token budget per task — prevents runaway cost on large inputs.
 */
export const TASK_MAX_TOKENS: Record<AITask, number> = {
  validate_idea:           2048,
  propose_stronger_idea:   2048,
  interview_followup:       512,
  interview_deepdive:       768,
  interview_summary:       2048,
  research_synthesis:      3072,
  research_citation_check:  256,
  outline_generate:        4096,
  outline_refine:          3072,
  write_chapter:           8192,   // ~3k-5k words per chapter
  write_frontmatter:       4096,
  write_backmatter:        4096,
  rewrite_section:         4096,
  qa_readability:           512,
  qa_coherence:            2048,
  qa_factcheck:            2048,
  cover_prompt_generate:    512,
  publishing_metadata:     1024,
  publishing_guide:        1536,
  // Guild agents
  guild_mentor_turn:        768,   // one conversational reply
  guild_mentor_summary:    1536,   // structured journal entry at session end
  guild_analyst_report:    2048,   // structured insights
  guild_strategist_plan:   2560,   // week plan JSON
};

export function modelFor(task: AITask): string {
  return MODEL_IDS[TASK_MODEL[task]];
}

export function maxTokensFor(task: AITask): number {
  return TASK_MAX_TOKENS[task];
}

/**
 * Calculate USD cost for a completion given its usage.
 */
export function calculateCost(
  task: AITask,
  inputTokens: number,
  outputTokens: number
): number {
  const tier = TASK_MODEL[task];
  const pricing = MODEL_PRICING[tier];
  return Number(
    (
      (inputTokens / 1_000_000) * pricing.input +
      (outputTokens / 1_000_000) * pricing.output
    ).toFixed(6)
  );
}
