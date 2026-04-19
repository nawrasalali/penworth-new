-- =============================================================================
-- 020_pipeline_health_and_command_center.sql
-- =============================================================================
--
-- Captures the pipeline-health + Command Center schema that already lives in
-- the production Supabase project (lodupspxdvadamrqvkje) but was not committed
-- to the repo alongside migrations 001–019. The DDL below was dumped from
-- live and reassembled here so that:
--
--   - Local `supabase db reset` produces a schema matching production.
--   - Future branches / DR rebuilds don't lose the pipeline-health layer.
--   - Subsequent migrations have a canonical reference for column names,
--     check-constraint vocabulary, and function signatures.
--
-- This migration is written idempotently (CREATE … IF NOT EXISTS,
-- CREATE OR REPLACE FUNCTION/VIEW, DROP …  IF EXISTS before CREATE for
-- triggers and policies) so re-running against a database that already
-- has these objects — live production — is a no-op.
--
-- NO schema changes are introduced here beyond what is already in live.
-- If a future migration needs to extend any object (e.g. add a
-- `resolved_by` column to pipeline_incidents), it MUST be a new numbered
-- migration file, not an edit to this one.
-- =============================================================================


-- =============================================================================
-- 1.  INTERVIEW_SESSIONS — heartbeat + pipeline status columns
-- =============================================================================

ALTER TABLE public.interview_sessions
  ADD COLUMN IF NOT EXISTS current_agent        text NOT NULL DEFAULT 'validate',
  ADD COLUMN IF NOT EXISTS pipeline_status      text NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS agent_status         jsonb NOT NULL DEFAULT
    '{"qa": "waiting", "outline": "waiting", "writing": "waiting", "research": "waiting", "validate": "active", "interview": "waiting", "publishing": "waiting"}'::jsonb,
  ADD COLUMN IF NOT EXISTS agent_started_at     timestamptz,
  ADD COLUMN IF NOT EXISTS agent_heartbeat_at   timestamptz,
  ADD COLUMN IF NOT EXISTS failure_count        integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_failure_at      timestamptz,
  ADD COLUMN IF NOT EXISTS last_failure_reason  text;

-- pipeline_status whitelist
ALTER TABLE public.interview_sessions
  DROP CONSTRAINT IF EXISTS interview_sessions_pipeline_status_check;
ALTER TABLE public.interview_sessions
  ADD CONSTRAINT interview_sessions_pipeline_status_check CHECK (
    pipeline_status = ANY (
      ARRAY['active','stuck','recovering','failed','completed','user_abandoned']
    )
  );

CREATE INDEX IF NOT EXISTS interview_sessions_current_agent_idx
  ON public.interview_sessions (current_agent, pipeline_status);

CREATE INDEX IF NOT EXISTS interview_sessions_heartbeat_idx
  ON public.interview_sessions (pipeline_status, agent_heartbeat_at)
  WHERE pipeline_status = ANY (ARRAY['active','stuck','recovering']);


-- =============================================================================
-- 2.  PROFILES — admin_role column, check, and sync trigger
-- =============================================================================

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS admin_role text;

ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_admin_role_check;
ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_admin_role_check CHECK (
    admin_role IS NULL
    OR admin_role = ANY (ARRAY['super_admin','ops_admin','finance_admin','cs_admin'])
  );

-- Keep is_admin in sync with admin_role. Anyone with a non-null admin_role
-- is an admin; clearing admin_role drops is_admin back to false.
CREATE OR REPLACE FUNCTION public.profiles_sync_is_admin_with_role()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.is_admin := (NEW.admin_role IS NOT NULL);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_profiles_sync_admin ON public.profiles;
CREATE TRIGGER trg_profiles_sync_admin
  BEFORE INSERT OR UPDATE OF admin_role ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.profiles_sync_is_admin_with_role();


-- =============================================================================
-- 3.  HAS_ADMIN_ROLE — central auth helper used by every admin RLS policy
-- =============================================================================
--
-- Behaviour:
--   has_admin_role(uid)             → true for ANY admin role
--   has_admin_role(uid, 'ops_admin')→ true for super_admin OR ops_admin
-- =============================================================================

CREATE OR REPLACE FUNCTION public.has_admin_role(
  p_user_id uuid,
  p_required_role text DEFAULT NULL
)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = p_user_id AND admin_role IS NOT NULL
      AND (p_required_role IS NULL OR admin_role = 'super_admin' OR admin_role = p_required_role)
  );
$$;


-- =============================================================================
-- 4.  ALERT_RECIPIENTS — who gets paged, at what severity, for what category
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.alert_recipients (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email              text NOT NULL,
  full_name          text,
  receives_p0        boolean NOT NULL DEFAULT true,
  receives_p1        boolean NOT NULL DEFAULT true,
  receives_p2        boolean NOT NULL DEFAULT false,
  categories         text[] NOT NULL DEFAULT ARRAY[
                       'pipeline','financial','security',
                       'api_health','ai_cost','user_support'
                     ],
  quiet_hours_start  time without time zone,
  quiet_hours_end    time without time zone,
  timezone           text DEFAULT 'Australia/Adelaide',
  active             boolean NOT NULL DEFAULT true,
  created_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS alert_recipients_active_idx
  ON public.alert_recipients (active) WHERE active = true;

ALTER TABLE public.alert_recipients ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS alert_recipients_admin_read ON public.alert_recipients;
CREATE POLICY alert_recipients_admin_read
  ON public.alert_recipients
  FOR SELECT
  TO authenticated
  USING (public.has_admin_role(auth.uid(), 'super_admin'));


-- =============================================================================
-- 5.  ALERT_LOG — every alert we tried to send, with dedup + delivery state
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.alert_log (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_type      text NOT NULL,
  source_id        uuid,
  severity         text NOT NULL,
  category         text NOT NULL,
  title            text NOT NULL,
  body             text NOT NULL,
  dedup_key        text NOT NULL,
  recipients_json  jsonb NOT NULL DEFAULT '[]'::jsonb,
  sent_at          timestamptz NOT NULL DEFAULT now(),
  delivery_status  text NOT NULL DEFAULT 'pending',
  delivery_error   text,
  acknowledged_by  uuid REFERENCES auth.users(id),
  acknowledged_at  timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.alert_log
  DROP CONSTRAINT IF EXISTS alert_log_severity_check;
ALTER TABLE public.alert_log
  ADD CONSTRAINT alert_log_severity_check CHECK (
    severity = ANY (ARRAY['p0','p1','p2','p3'])
  );

ALTER TABLE public.alert_log
  DROP CONSTRAINT IF EXISTS alert_log_source_type_check;
ALTER TABLE public.alert_log
  ADD CONSTRAINT alert_log_source_type_check CHECK (
    source_type = ANY (ARRAY[
      'pipeline_incident','stripe_webhook_fail','ai_cost_burn',
      'api_health','security','manual'
    ])
  );

ALTER TABLE public.alert_log
  DROP CONSTRAINT IF EXISTS alert_log_delivery_status_check;
ALTER TABLE public.alert_log
  ADD CONSTRAINT alert_log_delivery_status_check CHECK (
    delivery_status = ANY (ARRAY[
      'pending','sent','failed','deduplicated','suppressed_quiet_hours'
    ])
  );

CREATE INDEX IF NOT EXISTS alert_log_dedup_lookup_idx
  ON public.alert_log (source_type, dedup_key, sent_at DESC);

CREATE INDEX IF NOT EXISTS alert_log_severity_idx
  ON public.alert_log (severity, sent_at DESC);

CREATE INDEX IF NOT EXISTS alert_log_unacked_idx
  ON public.alert_log (sent_at DESC) WHERE acknowledged_at IS NULL;

ALTER TABLE public.alert_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS alert_log_admin_read ON public.alert_log;
CREATE POLICY alert_log_admin_read
  ON public.alert_log
  FOR SELECT
  TO authenticated
  USING (public.has_admin_role(auth.uid()));


-- =============================================================================
-- 6.  ALERT_DISPATCH — single entry point for firing an alert
-- =============================================================================
--
-- Inserts a row into alert_log with delivery_status='pending' (or
-- 'suppressed_quiet_hours' when every matching recipient is quiet).
-- The email cron picks pending rows up and sends them.
--
-- Dedup: same (source_type, dedup_key) already sent in the last hour
-- short-circuits with {dispatched:false, reason:'deduplicated'}.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.alert_dispatch(
  p_source_type text,
  p_source_id   uuid,
  p_severity    text,
  p_category    text,
  p_title       text,
  p_body        text,
  p_dedup_key   text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_dedup_key      text;
  v_existing_alert uuid;
  v_recipient      record;
  v_recipients_json jsonb := '[]'::jsonb;
  v_alert_id       uuid;
BEGIN
  v_dedup_key := COALESCE(p_dedup_key, p_source_type || ':' || p_source_id::text);

  -- Dedup: same (source_type, dedup_key) fired in the last hour → skip
  SELECT id INTO v_existing_alert
  FROM public.alert_log
  WHERE source_type = p_source_type
    AND dedup_key = v_dedup_key
    AND sent_at > now() - interval '1 hour'
    AND delivery_status IN ('sent', 'pending')
  ORDER BY sent_at DESC
  LIMIT 1;

  IF FOUND THEN
    RETURN jsonb_build_object('dispatched', false, 'reason', 'deduplicated', 'existing_alert_id', v_existing_alert);
  END IF;

  INSERT INTO public.alert_log (source_type, source_id, severity, category, title, body, dedup_key, delivery_status)
  VALUES (p_source_type, p_source_id, p_severity, p_category, p_title, p_body, v_dedup_key, 'pending')
  RETURNING id INTO v_alert_id;

  FOR v_recipient IN
    SELECT r.email, r.full_name,
      CASE
        WHEN r.quiet_hours_start IS NULL OR r.quiet_hours_end IS NULL THEN false
        WHEN r.quiet_hours_start <= r.quiet_hours_end THEN
          (now() AT TIME ZONE r.timezone)::time BETWEEN r.quiet_hours_start AND r.quiet_hours_end
        ELSE
          (now() AT TIME ZONE r.timezone)::time >= r.quiet_hours_start
          OR (now() AT TIME ZONE r.timezone)::time <= r.quiet_hours_end
      END AS in_quiet
    FROM public.alert_recipients r
    WHERE r.active = true
      AND p_category = ANY(r.categories)
      AND CASE p_severity
            WHEN 'p0' THEN r.receives_p0
            WHEN 'p1' THEN r.receives_p1
            WHEN 'p2' THEN r.receives_p2
            ELSE false
          END
  LOOP
    -- P0 always pages, even during quiet hours.
    IF p_severity = 'p0' OR NOT v_recipient.in_quiet THEN
      v_recipients_json := v_recipients_json || jsonb_build_object(
        'email', v_recipient.email, 'name', v_recipient.full_name
      );
    END IF;
  END LOOP;

  UPDATE public.alert_log
  SET recipients_json = v_recipients_json,
      delivery_status = CASE
        WHEN jsonb_array_length(v_recipients_json) = 0 THEN 'suppressed_quiet_hours'
        ELSE 'pending'
      END
  WHERE id = v_alert_id;

  RETURN jsonb_build_object(
    'dispatched', jsonb_array_length(v_recipients_json) > 0,
    'alert_id', v_alert_id,
    'recipient_count', jsonb_array_length(v_recipients_json),
    'recipients', v_recipients_json
  );
END;
$$;


-- =============================================================================
-- 7.  PIPELINE_INCIDENTS — append-on-insert log of pipeline failures
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.pipeline_incidents (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id            uuid REFERENCES public.interview_sessions(id) ON DELETE CASCADE,
  user_id               uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  incident_type         text NOT NULL,
  agent                 text,
  severity              text NOT NULL,
  detected_at           timestamptz NOT NULL DEFAULT now(),
  detected_by           text NOT NULL DEFAULT 'auto_monitor',
  recovery_action_taken text,
  recovered_at          timestamptz,
  escalated_to_admin    boolean NOT NULL DEFAULT false,
  user_notified_at      timestamptz,
  error_details         jsonb,
  resolved              boolean NOT NULL DEFAULT false,
  resolved_at           timestamptz,
  resolution_note       text,
  created_at            timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.pipeline_incidents
  DROP CONSTRAINT IF EXISTS pipeline_incidents_severity_check;
ALTER TABLE public.pipeline_incidents
  ADD CONSTRAINT pipeline_incidents_severity_check CHECK (
    severity = ANY (ARRAY['p0','p1','p2','p3'])
  );

ALTER TABLE public.pipeline_incidents
  DROP CONSTRAINT IF EXISTS pipeline_incidents_incident_type_check;
ALTER TABLE public.pipeline_incidents
  ADD CONSTRAINT pipeline_incidents_incident_type_check CHECK (
    incident_type = ANY (ARRAY[
      'stuck_agent','api_rate_limit','api_error','token_budget_exhausted',
      'validation_failed','user_abandoned','infrastructure_error','unknown'
    ])
  );

CREATE INDEX IF NOT EXISTS pipeline_incidents_session_idx
  ON public.pipeline_incidents (session_id, detected_at DESC);

CREATE INDEX IF NOT EXISTS pipeline_incidents_severity_idx
  ON public.pipeline_incidents (severity, detected_at DESC)
  WHERE resolved = false;

CREATE INDEX IF NOT EXISTS pipeline_incidents_unresolved_idx
  ON public.pipeline_incidents (detected_at DESC)
  WHERE resolved = false;

ALTER TABLE public.pipeline_incidents ENABLE ROW LEVEL SECURITY;

-- Admins see every incident. Authors see their own (lets the author UI
-- surface a "something went wrong on your book" state without leaking
-- anyone else's.)
DROP POLICY IF EXISTS pipeline_incidents_admin_read ON public.pipeline_incidents;
CREATE POLICY pipeline_incidents_admin_read
  ON public.pipeline_incidents
  FOR SELECT
  TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.profiles
    WHERE profiles.id = auth.uid() AND profiles.is_admin = true
  ));

DROP POLICY IF EXISTS pipeline_incidents_user_own_read ON public.pipeline_incidents;
CREATE POLICY pipeline_incidents_user_own_read
  ON public.pipeline_incidents
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());


-- =============================================================================
-- 8.  PIPELINE_INCIDENTS_AUTO_ALERT — trigger: new incident → dispatch alert
-- =============================================================================

CREATE OR REPLACE FUNCTION public.pipeline_incidents_auto_alert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Retroactive backfills shouldn't page the founder at 3am.
  IF NEW.resolved = false AND NEW.detected_by != 'retroactive_backfill' THEN
    PERFORM public.alert_dispatch(
      p_source_type := 'pipeline_incident',
      p_source_id   := NEW.id,
      p_severity    := NEW.severity,
      p_category    := 'pipeline',
      p_title       := format(
        '[%s] Pipeline incident: %s on %s',
        upper(NEW.severity), NEW.incident_type, COALESCE(NEW.agent, 'unknown')
      ),
      p_body        := format(
        E'Incident %s\nType: %s\nAgent: %s\nUser: %s\nDetected: %s\n\nDetails: %s\n\nCheck /admin/command-center for full context.',
        NEW.id, NEW.incident_type, COALESCE(NEW.agent, '(none)'),
        COALESCE(NEW.user_id::text, '(unknown)'),
        NEW.detected_at, COALESCE(NEW.error_details::text, '{}')
      ),
      p_dedup_key   := NEW.incident_type || ':' || COALESCE(NEW.session_id::text, NEW.id::text)
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_pipeline_incidents_auto_alert ON public.pipeline_incidents;
CREATE TRIGGER trg_pipeline_incidents_auto_alert
  AFTER INSERT ON public.pipeline_incidents
  FOR EACH ROW
  EXECUTE FUNCTION public.pipeline_incidents_auto_alert();


-- =============================================================================
-- 9.  PIPELINE_DETECT_STUCK_SESSIONS — cron workhorse
-- =============================================================================
--
-- Walks every interview_session where pipeline_status='active' and
-- agent_status has at least one agent in "active" state. If the
-- agent_heartbeat_at is older than the per-agent threshold, and there
-- isn't already an unresolved stuck_agent incident for that session,
-- it:
--   1. INSERTs a pipeline_incidents row (which fires the auto_alert
--      trigger and pages the founder via alert_dispatch).
--   2. Updates the session to pipeline_status='stuck'.
--   3. Returns a row so the caller can decide whether to auto-retry.
--
-- Thresholds per agent (minutes):
--   validate 3, interview 10, research 5, outline 5,
--   writing 15, qa 3, cover 10, publishing 20.
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
    WHERE s.pipeline_status = 'active'
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
      -- Skip if we already have an unresolved stuck_agent incident
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


-- =============================================================================
-- 10.  PIPELINE_SHOULD_AUTO_RETRY — cron decision helper
-- =============================================================================
--
-- Given a session id, returns a jsonb decision with shape:
--   { retry: bool, reason: text, action?: 'escalate_to_user'|'escalate_to_admin',
--     retry_attempt?: int, current_agent?: text }
--
-- Rules:
--   failure_count >= 3             → escalate_to_user (author email it)
--   pipeline_status NOT IN (stuck,recovering) → retry:false
--   total stuck incidents > 5      → escalate_to_admin (chronic)
--   else                            → retry:true
-- =============================================================================

CREATE OR REPLACE FUNCTION public.pipeline_should_auto_retry(p_session_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
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

  IF v_session.failure_count >= 3 THEN
    RETURN jsonb_build_object(
      'retry', false,
      'reason', 'max_retries_exceeded',
      'action', 'escalate_to_user',
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
$$;


-- =============================================================================
-- 11.  COMMAND CENTER VIEWS
-- =============================================================================

CREATE OR REPLACE VIEW public.v_pipeline_health_snapshot AS
SELECT
  count(*) FILTER (WHERE pipeline_status = 'active')     AS sessions_active,
  count(*) FILTER (WHERE pipeline_status = 'stuck')      AS sessions_stuck,
  count(*) FILTER (WHERE pipeline_status = 'recovering') AS sessions_recovering,
  count(*) FILTER (WHERE pipeline_status = 'failed')     AS sessions_failed_24h,
  count(*) FILTER (WHERE current_agent = 'validate'   AND pipeline_status = 'active') AS validate_active,
  count(*) FILTER (WHERE current_agent = 'interview'  AND pipeline_status = 'active') AS interview_active,
  count(*) FILTER (WHERE current_agent = 'writing'    AND pipeline_status = 'active') AS writing_active,
  count(*) FILTER (WHERE current_agent = 'publishing' AND pipeline_status = 'active') AS publishing_active,
  (SELECT count(*) FROM public.pipeline_incidents WHERE resolved = false)                           AS open_incidents,
  (SELECT count(*) FROM public.pipeline_incidents WHERE resolved = false AND severity = 'p0')       AS p0_open,
  (SELECT count(*) FROM public.pipeline_incidents WHERE resolved = false AND severity = 'p1')       AS p1_open,
  (SELECT count(*) FROM public.pipeline_incidents WHERE detected_at > now() - interval '24 hours')  AS incidents_24h,
  (SELECT CASE WHEN count(*) > 0
            THEN round(100.0 * count(*) FILTER (WHERE pipeline_status = 'completed')::numeric / count(*)::numeric, 2)
            ELSE NULL::numeric END
     FROM public.interview_sessions
     WHERE updated_at > now() - interval '24 hours') AS success_rate_24h_pct,
  (SELECT EXTRACT(epoch FROM now() - min(detected_at)) / 60::numeric
     FROM public.pipeline_incidents WHERE resolved = false) AS oldest_incident_minutes,
  (SELECT EXTRACT(epoch FROM now() - max(detected_at)) / 60::numeric
     FROM public.pipeline_incidents) AS minutes_since_last_incident
FROM public.interview_sessions
WHERE pipeline_status IN ('active','stuck','recovering')
   OR (pipeline_status = 'failed' AND last_failure_at > now() - interval '24 hours');


CREATE OR REPLACE VIEW public.v_agent_load_by_window AS
SELECT
  current_agent,
  count(*) FILTER (WHERE pipeline_status = 'active' AND agent_heartbeat_at > now() - interval '2 minutes') AS truly_running_now,
  count(*) FILTER (WHERE pipeline_status = 'active')                                                       AS marked_active,
  count(*) FILTER (WHERE pipeline_status = 'stuck')                                                        AS stuck,
  count(*) FILTER (WHERE updated_at > now() - interval '1 hour' AND pipeline_status = 'completed')         AS completed_last_hour,
  count(*) FILTER (WHERE updated_at > now() - interval '1 hour' AND pipeline_status = 'failed')            AS failed_last_hour
FROM public.interview_sessions
WHERE current_agent IS NOT NULL
GROUP BY current_agent
ORDER BY current_agent;


CREATE OR REPLACE VIEW public.v_system_capacity_snapshot AS
SELECT
  (SELECT count(*) FROM public.profiles)                                                                      AS total_authors,
  (SELECT count(*) FROM public.profiles WHERE plan <> 'free')                                                 AS paid_authors,
  (SELECT count(DISTINCT user_id) FROM public.interview_sessions
     WHERE updated_at > now() - interval '24 hours')                                                          AS active_authors_24h,
  (SELECT count(*) FROM public.guild_members WHERE status = 'active')                                         AS active_guildmembers,
  (SELECT count(*) FROM public.guild_members WHERE status = 'probation')                                      AS probation_guildmembers,
  (SELECT count(*) FROM public.store_readers)                                                                 AS total_readers,
  (SELECT count(*) FROM public.store_reading_progress
     WHERE last_read_at > now() - interval '24 hours')                                                        AS active_readers_24h,
  (SELECT count(*) FROM public.interview_sessions
     WHERE pipeline_status = 'active'
       AND agent_heartbeat_at > now() - interval '2 minutes')                                                 AS pipelines_running_now,
  (SELECT count(*) FROM public.nora_conversations
     WHERE last_turn_at > now() - interval '2 minutes')                                                       AS nora_active_now,
  (SELECT COALESCE(sum(cost_usd), 0) FROM public.usage
     WHERE created_at > now() - interval '1 hour')                                                            AS ai_cost_last_hour_usd,
  (SELECT COALESCE(sum(tokens_input + tokens_output), 0) FROM public.usage
     WHERE created_at > now() - interval '1 hour')                                                            AS tokens_last_hour,
  (SELECT count(*) FROM public.stripe_webhook_events WHERE processing_status = 'failed')                      AS stripe_webhook_failures,
  (SELECT EXTRACT(epoch FROM now() - max(received_at)) / 60
     FROM public.stripe_webhook_events)                                                                       AS minutes_since_last_webhook;


CREATE OR REPLACE VIEW public.v_command_center_super_admin AS
SELECT
  (SELECT row_to_json(x.*) FROM public.v_system_capacity_snapshot x)                                          AS system_capacity,
  (SELECT row_to_json(x.*) FROM public.v_pipeline_health_snapshot x)                                          AS pipeline_health,
  (SELECT jsonb_agg(row_to_json(x.*)) FROM public.v_agent_load_by_window x)                                   AS agent_load,
  (SELECT jsonb_agg(row_to_json(i.*) ORDER BY i.detected_at DESC) FROM (
     SELECT id, incident_type, agent, severity, detected_at, session_id, user_id, resolved
     FROM public.pipeline_incidents
     ORDER BY detected_at DESC LIMIT 100
   ) i)                                                                                                       AS recent_incidents,
  (SELECT jsonb_agg(row_to_json(a.*) ORDER BY a.sent_at DESC) FROM (
     SELECT id, source_type, severity, category, title, sent_at, acknowledged_at, delivery_status
     FROM public.alert_log ORDER BY sent_at DESC LIMIT 50
   ) a)                                                                                                       AS recent_alerts,
  (SELECT count(*) FROM public.support_tickets WHERE status = 'open')                                         AS tickets_open,
  (SELECT count(*) FROM public.guild_members WHERE status = 'active')                                         AS members_active,
  (SELECT count(*) FROM public.guild_members WHERE status = 'probation')                                      AS members_probation,
  (SELECT count(*) FROM public.guild_fraud_flags WHERE status IN ('open','investigating'))                    AS open_fraud_flags,
  (SELECT COALESCE(sum(cost_usd), 0) FROM public.usage WHERE created_at > now() - interval '1 hour')          AS ai_cost_1h,
  (SELECT count(*) FROM public.stripe_webhook_events WHERE processing_status = 'failed')                      AS stripe_failures
WHERE public.has_admin_role(auth.uid(), 'super_admin');


CREATE OR REPLACE VIEW public.v_command_center_ops AS
SELECT
  (SELECT row_to_json(x.*) FROM public.v_pipeline_health_snapshot x)                                          AS pipeline_health,
  (SELECT jsonb_agg(row_to_json(x.*)) FROM public.v_agent_load_by_window x)                                   AS agent_load,
  (SELECT jsonb_agg(row_to_json(i.*) ORDER BY i.detected_at DESC) FROM (
     SELECT id, incident_type, agent, severity, detected_at, session_id, user_id, resolved, error_details
     FROM public.pipeline_incidents
     WHERE resolved = false OR detected_at > now() - interval '24 hours'
     ORDER BY detected_at DESC LIMIT 50
   ) i)                                                                                                       AS recent_incidents,
  (SELECT count(*) FROM public.support_tickets WHERE status = 'open')                                         AS tickets_open,
  (SELECT count(*) FROM public.support_tickets WHERE status = 'open' AND priority = 'urgent')                 AS tickets_urgent,
  (SELECT count(*) FROM public.nora_conversations WHERE last_turn_at > now() - interval '1 hour')             AS nora_active_1h
WHERE public.has_admin_role(auth.uid(), 'ops_admin');


CREATE OR REPLACE VIEW public.v_command_center_finance AS
SELECT
  (SELECT count(*) FROM public.stripe_webhook_events WHERE processing_status = 'failed')                      AS stripe_failures,
  (SELECT EXTRACT(epoch FROM now() - max(received_at)) / 60 FROM public.stripe_webhook_events)                AS minutes_since_last_webhook,
  (SELECT count(*) FROM public.guild_commissions WHERE status = 'pending')                                    AS pending_commissions,
  (SELECT COALESCE(sum(commission_amount_usd), 0) FROM public.guild_commissions
     WHERE status IN ('pending','locked'))                                                                    AS pending_commission_usd,
  (SELECT count(*) FROM public.guild_payouts WHERE status = 'queued')                                         AS queued_payouts,
  (SELECT COALESCE(sum(net_amount_usd), 0) FROM public.guild_payouts WHERE status = 'queued')                 AS queued_payout_usd,
  (SELECT COALESCE(sum(cost_usd), 0) FROM public.usage WHERE created_at > now() - interval '1 hour')          AS ai_cost_1h,
  (SELECT COALESCE(sum(cost_usd), 0) FROM public.usage WHERE created_at > now() - interval '24 hours')        AS ai_cost_24h,
  (SELECT COALESCE(sum(cost_usd), 0) FROM public.usage WHERE created_at > date_trunc('month', now()))         AS ai_cost_mtd,
  (SELECT count(*) FROM public.credit_transactions
     WHERE transaction_type = 'purchase' AND created_at > date_trunc('month', now()))                         AS purchases_mtd,
  (SELECT COALESCE(sum(amount_deferred_usd), 0) FROM public.guild_account_fees
     WHERE amount_deferred_usd > 0)                                                                           AS total_deferred_balance
WHERE public.has_admin_role(auth.uid(), 'finance_admin');


CREATE OR REPLACE VIEW public.v_command_center_cs AS
SELECT
  (SELECT jsonb_agg(row_to_json(t.*) ORDER BY t.created_at DESC) FROM (
     SELECT id, ticket_number, user_email, category, priority, status, subject, created_at
     FROM public.support_tickets
     WHERE status IN ('open','in_progress','awaiting_user')
     ORDER BY priority DESC, created_at DESC LIMIT 50
   ) t)                                                                                                       AS open_tickets,
  (SELECT count(*) FROM public.support_tickets WHERE status = 'open')                                         AS tickets_open_count,
  (SELECT count(*) FROM public.nora_conversations
     WHERE resolution = 'open' AND last_turn_at > now() - interval '24 hours')                                AS nora_conversations_24h,
  (SELECT count(*) FROM public.guild_members WHERE status = 'probation')                                      AS members_on_probation,
  (SELECT count(*) FROM public.guild_fraud_flags WHERE status IN ('open','investigating'))                    AS open_fraud_flags,
  (SELECT count(DISTINCT user_id) FROM public.interview_sessions
     WHERE pipeline_status IN ('stuck','failed')
       AND updated_at > now() - interval '24 hours')                                                          AS authors_with_failures_24h
WHERE public.has_admin_role(auth.uid(), 'cs_admin');


-- =============================================================================
-- 12.  SEED — alert_recipients default row (founder)
-- =============================================================================
--
-- Idempotent: only inserts if the founder row doesn't already exist.
-- Email match is used as the natural key since there's no UNIQUE
-- constraint on email in the live schema.
-- =============================================================================

INSERT INTO public.alert_recipients (
  email, full_name, receives_p0, receives_p1, receives_p2, categories, active
)
SELECT
  'nawras@penworth.ai', 'Nawras Alali', true, true, true,
  ARRAY['pipeline','financial','security','api_health','ai_cost','user_support'],
  true
WHERE NOT EXISTS (
  SELECT 1 FROM public.alert_recipients WHERE email = 'nawras@penworth.ai'
);


-- =============================================================================
-- 13.  GRANTS
-- =============================================================================

-- Function grants mirror the live permissions (SECURITY DEFINER functions
-- still need EXECUTE for PostgREST to call them from the service role).
GRANT EXECUTE ON FUNCTION public.has_admin_role(uuid, text)                 TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.alert_dispatch(text, uuid, text, text, text, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.pipeline_detect_stuck_sessions()           TO service_role;
GRANT EXECUTE ON FUNCTION public.pipeline_should_auto_retry(uuid)           TO service_role;
