// Stripe webhook route.
//
// Refactored 2026-04-27 (CEO-179) — handlers extracted into
// lib/stripe/process-event.ts so the reconcile cron can replay failed
// events without going through this URL (which would fail signature
// verification, since the cron has the body as JSON not the original
// raw signed payload).
//
// This route's job is now narrow:
//   1. Verify the Stripe signature on the raw request body
//   2. Record the event by stripe_event_id (idempotency gate)
//   3. Dispatch to processStripeEvent
//   4. Mark the event as processed / skipped / failed
//
// All per-event-type business logic lives in lib/stripe/process-event.ts.

import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';
import { getStripeOrError, getWebhookSecretOrError } from '@/lib/stripe/client';
import {
  recordStripeEvent,
  markStripeEventProcessed,
  markStripeEventFailed,
  markStripeEventSkipped,
} from '@/lib/stripe/webhook-idempotency';
import { processStripeEvent } from '@/lib/stripe/process-event';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

export async function POST(request: NextRequest) {
  const stripeResult = getStripeOrError();
  if (stripeResult.error) return stripeResult.error;
  const stripe = stripeResult.stripe;

  const secretResult = getWebhookSecretOrError();
  if (secretResult.error) return secretResult.error;
  const webhookSecret = secretResult.secret;

  const body = await request.text();
  const signature = request.headers.get('stripe-signature')!;

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(body, signature, webhookSecret);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('Webhook signature verification failed:', message);
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 });
  }

  // Idempotency gate: record this event before any handler runs. If the
  // same stripe_event_id has already been processed, skip — Stripe can
  // retry deliveries and we must never double-commission or double-grant.
  const gate = await recordStripeEvent(supabase, event, 'webhook');
  if (!gate.shouldProcess) {
    console.log(
      `[stripe/webhook] Skipping event ${event.id} (${event.type}): ${gate.reason}`,
    );
    return NextResponse.json({ received: true, duplicate: true });
  }

  try {
    const outcome = await processStripeEvent(event);
    if (outcome === 'unhandled') {
      console.log(`Unhandled event type: ${event.type}`);
      await markStripeEventSkipped(
        supabase,
        event.id,
        `unhandled event type: ${event.type}`,
      );
    } else {
      // Both 'handled' and 'skipped' (e.g. self-pay branch returning early
      // after waiving fees) record as processed — the event was evaluated
      // and the right action taken.
      await markStripeEventProcessed(supabase, event.id);
    }
    return NextResponse.json({ received: true });
  } catch (error) {
    console.error('Webhook handler error:', error);
    await markStripeEventFailed(supabase, event.id, error);
    return NextResponse.json({ error: 'Webhook handler failed' }, { status: 500 });
  }
}
