-- Migration 028: replace Guild monthly account fee with paying-author requirement.
--
-- POLICY CHANGE (decided 2026-04-25 by Founder):
--
-- OLD model: After 90 days, Apprentices paid $20/month, Journeymen $25,
--            Artisans $30, Masters $35, Fellows $40, deducted from
--            commissions on monthly close (guild_compute_account_fee).
--
-- NEW model: After 90 days, the Guildmember must be a PAYING AUTHOR
--            themselves — i.e. on the Pro ($19/mo) or Max ($49/mo) plan.
--            If they drop to free, they go on probation. If they don't
--            recover within the grace window, membership is suspended.
--
-- Why: cleaner economics, no parallel billing system, and authentic
-- ("walk the talk" — Guildmembers must use the product they sell).
-- Pro at $19 already exceeds the old Apprentice $20 fee, so this is
-- accretive to Penworth revenue.
--
-- This migration:
--   1. Repurposes account_fee_starts_at semantically — the column now
--      means "paid-author requirement starts at this date." Renaming would
--      break too many call sites; we add a clarifying comment instead.
--   2. Replaces guild_compute_account_fee() with a no-op that returns
--      0 for every tier (so existing close logic safely passes through
--      until callers are updated to the paid-author check).
--   3. Adds guild_assess_paid_author_status() — the new check function.
--   4. Records the policy decision in audit_log for traceability.
--
-- The application-level closeGuildMonth() in lib/guild/commissions.ts is
-- updated in the same commit to use the new paid-author check.
--
-- BACKWARD COMPATIBILITY: existing rows in guild_account_fees are
-- preserved as historical record. New rows stop being created after
-- this migration + the corresponding code change deploy.

BEGIN;

-- 1. Document the column's new meaning. Renaming would cascade through
-- many tables/views/functions; a comment is the lighter touch.
COMMENT ON COLUMN public.guild_members.account_fee_starts_at IS
  'Date from which the paid-author requirement applies. Member must be on '
  'a paid plan (Pro or Max) on or after this date to remain in good standing. '
  'Replaces the legacy account_fee policy (migration 028). Set on join '
  'as joined_at + 90 days.';

-- 2. Neuter the legacy fee function. We keep the function so old close
-- runs that still call it don't crash, but it now returns $0 for all
-- tiers. Callers should be migrated to guild_assess_paid_author_status.
CREATE OR REPLACE FUNCTION public.guild_compute_account_fee(p_tier text)
RETURNS numeric
LANGUAGE sql
IMMUTABLE
AS $$
  -- Migration 028: this fee is retired. Always returns 0.
  -- New policy enforced via guild_assess_paid_author_status().
  SELECT 0.00::numeric;
$$;

COMMENT ON FUNCTION public.guild_compute_account_fee(text) IS
  'DEPRECATED in migration 028. Always returns 0. Guild membership is now '
  'gated by paid-author status (Pro/Max plan), not a separate Guild fee. '
  'Use guild_assess_paid_author_status(uuid) instead.';

-- 3. The new check function. Returns one of:
--   'compliant'         — member is on Pro or Max
--   'pre_grace'         — within first 90 days, no requirement yet
--   'non_paying'        — past grace, on free plan, should be on probation
--   'no_profile'        — orphan record, surface for ops attention
CREATE OR REPLACE FUNCTION public.guild_assess_paid_author_status(p_user_id uuid)
RETURNS text
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_plan text;
  v_starts_at timestamptz;
BEGIN
  SELECT p.plan, gm.account_fee_starts_at
    INTO v_plan, v_starts_at
    FROM public.guild_members gm
    JOIN public.profiles p ON p.id = gm.user_id
   WHERE gm.user_id = p_user_id;

  IF NOT FOUND THEN
    RETURN 'no_profile';
  END IF;

  -- Pre-grace window — newly-joined Apprentices have time to write
  -- their three free books before any paid-plan requirement applies.
  IF v_starts_at IS NULL OR v_starts_at > now() THEN
    RETURN 'pre_grace';
  END IF;

  -- After grace: must be on a paid plan.
  IF v_plan IN ('pro', 'max') THEN
    RETURN 'compliant';
  END IF;

  RETURN 'non_paying';
END;
$$;

COMMENT ON FUNCTION public.guild_assess_paid_author_status(uuid) IS
  'New paid-author check (migration 028). Returns the membership '
  'compliance state for a Guildmember based on whether they are on '
  'Pro or Max plan past their 90-day grace window. Called from '
  'closeGuildMonth() to decide probation transitions.';

-- 4. Audit-log the policy change.
INSERT INTO public.audit_log (
  actor_user_id, actor_type, action, entity_type, entity_id, metadata
) VALUES (
  '916a7d24-cc36-4eb7-9ad7-6358ec50bc8d',  -- Founder UID
  'admin',
  'guild_policy_change',
  'policy',
  'guild_paid_author_requirement',
  jsonb_build_object(
    'migration', '028_guild_paid_author_policy',
    'old_policy', 'monthly_account_fee_$20_to_$40_per_tier',
    'new_policy', 'must_be_on_pro_or_max_after_90_days',
    'effective', now(),
    'decided_by', 'Founder',
    'rationale', 'walk_the_talk_authentic_advocacy_plus_cleaner_economics'
  )
);

COMMIT;
