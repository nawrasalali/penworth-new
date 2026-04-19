import { createClient } from '@supabase/supabase-js';
import { createAdminClient } from '@/lib/supabase/server';
import type { NoraToolDefinition } from '../types';

/**
 * Tier 1: resend the email-confirmation link for an unconfirmed account.
 *
 * A15 amendment: MUST check email_confirmed_at on the auth.users row
 * first (admin API). If already confirmed, return a diagnostic
 * ok:false with a message Nora can relay — no point sending a
 * confirmation email for an already-confirmed account.
 *
 * Implementation note on which auth method to use:
 *   - admin.auth.admin.generateLink({type:'signup'}) — REJECTED: this
 *     variant requires `password` because it's designed to create a
 *     fresh signup, not resend for an existing row. Would require us
 *     to somehow pass a password we don't own.
 *   - auth.resend({type:'signup', email}) — CHOSEN: this is the
 *     public resend endpoint. Works with any Supabase client keyed by
 *     URL + anon key (no session needed — the endpoint is meant for
 *     users who cannot sign in yet). Triggers the standard
 *     confirmation template.
 *
 * We do the admin-check on the server client (service role) and then
 * issue the resend via a dedicated anon-keyed client — two clients,
 * two different privilege levels, clean separation.
 */
export const resendEmailConfirmationTool: NoraToolDefinition = {
  name: 'resend_email_confirmation',
  tier: 1,
  description:
    'Resend the signup confirmation email to an unconfirmed account. ' +
    'Use when the user says they never received or cannot find their ' +
    'signup confirmation email. Always confirm with the user before ' +
    'calling. This tool automatically refuses if the account is already ' +
    'confirmed.',
  input_schema: {
    type: 'object',
    properties: {},
    required: [],
  },
  handler: async (_input, ctx) => {
    const admin = createAdminClient();
    const email = ctx.member.email;
    const user_id = ctx.member.user_id;

    // Check confirmation state via admin API — source of truth is
    // auth.users.email_confirmed_at, which only the admin client can read.
    const { data: userData, error: getUserErr } =
      await admin.auth.admin.getUserById(user_id);

    if (getUserErr || !userData?.user) {
      console.error('[nora:resend_email_confirmation] getUserById:', getUserErr);
      return {
        ok: false,
        failure_reason: `getUserById error: ${getUserErr?.message ?? 'no user'}`,
        message_for_user:
          'I was not able to look up your account state just now. Let ' +
          'me open a ticket so someone can check on it.',
      };
    }

    if (userData.user.email_confirmed_at) {
      return {
        ok: false,
        failure_reason: 'already_confirmed',
        message_for_user:
          'Your email is already confirmed — you should be able to sign ' +
          'in normally. If you still cannot, try a password reset instead.',
        data: { email_confirmed_at: userData.user.email_confirmed_at },
      };
    }

    // Use an anon-keyed client for the resend — the resend endpoint is
    // public and doesn't want a service-role token.
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!supabaseUrl || !anonKey) {
      console.error('[nora:resend_email_confirmation] missing env vars');
      return {
        ok: false,
        failure_reason: 'missing_env',
        message_for_user:
          'Email confirmation is temporarily unavailable. Let me open a ' +
          'ticket so the team can investigate.',
      };
    }
    const anonClient = createClient(supabaseUrl, anonKey);

    const { error } = await anonClient.auth.resend({
      type: 'signup',
      email,
    });

    if (error) {
      console.error('[nora:resend_email_confirmation] auth.resend:', error);
      return {
        ok: false,
        failure_reason: `auth.resend error: ${error.message}`,
        message_for_user:
          'The confirmation email could not be sent right now. Let me ' +
          'open a ticket.',
      };
    }

    return {
      ok: true,
      message_for_user:
        `A fresh confirmation email is on its way to ${email}. It usually ` +
        'arrives within a minute — check spam if it does not.',
      data: { email },
    };
  },
};
