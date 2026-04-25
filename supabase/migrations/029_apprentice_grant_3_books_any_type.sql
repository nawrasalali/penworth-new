-- Migration 029: Apprentice showcase grant — 5 categories → 3 of any kind.
--
-- POLICY CHANGE (Founder, 2026-04-25):
-- Old: New Apprentices got 5 grants, one per category (book, business,
--      academic, legal, technical). Could only consume a grant when the
--      project's content_type matched the grant's category.
-- New: New Apprentices get 3 grants of any kind. The writer chooses what
--      to write — no category gating. Aligns with the "3 free books" copy
--      shipped in commit c2df108 and the "walk the talk" Guild policy in
--      migration 028.
--
-- Backward compatibility: existing rows are untouched. The Founder (the
-- only current Guildmember) keeps his 5 historical grants. New members
-- get 3 'showcase' grants going forward.
--
-- The CHECK constraint on category is loosened to add 'showcase'. The
-- consume RPC drops the category match — any unused grant for the member
-- is taken, oldest first.

BEGIN;

-- 1. Loosen category check to allow the new generic 'showcase' category.
ALTER TABLE public.guild_showcase_grants
  DROP CONSTRAINT IF EXISTS guild_showcase_grants_category_check;

ALTER TABLE public.guild_showcase_grants
  ADD CONSTRAINT guild_showcase_grants_category_check
  CHECK (category = ANY (ARRAY[
    'book', 'business', 'academic', 'legal', 'technical',
    'showcase'  -- migration 029: new generic Apprentice grant
  ]));

-- 2. New trigger: seed 3 generic 'showcase' grants per new Guildmember.
CREATE OR REPLACE FUNCTION public.guild_members_create_showcase_grants()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.status IN ('active', 'probation') THEN
    -- Migration 029: 3 generic grants instead of 5 category-locked.
    -- The Apprentice chooses what to write; the grant is content-agnostic.
    INSERT INTO public.guild_showcase_grants (guildmember_id, category)
    VALUES
      (NEW.id, 'showcase'),
      (NEW.id, 'showcase'),
      (NEW.id, 'showcase');
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.guild_members_create_showcase_grants() IS
  'Migration 029: seeds 3 generic showcase grants for new Guildmembers. '
  'Replaces the 5-category seeding from migration 010.';

-- 3. New consume RPC: drop the category match. Any unused grant for the
-- member is consumed, oldest first. content_type is still recorded for
-- audit but no longer gates eligibility.
CREATE OR REPLACE FUNCTION public.guild_consume_showcase_grant(
  p_user_id      uuid,
  p_content_type text,
  p_project_id   uuid
) RETURNS jsonb
LANGUAGE plpgsql
AS $func$
DECLARE
  v_member_id     uuid;
  v_member_status text;
  v_grant_id      uuid;
  v_grant_category text;
BEGIN
  SELECT id, status INTO v_member_id, v_member_status
  FROM public.guild_members
  WHERE user_id = p_user_id
  LIMIT 1;

  IF v_member_id IS NULL THEN
    RETURN jsonb_build_object('consumed', false, 'reason', 'not_a_guildmember');
  END IF;

  IF v_member_status NOT IN ('active', 'probation') THEN
    RETURN jsonb_build_object(
      'consumed', false,
      'reason', 'member_status_ineligible',
      'status', v_member_status
    );
  END IF;

  -- Migration 029: drop the category match. Any unused grant is fair
  -- game. ORDER BY granted_at so the oldest grant gets used first
  -- (FIFO; matters for old members with mixed-category historical
  -- grants — they should consume the legacy ones first).
  SELECT id, category INTO v_grant_id, v_grant_category
  FROM public.guild_showcase_grants
  WHERE guildmember_id = v_member_id
    AND status = 'unused'
  ORDER BY granted_at ASC
  FOR UPDATE SKIP LOCKED
  LIMIT 1;

  IF v_grant_id IS NULL THEN
    RETURN jsonb_build_object('consumed', false, 'reason', 'no_unused_grant');
  END IF;

  UPDATE public.guild_showcase_grants
  SET status = 'used',
      used_at = now(),
      project_id = p_project_id
  WHERE id = v_grant_id;

  RETURN jsonb_build_object(
    'consumed', true,
    'grant_id', v_grant_id,
    'category', v_grant_category,
    'content_type', p_content_type,  -- recorded for audit
    'member_id', v_member_id
  );
END;
$func$;

COMMENT ON FUNCTION public.guild_consume_showcase_grant(uuid, text, uuid) IS
  'Migration 029: consumes any unused grant (oldest first), regardless '
  'of category. content_type is recorded for audit only — no longer '
  'gates eligibility. Replaces the category-matched logic from migration 014.';

-- 4. Audit-log the policy change.
INSERT INTO public.audit_log (
  actor_user_id, actor_type, action, entity_type, entity_id, metadata
) VALUES (
  '916a7d24-cc36-4eb7-9ad7-6358ec50bc8d',
  'admin',
  'guild_policy_change',
  'policy',
  'guild_apprentice_grant_redesign',
  jsonb_build_object(
    'migration', '029_apprentice_grant_3_books_any_type',
    'old_policy', '5_category_locked_grants_per_member',
    'new_policy', '3_generic_grants_per_member_writer_chooses',
    'effective', now(),
    'decided_by', 'Founder',
    'rationale', 'simpler_apprentice_walk_the_talk_writer_chooses_book_type',
    'historical_data_preserved', true
  )
);

COMMIT;
