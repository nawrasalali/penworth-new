-- =============================================================================
-- 021_pipeline_detector_also_scans_stuck_and_recovering.sql
-- =============================================================================
--
-- The original detector from migration 020 only scans pipeline_status='active'
-- sessions. That created a silent dead-end: once a stuck session was flagged
-- (status flips to 'stuck') or a retry was triggered (status flips to
-- 'recovering'), the detector would never look at it again. If the retry
-- consumer didn't exist or failed silently, the session would stay in
-- 'recovering' forever with no escalation path.
--
-- This migration extends the detector to ALSO scan 'stuck' and 'recovering'
-- sessions whose heartbeats are still stale. Combined with the cron handler
-- bumping failure_count on every retry attempt, this lets the auto-recovery
-- loop self-terminate at failure_count=3 via escalate_to_user.
--
-- No other changes. Same per-agent thresholds. Same incident-dedup check.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.pipeline_detect_stuck_sessions()
RETURNS TABLE(
  session_id      uuid,
  user_id         uuid,
  current_agent   text,
  minutes_stale   integer,
  incident_id     uuid
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_session            record;
  v_threshold_minutes  integer;
  v_incident_id        uuid;
BEGIN
  FOR v_session IN
    SELECT
      s.id, s.user_id, s.current_agent,
      COALESCE(
        EXTRACT(EPOCH FROM (now() - s.agent_heartbeat_at))/60,
        EXTRACT(EPOCH FROM (now() - s.updated_at))/60
      )::integer AS minutes_since_heartbeat
    FROM public.interview_sessions s
    -- Extended: was 'active' only. Now catches 'stuck' and 'recovering'
    -- too, so re-detection works after the cron flips state.
    WHERE s.pipeline_status IN ('active', 'stuck', 'recovering')
      AND s.current_agent IS NOT NULL
      AND s.agent_status::text LIKE '%"active"%'
  LOOP
    v_threshold_minutes := CASE v_session.current_agent
      WHEN 'validate'   THEN 3
      WHEN 'interview'  THEN 10
      WHEN 'research'   THEN 5
      WHEN 'outline'    THEN 5
      WHEN 'writing'    THEN 15
      WHEN 'qa'         THEN 3
      WHEN 'cover'      THEN 10
      WHEN 'publishing' THEN 20
      ELSE 10
    END;

    IF v_session.minutes_since_heartbeat > v_threshold_minutes THEN
      -- Dedup: only create a new incident if there isn't already an
      -- unresolved stuck_agent incident for this session. The cron
      -- resolves incidents after handling them, so the next detection
      -- pass is unblocked.
      IF NOT EXISTS (
        SELECT 1 FROM public.pipeline_incidents
        WHERE session_id = v_session.id
          AND incident_type = 'stuck_agent'
          AND resolved = false
      ) THEN
        INSERT INTO public.pipeline_incidents (
          session_id, user_id, incident_type, agent, severity, error_details
        ) VALUES (
          v_session.id, v_session.user_id, 'stuck_agent',
          v_session.current_agent,
          CASE
            WHEN v_session.minutes_since_heartbeat > 60 THEN 'p0'
            WHEN v_session.minutes_since_heartbeat > 30 THEN 'p1'
            WHEN v_session.minutes_since_heartbeat > 10 THEN 'p2'
            ELSE 'p3'
          END,
          jsonb_build_object(
            'minutes_stale', v_session.minutes_since_heartbeat,
            'threshold', v_threshold_minutes,
            'agent_status_at_detection',
              (SELECT agent_status FROM public.interview_sessions WHERE id = v_session.id)
          )
        ) RETURNING id INTO v_incident_id;

        -- Keep session flagged as stuck. If it was already 'stuck' or
        -- 'recovering', we don't demote it to a different state — the
        -- cron handler owns that transition after deciding.
        UPDATE public.interview_sessions
        SET pipeline_status     = 'stuck',
            last_failure_at     = now(),
            last_failure_reason = format(
              'Agent %s heartbeat stale for %s minutes (threshold %s min)',
              v_session.current_agent,
              v_session.minutes_since_heartbeat,
              v_threshold_minutes
            )
        WHERE id = v_session.id;

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
$$;
