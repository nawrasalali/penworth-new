-- Migration: Scope pipeline_detect_stuck_sessions() to the writing agent only.
--
-- CEO-161 — applied to live DB on 2026-04-26 (Supabase MCP version 20260426234259);
-- this file backfills the SQL into the repo so source-of-truth stays in git.
--
-- Background:
-- Non-writing pipeline stages (validate, interview, research, outline, qa, cover)
-- are synchronous /api/ai/* serverless routes triggered by user clicks. They are
-- NOT Inngest background workers, so an "active" agent_status on those stages
-- means "user has the screen open" rather than "a worker is running". Applying
-- heartbeat-based stuck detection to those stages produces a false positive
-- every time a user idles on a screen for more than the threshold.
--
-- Only the writing agent has out-of-band Inngest workers with periodic
-- agent_heartbeat_at writes. Stuck detection is therefore meaningful only on
-- current_agent='writing'. The publishing stage was already excluded by an
-- earlier patch (ceo031_detector_exclude_publishing_and_stuck_current_only,
-- version 20260424171809); this migration tightens the filter to the single
-- agent the heuristic is actually valid for.
--
-- Empirical verification (run before backfilling this file): zero stuck_agent
-- incidents on non-writing stages in the 36 hours after the migration shipped.

CREATE OR REPLACE FUNCTION public.pipeline_detect_stuck_sessions()
 RETURNS TABLE(session_id uuid, user_id uuid, current_agent text, minutes_stale integer, incident_id uuid)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_session            record;
  v_threshold_minutes  integer := 45;  -- writing-only threshold
  v_incident_id        uuid;
BEGIN
  FOR v_session IN
    SELECT
      s.id, s.user_id, s.current_agent,
      COALESCE(
        EXTRACT(EPOCH FROM (now() - s.agent_heartbeat_at))/60,
        EXTRACT(EPOCH FROM (now() - s.updated_at))/60
      )::integer AS minutes_since_heartbeat,
      s.agent_status
    FROM public.interview_sessions s
    WHERE s.pipeline_status IN ('active', 'stuck', 'recovering')
      -- Writing is the only agent with a real out-of-band background
      -- worker and heartbeat keepalive. All others are user-driven
      -- UI stages where active=on-screen, not active=worker-running.
      -- Detecting "stuck" on those stages is meaningless and false-
      -- positives every time a user idles on a screen for >threshold.
      -- (CEO-161; see migration commentary above.)
      AND s.current_agent = 'writing'
      AND s.agent_status->>s.current_agent = 'active'
  LOOP
    IF v_session.minutes_since_heartbeat > v_threshold_minutes THEN
      IF NOT EXISTS (
        SELECT 1
        FROM public.pipeline_incidents pi
        WHERE pi.session_id = v_session.id
          AND pi.incident_type = 'stuck_agent'
          AND pi.resolved = false
      ) THEN
        INSERT INTO public.pipeline_incidents (
          session_id, user_id, incident_type, agent, severity, error_details
        ) VALUES (
          v_session.id, v_session.user_id, 'stuck_agent',
          v_session.current_agent,
          CASE
            WHEN v_session.minutes_since_heartbeat > 120 THEN 'p0'
            WHEN v_session.minutes_since_heartbeat > 60 THEN 'p1'
            WHEN v_session.minutes_since_heartbeat > 30 THEN 'p2'
            ELSE 'p3'
          END,
          jsonb_build_object(
            'minutes_stale', v_session.minutes_since_heartbeat,
            'threshold', v_threshold_minutes,
            'agent_status_at_detection',
              (SELECT s.agent_status FROM public.interview_sessions s WHERE s.id = v_session.id)
          )
        ) RETURNING id INTO v_incident_id;

        UPDATE public.interview_sessions s
        SET pipeline_status     = 'stuck',
            last_failure_at     = now(),
            last_failure_reason = format(
              'Agent %s heartbeat stale for %s minutes (threshold %s min)',
              v_session.current_agent,
              v_session.minutes_since_heartbeat,
              v_threshold_minutes
            )
        WHERE s.id = v_session.id;

        session_id    := v_session.id;
        user_id       := v_session.user_id;
        current_agent := v_session.current_agent;
        minutes_stale := v_session.minutes_since_heartbeat;
        incident_id   := v_incident_id;
        RETURN NEXT;
      END IF;
    END IF;
  END LOOP;

  RETURN;
END;
$function$;
