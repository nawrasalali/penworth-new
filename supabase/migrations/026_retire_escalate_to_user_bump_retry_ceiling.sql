-- CEO-031 Part A — retire the 'escalate_to_user' decision branch.
--
-- Founder directive 2026-04-23:
--   "we do not want authors receive emails when writing agents are stuck
--    this is an internal problem we should handle ourselves and resolve it"
--
-- This migration was applied live on 2026-04-24 via the Supabase management
-- API (Supabase project lodupspxdvadamrqvkje) as part of the same commit
-- that removes the app-side escalate_to_user branch in
-- app/api/cron/pipeline-health/route.ts and updates the stale comment in
-- inngest/functions/restart-agent.ts. The file is committed here for the
-- repo audit trail only; re-running it against the live DB is a no-op.
--
-- Changes:
--  1. Retry ceiling bumped 3 → 5. More headroom before terminal state.
--  2. Terminal state is now ALWAYS escalate_to_admin; the function never
--     returns escalate_to_user again.
--  3. Reason code on the budget-exhausted terminal branch renamed to
--     'retry_budget_exhausted' so Command Center and alert bodies read
--     correctly. The shape of the jsonb decision is otherwise unchanged,
--     so the cron route only needs to drop its escalate_to_user branch.
--
-- No DROP of user_notified_at / recovery_action_taken columns — those
-- hold historical rows and the Command Center UI reads them. The cron
-- route simply stops writing user_notified_at going forward.

CREATE OR REPLACE FUNCTION public.pipeline_should_auto_retry(p_session_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_session record;
BEGIN
  SELECT s.*,
    (SELECT COUNT(*) FROM public.pipeline_incidents
       WHERE session_id = s.id AND incident_type = 'stuck_agent')::integer AS total_stuck_incidents
  INTO v_session
  FROM public.interview_sessions s
  WHERE s.id = p_session_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('retry', false, 'reason', 'session_not_found');
  END IF;

  -- Retry budget exhausted → escalate to admin (ops). Never to the author.
  IF v_session.failure_count >= 5 THEN
    RETURN jsonb_build_object(
      'retry', false,
      'reason', 'retry_budget_exhausted',
      'action', 'escalate_to_admin',
      'failure_count', v_session.failure_count
    );
  END IF;

  IF v_session.pipeline_status NOT IN ('stuck', 'recovering') THEN
    RETURN jsonb_build_object(
      'retry', false,
      'reason', 'not_in_retryable_state',
      'current_status', v_session.pipeline_status
    );
  END IF;

  -- Chronic stuck pattern → escalate to admin (existing behaviour).
  IF v_session.total_stuck_incidents > 5 THEN
    RETURN jsonb_build_object(
      'retry', false,
      'reason', 'chronic_stuck_pattern',
      'action', 'escalate_to_admin',
      'stuck_count', v_session.total_stuck_incidents
    );
  END IF;

  RETURN jsonb_build_object(
    'retry', true,
    'reason', 'within_retry_budget',
    'retry_attempt', v_session.failure_count + 1,
    'current_agent', v_session.current_agent
  );
END;
$function$;

COMMENT ON FUNCTION public.pipeline_should_auto_retry(uuid) IS
  'CEO-031: retry ceiling=5, terminal state always escalate_to_admin. '
  'Authors never emailed on stuck-agent failures — internal problem, '
  'internal escalation only.';
