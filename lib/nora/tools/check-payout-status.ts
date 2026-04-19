import { createAdminClient } from '@/lib/supabase/server';
import type { NoraToolDefinition } from '../types';

/**
 * Tier 1: return the 3 most recent payouts for a Guildmember.
 *
 * A15 amendment: join user_id → guildmember_id via guild_members FIRST.
 * guild_payouts.guildmember_id is the FK (not user_id). Non-Guildmembers
 * get a clean ok:false with an explanatory message rather than an empty
 * array — Nora's prompt wants "I don't have that information" over
 * fake-silence.
 *
 * Read-only, safe to call without user confirmation. Use when the user
 * asks about payout timing, amounts, or status.
 */
export const checkPayoutStatusTool: NoraToolDefinition = {
  name: 'check_payout_status',
  tier: 1,
  description:
    'Return the 3 most recent payouts for the current user (must be a ' +
    'Guildmember). Includes status, amount, method, sent/confirmed ' +
    'timestamps. Use when the user asks about their payout.',
  input_schema: {
    type: 'object',
    properties: {},
    required: [],
  },
  handler: async (_input, ctx) => {
    const admin = createAdminClient();

    // Non-Guildmembers have no payouts. Resolve via context rather than
    // another DB hit where possible.
    if (!ctx.member.guildmember_id) {
      return {
        ok: false,
        failure_reason: 'not_a_guildmember',
        message_for_user:
          'Payouts are only for Penworth Guild members. Your account ' +
          'does not have Guild membership on it.',
      };
    }

    const { data, error } = await admin
      .from('guild_payouts')
      .select(
        'id, payout_month, amount_usd, net_amount_usd, fee_usd, method, ' +
          'destination_masked, status, reference_number, approved_at, ' +
          'sent_at, confirmed_at, failure_reason, created_at',
      )
      .eq('guildmember_id', ctx.member.guildmember_id)
      .order('payout_month', { ascending: false })
      .limit(3);

    if (error) {
      console.error('[nora:check_payout_status] query error:', error);
      return {
        ok: false,
        failure_reason: `payouts query error: ${error.message}`,
        message_for_user:
          'I hit an error reading your payout history. Let me open a ticket.',
      };
    }

    if (!data || data.length === 0) {
      return {
        ok: true,
        message_for_user:
          'No payouts have been issued on your account yet. Once you ' +
          'accrue retained commission, a payout will be queued for the ' +
          'monthly run.',
        data: { payouts: [] },
      };
    }

    return {
      ok: true,
      message_for_user: `Found ${data.length} recent payout${data.length > 1 ? 's' : ''}.`,
      data: { payouts: data },
    };
  },
};
