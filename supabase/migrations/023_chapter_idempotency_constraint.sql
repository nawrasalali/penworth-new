-- Migration 023 — chapter idempotency for retry safety
--
-- Context:
--   writeBook is an Inngest durable function. Step-level retries inside
--   a single function run are memoized by Inngest — a step that succeeded
--   will not re-run. But if a function run fails terminally (onFailure
--   fires) and a human/admin later re-triggers book/write with a NEW
--   event id, Inngest starts a fresh run and every step runs again,
--   including steps whose chapters were already inserted by the prior
--   run. That produces duplicate chapter rows at the same order_index
--   within the same project.
--
-- Before this migration:
--   - No constraint on (project_id, order_index)
--   - PK was chapters.id (uuid) only
--   - Any force-retry, manual restart, or future restart-agent consumer
--     was unsafe against duplicate chapter inserts
--
-- After this migration:
--   - (project_id, order_index) is unique. A re-run that tries to
--     re-insert the same chapter position fails cleanly, which the
--     code handles via upsert(onConflict: 'project_id,order_index').
--
-- Rollout note:
--   This was applied to the production Supabase database on 2026-04-20
--   via the apply_migration tool. This file captures the DDL for repo
--   parity — staging, CI, preview envs re-apply this on next deploy.
--   The DO block makes it idempotent so re-application is safe.
--
-- The constraint is a real UNIQUE constraint (not a unique index) so
-- supabase-js upsert() can target it via the `onConflict` option.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.chapters'::regclass
      AND conname = 'chapters_project_order_key'
  ) THEN
    ALTER TABLE public.chapters
      ADD CONSTRAINT chapters_project_order_key
      UNIQUE (project_id, order_index);
  END IF;
END
$$;

COMMENT ON CONSTRAINT chapters_project_order_key ON public.chapters IS
  'Enforces at most one chapter per (project, order_index). Prevents duplicate chapter inserts on retry/restart paths. Added by migration 023.';
