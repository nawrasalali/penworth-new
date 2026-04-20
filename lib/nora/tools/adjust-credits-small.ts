import { createServiceClient } from '@/lib/supabase/service';
import type { NoraToolDefinition } from '../types';
import {
  requireAuthorSurface,
  buildUndoExpiresAt,
  withUndoAffordance,
  isReverseCall,
} from './_tier2-helpers';

/**
 * Tier 2: adjust the user's credits balance by a small amount (±1000 max).
 *
 * === ATOMIC FORWARD ACTION ===
 *
 * This is the ONE Tier 2 tool that gets real multi-statement atomicity,
 * via the SECURITY DEFINER RPC nora_adjust_credits_and_record_undo. That
 * RPC wraps UPDATE profiles + INSERT credit_transactions + INSERT
 * nora_tool_undo_tokens in one implicit PLPGSQL transaction.
 *
 * Migration: nora_adjust_credits_and_record_undo_rpc
 *            nora_adjust_credits_rpc_revoke_public_execute
 *
 * On reverse calls (is_reverse=true), we still use the same RPC but with
 * negated delta. The RPC generates a NEW undo token for the reverse —
 * which would be recursively reversible. To prevent "undo the undo"
 * recursion, we DO NOT ship reverse-token rows back through insertUndoToken
 * (the RPC always inserts, so we need a different suppression path: on
 * reverse, we consume the emitted token immediately — design note 2 below).
 *
 * === RATE LIMIT ===
 *
 * Policy: max 1 adjust_credits_small call per user per 24h.
 * Implementation: count tool_call rows for this tool on any conversation
 * owned by the user within the 24h window. No new schema needed.
 *
 * Reverse calls count against the limit too — a reverse is still an
 * adjustment. If the user burns their forward on a wrong-delta mistake,
 * they get one undo in the window (via the matcher, which bypasses the
 * LLM tool-use path entirely and calls the tool with is_reverse=true),
 * but they cannot do a second adjustment for 24h.
 *
 * Exception to rate limit: reverse calls from the undo intent matcher
 * DO NOT count (is_reverse=true bypasses the check). The undo matcher
 * is driven by an explicit user intent in a 60-minute window — the rate
 * limit is there to prevent abuse of the adjustment tool itself, not to
 * block reverses. See check below.
 *
 * === REVERSE PAYLOAD SHAPE ===
 *
 * Forward delta +N → reverse payload { delta: -N, reason: 'reverse of ...' }.
 * Forward reason must be surfaced to the user so they can confirm what
 * they're undoing — design doc section 1 + 9.
 *
 * === SURFACE + TIER ===
 *
 * Author surface only. Guild/admin surfaces get a friendly reject.
 */
export const adjustCreditsSmallTool: NoraToolDefinition = {
  name: 'adjust_credits_small',
  tier: 2,
  description:
    "Adjust the user's credits balance by a small amount, positive or " +
    'negative (max 1000 in either direction). Use for support adjustments ' +
    'like refunds on a failed book generation or compensating for a ' +
    "service issue. Confirm the exact amount and reason with the user " +
    'BEFORE calling. Limited to 1 call per user per 24 hours. Available ' +
    'only on the author surface.',
  input_schema: {
    type: 'object',
    properties: {
      delta: {
        type: 'integer',
        description:
          'The signed credit adjustment. Positive = credit, negative = ' +
          'debit. Must be in the range [-1000, 1000] and non-zero. Always ' +
          'read this back to the user verbatim before calling the tool.',
        minimum: -1000,
        maximum: 1000,
      },
      reason: {
        type: 'string',
        description:
          'Short human-readable reason for the adjustment. Stored in the ' +
          'audit trail and shown to the user in the undo summary. Required.',
        minLength: 3,
        maxLength: 200,
      },
      is_reverse: {
        type: 'boolean',
        description:
          'Internal flag. NEVER set this yourself. The undo intent matcher ' +
          'sets it when dispatching a reverse.',
      },
    },
    required: ['delta', 'reason'],
  },
  handler: async (input, ctx) => {
    // Surface gate.
    const gate = requireAuthorSurface(ctx);
    if (gate) return gate;

    // Input validation (defence in depth — the RPC also validates).
    const delta = input.delta;
    const reason = input.reason;
    if (typeof delta !== 'number' || !Number.isInteger(delta)) {
      return {
        ok: false,
        failure_reason: 'invalid_delta_not_integer',
        message_for_user:
          'I need a whole-number credit amount (e.g. 500 or -250). ' +
          'Could you restate the adjustment?',
      };
    }
    if (delta === 0 || delta < -1000 || delta > 1000) {
      return {
        ok: false,
        failure_reason: 'delta_out_of_bounds',
        message_for_user:
          `I can only adjust by up to 1000 credits in one action. ` +
          `${delta} is out of that range — if you need a larger ` +
          "adjustment, I'll open a ticket for a support agent to handle.",
      };
    }
    if (typeof reason !== 'string' || reason.trim().length < 3) {
      return {
        ok: false,
        failure_reason: 'reason_required',
        message_for_user:
          'I need a short reason for the adjustment — even a few words ' +
          'is enough. What should I note as the reason?',
      };
    }

    const isReverse = isReverseCall(input);
    const admin = createServiceClient();

    // Rate limit: at most 1 forward adjust_credits_small per user per 24h.
    // Reverses bypass the check — the undo matcher's 60-minute window is
    // already the relevant rate limit for reverses.
    if (!isReverse) {
      // Count tool_call rows for this tool across all of the user's
      // conversations in the last 24 hours. Uses nora_conversations as
      // the join target because nora_turns doesn't carry user_id.
      const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

      // First, fetch user's conversation ids — simpler than a SQL join via
      // the PostgREST query builder and still indexed on nora_conversations
      // (user_id, created_at).
      const { data: convs, error: convsErr } = await admin
        .from('nora_conversations')
        .select('id')
        .eq('user_id', ctx.member.user_id)
        .gt('created_at', since);

      if (convsErr) {
        console.error('[nora:adjust_credits_small] rate-limit conv fetch:', convsErr);
        // Fail-closed — rate limit on a money-adjacent action is important
        // enough that if we can't verify, we don't proceed.
        return {
          ok: false,
          failure_reason: 'rate_limit_check_failed',
          message_for_user:
            "I couldn't confirm the rate limit on credit adjustments just " +
            'now. Let me open a ticket instead — a support agent can ' +
            'handle this directly.',
        };
      }

      const convIds = (convs ?? []).map((c) => c.id);
      if (convIds.length > 0) {
        const { count, error: countErr } = await admin
          .from('nora_turns')
          .select('id', { count: 'exact', head: true })
          .in('conversation_id', convIds)
          .eq('role', 'tool_call')
          .eq('tool_name', 'adjust_credits_small')
          .gt('created_at', since);

        if (countErr) {
          console.error('[nora:adjust_credits_small] rate-limit turn count:', countErr);
          return {
            ok: false,
            failure_reason: 'rate_limit_check_failed',
            message_for_user:
              "I couldn't confirm the rate limit on credit adjustments just " +
              'now. Let me open a ticket instead.',
          };
        }

        // count includes the tool_call row the turn route just inserted
        // FOR THIS invocation. So the threshold is >= 2: one prior + this one.
        if ((count ?? 0) >= 2) {
          return {
            ok: false,
            failure_reason: 'rate_limited_24h',
            message_for_user:
              "I've already made a credit adjustment on your account in " +
              "the last 24 hours — I can only do one per day. If you need " +
              "another adjustment, let me open a ticket for support to " +
              'handle it directly.',
          };
        }
      }
    }

    // Guard: we need a real forward_turn_id for the RPC.
    if (!ctx.forward_turn_id) {
      console.error('[nora:adjust_credits_small] missing forward_turn_id', {
        user_id: ctx.member.user_id,
        conversation_id: ctx.conversation_id,
      });
      return {
        ok: false,
        failure_reason: 'missing_forward_turn_id',
        message_for_user:
          "Something went wrong on my side tracking this adjustment. Let " +
          'me open a ticket so support can handle it.',
      };
    }

    // Atomic RPC call. Wraps UPDATE profiles + INSERT credit_transactions
    // + INSERT nora_tool_undo_tokens in one PLPGSQL transaction.
    const p_expires_at = buildUndoExpiresAt();
    const { data: rpcData, error: rpcErr } = await admin.rpc(
      'nora_adjust_credits_and_record_undo',
      {
        p_user_id: ctx.member.user_id,
        p_delta: delta,
        p_reason: reason.trim(),
        p_conversation_id: ctx.conversation_id,
        p_forward_turn_id: ctx.forward_turn_id,
        p_reverse_payload: {
          tool_name: 'adjust_credits_small',
          tool_input: {
            delta: -delta,
            reason: `reverse of: ${reason.trim()}`,
          },
        },
        p_expires_at,
      },
    );

    if (rpcErr) {
      console.error('[nora:adjust_credits_small] RPC failed:', {
        user_id: ctx.member.user_id,
        delta,
        code: rpcErr.code,
        message: rpcErr.message,
        details: rpcErr.details,
        hint: rpcErr.hint,
      });

      // SQLSTATE 22023 is the RPC's defence-in-depth validation rejection —
      // surface as a user-recoverable error. Any other code is an
      // unexpected DB-level failure.
      const friendly =
        rpcErr.code === '22023'
          ? 'The adjustment parameters were rejected by the database — ' +
            'the amount or expiry window is out of range. Let me open a ' +
            'ticket so support can handle this manually.'
          : "I hit a database error making that adjustment — your balance " +
            "hasn't been changed. Let me open a ticket.";
      return {
        ok: false,
        failure_reason: `rpc error: ${rpcErr.code} ${rpcErr.message}`,
        message_for_user: friendly,
      };
    }

    const env = rpcData as {
      success?: boolean;
      delta_applied?: number;
      previous_credits_balance?: number;
      new_credits_balance?: number;
      credit_transaction_id?: string;
      undo_token_id?: string;
      undo_expires_at?: string;
    } | null;

    if (!env?.success || typeof env.new_credits_balance !== 'number') {
      console.error('[nora:adjust_credits_small] unexpected RPC envelope:', env);
      return {
        ok: false,
        failure_reason: 'rpc_unexpected_envelope',
        message_for_user:
          "I got an unexpected response from the credits system. Let me " +
          'open a ticket.',
      };
    }

    // Reverse call: neutralize the undo token the RPC just emitted so
    // users can't recursively "undo the undo." We consume it by setting
    // consumed_at + consumed_by_turn_id to THIS reverse's tool_call row
    // (ctx.forward_turn_id). Both fields populated → satisfies the
    // nora_tool_undo_tokens pair-or-neither CHECK.
    //
    // Semantically correct: the token for the reverse action is "consumed
    // by the reverse itself", which is a no-op consumption — the reverse
    // already completed, no further reverse is possible.
    //
    // If this UPDATE fails, worst case is the user has a 60-minute window
    // to undo their undo, which just reverts to the state before the
    // original forward. Not a data-integrity bug, just a mild UX weirdness
    // that's strictly better than blocking the reverse entirely. Log but
    // don't fail.
    if (isReverse && env.undo_token_id) {
      const { error: consumeErr } = await admin
        .from('nora_tool_undo_tokens')
        .update({
          consumed_at: new Date().toISOString(),
          consumed_by_turn_id: ctx.forward_turn_id,
        })
        .eq('id', env.undo_token_id);
      if (consumeErr) {
        console.error('[nora:adjust_credits_small] reverse-token self-consume failed:', {
          undo_token_id: env.undo_token_id,
          code: consumeErr.code,
          message: consumeErr.message,
        });
        // Deliberately non-fatal — see comment above.
      }
    }

    // User-facing message
    const magnitude = Math.abs(delta);
    const direction = delta > 0 ? 'added' : 'removed';
    const baseMessage = isReverse
      ? `I've reversed the previous adjustment. Your balance is back to ` +
        `${env.new_credits_balance.toLocaleString()} credits.`
      : `I've ${direction} ${magnitude.toLocaleString()} credits ` +
        `(reason: ${reason.trim()}). Your new balance is ` +
        `${env.new_credits_balance.toLocaleString()} credits.`;

    return {
      ok: true,
      message_for_user: withUndoAffordance(baseMessage, isReverse),
      data: {
        delta_applied: env.delta_applied,
        previous_credits_balance: env.previous_credits_balance,
        new_credits_balance: env.new_credits_balance,
        credit_transaction_id: env.credit_transaction_id,
        undo_token_id: env.undo_token_id,
        undo_expires_at: env.undo_expires_at,
        is_reverse: isReverse,
      },
    };
  },
};
