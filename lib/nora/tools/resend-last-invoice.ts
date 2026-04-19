import { createAdminClient } from '@/lib/supabase/server';
import { getStripeOrError } from '@/lib/stripe/client';
import type { NoraToolDefinition } from '../types';

/**
 * Tier 1: resend the last Stripe invoice, OR hand the user a billing-
 * portal URL if the invoice is auto-charge.
 *
 * A15 amendment: check invoice.collection_method FIRST. Two paths:
 *   - 'send_invoice'        → stripe.invoices.sendInvoice(id) (actually
 *                             re-emails the receipt)
 *   - 'charge_automatically' → no resend endpoint exists; create a
 *                             billing-portal session URL the user can
 *                             open to see/download the invoice
 *
 * stripe_customer_id is on organizations, reached via:
 *   user_id → org_members → organizations
 */
export const resendLastInvoiceTool: NoraToolDefinition = {
  name: 'resend_last_invoice',
  tier: 1,
  description:
    'Resend the most recent Stripe invoice or receipt to the user. ' +
    'For auto-charge subscriptions where Stripe does not support ' +
    'resending, returns a billing portal link instead. Use when the ' +
    'user says they did not receive their invoice or receipt. Confirm ' +
    'with the user first.',
  input_schema: {
    type: 'object',
    properties: {},
    required: [],
  },
  handler: async (_input, ctx) => {
    const admin = createAdminClient();
    const stripeResult = getStripeOrError();
    if ('error' in stripeResult) {
      return {
        ok: false,
        failure_reason: 'stripe_not_configured',
        message_for_user:
          'Billing is temporarily unavailable — I cannot reach the ' +
          'payment system. Let me open a ticket.',
      };
    }
    const { stripe } = stripeResult;

    // Resolve stripe_customer_id via the org membership.
    const { data: memberships, error: membershipErr } = await admin
      .from('org_members')
      .select('organizations(stripe_customer_id)')
      .eq('user_id', ctx.member.user_id)
      .limit(1);

    if (membershipErr) {
      console.error('[nora:resend_last_invoice] org_members query:', membershipErr);
      return {
        ok: false,
        failure_reason: `org_members error: ${membershipErr.message}`,
        message_for_user:
          'I hit an error looking up your billing account. Let me open ' +
          'a ticket.',
      };
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const org = (memberships?.[0]?.organizations as any) ?? null;
    const customerId: string | null = org?.stripe_customer_id ?? null;
    if (!customerId) {
      return {
        ok: false,
        failure_reason: 'no_stripe_customer',
        message_for_user:
          'I do not see any billing history on your account — you may ' +
          'not have a paid subscription yet. If you think that is wrong, ' +
          'let me know and I will open a ticket.',
      };
    }

    // Fetch the most recent invoice for this customer.
    const invoices = await stripe.invoices.list({ customer: customerId, limit: 1 });
    const latest = invoices.data[0];
    if (!latest) {
      return {
        ok: false,
        failure_reason: 'no_invoices',
        message_for_user:
          'There are no invoices on file for your billing account yet.',
      };
    }

    // Path A: collection_method='send_invoice' — Stripe supports resend.
    if (latest.collection_method === 'send_invoice') {
      try {
        await stripe.invoices.sendInvoice(latest.id);
        return {
          ok: true,
          message_for_user:
            `I have resent invoice ${latest.number ?? latest.id} to ` +
            `${ctx.member.email}. It should arrive shortly.`,
          data: {
            invoice_id: latest.id,
            invoice_number: latest.number,
            path: 'send_invoice',
          },
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error('[nora:resend_last_invoice] sendInvoice:', err);
        return {
          ok: false,
          failure_reason: `stripe sendInvoice error: ${msg}`,
          message_for_user:
            'I could not resend that invoice through Stripe just now. ' +
            'Let me open a ticket.',
        };
      }
    }

    // Path B: charge_automatically — no resend endpoint. Give portal URL.
    const surfaceHost =
      ctx.member.surface === 'guild'
        ? 'https://guild.penworth.ai'
        : 'https://new.penworth.ai';
    try {
      const portal = await stripe.billingPortal.sessions.create({
        customer: customerId,
        return_url: `${surfaceHost}/billing`,
      });
      return {
        ok: true,
        message_for_user:
          `Stripe does not resend auto-charge receipts by email, but you ` +
          `can see and download invoice ${latest.number ?? latest.id} ` +
          `here: ${portal.url}`,
        data: {
          invoice_id: latest.id,
          invoice_number: latest.number,
          path: 'billing_portal',
          portal_url: portal.url,
        },
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[nora:resend_last_invoice] billingPortal:', err);
      return {
        ok: false,
        failure_reason: `stripe billingPortal error: ${msg}`,
        message_for_user:
          'I could not generate a billing portal link just now. Let me ' +
          'open a ticket.',
      };
    }
  },
};
