// Stripe ↔ DB reconciliation cron.
//
// Authored: 2026-04-27 by CTO security/ops pass.
//
// Why this exists:
//   The webhook handler at app/api/stripe/webhook/route.ts is the only path
//   that updates our local mirror of Stripe state (subscriptions, invoices,
//   charges). Two failure modes leak state:
//     1. A handler errors mid-event; the row is recorded as status='failed'
//        but is never automatically retried.
//     2. A webhook is delivered to a Vercel function that times out or
//        cold-starts past Stripe's signature window, returning 5xx. Stripe
//        retries on its own schedule but we never observe the gap.
//   In either case the local mirror drifts from Stripe truth, and the longer
//   we go without a check the worse the divergence gets.
//
// What this does, every 6 hours:
//   A. Pulls the last 24h of events from the Stripe events API.
//   B. Looks them up by stripe_event_id in our stripe_webhook_events table.
//   C. Anything in (A) that's not in (B) is a webhook we never received.
//      Emits an alert listing the missing event IDs.
//   D. Counts failed rows in the last 7 days and emits an alert if any exist.
//      Does NOT auto-replay them — the webhook handlers are currently file-local
//      to app/api/stripe/webhook/route.ts and the right replay path is to
//      extract them into a shared module first (tracked separately).
//
// Operator actions on alert:
//   - "missing in db" → replay each missing event through the Stripe dashboard
//     (Developers → Webhooks → resend) so the standard handler runs against
//     the real signature header.
//   - "failed in db"  → inspect error_message column; fix root cause; manually
//     mark replayed once handler is patched.
//
// Dispatch:
//   Inngest scheduled function. Inngest gives us retries, observability, and
//   per-step durability automatically.

import { inngest } from '@/inngest/client';
import { createServiceClient } from '@/lib/supabase/service';
import { getStripeOrError } from '@/lib/stripe/client';
import type Stripe from 'stripe';

const RECONCILE_WINDOW_FAILED_DAYS = 7;
const RECONCILE_WINDOW_DRIFT_HOURS = 24;
const STRIPE_EVENTS_PAGE_LIMIT = 100;
const STRIPE_EVENTS_MAX_PAGES = 10; // hard cap: 1000 events per run

interface DriftResult {
  stripe_events_checked: number;
  missing_in_db: string[];
}

interface FailedSummary {
  failed_count: number;
  oldest_failed_at: string | null;
  retry_exhausted_count: number;
}

export const stripeReconcile = inngest.createFunction(
  {
    id: 'stripe-reconcile',
    name: 'Stripe ↔ DB reconciliation',
    retries: 2,
  },
  { cron: '0 */6 * * *' },
  async ({ step, logger }) => {
    // ─────────────────────────────────────────────────────────────────────
    // Step A: count the failed rows in our table
    // ─────────────────────────────────────────────────────────────────────
    const failedSummary = await step.run('summarise-failed-rows', async (): Promise<FailedSummary> => {
      const supabase = createServiceClient();
      const cutoff = new Date(
        Date.now() - RECONCILE_WINDOW_FAILED_DAYS * 24 * 60 * 60 * 1000,
      ).toISOString();

      const { data, error, count } = await supabase
        .from('stripe_webhook_events')
        .select('stripe_event_id, received_at, retry_count', { count: 'exact' })
        .eq('processing_status', 'failed')
        .gte('received_at', cutoff)
        .order('received_at', { ascending: true });

      if (error) throw new Error(`failed-rows query: ${error.message}`);

      const exhausted = (data ?? []).filter((r) => (r.retry_count ?? 0) >= 3).length;
      return {
        failed_count: count ?? 0,
        oldest_failed_at: data && data.length > 0 ? data[0].received_at : null,
        retry_exhausted_count: exhausted,
      };
    });

    // ─────────────────────────────────────────────────────────────────────
    // Step B: pull recent events from Stripe and diff
    // ─────────────────────────────────────────────────────────────────────
    const drift = await step.run('detect-missing-webhooks', async (): Promise<DriftResult> => {
      const stripeOrError = getStripeOrError();
      if (!stripeOrError.stripe) {
        logger.warn('Stripe client unavailable, skipping drift check (STRIPE_SECRET_KEY missing)');
        return { stripe_events_checked: 0, missing_in_db: [] };
      }
      const stripe = stripeOrError.stripe;

      const sinceUnix =
        Math.floor(Date.now() / 1000) - RECONCILE_WINDOW_DRIFT_HOURS * 60 * 60;

      const stripeEventIds: string[] = [];
      let starting_after: string | undefined;
      let pages = 0;
      let hasMore = true;

      while (hasMore && pages < STRIPE_EVENTS_MAX_PAGES) {
        const page: Stripe.ApiList<Stripe.Event> = await stripe.events.list({
          created: { gte: sinceUnix },
          limit: STRIPE_EVENTS_PAGE_LIMIT,
          starting_after,
        });
        for (const e of page.data) stripeEventIds.push(e.id);
        hasMore = page.has_more;
        starting_after = page.data.length ? page.data[page.data.length - 1].id : undefined;
        pages++;
      }

      if (stripeEventIds.length === 0) {
        return { stripe_events_checked: 0, missing_in_db: [] };
      }

      const supabase = createServiceClient();
      const { data: present, error: presentErr } = await supabase
        .from('stripe_webhook_events')
        .select('stripe_event_id')
        .in('stripe_event_id', stripeEventIds);

      if (presentErr) throw new Error(`present-events lookup: ${presentErr.message}`);

      const presentSet = new Set((present ?? []).map((r) => r.stripe_event_id));
      const missing = stripeEventIds.filter((id) => !presentSet.has(id));

      return { stripe_events_checked: stripeEventIds.length, missing_in_db: missing };
    });

    // ─────────────────────────────────────────────────────────────────────
    // Step C: alert if anything actionable
    // ─────────────────────────────────────────────────────────────────────
    if (
      drift.missing_in_db.length > 0 ||
      failedSummary.failed_count > 0
    ) {
      await step.run('emit-alert', async () => {
        const supa = createServiceClient();
        const severity =
          drift.missing_in_db.length > 5 || failedSummary.retry_exhausted_count > 0
            ? 'high'
            : 'medium';
        await supa.rpc('alert_dispatch', {
          p_source_type: 'stripe_reconcile',
          p_source_id: null,
          p_severity: severity,
          p_category: 'billing',
          p_title:
            drift.missing_in_db.length > 0
              ? `Stripe reconcile: ${drift.missing_in_db.length} events missing in db`
              : `Stripe reconcile: ${failedSummary.failed_count} failed rows pending`,
          p_body: JSON.stringify(
            {
              drift,
              failed: failedSummary,
              window: {
                drift_hours: RECONCILE_WINDOW_DRIFT_HOURS,
                failed_days: RECONCILE_WINDOW_FAILED_DAYS,
              },
            },
            null,
            2,
          ),
          p_dedup_key: `stripe_reconcile_${new Date().toISOString().slice(0, 13)}`,
        });
      });
    }

    return { drift, failed: failedSummary };
  },
);
