-- =============================================================================
-- Migration 014: Phase 1E showcase grant billing columns + self-healing helper
-- =============================================================================
--
-- Adds the two columns the project-creation hook needs to tag a project as
-- grant-billed, plus the helper RPC that every downstream credit-deduction
-- call site consults to decide whether to actually debit.
--
-- The helper is intentionally self-healing: it returns false (skip deduction)
-- if EITHER:
--   (a) projects.billing_type = 'showcase_grant', OR
--   (b) a guild_showcase_grants row exists with project_id = :id and
--       status = 'used'
--
-- Branch (b) recovers the tiny race window where guild_consume_showcase_grant
-- succeeded (grant marked 'used' + project_id set) but the subsequent
-- projects.billing_type UPDATE failed. The grant row still correctly
-- references the project, so the helper still correctly returns false.
-- Without this, the user would be double-charged at generation time.
--
-- All objects are idempotent (IF NOT EXISTS / OR REPLACE) so replays are safe.
-- =============================================================================

-- New columns on projects. billing_type defaults to 'credits' so existing
-- rows (created before this migration) are correctly classified. grant_id
-- is NULL for non-grant projects, FK to guild_showcase_grants.
ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS billing_type text DEFAULT 'credits'
    CHECK (billing_type IN ('credits', 'showcase_grant', 'subscription_included'));

ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS grant_id uuid
    REFERENCES public.guild_showcase_grants(id);

-- Partial index: grant_id is NULL for the vast majority of projects, so a
-- partial index is far smaller and still covers the helper's EXISTS check
-- path when loading a grant-billed project.
CREATE INDEX IF NOT EXISTS projects_grant_id_idx
  ON public.projects(grant_id)
  WHERE grant_id IS NOT NULL;

-- -----------------------------------------------------------------------------
-- should_deduct_credits_for_project
--
-- Single source of truth for "should this project's next paid operation
-- actually debit credits?" Used by every deduction call site in the API.
--
-- Returns true  → deduct normally (project is credit-billed)
-- Returns false → skip deduction (project is grant-billed, even if the
--                  billing_type column failed to update post-consume)
--
-- STABLE because the answer depends only on the DB state (no writes).
-- SECURITY DEFINER so we can call it via RPC from the API layer without
-- the caller's RLS blocking the EXISTS subquery on guild_showcase_grants.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.should_deduct_credits_for_project(
  p_project_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT NOT (
    (SELECT billing_type FROM public.projects WHERE id = p_project_id) = 'showcase_grant'
    OR EXISTS (
      SELECT 1
      FROM public.guild_showcase_grants
      WHERE project_id = p_project_id
        AND status = 'used'
    )
  );
$$;

COMMENT ON FUNCTION public.should_deduct_credits_for_project(uuid) IS
  'Phase 1E: call before every credit deduction. Returns false if project is '
  'showcase-grant-billed (via billing_type column OR via self-healing fallback '
  'on guild_showcase_grants.status=used). Never raises; returns true by default '
  'if project does not exist so callers default to the safer path.';

-- Grant execute to authenticated — matches the pattern of other API-called RPCs.
GRANT EXECUTE ON FUNCTION public.should_deduct_credits_for_project(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.should_deduct_credits_for_project(uuid) TO service_role;
