-- =============================================================================
-- Migration 015 — Phase 2 Commit 1
-- Three admin-callable RPCs for Guild member actions (probation + tier promote)
-- plus the Advisor rate-limit infrastructure (guild_advisor_usage table +
-- atomic check-and-increment RPC).
-- =============================================================================
--
-- Scope rationale:
--   The three guild RPCs are the backbone of the /admin/guild/members/[id]
--   action panel — admin UIs never UPDATE guild_members directly; every
--   state change flows through one of these so we get auditability, admin
--   caller validation, and a single place to evolve business rules.
--
--   The Advisor rate-limit infrastructure ships now even though the Advisor
--   endpoint is still a 501 stub (/api/guild/agents/advisor is Phase 1D
--   stub). Rationale: the table + RPC are pure infrastructure with zero
--   runtime cost when unused. When Advisor gets real logic in a later
--   phase, enforcement is one RPC call away at the top of the handler.
--
-- Self-healing properties:
--   - All three RPCs use SECURITY DEFINER + is_admin check → can't be
--     bypassed via direct PostgREST calls by non-admin users
--   - guild_advisor_consume_turn uses SELECT ... FOR UPDATE → serializes
--     concurrent turn attempts, preventing the TOCTOU race where two
--     parallel calls both see turns_today=19 and both increment
--   - All functions are idempotent on replay (OR REPLACE); table creates
--     are guarded by IF NOT EXISTS; policy create is guarded via
--     DROP IF EXISTS ... CREATE pattern so re-apply is safe
--
-- Pre-flight amendments folded in:
--   A10: guild_tier_promotions columns are (from_tier, to_tier,
--        promotion_reason, promoted_by) — NOT (reason, actor_id,
--        promotion_type) as the brief's pseudocode assumed. Verified by
--        reading supabase/migrations/010_guild_schema.sql lines 129-146.
--   Tier enum: apprentice | journeyman | artisan | master | fellow |
--        emeritus — NOT apprentice|fellow|master|council. The brief had
--        an out-of-date tier list.
--   Probation columns are NULLABLE — no need for 'infinity'::timestamptz
--        sentinel; NULL works.
--   A12: guild_advisor_consume_turn uses FOR UPDATE inside a single RPC
--        transaction, eliminating the race window of "check turns_today,
--        then increment" as two separate round-trips.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- guild_trigger_probation
-- Manual Council-initiated probation. Auto-lift is already wired via
-- trg_guild_auto_lift_probation on guild_account_fees UPDATE (Phase 1D);
-- this RPC is only for cases where a Council decides to put a member on
-- probation outside the automatic fee-threshold path.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.guild_trigger_probation(
  p_guildmember_id uuid,
  p_reason text,
  p_actor_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_before jsonb;
  v_after jsonb;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_actor_id AND is_admin = true) THEN
    RAISE EXCEPTION 'not_authorised' USING ERRCODE = '42501';
  END IF;

  SELECT to_jsonb(m.*) INTO v_before
  FROM public.guild_members m
  WHERE id = p_guildmember_id
  FOR UPDATE;

  IF v_before IS NULL THEN
    RAISE EXCEPTION 'member_not_found' USING ERRCODE = 'P0002';
  END IF;

  -- Idempotent: if already on probation, return early with status instead
  -- of redundantly updating and bumping updated_at.
  IF v_before->>'status' = 'probation' THEN
    RETURN jsonb_build_object(
      'ok', true,
      'already_on_probation', true,
      'since', v_before->>'probation_started_at',
      'reason', v_before->>'probation_reason'
    );
  END IF;

  UPDATE public.guild_members
  SET status = 'probation',
      probation_reason = p_reason,
      probation_started_at = now(),
      updated_at = now()
  WHERE id = p_guildmember_id;

  SELECT to_jsonb(m.*) INTO v_after
  FROM public.guild_members m
  WHERE id = p_guildmember_id;

  RETURN jsonb_build_object(
    'ok', true,
    'before', v_before,
    'after', v_after,
    'actor_id', p_actor_id
  );
END
$$;

COMMENT ON FUNCTION public.guild_trigger_probation(uuid, text, uuid) IS
  'Phase 2: admin action. Puts a Guildmember on probation with a human-'
  'readable reason. Idempotent — returns already_on_probation=true if '
  'the member is already on probation. Auto-lift via '
  'trg_guild_auto_lift_probation still applies.';

GRANT EXECUTE ON FUNCTION public.guild_trigger_probation(uuid, text, uuid)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.guild_trigger_probation(uuid, text, uuid)
  TO service_role;

-- -----------------------------------------------------------------------------
-- guild_lift_probation
-- Manual lift for cases auto-lift wouldn't apply (e.g., Council decided
-- to un-probate based on communication rather than fee clearance).
-- Auto-lift via trg_guild_auto_lift_probation remains the primary path.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.guild_lift_probation(
  p_guildmember_id uuid,
  p_note text,
  p_actor_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_before jsonb;
  v_after jsonb;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_actor_id AND is_admin = true) THEN
    RAISE EXCEPTION 'not_authorised' USING ERRCODE = '42501';
  END IF;

  SELECT to_jsonb(m.*) INTO v_before
  FROM public.guild_members m
  WHERE id = p_guildmember_id
  FOR UPDATE;

  IF v_before IS NULL THEN
    RAISE EXCEPTION 'member_not_found' USING ERRCODE = 'P0002';
  END IF;

  IF v_before->>'status' <> 'probation' THEN
    RAISE EXCEPTION 'not_on_probation' USING ERRCODE = 'P0002';
  END IF;

  -- probation_reason and probation_started_at are NULLABLE in 010_guild_schema
  -- (lines 110-111). NULL them cleanly rather than using sentinel values.
  UPDATE public.guild_members
  SET status = 'active',
      probation_reason = NULL,
      probation_started_at = NULL,
      updated_at = now()
  WHERE id = p_guildmember_id;

  SELECT to_jsonb(m.*) INTO v_after
  FROM public.guild_members m
  WHERE id = p_guildmember_id;

  RETURN jsonb_build_object(
    'ok', true,
    'before', v_before,
    'after', v_after,
    'note', p_note,
    'actor_id', p_actor_id
  );
END
$$;

COMMENT ON FUNCTION public.guild_lift_probation(uuid, text, uuid) IS
  'Phase 2: admin action. Lifts probation manually. Fails if member is '
  'not currently on probation. Does not reconcile fee balances — that '
  'is the caller''s responsibility. Auto-lift via '
  'trg_guild_auto_lift_probation is the primary path; this is for '
  'Council-discretion cases.';

GRANT EXECUTE ON FUNCTION public.guild_lift_probation(uuid, text, uuid)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.guild_lift_probation(uuid, text, uuid)
  TO service_role;

-- -----------------------------------------------------------------------------
-- guild_promote_tier
-- Council-decision manual tier change. Writes an audit row to
-- guild_tier_promotions with promotion_reason='manual_override' so the
-- promotion history shows the change wasn't criteria-driven.
--
-- Tier enum per 010_guild_schema.sql:
--   apprentice | journeyman | artisan | master | fellow | emeritus
-- Note: the brief's pseudocode had 'council' in the enum — that is NOT
-- in the schema's CHECK constraint. This RPC uses the actual enum.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.guild_promote_tier(
  p_guildmember_id uuid,
  p_new_tier text,
  p_reason text,
  p_actor_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_old_tier text;
  v_promotion_id uuid;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_actor_id AND is_admin = true) THEN
    RAISE EXCEPTION 'not_authorised' USING ERRCODE = '42501';
  END IF;

  IF p_new_tier NOT IN ('apprentice', 'journeyman', 'artisan', 'master', 'fellow', 'emeritus') THEN
    RAISE EXCEPTION 'invalid_tier' USING ERRCODE = '22023';
  END IF;

  SELECT tier INTO v_old_tier
  FROM public.guild_members
  WHERE id = p_guildmember_id
  FOR UPDATE;

  IF v_old_tier IS NULL THEN
    RAISE EXCEPTION 'member_not_found' USING ERRCODE = 'P0002';
  END IF;

  -- No-op if they're already on the target tier. Return cleanly rather
  -- than create a spurious guild_tier_promotions row.
  IF v_old_tier = p_new_tier THEN
    RETURN jsonb_build_object(
      'ok', true,
      'no_change', true,
      'tier', v_old_tier
    );
  END IF;

  UPDATE public.guild_members
  SET tier = p_new_tier,
      tier_since = now(),
      updated_at = now()
  WHERE id = p_guildmember_id;

  -- guild_tier_promotions actual columns per 010_guild_schema.sql lines 129-146:
  --   (id, guildmember_id, from_tier, to_tier, promotion_reason,
  --    evidence, promoted_by, promoted_at)
  -- promotion_reason CHECK includes 'manual_override' — that's the one we use.
  -- Brief's pseudocode used (reason, actor_id, promotion_type) which don't
  -- exist.
  INSERT INTO public.guild_tier_promotions (
    guildmember_id,
    from_tier,
    to_tier,
    promotion_reason,
    evidence,
    promoted_by
  )
  VALUES (
    p_guildmember_id,
    v_old_tier,
    p_new_tier,
    'manual_override',
    jsonb_build_object('note', p_reason),
    p_actor_id
  )
  RETURNING id INTO v_promotion_id;

  RETURN jsonb_build_object(
    'ok', true,
    'from_tier', v_old_tier,
    'to_tier', p_new_tier,
    'promotion_id', v_promotion_id,
    'actor_id', p_actor_id
  );
END
$$;

COMMENT ON FUNCTION public.guild_promote_tier(uuid, text, uuid, uuid) IS
  'Phase 2: admin action. Changes a Guildmember''s tier and writes an '
  'audit row to guild_tier_promotions with promotion_reason=manual_override. '
  'Valid tiers: apprentice, journeyman, artisan, master, fellow, emeritus.';

GRANT EXECUTE ON FUNCTION public.guild_promote_tier(uuid, text, uuid, uuid)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.guild_promote_tier(uuid, text, uuid, uuid)
  TO service_role;

-- =============================================================================
-- Advisor rate-limit infrastructure (ships dormant until Advisor has real logic)
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.guild_advisor_usage (
  user_id          uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  turns_today      integer NOT NULL DEFAULT 0,
  window_resets_at timestamptz NOT NULL DEFAULT (now() + interval '24 hours'),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.guild_advisor_usage IS
  'Phase 2: per-user rolling 24h turn counter for the Advisor agent. '
  'Populated on demand by guild_advisor_consume_turn. The window resets '
  'when window_resets_at <= now() via the same RPC. service_role bypasses '
  'RLS; authenticated users can read only their own row.';

ALTER TABLE public.guild_advisor_usage ENABLE ROW LEVEL SECURITY;

-- Self-read policy. Drop-and-recreate so replay doesn't error on
-- existing policy name.
DROP POLICY IF EXISTS guild_advisor_usage_self_read ON public.guild_advisor_usage;
CREATE POLICY guild_advisor_usage_self_read
  ON public.guild_advisor_usage FOR SELECT
  USING (auth.uid() = user_id);

-- No INSERT / UPDATE / DELETE policies on purpose — writes go via
-- service_role which bypasses RLS. Users cannot directly increment
-- their own turn counter.

-- -----------------------------------------------------------------------------
-- guild_advisor_consume_turn
-- Atomic check-and-increment with optional window rollover. Per A12 the
-- key property is that FOR UPDATE serializes concurrent callers, so the
-- naive "read turns_today; if < limit, UPDATE turns_today+1" race is
-- eliminated: second caller blocks until first commits, then reads the
-- already-incremented value.
--
-- Return shape:
--   on allow:  { ok: true, allowed: true, turns_today, limit, remaining, resets_at }
--   on deny:   { ok: true, allowed: false, turns_today, limit, resets_at }
-- (Always ok:true — denial is a normal business outcome, not an error.)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.guild_advisor_consume_turn(
  p_user_id uuid,
  p_limit   int DEFAULT 20
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_turns   int;
  v_resets  timestamptz;
  v_now     timestamptz := now();
BEGIN
  -- Ensure a row exists for this user. ON CONFLICT makes this idempotent.
  INSERT INTO public.guild_advisor_usage (user_id, turns_today, window_resets_at)
  VALUES (p_user_id, 0, v_now + interval '24 hours')
  ON CONFLICT (user_id) DO NOTHING;

  -- Lock the row for the rest of this transaction. Concurrent consumers
  -- block here until we commit, which is the core of the atomicity fix.
  SELECT turns_today, window_resets_at
    INTO v_turns, v_resets
  FROM public.guild_advisor_usage
  WHERE user_id = p_user_id
  FOR UPDATE;

  -- Roll the window if it's expired. We'll persist this below whether
  -- or not we increment, so a user who never hits the cap still gets
  -- their window reset correctly.
  IF v_resets <= v_now THEN
    v_turns := 0;
    v_resets := v_now + interval '24 hours';
  END IF;

  -- Check BEFORE increment. At-limit means deny and return the current
  -- window_resets_at so the client can set a Retry-After header.
  IF v_turns >= p_limit THEN
    UPDATE public.guild_advisor_usage
    SET window_resets_at = v_resets,
        updated_at = v_now
    WHERE user_id = p_user_id;

    RETURN jsonb_build_object(
      'ok', true,
      'allowed', false,
      'turns_today', v_turns,
      'limit', p_limit,
      'resets_at', v_resets
    );
  END IF;

  -- Allowed — increment, persist, return.
  UPDATE public.guild_advisor_usage
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

COMMENT ON FUNCTION public.guild_advisor_consume_turn(uuid, int) IS
  'Phase 2: atomic check-and-increment for Advisor turn limits. Uses '
  'FOR UPDATE to serialize concurrent calls. Returns allowed=true/false; '
  'always ok:true. Rolls the 24h window automatically on expired '
  'window_resets_at. Ships dormant — Advisor endpoint is still a stub.';

GRANT EXECUTE ON FUNCTION public.guild_advisor_consume_turn(uuid, int)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.guild_advisor_consume_turn(uuid, int)
  TO service_role;
