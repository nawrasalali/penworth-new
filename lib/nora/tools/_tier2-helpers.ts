import type { NoraToolContext, NoraToolResult } from '../types';
import { createServiceClient } from '@/lib/supabase/service';

/**
 * Shared helpers for Tier 2 tools.
 *
 * Extracted to prevent drift across change_email / adjust_credits_small /
 * pause_subscription. Every decision that must be identical across all
 * three tools lives here; tool-specific logic lives in each tool file.
 *
 * Design doc: docs/phase-2.5/tier-2-phase-b-design.md
 */

// -----------------------------------------------------------------------------
// Surface gate — section 3 of design doc
// -----------------------------------------------------------------------------

/**
 * Tier 2 tools are author-surface only on first ship (policy decision in
 * Phase A handoff). Call at the top of every Tier 2 handler before doing
 * anything else. Returning the NoraToolResult directly makes the guard a
 * drop-in early return.
 *
 * Returns null if the surface is allowed; returns a failure-shaped
 * NoraToolResult if not. Callers handle the null-check:
 *
 *     const gate = requireAuthorSurface(ctx);
 *     if (gate) return gate;
 *
 * Keeps the happy path as the main branch of the handler.
 */
export function requireAuthorSurface(ctx: NoraToolContext): NoraToolResult | null {
  if (ctx.member.surface === 'author') return null;
  return {
    ok: false,
    failure_reason: 'tier_2_not_available_on_surface',
    message_for_user:
      `This action isn't available from the ${ctx.member.surface} surface — ` +
      'it lives on the author dashboard. Sign in to the author site to use it.',
  };
}

// -----------------------------------------------------------------------------
// Undo token duration — section 1 of design doc
// -----------------------------------------------------------------------------

/**
 * Fixed 60-minute undo window. Single source of truth so every tool ships
 * with the same window and the RPC's defence-in-depth expires_at guard
 * (<= now() + 24h) never becomes a surprise.
 */
export const UNDO_WINDOW_MS = 60 * 60 * 1000;

/**
 * ISO-string expiry for a new undo token, computed from `Date.now()` at
 * call time. Tools pass this verbatim to the RPC (adjust_credits_small)
 * or to the direct INSERT path (change_email, pause_subscription).
 */
export function buildUndoExpiresAt(): string {
  return new Date(Date.now() + UNDO_WINDOW_MS).toISOString();
}

// -----------------------------------------------------------------------------
// Undo-token INSERT helper for external-API tools — section 4 of design doc
// -----------------------------------------------------------------------------

/**
 * Shape of a reverse payload stored in nora_tool_undo_tokens.reverse_payload.
 * Must match the CHECK constraint on that column (object with tool_name +
 * tool_input keys). Keeping the type explicit here means a tool can't
 * accidentally construct a reverse_payload that the DB would reject —
 * TypeScript catches it at compile time.
 */
export interface ReversePayload {
  tool_name: string;
  tool_input: Record<string, unknown>;
}

/**
 * Arguments for insertUndoToken. Extracted into its own shape so tool
 * files don't misremember the column list.
 */
export interface InsertUndoTokenArgs {
  user_id: string;
  conversation_id: string;
  forward_turn_id: string;
  forward_summary: string;
  tool_name: string;
  reverse_payload: ReversePayload;
}

/**
 * Best-effort undo-token INSERT for external-API tools (change_email,
 * pause_subscription). NOT used by adjust_credits_small — that tool uses
 * the atomic RPC nora_adjust_credits_and_record_undo instead.
 *
 * === FAILURE SEMANTICS ===
 *
 * This is deliberately best-effort. The external action (GoTrue email
 * update, Stripe pause) has already succeeded and cannot be reversed
 * from this side of the wire. If the token INSERT fails, the forward
 * action still sticks — the user keeps the effect, they just lose the
 * undo window for that one call.
 *
 * On failure: log a [nora:undo-token-insert-failed] critical error with
 * enough detail for ops to manually create a token after the fact if
 * needed. Do NOT throw — the caller has already told the user "done".
 *
 * === SURFACE CONSTRAINT ===
 *
 * Tier 2 is author-surface only; the surface column on the token is
 * hardcoded to 'author'. If we ever extend Tier 2 to other surfaces,
 * this helper needs a `surface: NoraSurface` parameter.
 *
 * @returns undo_token_id if INSERT succeeded, null if it failed.
 */
export async function insertUndoToken(args: InsertUndoTokenArgs): Promise<string | null> {
  const admin = createServiceClient();
  const expires_at = buildUndoExpiresAt();

  const { data, error } = await admin
    .from('nora_tool_undo_tokens')
    .insert({
      user_id: args.user_id,
      conversation_id: args.conversation_id,
      forward_turn_id: args.forward_turn_id,
      surface: 'author',
      tool_name: args.tool_name,
      forward_summary: args.forward_summary,
      reverse_payload: args.reverse_payload,
      expires_at,
    })
    .select('id')
    .maybeSingle<{ id: string }>();

  if (error || !data) {
    console.error('[nora:undo-token-insert-failed]', {
      tool_name: args.tool_name,
      user_id: args.user_id,
      conversation_id: args.conversation_id,
      forward_turn_id: args.forward_turn_id,
      error: error ? { code: error.code, message: error.message } : 'null_row_returned',
    });
    return null;
  }

  return data.id;
}

// -----------------------------------------------------------------------------
// Undo affordance message — section 9 of design doc
// -----------------------------------------------------------------------------

/**
 * Plain-text undo affordance appended to every Tier 2 forward tool's
 * message_for_user. Consistent phrasing across all three tools means Nora's
 * user-facing language stays uniform — users learn the pattern once.
 *
 * Keep short — this is appended to tool-specific copy, not a standalone
 * message. No UI button in MVP (Phase 2.6 scope).
 */
export const UNDO_AFFORDANCE =
  ' You have 60 minutes to undo this — just say "undo" and I\'ll reverse it.';

/**
 * Convenience: append UNDO_AFFORDANCE to a forward-action message iff the
 * call wasn't made as part of a reverse (is_reverse flag). Reverse calls
 * should not advertise an undo affordance because we deliberately do not
 * emit a nested undo token for them.
 */
export function withUndoAffordance(message: string, isReverse: boolean): string {
  return isReverse ? message : message + UNDO_AFFORDANCE;
}

// -----------------------------------------------------------------------------
// is_reverse flag helper — section 7 of design doc
// -----------------------------------------------------------------------------

/**
 * Reads the is_reverse flag from tool input. The undo intent matcher sets
 * this to true when dispatching the reverse payload, so the reverse-called
 * handler can skip the undo-token INSERT step. Returns false if missing or
 * non-boolean — tools should behave as forward calls by default.
 */
export function isReverseCall(input: Record<string, unknown>): boolean {
  return input.is_reverse === true;
}
