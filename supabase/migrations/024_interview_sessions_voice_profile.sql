-- Migration 024 — persist voiceProfile on interview_sessions
--
-- Captures the voice_profile jsonb column that was applied directly to
-- production on 2026-04-20 via Supabase apply_migration. This file exists
-- so that staging rebuilds, CI runs, and preview deploys stay in sync
-- with production.
--
-- The column stores the author voice profile (tone / style / vocabulary)
-- captured at book/write time so any subsequent re-fire path — the
-- pipeline.restart-agent consumer, or a future manual retry — can read
-- the same voice used in the original run, preventing style drift across
-- retries.
--
-- Legacy sessions created before this migration have voice_profile = NULL.
-- write-book.ts treats voiceProfile as optional, so NULL is safe.

ALTER TABLE public.interview_sessions
  ADD COLUMN IF NOT EXISTS voice_profile jsonb;

COMMENT ON COLUMN public.interview_sessions.voice_profile IS
  'Author voice profile (tone/style/vocabulary) captured at book/write time. Nullable. Consumed by write-book.load-context (fallback path) and pipeline-restart-agent consumer to preserve voice across retries.';
