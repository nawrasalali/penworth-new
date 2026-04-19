import { createServiceClient } from '@/lib/supabase/service';
import { getStripeOrError } from '@/lib/stripe/client';
import type { NoraToolDefinition } from '../types';

/**
 * Tier 1: return the user's current subscription status.
 *
 * Resolves via org_members → organizations → (subscription_tier,
 * stripe_customer_id, stripe_subscription_id). If a Stripe subscription
 * is present, retrieves it for status + current_period_end. If no
 * subscription exists, reports free tier.
 *
 * Read-only; no confirmation required.
 */
export const checkSubscriptionStatusTool: NoraToolDefinition = {
  name: 'check_subscription_status',
  tier: 1,
  description:
    'Return the current subscription tier, billing cycle status, and ' +
    'next renewal date for the user\'s organization. Use when the user ' +
    'asks about their plan, renewal, or billing period.',
  input_schema: {
    type: 'object',
    properties: {},
    required: [],
  },
  handler: async (_input, ctx) => {
    const admin = createServiceClient();

    const { data: memberships, error: membershipErr } = await admin
      .from('org_members')
      .select(
        'organizations(id, name, subscription_tier, stripe_customer_id, stripe_subscription_id)',
      )
      .eq('user_id', ctx.member.user_id)
      .limit(1);

    if (membershipErr) {
      console.error('[nora:check_subscription_status] org_members:', membershipErr);
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
    if (!org) {
      return {
        ok: true,
        message_for_user:
          'Your account is on the free plan — no paid subscription is ' +
          'active.',
        data: { tier: 'free', has_subscription: false },
      };
    }

    const tier: string = org.subscription_tier ?? 'free';
    const subscriptionId: string | null = org.stripe_subscription_id ?? null;

    if (!subscriptionId) {
      return {
        ok: true,
        message_for_user:
          tier === 'free'
            ? 'Your account is on the free plan — no paid subscription ' +
              'is active.'
            : `Your organization "${org.name}" is on the ${tier} plan ` +
              'but no Stripe subscription is currently linked. If you ' +
              'recently upgraded, the subscription may still be processing.',
        data: { tier, has_subscription: false, org_name: org.name },
      };
    }

    // Retrieve live status from Stripe.
    const stripeResult = getStripeOrError();
    if ('error' in stripeResult) {
      return {
        ok: false,
        failure_reason: 'stripe_not_configured',
        message_for_user:
          'Billing is temporarily unavailable — I cannot reach the ' +
          'payment system to confirm the renewal date.',
      };
    }

    try {
      const sub = await stripeResult.stripe.subscriptions.retrieve(subscriptionId);
      const currentPeriodEnd = new Date(sub.current_period_end * 1000);
      const prettyEnd = currentPeriodEnd.toISOString().slice(0, 10);

      const statusWords: Record<string, string> = {
        active: 'active',
        trialing: 'on a trial',
        past_due: 'past due — payment failed',
        canceled: 'cancelled',
        unpaid: 'unpaid',
        incomplete: 'in the middle of activation',
        incomplete_expired: 'expired before activation',
        paused: 'paused',
      };
      const statusText = statusWords[sub.status] ?? sub.status;

      return {
        ok: true,
        message_for_user:
          `You are on the ${tier} plan. Subscription is ${statusText}. ` +
          `Current billing period ends ${prettyEnd}` +
          (sub.cancel_at_period_end
            ? ' — you have set this to cancel at period end.'
            : '.'),
        data: {
          tier,
          has_subscription: true,
          status: sub.status,
          current_period_end: currentPeriodEnd.toISOString(),
          cancel_at_period_end: sub.cancel_at_period_end,
          org_name: org.name,
        },
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[nora:check_subscription_status] retrieve:', err);
      return {
        ok: false,
        failure_reason: `stripe retrieve error: ${msg}`,
        message_for_user:
          `Your plan is ${tier}, but I could not reach Stripe to confirm ` +
          'the renewal details just now. Let me know if you want me to ' +
          'open a ticket.',
        data: { tier, subscription_id_last4: subscriptionId.slice(-4) },
      };
    }
  },
};
