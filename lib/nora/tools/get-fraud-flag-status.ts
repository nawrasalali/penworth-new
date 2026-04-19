import { createServiceClient } from '@/lib/supabase/service';
import type { NoraToolDefinition } from '../types';

/**
 * Tier 1: return open fraud flags for a Guildmember.
 *
 * A15 amendment: same join pattern as check_payout_status — user_id →
 * guildmember_id first, then guild_fraud_flags. Non-Guildmembers get a
 * clean ok:false.
 *
 * Returns only OPEN flags (status='open'). Closed flags (dismissed,
 * confirmed, resolved) are not surfaced to the user — if a flag has
 * been investigated and resolved, there's no useful signal in telling
 * the user about it. If anything, showing dismissed flags would
 * suggest past suspicion when the T&S team has already cleared it.
 *
 * Sensitive data is filtered: the `payload` JSONB column can contain
 * investigator notes, IP addresses, and correlated account IDs. This
 * tool returns only flag_type, severity, and created_at — never the
 * raw payload. The prompt's BOUNDARIES section is explicit about not
 * sharing one user's info with another, and fraud payloads often
 * reference other accounts.
 *
 * Read-only, safe to call without user confirmation.
 */
export const getFraudFlagStatusTool: NoraToolDefinition = {
  name: 'get_fraud_flag_status',
  tier: 1,
  description:
    'Return any open fraud flags on the current user\'s Guild account. ' +
    'Use when the user asks why their payout is held, why their ' +
    'account is restricted, or references a suspected fraud signal. ' +
    'Non-Guildmembers have no applicable flags. Investigator notes are ' +
    'never exposed — only flag type and severity.',
  input_schema: {
    type: 'object',
    properties: {},
    required: [],
  },
  handler: async (_input, ctx) => {
    if (!ctx.member.guildmember_id) {
      return {
        ok: false,
        failure_reason: 'not_a_guildmember',
        message_for_user:
          'Fraud flags only apply to Penworth Guild accounts. Your ' +
          'account is not a Guild account, so there are no flags to ' +
          'check.',
      };
    }

    const admin = createServiceClient();

    // Deliberately narrow column list: payload withheld. See rationale above.
    const { data, error } = await admin
      .from('guild_fraud_flags')
      .select('id, flag_type, severity, status, created_at')
      .eq('guildmember_id', ctx.member.guildmember_id)
      .eq('status', 'open')
      .order('created_at', { ascending: false })
      .limit(10);

    if (error) {
      console.error('[nora:get_fraud_flag_status] query error:', error);
      return {
        ok: false,
        failure_reason: `fraud_flags query error: ${error.message}`,
        message_for_user:
          'I hit an error reading your account flag state. Let me open ' +
          'a ticket.',
      };
    }

    if (!data || data.length === 0) {
      return {
        ok: true,
        message_for_user:
          'No open fraud flags on your Guild account. Your account is ' +
          'in good standing from a trust-and-safety perspective.',
        data: { open_flags: [], count: 0 },
      };
    }

    // If ANY flag is critical or high severity, surface it directly —
    // the user is owed a straight answer.
    const hasCritical = data.some((f) => f.severity === 'critical');
    const hasHigh = data.some((f) => f.severity === 'high');
    const summary = hasCritical
      ? `You have ${data.length} open flag${data.length > 1 ? 's' : ''} on ` +
        'your account, at least one of which is critical. Our Trust & ' +
        'Safety team is reviewing it. You will get an email the moment ' +
        'there is a decision.'
      : hasHigh
      ? `You have ${data.length} open flag${data.length > 1 ? 's' : ''} on ` +
        'your account. Our Trust & Safety team reviews these in the ' +
        'order they come in, usually within a few business days.'
      : `You have ${data.length} open flag${data.length > 1 ? 's' : ''} on ` +
        'your account — nothing severe, but they are in the queue for ' +
        'review.';

    return {
      ok: true,
      message_for_user: summary,
      data: { open_flags: data, count: data.length },
    };
  },
};
