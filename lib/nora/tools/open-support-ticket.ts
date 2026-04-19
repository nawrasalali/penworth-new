import { createAdminClient } from '@/lib/supabase/server';
import type { NoraToolDefinition } from '../types';

/**
 * Tier 1: escalate to a human via nora_support_tickets.
 *
 * A15 amendment: the prod schema has strict CHECK constraints and NOT
 * NULL columns. Handler MUST supply:
 *   - subject                       (NOT NULL)
 *   - initial_description           (NOT NULL)
 *   - nora_diagnosis                (NOT NULL) — pulled from matched
 *                                    pattern if present, else a brief
 *                                    "no pattern match" note
 *   - surface                       CHECK ∈ (author|guild|store|admin)
 *   - category                      CHECK ∈ (billing, payout,
 *                                    commission, account, technical,
 *                                    content_issue, fraud_dispute,
 *                                    legal, other)
 *   - priority                      CHECK ∈ (low, normal, high, urgent)
 *   - created_from_conversation_id  NOT NULL FK
 *
 * ticket_number (format PW-YYMM-NNNN) is auto-filled by a trigger on
 * INSERT per the prod schema — we don't compute it here.
 */

const ALLOWED_CATEGORIES = [
  'billing',
  'payout',
  'commission',
  'account',
  'technical',
  'content_issue',
  'fraud_dispute',
  'legal',
  'other',
] as const;
type Category = (typeof ALLOWED_CATEGORIES)[number];

const ALLOWED_PRIORITIES = ['low', 'normal', 'high', 'urgent'] as const;
type Priority = (typeof ALLOWED_PRIORITIES)[number];

export const openSupportTicketTool: NoraToolDefinition = {
  name: 'open_support_ticket',
  tier: 1,
  description:
    'Escalate to a human admin by opening a support ticket. Use when ' +
    'you have exhausted pattern-based resolution, the user asks for a ' +
    'human, or any escalation rule fires. Provide a crisp subject and ' +
    'the user\'s description in their own words. Choose the narrowest ' +
    'correct category. Use priority=urgent only for safety or critical ' +
    'outages, high for blocked workflows, normal for everything else.',
  input_schema: {
    type: 'object',
    properties: {
      subject: {
        type: 'string',
        description:
          'One-line summary of the issue, written in third person. ' +
          'e.g. "Payout for March not received".',
        minLength: 4,
        maxLength: 200,
      },
      initial_description: {
        type: 'string',
        description:
          'What the user said about their problem, in their own words. ' +
          'Quote or paraphrase — do not editorialise.',
        minLength: 10,
      },
      category: {
        type: 'string',
        enum: [...ALLOWED_CATEGORIES],
        description: 'Narrowest correct category.',
      },
      priority: {
        type: 'string',
        enum: [...ALLOWED_PRIORITIES],
        description:
          'low | normal | high | urgent. Default normal unless there is ' +
          'a clear reason otherwise.',
      },
    },
    required: ['subject', 'initial_description', 'category'],
  },
  handler: async (input, ctx) => {
    const subject = String(input.subject ?? '').trim();
    const description = String(input.initial_description ?? '').trim();
    const category = String(input.category ?? '') as Category;
    const priority = (
      ALLOWED_PRIORITIES.includes(input.priority as Priority)
        ? input.priority
        : 'normal'
    ) as Priority;

    // Defensive validation — Anthropic's JSON schema enforcement is
    // good but not ironclad for enum fields in tool_use blocks.
    if (subject.length < 4 || subject.length > 200) {
      return {
        ok: false,
        failure_reason: 'invalid_subject',
        message_for_user:
          'I was not able to draft that ticket — let me try again with ' +
          'a clearer subject line.',
      };
    }
    if (description.length < 10) {
      return {
        ok: false,
        failure_reason: 'invalid_description',
        message_for_user:
          'I need a little more detail before I open a ticket. Can you ' +
          'say a bit more about what happened?',
      };
    }
    if (!ALLOWED_CATEGORIES.includes(category)) {
      return {
        ok: false,
        failure_reason: 'invalid_category',
        message_for_user:
          'I ran into an internal issue categorising that ticket. Let me ' +
          'try again in a moment.',
      };
    }

    // Build nora_diagnosis from the matched pattern + context snapshot.
    const diagnosis = ctx.matched_pattern
      ? `Pattern match: ${ctx.matched_pattern.pattern_slug}.\n` +
        (ctx.matched_pattern.resolution_playbook
          ? `Attempted playbook: ${ctx.matched_pattern.resolution_playbook}`
          : 'Playbook not yet executed.')
      : 'No known-issue pattern matched. Escalating without prior ' +
        'automated diagnosis.';

    const admin = createAdminClient();

    const { data, error } = await admin
      .from('nora_support_tickets')
      .insert({
        user_id: ctx.member.user_id,
        subject,
        initial_description: description,
        nora_diagnosis: diagnosis,
        surface: ctx.member.surface,
        category,
        priority,
        created_from_conversation_id: ctx.conversation_id,
      })
      .select('id, ticket_number, created_at')
      .single();

    if (error || !data) {
      console.error('[nora:open_support_ticket] insert error:', error);
      return {
        ok: false,
        failure_reason: `ticket insert error: ${error?.message ?? 'no row returned'}`,
        message_for_user:
          'I could not open a ticket just now — our tracking system ' +
          'returned an error. Please email support@penworth.ai directly ' +
          'and reference your conversation.',
      };
    }

    const prettyExpectation =
      priority === 'urgent'
        ? 'within a few hours'
        : priority === 'high'
        ? 'within 8 hours'
        : 'within 24 hours';

    return {
      ok: true,
      message_for_user:
        `I have opened ticket ${data.ticket_number} for our admin team. ` +
        `You should hear back ${prettyExpectation}. You will get an email ` +
        'at the moment they reply.',
      data: {
        ticket_id: data.id,
        ticket_number: data.ticket_number,
        priority,
        category,
        created_at: data.created_at,
      },
    };
  },
};
