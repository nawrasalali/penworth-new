-- ============================================================================
-- PENWORTH — Stripe Webhook Event Sourcing
-- Migration 012 — Creates stripe_webhook_events for idempotency and the
-- daily reconciliation cron that detects and replays missed events.
-- ============================================================================
--
-- Purpose:
--   Stripe webhooks are the financial source-of-truth pipeline. If the webhook
--   endpoint is briefly down, or if a handler fails mid-processing, we must
--   never silently lose an event. Every event is stored as a raw row before
--   any business logic runs. Failed events are retried. The daily reconciler
--   compares Stripe's event log against this table and replays anything missed.
--
-- Invariants:
--   1. Every webhook event is INSERTed before business logic executes.
--   2. (stripe_event_id) is UNIQUE — enforces idempotency at the DB level.
--      A second webhook delivery for the same event_id is a no-op.
--   3. `source='webhook'` = arrived via the webhook endpoint.
--      `source='reconciliation'` = backfilled by the nightly reconciliation cron.
--   4. Rows are never deleted. This table is the durable record of every
--      financial event Stripe has ever sent us.

CREATE TABLE IF NOT EXISTS stripe_webhook_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  stripe_event_id TEXT NOT NULL UNIQUE,
  event_type TEXT NOT NULL,
  payload JSONB NOT NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed_at TIMESTAMPTZ,
  processing_status TEXT NOT NULL DEFAULT 'received'
    CHECK (processing_status IN (
      'received',       -- stored, handler not yet started
      'processed',      -- handler ran successfully
      'failed',         -- handler errored; eligible for retry
      'replayed',       -- backfilled by reconciliation cron and processed
      'skipped'         -- event type we don't handle; recorded for audit only
    )),
  error_message TEXT,
  retry_count INTEGER NOT NULL DEFAULT 0,
  last_retry_at TIMESTAMPTZ,
  source TEXT NOT NULL DEFAULT 'webhook'
    CHECK (source IN ('webhook', 'reconciliation')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes for the two access patterns:
--   1. Retry cron scans failed rows
--   2. Reconciliation cron scans by received_at window
CREATE INDEX IF NOT EXISTS idx_swe_status
  ON stripe_webhook_events(processing_status);

CREATE INDEX IF NOT EXISTS idx_swe_received_at
  ON stripe_webhook_events(received_at DESC);

CREATE INDEX IF NOT EXISTS idx_swe_event_type
  ON stripe_webhook_events(event_type);

-- Partial index for the retry queue — small, fast
CREATE INDEX IF NOT EXISTS idx_swe_retry_queue
  ON stripe_webhook_events(received_at)
  WHERE processing_status = 'failed';

COMMENT ON TABLE stripe_webhook_events IS
  'Append-only log of every Stripe webhook event received or reconciled. Used for idempotency and gap detection.';
