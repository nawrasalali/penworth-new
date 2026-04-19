-- =============================================================================
-- Migration 018 — Phase 2.5 Item 3 Commit 3
-- Nora rate-limit infrastructure: nora_usage table + nora_consume_turn RPC
-- =============================================================================
--
-- Mirrors the guild_advisor_consume_turn pattern from migration 015 per
-- pre-flight A11. Same atomic check-and-increment via SELECT ... FOR UPDATE,
-- same 24h rolling window semantics, same return shape — with the one
-- addition that the deny payload carries a user-facing message the Nora
-- widget can render verbatim without needing to construct its own copy.
--
-- ROLE AND CALL SITE
--
--   Called from app/api/nora/conversation/turn/route.ts (ships in a later
--   Phase 2.5 commit) at the TOP of every POST handler — before any Claude
--   API work happens, before KB retrieval, before known-issue matching.
--   When allowed=false the route returns 429 with the resets_at payload.
--
--   Default limit: 20 turns per user per 24h. Callers can override via
--   the p_limit parameter if a specific surface needs a different cap
--   (e.g. admin might get unlimited).
--
-- A11 — WHY THIS EXISTS
--
--   The brief's original design had the route do:
--
--     SELECT COUNT(*) FROM nora_turns WHERE user_id = $1 AND role = 'user'
--       AND created_at > now() - interval '24 hours';
--     IF count < 20 THEN allow ELSE deny
--
--   Same TOCTOU race as guild_advisor_consume_turn pre-A12: two parallel
--   turn requests both see count=19, both pass, user gets 21 turns. Fix
--   is identical: dedicated counter table with FOR UPDATE serialization.
--
-- RELATIONSHIP TO nora_turns
--
--   nora_turns still gets one row per user message (append-only audit
--   trail). This counter is independent — it tracks enforcement state,
--   not message history. The two can diverge briefly during the window
--   between nora_consume_turn returning allowed=true and the route
--   inserting the nora_turns row, but that's acceptable: the counter is
--   the source of truth for rate-limiting, nora_turns is the source of
--   truth for conversation playback.
--
-- SCOPE NOTE
--
--   This migration only adds the rate-limit primitive. The /api/nora/*
--   routes that consume it, the widget UI, and the 8 Tier 1 tools all
--   ship in subsequent Phase 2.5 commits.
--
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Table
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.nora_usage (
  user_id          uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  turns_today      integer NOT NULL DEFAULT 0,
  window_resets_at timestamptz NOT NULL DEFAULT (now() + interval '24 hours'),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.nora_usage IS
  'Phase 2.5: per-user rolling 24h turn counter for the Nora support '
  'assistant. Populated on demand by nora_consume_turn. The window resets '
  'when window_resets_at <= now() via the same RPC. service_role bypasses '
  'RLS; authenticated users can read only their own row.';

-- -----------------------------------------------------------------------------
-- RLS
-- -----------------------------------------------------------------------------

ALTER TABLE public.nora_usage ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS nora_usage_self_read ON public.nora_usage;
CREATE POLICY nora_usage_self_read
  ON public.nora_usage FOR SELECT
  USING (auth.uid() = user_id);

-- No INSERT / UPDATE / DELETE policies on purpose — writes go via
-- service_role which bypasses RLS. Users cannot directly increment
-- their own turn counter.

-- -----------------------------------------------------------------------------
-- nora_consume_turn
-- Atomic check-and-increment. Per A11 + A12, FOR UPDATE serializes
-- concurrent callers so the "read N, if < limit increment to N+1" race is
-- eliminated: the second caller blocks until the first commits, then reads
-- the already-incremented value.
--
-- Return shape:
--   on allow: { ok: true, allowed: true, turns_today, limit, remaining, resets_at }
--   on deny:  { ok: true, allowed: false, turns_today, limit, resets_at, message }
-- (Always ok:true — denial is a normal business outcome, not an error.)
--
-- The deny payload carries `message` — a user-facing string the widget
-- renders verbatim. This prevents N clients from each having to construct
-- their own copy ("Nora is resting. Try again tomorrow…" vs any other
-- wording). One place to change it; one place to translate it in the
-- future if i18n of this particular string becomes necessary.
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.nora_consume_turn(
  p_user_id uuid,
  p_limit   int DEFAULT 20
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_turns  int;
  v_resets timestamptz;
  v_now    timestamptz := now();
BEGIN
  -- Ensure a row exists for this user. ON CONFLICT makes this idempotent
  -- across concurrent callers — both will see their INSERT absorbed and
  -- proceed to the FOR UPDATE SELECT below.
  INSERT INTO public.nora_usage (user_id, turns_today, window_resets_at)
  VALUES (p_user_id, 0, v_now + interval '24 hours')
  ON CONFLICT (user_id) DO NOTHING;

  -- Lock the row for the rest of this transaction. Concurrent consumers
  -- block here until we commit — the atomicity fix.
  SELECT turns_today, window_resets_at
    INTO v_turns, v_resets
  FROM public.nora_usage
  WHERE user_id = p_user_id
  FOR UPDATE;

  -- Roll the window if it's expired. We'll persist this below whether or
  -- not we increment, so a user who never hits the cap still gets their
  -- window reset correctly.
  IF v_resets <= v_now THEN
    v_turns := 0;
    v_resets := v_now + interval '24 hours';
  END IF;

  -- Check BEFORE increment. At-limit means deny and return the current
  -- window_resets_at so the client can set a Retry-After header and show
  -- a meaningful "try again at X" message.
  IF v_turns >= p_limit THEN
    UPDATE public.nora_usage
    SET window_resets_at = v_resets,
        updated_at = v_now
    WHERE user_id = p_user_id;

    RETURN jsonb_build_object(
      'ok', true,
      'allowed', false,
      'turns_today', v_turns,
      'limit', p_limit,
      'resets_at', v_resets,
      'message', 'Nora is resting. Try again tomorrow or open a support ticket.'
    );
  END IF;

  -- Allowed — increment, persist, return.
  UPDATE public.nora_usage
  SET turns_today = v_turns + 1,
      window_resets_at = v_resets,
      updated_at = v_now
  WHERE user_id = p_user_id;

  RETURN jsonb_build_object(
    'ok', true,
    'allowed', true,
    'turns_today', v_turns + 1,
    'limit', p_limit,
    'remaining', p_limit - (v_turns + 1),
    'resets_at', v_resets
  );
END
$$;

COMMENT ON FUNCTION public.nora_consume_turn(uuid, int) IS
  'Phase 2.5: atomic check-and-increment for Nora turn limits. Mirrors '
  'guild_advisor_consume_turn. Uses FOR UPDATE to serialize concurrent '
  'calls. Returns allowed=true/false; always ok:true. Rolls the 24h '
  'window automatically on expired window_resets_at. Deny payload '
  'includes a user-facing message string.';

GRANT EXECUTE ON FUNCTION public.nora_consume_turn(uuid, int)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.nora_consume_turn(uuid, int)
  TO service_role;
