/**
 * Penworth Author-pipeline prompt bundles — shared helpers.
 *
 * The 8 Author-pipeline agents (Validate, Interview, Research, Outline, Writing,
 * QA, Cover, Publishing) each resolve their prompt bundle from Postgres via a
 * resolve_<agent>_prompt RPC seeded under CEO-033 / CEO-034 / CEO-039. Every
 * bundle shares the same core columns — system_prompt, user_prompt_template,
 * output_schema, is_fallback, resolved_document_type, resolved_version — plus
 * a couple of agent-specific extras (e.g. validate's validation_rubric,
 * outline's section_constraints, cover's typography_layer_spec).
 *
 * This module centralises:
 *   • fetchPromptBundle()        — one RPC call, one typed return shape
 *   • interpolateTemplate()      — {{var}} + {{#if var}}...{{/if}} renderer
 *   • runValidatedCompletion()   — retry loop with ajv schema validation and
 *                                  progressive error feedback into the prompt
 *
 * Founder directive 2026-04-23 (CEO-039 Phase 2): every Author agent reads its
 * prompt from the DB so the Founder can iterate without a deploy. Keeping the
 * plumbing in one module means each agent becomes a thin adapter that:
 *   1. Loads the brief from whatever source it needs
 *   2. Builds its template-variable dictionary
 *   3. Calls runValidatedCompletion() with the bundle and the vars
 *   4. Maps the validated output into whatever shape the downstream
 *      persistence / UI consumer expects
 *
 * Backwards compat: lib/ai/outline-prompts-db.ts and lib/ai/interview-prompts-db.ts
 * predate this module. They are not retrofitted in this pass — keeping their
 * existing shape avoids touching a working path (outline is already live).
 * Future cleanup can merge them into this helper; tracked informally, not
 * a blocking refactor.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import Ajv, { type ErrorObject, type ValidateFunction } from 'ajv';
import Anthropic from '@anthropic-ai/sdk';

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

/**
 * The full set of resolver RPCs the Author pipeline uses. Each resolves the
 * caller's requested content_type to the most appropriate seeded prompt row
 * (direct match or fallback chain) and returns a common column set.
 */
export type AuthorPromptRpc =
  | 'resolve_validate_prompt'
  | 'resolve_research_prompt'
  | 'resolve_writing_prompt'
  | 'resolve_qa_prompt'
  | 'resolve_cover_prompt'
  | 'resolve_publishing_prompt';

/**
 * Columns shared by every Author-pipeline prompt bundle. Agent-specific
 * extras (rubric, constraints, typography spec, etc.) are exposed via
 * the `extras` record so callers can reach into them without forcing a
 * bespoke type per agent.
 */
export interface PromptBundle {
  documentType: string;
  version: number;
  isFallback: boolean;
  systemPrompt: string;
  userPromptTemplate: string;
  outputSchema: Record<string, unknown>;
  /** Per-agent extras (validation_rubric, section_constraints, etc). */
  extras: Record<string, unknown>;
}

export interface RunCompletionOptions {
  /** The compiled prompt bundle from fetchPromptBundle. */
  bundle: PromptBundle;
  /** Anthropic model identifier. */
  model: string;
  /** Max tokens for the response. */
  maxTokens: number;
  /** Temperature — defaults to 0.4 for structured-JSON tasks. */
  temperature?: number;
  /** Template variables for the user message. */
  vars: Record<string, string | undefined>;
  /**
   * Optional feedback or refinement instruction appended to the user message
   * after template interpolation. Useful for "refine this previous output"
   * flows where the base template is reused.
   */
  userMessageSuffix?: string;
  /**
   * Language preamble prepended to the user message. If supplied, forces the
   * model to respond in the author's chosen language even when the DB
   * system_prompt itself doesn't explicitly reference it.
   */
  languagePreamble?: string;
  /** Max retry attempts on schema-validation or JSON-parse failure. */
  maxAttempts?: number;
}

export interface CompletionSuccess {
  ok: true;
  data: unknown;
  attempts: number;
  usage: { inputTokens: number; outputTokens: number };
  modelUsed: string;
}

export interface CompletionFailure {
  ok: false;
  error: 'schema_validation' | 'json_parse' | 'schema_compile' | 'anthropic_error';
  lastErrors: unknown;
  attempts: number;
  rawText?: string;
  usage: { inputTokens: number; outputTokens: number };
}

export type CompletionResult = CompletionSuccess | CompletionFailure;

// -----------------------------------------------------------------------------
// Module-local singletons
// -----------------------------------------------------------------------------

const anthropic = new Anthropic();
const ajv = new Ajv({ strict: false, allErrors: true });

// -----------------------------------------------------------------------------
// Fetcher
// -----------------------------------------------------------------------------

/**
 * Fetch the prompt bundle for a given agent + content_type. Returns null if
 * the RPC returned no row — every seeded resolver has a fallback chain that
 * terminates at non-fiction, so a null return means either the RPC name is
 * wrong or the DB is misconfigured; callers should treat it as a 500-level
 * failure, not a quiet degradation.
 */
export async function fetchPromptBundle(
  supabase: SupabaseClient,
  rpcName: AuthorPromptRpc,
  contentType: string
): Promise<PromptBundle | null> {
  const { data, error } = await supabase.rpc(rpcName, {
    p_content_type: contentType,
  });

  if (error) {
    // eslint-disable-next-line no-console
    console.error(`[prompt-bundle] ${rpcName} failed`, {
      contentType,
      error: error.message,
    });
    return null;
  }

  // RPCs that RETURN TABLE(...) come back as arrays; one-row variants may
  // come back as the object directly. Handle both.
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) return null;

  // Pull the common fields and stash everything else in extras. That way
  // the validate agent can reach into `extras.validation_rubric`, cover
  // can reach into `extras.typography_layer_spec`, etc., without the shared
  // type ballooning.
  const {
    resolved_document_type,
    resolved_version,
    is_fallback,
    system_prompt,
    user_prompt_template,
    output_schema,
    ...rest
  } = row as Record<string, unknown>;

  return {
    documentType: String(resolved_document_type ?? ''),
    version: Number(resolved_version ?? 1),
    isFallback: Boolean(is_fallback),
    systemPrompt: String(system_prompt ?? ''),
    userPromptTemplate: String(user_prompt_template ?? ''),
    outputSchema: (output_schema ?? {}) as Record<string, unknown>,
    extras: rest as Record<string, unknown>,
  };
}

// -----------------------------------------------------------------------------
// Template interpolation
// -----------------------------------------------------------------------------

/**
 * Minimal handlebars-ish interpolator supporting:
 *   {{var}}                            — simple substitution (missing = empty)
 *   {{#if var}} ... {{/if}}            — block included iff var is non-empty
 *
 * Block pass runs first so {{var}} inside a dropped block doesn't leak the
 * literal placeholder token into output.
 */
export function interpolateTemplate(
  template: string,
  vars: Record<string, string | undefined>
): string {
  let out = template;

  out = out.replace(
    /\{\{#if\s+(\w+)\}\}([\s\S]*?)\{\{\/if\}\}/g,
    (_match, name: string, body: string) => {
      const v = vars[name];
      return v && v.trim().length > 0 ? body : '';
    }
  );

  out = out.replace(/\{\{(\w+)\}\}/g, (_match, name: string) => {
    return vars[name] ?? '';
  });

  return out;
}

// -----------------------------------------------------------------------------
// Parsing / validation
// -----------------------------------------------------------------------------

/**
 * Strip common LLM-emitted markdown fences and parse the remainder as JSON.
 * Throws on malformed JSON; caller decides whether to retry.
 */
export function stripFencesAndParse(raw: string): unknown {
  const clean = raw
    .replace(/```json\n?/g, '')
    .replace(/```\n?/g, '')
    .trim();
  return JSON.parse(clean);
}

/**
 * Compact summary of ajv errors suitable for feeding back into the model in a
 * retry prompt. Capped at 20 items so a pathological output doesn't balloon
 * the next user message.
 */
export function summariseAjvErrors(errors: ErrorObject[] | null | undefined) {
  if (!errors) return null;
  return errors.slice(0, 20).map((e) => ({
    path: e.instancePath || '(root)',
    keyword: e.keyword,
    message: e.message,
    params: e.params,
  }));
}

// -----------------------------------------------------------------------------
// Retry loop
// -----------------------------------------------------------------------------

/**
 * Call the model with the supplied bundle + vars, validate the JSON response
 * against the bundle's output_schema via ajv, and retry up to maxAttempts
 * times feeding schema errors back into the prompt on failure.
 *
 * Returns a discriminated union so callers can handle success vs. each
 * failure mode distinctly (parse error → retry or fail loud; schema error →
 * log and persist an {approved: false, …} row; schema-compile error → DB
 * misconfiguration; Anthropic error → surface to user).
 */
export async function runValidatedCompletion(
  options: RunCompletionOptions
): Promise<CompletionResult> {
  const {
    bundle,
    model,
    maxTokens,
    temperature = 0.4,
    vars,
    userMessageSuffix = '',
    languagePreamble = '',
    maxAttempts = 3,
  } = options;

  // Compile the schema once. A malformed schema in the DB row is a
  // non-recoverable misconfiguration and gets surfaced immediately.
  let validate: ValidateFunction;
  try {
    validate = ajv.compile(bundle.outputSchema);
  } catch (schemaErr) {
    return {
      ok: false,
      error: 'schema_compile',
      lastErrors: { message: (schemaErr as Error).message },
      attempts: 0,
      usage: { inputTokens: 0, outputTokens: 0 },
    };
  }

  const baseUser = interpolateTemplate(bundle.userPromptTemplate, vars);
  let userMessage = languagePreamble + baseUser + userMessageSuffix;

  let lastErrors: unknown = null;
  let lastRaw = '';
  let inputTokensTotal = 0;
  let outputTokensTotal = 0;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    let message;
    try {
      message = await anthropic.messages.create({
        model,
        max_tokens: maxTokens,
        temperature,
        system: bundle.systemPrompt,
        messages: [{ role: 'user', content: userMessage }],
      });
    } catch (err) {
      return {
        ok: false,
        error: 'anthropic_error',
        lastErrors: { message: (err as Error).message },
        attempts: attempt,
        usage: { inputTokens: inputTokensTotal, outputTokens: outputTokensTotal },
      };
    }

    inputTokensTotal += message.usage?.input_tokens ?? 0;
    outputTokensTotal += message.usage?.output_tokens ?? 0;

    const responseText =
      message.content[0]?.type === 'text' ? message.content[0].text : '';
    lastRaw = responseText;

    // Parse
    let candidate: unknown;
    try {
      candidate = stripFencesAndParse(responseText);
    } catch (parseErr) {
      lastErrors = { parseError: (parseErr as Error).message };
      if (attempt < maxAttempts) {
        userMessage =
          languagePreamble +
          baseUser +
          userMessageSuffix +
          `\n\nYour previous response was not valid JSON. Error: ${(parseErr as Error).message}\n` +
          `Return ONLY the JSON object. No markdown fences, no prose, no commentary.`;
        continue;
      }
      return {
        ok: false,
        error: 'json_parse',
        lastErrors,
        attempts: attempt,
        rawText: responseText,
        usage: { inputTokens: inputTokensTotal, outputTokens: outputTokensTotal },
      };
    }

    // Validate
    if (validate(candidate)) {
      return {
        ok: true,
        data: candidate,
        attempts: attempt,
        usage: { inputTokens: inputTokensTotal, outputTokens: outputTokensTotal },
        modelUsed: model,
      };
    }

    lastErrors = summariseAjvErrors(validate.errors);
    if (attempt < maxAttempts) {
      userMessage =
        languagePreamble +
        baseUser +
        userMessageSuffix +
        `\n\nYour previous response failed schema validation. Errors:\n` +
        `${JSON.stringify(lastErrors, null, 2)}\n` +
        `Return ONLY the fully-corrected JSON object. Fix every listed issue.`;
    }
  }

  return {
    ok: false,
    error: 'schema_validation',
    lastErrors,
    attempts: maxAttempts,
    rawText: lastRaw,
    usage: { inputTokens: inputTokensTotal, outputTokens: outputTokensTotal },
  };
}

// -----------------------------------------------------------------------------
// Helpers for common variable patterns
// -----------------------------------------------------------------------------

/**
 * Build the language preamble the retry loop will prepend to the user message.
 * Returns empty string for English so the prompt stays unchanged for the
 * default path.
 */
export function buildLanguagePreamble(
  languageCode: string,
  languageName: string
): string {
  if (languageCode === 'en') return '';
  return (
    `LANGUAGE — CRITICAL: Write every field in ${languageName}. ` +
    `Do not code-switch to English. Think in ${languageName} from the first word.\n\n`
  );
}
