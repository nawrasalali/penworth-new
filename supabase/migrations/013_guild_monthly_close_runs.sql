-- ============================================================================
-- PENWORTH GUILD — Monthly Close Run Log
-- Migration 013 — Creates guild_monthly_close_runs so each month's close is
-- idempotent and every run leaves an audit trail.
-- ============================================================================
--
-- Purpose:
--   The monthly close is the single most consequential automated job in the
--   Guild economy: it locks commissions, deducts fees, queues payouts, and
--   can put members on probation. It must be impossible to run twice for the
--   same month, and every run must be fully observable.
--
-- Invariants:
--   1. (run_month) is UNIQUE — enforced by the table. A second attempted run
--      for the same YYYY-MM raises unique_violation, which the cron handler
--      interprets as "already closed" and returns 200 OK without reprocessing.
--   2. A run transitions: running -> completed (or failed) exactly once.
--      A 'running' row that's older than 30 minutes is considered stuck and
--      may be marked 'failed' by a separate reconcile step (future work).
--   3. Errors are accumulated in a JSONB array keyed by guildmember_id, not
--      thrown up the stack — one bad member must not stop the close for all
--      other members.

CREATE TABLE IF NOT EXISTS guild_monthly_close_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- The month being closed, in YYYY-MM format (e.g. '2026-04')
  run_month TEXT NOT NULL UNIQUE,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'running'
    CHECK (status IN ('running', 'completed', 'failed')),

  -- Aggregate counters (populated as the run progresses)
  members_considered INTEGER NOT NULL DEFAULT 0,
  members_processed INTEGER NOT NULL DEFAULT 0,
  members_errored INTEGER NOT NULL DEFAULT 0,
  commissions_locked INTEGER NOT NULL DEFAULT 0,
  payouts_created INTEGER NOT NULL DEFAULT 0,
  total_paid_usd NUMERIC(14,2) NOT NULL DEFAULT 0,
  fees_assessed_usd NUMERIC(14,2) NOT NULL DEFAULT 0,
  fees_deducted_usd NUMERIC(14,2) NOT NULL DEFAULT 0,
  fees_deferred_usd NUMERIC(14,2) NOT NULL DEFAULT 0,
  probations_triggered INTEGER NOT NULL DEFAULT 0,

  -- Per-member errors, so one bad member doesn't hide in a generic failure.
  -- Shape: [{ guildmember_id, error_code, error_message, at }]
  errors JSONB NOT NULL DEFAULT '[]'::jsonb,

  -- Who or what triggered this run. 'cron' for the scheduled job,
  -- 'manual' for the admin-triggered backfill endpoint, 'test' for unit tests.
  triggered_by TEXT NOT NULL DEFAULT 'cron'
    CHECK (triggered_by IN ('cron', 'manual', 'test')),

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_gmcr_status ON guild_monthly_close_runs(status);
CREATE INDEX IF NOT EXISTS idx_gmcr_started ON guild_monthly_close_runs(started_at DESC);

COMMENT ON TABLE guild_monthly_close_runs IS
  'One row per monthly close execution. UNIQUE(run_month) enforces idempotency.';

-- Trigger to keep updated_at fresh on any change
CREATE OR REPLACE FUNCTION guild_monthly_close_runs_touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tr_gmcr_updated_at ON guild_monthly_close_runs;
CREATE TRIGGER tr_gmcr_updated_at
  BEFORE UPDATE ON guild_monthly_close_runs
  FOR EACH ROW EXECUTE FUNCTION guild_monthly_close_runs_touch_updated_at();
