/**
 * Penworth Outline Prompts — DB-backed loader.
 *
 * Replaces the hardcoded outline prompts in app/api/ai/outline/route.ts for
 * every content_type that has a row in public.outline_prompts. Calls the
 * resolve_outline_prompt() RPC, which:
 *   • Direct-maps seeded types (non-fiction, fiction, memoir, poetry)
 *   • Falls back to the nearest neighbour for other types and returns
 *     is_fallback=true so the caller can reason about fidelity later
 *
 * Founder directive 2026-04-23 (CEO-034): outline prompts live in the DB so
 * the Founder can iterate on them without shipping a release. The agent reads
 * the system prompt, user template, and the JSON Schema validator from the
 * same row so prompt rev and validator rev stay in lockstep.
 *
 * Usage:
 *   const bundle = await fetchOutlineBundle(supabase, contentType);
 *   const userMessage = interpolateTemplate(bundle.userPromptTemplate, vars);
 *   // call Anthropic with system=bundle.systemPrompt, user=userMessage
 *   // validate response against bundle.outputSchema via ajv
 */

import type { SupabaseClient } from '@supabase/supabase-js';

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

export interface OutlineBundle {
  documentType: string;
  version: number;
  isFallback: boolean;
  systemPrompt: string;
  userPromptTemplate: string;
  sectionConstraints: Record<string, unknown>;
  completionCriteria: Record<string, unknown>;
  outputSchema: Record<string, unknown>;
}

// -----------------------------------------------------------------------------
// Loader
// -----------------------------------------------------------------------------

/**
 * Fetch the outline prompt bundle for a content type from the DB. Returns null
 * if the RPC returns no row (no seed + no fallback match — should not happen
 * given resolve_outline_prompt()'s ultimate 'non-fiction' fallback, but we
 * treat it defensively so the caller can fail loud).
 */
export async function fetchOutlineBundle(
  supabase: SupabaseClient,
  contentType: string
): Promise<OutlineBundle | null> {
  const { data, error } = await supabase.rpc('resolve_outline_prompt', {
    p_content_type: contentType,
  });

  if (error) {
    // eslint-disable-next-line no-console
    console.error('[outline-prompts-db] resolve_outline_prompt failed', {
      contentType,
      error: error.message,
    });
    return null;
  }

  // RPC returns TABLE(...); Supabase returns an array.
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) return null;

  return {
    documentType: row.resolved_document_type,
    version: row.resolved_version,
    isFallback: Boolean(row.is_fallback),
    systemPrompt: row.system_prompt,
    userPromptTemplate: row.user_prompt_template,
    sectionConstraints: (row.section_constraints ?? {}) as Record<string, unknown>,
    completionCriteria: (row.completion_criteria ?? {}) as Record<string, unknown>,
    outputSchema: (row.output_schema ?? {}) as Record<string, unknown>,
  };
}

// -----------------------------------------------------------------------------
// Template interpolation
// -----------------------------------------------------------------------------

/**
 * Minimal handlebars-ish interpolator for the user_prompt_template.
 *
 * Supports:
 *   {{var_name}}                       — simple substitution
 *   {{#if var_name}} ... {{/if}}       — block included only when the named
 *                                        variable is a non-empty string
 *
 * Runs the {{#if}} pass first so that {{var}} replacement inside a dropped
 * block doesn't leak the literal name into output. Variables that aren't in
 * the vars map resolve to empty string so a missing key degrades gracefully
 * instead of inserting a literal handlebars token.
 */
export function interpolateTemplate(
  template: string,
  vars: Record<string, string | undefined>
): string {
  let out = template;

  // {{#if var}} ... {{/if}} — non-greedy across newlines. If the var is
  // missing, empty, or whitespace-only, the block is dropped.
  out = out.replace(
    /\{\{#if\s+(\w+)\}\}([\s\S]*?)\{\{\/if\}\}/g,
    (_match, name: string, body: string) => {
      const v = vars[name];
      return v && v.trim().length > 0 ? body : '';
    }
  );

  // {{var}} — plain substitution. Unknown vars collapse to empty.
  out = out.replace(/\{\{(\w+)\}\}/g, (_match, name: string) => {
    return vars[name] ?? '';
  });

  return out;
}
