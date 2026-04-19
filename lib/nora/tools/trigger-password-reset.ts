import { createServiceClient } from '@/lib/supabase/service';
import type { NoraToolDefinition } from '../types';

/**
 * Tier 1: trigger a password reset email.
 *
 * A15 amendment: the prompt's signature is trigger_password_reset(email)
 * but for security the handler ignores any email argument and always
 * uses ctx.member.email. This prevents a prompt-injected message from
 * triggering a reset against a different account.
 *
 * Implementation uses admin.auth.admin.generateLink which sends the
 * recovery email through Supabase's email template. No Resend hop
 * required — Supabase Auth owns auth email delivery.
 */
export const triggerPasswordResetTool: NoraToolDefinition = {
  name: 'trigger_password_reset',
  tier: 1,
  description:
    'Send a password reset email to the current user. Use when the ' +
    'user says they have forgotten their password or cannot sign in. ' +
    'Always confirm with the user first — "I will send a reset link ' +
    'to your email, okay?" — then call this tool.',
  input_schema: {
    type: 'object',
    properties: {
      redirect_to: {
        type: 'string',
        description:
          'Optional absolute URL to land on after reset. Defaults to ' +
          'the platform-standard /reset-password page.',
      },
    },
    required: [],
  },
  handler: async (input, ctx) => {
    const admin = createServiceClient();
    const email = ctx.member.email;

    // Default redirect: keep on the surface the user is currently using.
    // The widget knows its own host; server fills in the reset path.
    const surfaceHost =
      ctx.member.surface === 'guild'
        ? 'https://guild.penworth.ai'
        : ctx.member.surface === 'store'
        ? 'https://store.penworth.ai'
        : 'https://new.penworth.ai';

    const redirectTo =
      (typeof input.redirect_to === 'string' && input.redirect_to) ||
      `${surfaceHost}/reset-password`;

    const { error } = await admin.auth.admin.generateLink({
      type: 'recovery',
      email,
      options: { redirectTo },
    });

    if (error) {
      console.error('[nora:trigger_password_reset] generateLink failed:', error);
      return {
        ok: false,
        failure_reason: `generateLink error: ${error.message}`,
        message_for_user:
          "I wasn't able to send the reset email just now — the mail " +
          'system returned an error. Let me open a ticket so someone ' +
          'can look into it.',
      };
    }

    return {
      ok: true,
      message_for_user:
        `Password reset link sent to ${email}. It should arrive within ` +
        'a minute. Check your spam folder if you do not see it.',
      data: { email, redirect_to: redirectTo },
    };
  },
};
