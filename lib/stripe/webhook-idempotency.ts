/**
 * Stripe webhook idempotency helper.
 *
 * Every Stripe webhook event — whether it arrived via the webhook endpoint
 * or via the daily reconciliation cron — passes through these functions so
 * that:
 *
 *   1. No event is processed twice. The DB-level UNIQUE(stripe_event_id)
 *      on stripe_webhook_events is the enforcement. A second delivery of
 *      the same event_id fails the insert with SQLSTATE 23505, which we
 *      interpret as "already recorded — skip processing".
 *
 *   2. Every event that arrives is durably recorded BEFORE any business
 *      logic runs. If the process crashes mid-handler, the raw event is
 *      preserved for later replay.
 *
 *   3. Processing status (received → processed | failed | replayed) is
 *      tracked so the reconciliation cron can find stuck events and the
 *      CTO dashboard can surface failing event types.
 *
 * Usage pattern in the webhook route:
 *
 *   const event = stripe.webhooks.constructEvent(body, sig, secret);
 *   const gate = await recordStripeEvent(supabase, event, 'webhook');
 *   if (!gate.shouldProcess) {
 *     return NextResponse.json({ received: true, duplicate: true });
 *   }
 *   try {
 *     await dispatchStripeEvent(event, ...);
 *     await markStripeEventProcessed(supabase, event.id);
 *   } catch (err) {
 *     await markStripeEventFailed(supabase, event.id, err);
 *     throw err;
 *   }
 *
 * For the reconciliation cron, pass source='reconciliation' and the
 * record is created with an initial processing_status of 'replayed'.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type Stripe from 'stripe';

export type StripeEventSource = 'webhook' | 'reconciliation';

export interface RecordGate {
  shouldProcess: boolean;
  reason: 'new' | 'duplicate' | 'already_processed' | 'error';
  rowId?: string;
}

/**
 * Insert the raw event into stripe_webhook_events. Returns a gate telling
 * the caller whether to proceed with processing.
 *
 * - New event → shouldProcess=true
 * - Duplicate (same stripe_event_id already exists) → shouldProcess=false
 *   UNLESS the existing row is in 'failed' status, in which case the caller
 *   is expected to retry and we return shouldProcess=true (and the retry
 *   count is bumped by markStripeEventProcessed/Failed).
 */
export async function recordStripeEvent(
  admin: SupabaseClient,
  event: Stripe.Event,
  source: StripeEventSource,
): Promise<RecordGate> {
  const initialStatus = source === 'reconciliation' ? 'replayed' : 'received';

  const { data, error } = await admin
    .from('stripe_webhook_events')
    .insert({
      stripe_event_id: event.id,
      event_type: event.type,
      payload: event as any,
      processing_status: initialStatus,
      source,
    })
    .select('id')
    .single();

  if (!error && data) {
    return { shouldProcess: true, reason: 'new', rowId: data.id as string };
  }

  // 23505 = duplicate stripe_event_id. Either already processed, or a
  // failed row we should retry.
  if ((error as any)?.code === '23505') {
    const { data: existing } = await admin
      .from('stripe_webhook_events')
      .select('id, processing_status, retry_count')
      .eq('stripe_event_id', event.id)
      .single();

    if (!existing) {
      return { shouldProcess: false, reason: 'error' };
    }

    if (existing.processing_status === 'failed') {
      // Retry path — bump retry_count so we can observe thrashing
      await admin
        .from('stripe_webhook_events')
        .update({
          retry_count: (existing.retry_count || 0) + 1,
          last_retry_at: new Date().toISOString(),
          processing_status: 'received', // reset so the caller proceeds
        })
        .eq('id', existing.id);
      return { shouldProcess: true, reason: 'new', rowId: existing.id as string };
    }

    return { shouldProcess: false, reason: 'duplicate', rowId: existing.id as string };
  }

  console.error('[stripe-idempotency] recordStripeEvent error:', error);
  return { shouldProcess: false, reason: 'error' };
}

export async function markStripeEventProcessed(
  admin: SupabaseClient,
  stripeEventId: string,
): Promise<void> {
  await admin
    .from('stripe_webhook_events')
    .update({
      processing_status: 'processed',
      processed_at: new Date().toISOString(),
      error_message: null,
    })
    .eq('stripe_event_id', stripeEventId);
}

export async function markStripeEventFailed(
  admin: SupabaseClient,
  stripeEventId: string,
  err: unknown,
): Promise<void> {
  const message = err instanceof Error ? err.message : String(err);
  await admin
    .from('stripe_webhook_events')
    .update({
      processing_status: 'failed',
      error_message: message.slice(0, 2000), // don't blow the column
    })
    .eq('stripe_event_id', stripeEventId);
}

export async function markStripeEventSkipped(
  admin: SupabaseClient,
  stripeEventId: string,
  reason: string,
): Promise<void> {
  await admin
    .from('stripe_webhook_events')
    .update({
      processing_status: 'skipped',
      processed_at: new Date().toISOString(),
      error_message: reason.slice(0, 2000),
    })
    .eq('stripe_event_id', stripeEventId);
}
