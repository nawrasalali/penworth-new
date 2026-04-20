import { createServiceClient } from '@/lib/supabase/service';
import { getStripeOrError } from '@/lib/stripe/client';
import type { NoraToolDefinition } from '../types';
import {
  requireAuthorSurface,
  insertUndoToken,
  withUndoAffordance,
  isReverseCall,
} from './_tier2-helpers';

/**
 * Tier 2: pause the user's Stripe subscription billing.
 *
 * === FORWARD / REVERSE IN ONE TOOL ===
 *
 * Single tool handles both pause and resume. The is_reverse flag (set by
 * the undo intent matcher) + the input.resume flag distinguish:
 *
 *   Forward pause:   input = {},                      is_reverse=false
 *                    → Stripe pause_collection: { behavior: 'void' }
 *                    → emit undo token { resume: true }
 *
 *   Reverse (undo):  input = { resume: true },        is_reverse=true
 *                    → Stripe pause_collection: null
 *                    → NO undo token emitted
 *
 * User-initiated resume (without an undo): not in Tier 2 scope. If a user
 * just asks "can you unpause my subscription?" outside a 60-minute undo
 * window, Nora would call pause_subscription({ resume: true }) WITHOUT
 * is_reverse — the handler treats this as a forward action and emits an
 * undo token { resume: false }. That works too: symmetry is intentional.
 *
 * === PAYMENT_STATUS ===
 *
 * Per Phase B addendum in design doc: we do NOT touch profiles.payment_status.
 * The profiles CHECK only permits (active, past_due, canceled) — no 'paused'.
 * Stripe's pause_collection is the authoritative record. Adding a 'paused'
 * enum state would invite drift-class bugs between Stripe's view and our
 * cached view. If a future product surface needs 'is subscription paused'
 * visible in the dashboard, query it from Stripe via check_subscription_status
 * (Tier 1, already exists).
 *
 * === LOOKUP PATH ===
 *
 * Stripe subscription lives on organizations.stripe_subscription_id, reached
 * via org_members. Same lookup pattern as checkSubscriptionStatusTool. If the
 * user has no active Stripe subscription, the tool reports this rather than
 * silently no-oping.
 *
 * === SURFACE ===
 *
 * Author surface only. Guild/admin get a friendly reject.
 */
export const pauseSubscriptionTool: NoraToolDefinition = {
  name: 'pause_subscription',
  tier: 2,
  description:
    "Pause or resume the user's subscription billing at Stripe. Use " +
    "'resume: true' to resume a previously paused subscription. Requires " +
    'explicit user confirmation ("I want to pause my subscription") — ' +
    'never call this speculatively. Billing stops/starts immediately; ' +
    'the user keeps access either way in this MVP iteration. Author ' +
    'surface only.',
  input_schema: {
    type: 'object',
    properties: {
      resume: {
        type: 'boolean',
        description:
          'If true, resume a previously paused subscription. If false or ' +
          "omitted, pause the active subscription. Set by the user's " +
          'explicit request or by the undo intent matcher (which pairs ' +
          'it with is_reverse=true).',
      },
      is_reverse: {
        type: 'boolean',
        description:
          'Internal flag. NEVER set this yourself. The undo intent matcher ' +
          'sets it when reversing a prior pause_subscription call.',
      },
    },
    required: [],
  },
  handler: async (input, ctx) => {
    // Surface gate.
    const gate = requireAuthorSurface(ctx);
    if (gate) return gate;

    const isReverse = isReverseCall(input);
    const resume = input.resume === true;
    const intent: 'pause' | 'resume' = resume ? 'resume' : 'pause';
    const admin = createServiceClient();

    // Look up user's Stripe subscription via org_members → organizations.
    const { data: memberships, error: membershipErr } = await admin
      .from('org_members')
      .select(
        'organizations(id, name, stripe_subscription_id, subscription_tier)',
      )
      .eq('user_id', ctx.member.user_id)
      .limit(1);

    if (membershipErr) {
      console.error('[nora:pause_subscription] org_members:', membershipErr);
      return {
        ok: false,
        failure_reason: `org_members error: ${membershipErr.message}`,
        message_for_user:
          'I hit an error reading your subscription details. Let me open ' +
          'a ticket.',
      };
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const org = (memberships?.[0]?.organizations as any) ?? null;
    const subscriptionId: string | null = org?.stripe_subscription_id ?? null;

    if (!subscriptionId) {
      return {
        ok: false,
        failure_reason: 'no_active_subscription',
        message_for_user:
          "You don't have an active paid subscription to " +
          (resume ? 'resume' : 'pause') +
          '. If you recently subscribed and this looks wrong, let me ' +
          'open a ticket.',
      };
    }

    // Execute Stripe pause/resume.
    const stripeResult = getStripeOrError();
    if ('error' in stripeResult) {
      return {
        ok: false,
        failure_reason: 'stripe_not_configured',
        message_for_user:
          'Billing is temporarily unavailable — I cannot reach Stripe to ' +
          `${intent} your subscription. Let me open a ticket.`,
      };
    }

    try {
      await stripeResult.stripe.subscriptions.update(subscriptionId, {
        pause_collection: resume ? null : { behavior: 'void' },
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[nora:pause_subscription] stripe update:', {
        subscription_id_last4: subscriptionId.slice(-4),
        intent,
        error: msg,
      });
      return {
        ok: false,
        failure_reason: `stripe update error: ${msg}`,
        message_for_user:
          `I couldn't ${intent} your subscription at Stripe — the billing ` +
          'system returned an error. Nothing has changed on your account. ' +
          'Let me open a ticket so someone can look at it directly.',
      };
    }

    // Forward-only: emit an undo token. Skipped on reverse.
    let undoTokenId: string | null = null;
    if (!isReverse) {
      if (!ctx.forward_turn_id) {
        console.error('[nora:undo-token-skipped-no-turn-id]', {
          tool_name: 'pause_subscription',
          user_id: ctx.member.user_id,
          conversation_id: ctx.conversation_id,
        });
      } else {
        // Reverse input is the opposite intent: forward pause → reverse
        // resume, forward resume → reverse pause. The is_reverse flag
        // itself is supplied by the matcher, not stored in reverse_payload.
        undoTokenId = await insertUndoToken({
          user_id: ctx.member.user_id,
          conversation_id: ctx.conversation_id,
          forward_turn_id: ctx.forward_turn_id,
          forward_summary: resume
            ? 'Resumed subscription billing'
            : 'Paused subscription billing',
          tool_name: 'pause_subscription',
          reverse_payload: {
            tool_name: 'pause_subscription',
            tool_input: { resume: !resume },
          },
        });
      }
    }

    // User-facing message
    let baseMessage: string;
    if (isReverse) {
      baseMessage = resume
        ? "I've reverted the pause — your subscription is billing " +
          'normally again.'
        : "I've reverted the resume — your subscription is paused again.";
    } else if (resume) {
      baseMessage =
        "I've resumed your subscription — Stripe will bill you on your " +
        'usual schedule from now on.';
    } else {
      baseMessage =
        "I've paused your subscription — Stripe has stopped billing " +
        'until you resume. You keep access in the meantime.';
    }

    return {
      ok: true,
      message_for_user: withUndoAffordance(baseMessage, isReverse),
      data: {
        intent,
        is_reverse: isReverse,
        subscription_id_last4: subscriptionId.slice(-4),
        undo_token_id: undoTokenId,
        org_name: org.name,
      },
    };
  },
};
