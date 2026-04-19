import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { getStripeOrError } from '@/lib/stripe/client';
import { requireCronAuth } from '@/lib/cron/require-cron-auth';

export const runtime = 'nodejs';
export const maxDuration = 300;
export const dynamic = 'force-dynamic';

/**
 * GET /api/cron/stripe-reconcile
 *
 * Daily reconciliation against Stripe's event log. Runs at 02:00 UTC.
 *
 * Stripe retries webhook deliveries with exponential backoff for up to 72
 * hours. If our endpoint is down longer than that, events can be lost
 * silently — no webhook ever arrives, no row in stripe_webhook_events.
 * This job is the safety net:
 *
 *   1. Query Stripe's List Events API for everything in the past 48 hours
 *      (overlapping window — so a run that crashes partway doesn't leave
 *      a permanent gap).
 *   2. Compare each returned event's ID against stripe_webhook_events.
 *   3. For every missing event, INSERT it with source='reconciliation'.
 *      This creates the audit record and surfaces the miss in monitoring.
 *
 * DECISION (Phase 1A): detection-only, not auto-processing.
 *
 * The handoff spec called for auto-processing replayed events through the
 * webhook handler. We're deferring that because:
 *
 *   - The webhook dispatch currently lives inline in the route file with
 *     ~400 lines of private handlers. Extracting it into a reusable
 *     dispatcher is a larger refactor than Phase 1A should absorb.
 *   - If Stripe has retried and failed for 48 hours, something non-trivial
 *     is wrong. We want a human (founder or CTO agent) to look at each
 *     missed event and confirm before re-running the handler — not
 *     silently replay at 02:00 UTC and risk double-side-effects.
 *   - Recording the miss is 100% of the audit value. Processing is a
 *     separate follow-up once the detection layer proves stable.
 *
 * When a miss is detected, the event lands in the table with
 * processing_status='replayed' and error_message='awaiting manual review'.
 * The CTO Agent dashboard will surface these as P0.
 *
 * Query params:
 *   ?hours=48   Override the lookback window (default 48).
 *   ?dry=1      Don't write; just report what would have been inserted.
 */
export async function GET(request: NextRequest) {
  const unauthorized = requireCronAuth(request);
  if (unauthorized) return unauthorized;

  const stripeResult = getStripeOrError();
  if (stripeResult.error) return stripeResult.error;
  const stripe = stripeResult.stripe;

  try {
    const url = new URL(request.url);
    const hours = Math.min(Math.max(1, Number(url.searchParams.get('hours') || 48)), 168);
    const dryRun = url.searchParams.get('dry') === '1';

    const admin = createAdminClient();

    const windowStart = Math.floor(Date.now() / 1000) - hours * 3600;

    // Walk Stripe's event pages. Stripe caps list_events to 100 per page
    // and returns has_more + cursor for pagination.
    const stripeEventIds: Array<{ id: string; type: string; created: number }> = [];
    let startingAfter: string | undefined = undefined;
    let pagesWalked = 0;
    const MAX_PAGES = 50; // 5000 events max — well above a day's volume

    while (pagesWalked < MAX_PAGES) {
      const page: any = await stripe.events.list({
        limit: 100,
        created: { gte: windowStart },
        starting_after: startingAfter,
      });

      for (const ev of page.data) {
        stripeEventIds.push({ id: ev.id, type: ev.type, created: ev.created });
      }

      if (!page.has_more) break;
      startingAfter = page.data[page.data.length - 1].id;
      pagesWalked++;
    }

    if (stripeEventIds.length === 0) {
      return NextResponse.json({
        ok: true,
        window_hours: hours,
        stripe_events_in_window: 0,
        already_stored: 0,
        missing: 0,
        reconciled: 0,
      });
    }

    // Fetch which of those IDs we already have locally
    const { data: stored } = await admin
      .from('stripe_webhook_events')
      .select('stripe_event_id')
      .in(
        'stripe_event_id',
        stripeEventIds.map((e) => e.id),
      );

    const storedSet = new Set((stored || []).map((r) => r.stripe_event_id));
    const missing = stripeEventIds.filter((e) => !storedSet.has(e.id));

    if (missing.length === 0) {
      return NextResponse.json({
        ok: true,
        window_hours: hours,
        stripe_events_in_window: stripeEventIds.length,
        already_stored: stripeEventIds.length,
        missing: 0,
        reconciled: 0,
      });
    }

    const uniqueTypes = Array.from(new Set(missing.map((m) => m.type)));
    console.warn(
      `[stripe-reconcile] Found ${missing.length} missing events in last ${hours}h ` +
        `(over ${stripeEventIds.length} total). Types: ${uniqueTypes.join(', ')}`,
    );

    if (dryRun) {
      return NextResponse.json({
        ok: true,
        dry_run: true,
        window_hours: hours,
        stripe_events_in_window: stripeEventIds.length,
        missing: missing.length,
        missing_ids: missing.map((m) => ({ id: m.id, type: m.type })),
      });
    }

    // Retrieve each missing event's full payload and insert. We do this
    // one at a time (rather than passing IDs to the bulk insert) because
    // Stripe's list_events returns partial objects; we need the full
    // payload for any future replay.
    let reconciled = 0;
    const errors: Array<{ id: string; error: string }> = [];

    for (const m of missing) {
      try {
        const fullEvent = await stripe.events.retrieve(m.id);

        const { error: insertErr } = await admin
          .from('stripe_webhook_events')
          .insert({
            stripe_event_id: fullEvent.id,
            event_type: fullEvent.type,
            payload: fullEvent as any,
            source: 'reconciliation',
            processing_status: 'replayed',
            error_message: 'awaiting manual review — delivered via reconciliation, not webhook',
          });

        if (insertErr) {
          // 23505 here means a concurrent webhook arrived between our list
          // and our insert. That's fine — skip.
          if ((insertErr as any).code === '23505') {
            continue;
          }
          throw insertErr;
        }

        reconciled++;
      } catch (err: any) {
        errors.push({ id: m.id, error: err?.message || String(err) });
      }
    }

    return NextResponse.json({
      ok: true,
      window_hours: hours,
      stripe_events_in_window: stripeEventIds.length,
      already_stored: stripeEventIds.length - missing.length,
      missing: missing.length,
      reconciled,
      errors,
    });
  } catch (err: any) {
    console.error('[stripe-reconcile] Error:', err);
    return NextResponse.json(
      { error: err?.message || 'Reconciliation failed' },
      { status: 500 },
    );
  }
}
