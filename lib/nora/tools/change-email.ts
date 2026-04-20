import { createServiceClient } from '@/lib/supabase/service';
import type { NoraToolDefinition } from '../types';
import {
  requireAuthorSurface,
  insertUndoToken,
  withUndoAffordance,
  isReverseCall,
} from './_tier2-helpers';

/**
 * Tier 2: change the user's sign-in email address.
 *
 * === FORWARD ACTION ===
 *
 * Uses admin.auth.admin.updateUserById — GoTrue owns the email-change
 * flow, including sending the confirmation-required email to the NEW
 * address. We do NOT directly UPDATE auth.users; that would bypass
 * GoTrue's email confirmation safety net.
 *
 * === UNDO SEMANTICS ===
 *
 * Reverse payload stores the OLD email. If the user says "undo" within
 * 60 minutes, the undo intent matcher invokes this same tool with
 * is_reverse=true and new_email=<old_email>, which flips the user back.
 *
 * GoTrue fires a new confirmation email each time the email changes,
 * including on the reverse. The user will see TWO confirmation emails
 * (once for forward, once for reverse) in their inbox if they undo —
 * this is GoTrue's contract, not our choice. Acceptable: the safety
 * tradeoff of email-confirmation beats the UX annoyance of an extra mail.
 *
 * === SURFACE + TIER ===
 *
 * Author surface only. Guild/admin surfaces return a friendly reject via
 * the requireAuthorSurface helper.
 *
 * === RACE WITH CONFIRMATION ===
 *
 * GoTrue's updateUserById sets email_change to the new address and
 * email_change_token to a fresh token; the email isn't actually changed
 * on auth.users.email until the user clicks the confirmation link. This
 * tool's forward returns success as soon as the confirmation mail is
 * queued — the user's reported email in ctx.member.email will lag until
 * they confirm. That's GoTrue's contract; we surface the two-step flow in
 * message_for_user so the user knows to check their inbox.
 *
 * === NOT HANDLED (deferred to Tier 3 / manual) ===
 *
 * - Changing the email of an account that has an ACTIVE stripe_customer
 *   (would need a corresponding stripe.customers.update call). Nawras
 *   decided this is a rare case for Tier 2 and the support agent can
 *   follow up manually. For MVP, change_email updates auth only; Stripe
 *   records keep the old billing email.
 * - Email changes on Guild surface (out of scope for Tier 2).
 */
export const changeEmailTool: NoraToolDefinition = {
  name: 'change_email',
  tier: 2,
  description:
    "Update the user's sign-in email address. The user MUST explicitly " +
    'confirm the new address before you call this tool. GoTrue sends a ' +
    'confirmation email to the new address — the change only takes ' +
    'effect when the user clicks the link. Available only on the author ' +
    'surface.',
  input_schema: {
    type: 'object',
    properties: {
      new_email: {
        type: 'string',
        format: 'email',
        description:
          'The new email address to change to. Must be a valid email ' +
          "format. Always read this back to the user verbatim before " +
          'calling the tool.',
      },
      is_reverse: {
        type: 'boolean',
        description:
          'Internal flag used by the undo intent matcher when dispatching ' +
          "a reverse. NEVER set this yourself — it's only populated when " +
          'the undo matcher calls this tool with the old email.',
      },
    },
    required: ['new_email'],
  },
  handler: async (input, ctx) => {
    // Surface gate — identical across all Tier 2 tools.
    const gate = requireAuthorSurface(ctx);
    if (gate) return gate;

    const new_email = input.new_email;
    if (typeof new_email !== 'string' || !new_email.includes('@')) {
      return {
        ok: false,
        failure_reason: 'invalid_new_email',
        message_for_user:
          "That doesn't look like a valid email address. Could you share " +
          'the full address you want to change to?',
      };
    }

    const old_email = ctx.member.email;
    if (new_email.toLowerCase() === old_email.toLowerCase()) {
      return {
        ok: false,
        failure_reason: 'new_email_equals_old',
        message_for_user:
          `That's already the email on your account — no change needed.`,
      };
    }

    const isReverse = isReverseCall(input);
    const admin = createServiceClient();

    // Forward action: ask GoTrue to begin the email-change flow.
    const { error: updateErr } = await admin.auth.admin.updateUserById(
      ctx.member.user_id,
      { email: new_email },
    );

    if (updateErr) {
      console.error('[nora:change_email] updateUserById failed:', {
        user_id: ctx.member.user_id,
        code: updateErr.code,
        message: updateErr.message,
      });
      return {
        ok: false,
        failure_reason: `updateUserById error: ${updateErr.message}`,
        message_for_user:
          "I wasn't able to start the email change just now — the auth " +
          'system returned an error. Let me open a ticket so someone can ' +
          'look into it.',
      };
    }

    // Forward-only: emit an undo token. Skipped on reverse calls so we
    // don't recursively stack undo windows (design doc section 7).
    let undoTokenId: string | null = null;
    if (!isReverse) {
      if (!ctx.forward_turn_id) {
        // Turn route failed to insert the tool_call row before calling
        // us, so there's no valid FK target for nora_tool_undo_tokens.
        // Forward action already succeeded (email change in flight at
        // GoTrue). Log loudly and skip the undo token — user loses undo
        // for this call. Same failure contract as insertUndoToken's log.
        console.error('[nora:undo-token-skipped-no-turn-id]', {
          tool_name: 'change_email',
          user_id: ctx.member.user_id,
          conversation_id: ctx.conversation_id,
        });
      } else {
        undoTokenId = await insertUndoToken({
          user_id: ctx.member.user_id,
          conversation_id: ctx.conversation_id,
          forward_turn_id: ctx.forward_turn_id,
          forward_summary: `Changed email from ${old_email} to ${new_email}`,
          tool_name: 'change_email',
          reverse_payload: {
            tool_name: 'change_email',
            tool_input: { new_email: old_email },
          },
        });
      }
    }

    const baseMessage =
      isReverse
        ? `I've reverted your email address back to ${new_email}. GoTrue ` +
          `sent a confirmation link to ${new_email} — click it to finish ` +
          'the revert.'
        : `I've started changing your email to ${new_email}. GoTrue sent ` +
          `a confirmation link to ${new_email} — the change takes effect ` +
          'once you click it. Check your spam folder if you do not see it.';

    return {
      ok: true,
      message_for_user: withUndoAffordance(baseMessage, isReverse),
      data: {
        old_email,
        new_email,
        undo_token_id: undoTokenId,
        is_reverse: isReverse,
      },
    };
  },
};
