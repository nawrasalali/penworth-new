-- ============================================================================
-- Migration 016: audit_log — append-only audit trail for Command Center + DD
-- ============================================================================
--
-- APPLIED TO PRODUCTION: Supabase version 20260418185405 under the name
-- '015_audit_log_append_only' (applied via Supabase MCP before the other
-- chat landed 015_phase_2_admin_rpcs_and_advisor_rate_limit.sql). Renamed
-- to 016 on disk for ordering clarity; DB version unchanged.
--
-- Purpose: Every financial transaction, admin action, attribution decision,
-- and data-state change that could be relevant to an investor, regulator,
-- or auditor gets logged here. The table is strictly append-only:
--   - No UPDATE statements permitted (revoked on public, enforced by trigger)
--   - No DELETE statements permitted (revoked on public, enforced by trigger)
--   - 7-year minimum retention per Australian Corporations Act record-keeping
--     rules (s286, s290) and Anti-Money Laundering and Counter-Terrorism
--     Financing Act 2006 s107.
--
-- Consumers of this table:
--   - Monthly Investor Update report (financial summary)
--   - Quarterly Board Report (complete activity log)
--   - Due Diligence Data Room Export (everything, 7-year window)
--   - Command Center activity feed (real-time, last 24h)
--
-- Write path: lib/audit.ts logAudit() / logAuditFromRequest() helpers,
-- called from API routes via the service-role client (bypasses RLS).

CREATE TABLE IF NOT EXISTS public.audit_log (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at      timestamptz NOT NULL DEFAULT now(),
  actor_user_id   uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  actor_type      text NOT NULL CHECK (actor_type IN (
    'user', 'system', 'stripe_webhook', 'inngest', 'cron', 'admin'
  )),
  action          text NOT NULL,
  entity_type     text NOT NULL,
  entity_id       text,
  before          jsonb,
  after           jsonb,
  metadata        jsonb NOT NULL DEFAULT '{}'::jsonb,
  severity        text NOT NULL DEFAULT 'info' CHECK (severity IN (
    'info', 'warning', 'critical'
  )),
  ip_address      inet,
  user_agent      text
);

COMMENT ON TABLE public.audit_log IS
  'Append-only audit trail. Updates and deletes are blocked by trigger. '
  '7-year minimum retention (Australian Corporations Act s286/s290, '
  'AML/CTF Act 2006 s107). Consumers: Command Center, investor reports, DD.';

-- Indexes optimised for the four consumer query shapes
CREATE INDEX IF NOT EXISTS audit_log_created_at_idx
  ON public.audit_log (created_at DESC);

CREATE INDEX IF NOT EXISTS audit_log_entity_idx
  ON public.audit_log (entity_type, entity_id, created_at DESC);

CREATE INDEX IF NOT EXISTS audit_log_actor_idx
  ON public.audit_log (actor_user_id, created_at DESC)
  WHERE actor_user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS audit_log_severity_idx
  ON public.audit_log (severity, created_at DESC)
  WHERE severity IN ('warning', 'critical');

CREATE INDEX IF NOT EXISTS audit_log_action_time_idx
  ON public.audit_log (action, created_at DESC);

-- Append-only enforcement — belt + suspenders (REVOKE + trigger)
REVOKE UPDATE, DELETE, TRUNCATE ON public.audit_log FROM PUBLIC;
REVOKE UPDATE, DELETE, TRUNCATE ON public.audit_log FROM anon;
REVOKE UPDATE, DELETE, TRUNCATE ON public.audit_log FROM authenticated;
REVOKE UPDATE, DELETE, TRUNCATE ON public.audit_log FROM service_role;

CREATE OR REPLACE FUNCTION public.audit_log_block_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION
    'audit_log is append-only: % operations are not permitted (7-year retention required by Australian Corporations Act s286/s290)',
    TG_OP
    USING ERRCODE = 'insufficient_privilege';
END;
$$;

DROP TRIGGER IF EXISTS audit_log_no_update ON public.audit_log;
CREATE TRIGGER audit_log_no_update
  BEFORE UPDATE ON public.audit_log
  FOR EACH ROW
  EXECUTE FUNCTION public.audit_log_block_mutation();

DROP TRIGGER IF EXISTS audit_log_no_delete ON public.audit_log;
CREATE TRIGGER audit_log_no_delete
  BEFORE DELETE ON public.audit_log
  FOR EACH ROW
  EXECUTE FUNCTION public.audit_log_block_mutation();

DROP TRIGGER IF EXISTS audit_log_no_truncate ON public.audit_log;
CREATE TRIGGER audit_log_no_truncate
  BEFORE TRUNCATE ON public.audit_log
  FOR EACH STATEMENT
  EXECUTE FUNCTION public.audit_log_block_mutation();

-- RLS: admins read all; users read own actor rows only; service_role bypasses
ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY audit_log_admin_read ON public.audit_log
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND is_admin = true
    )
  );

CREATE POLICY audit_log_own_read ON public.audit_log
  FOR SELECT
  TO authenticated
  USING (actor_user_id = auth.uid());
