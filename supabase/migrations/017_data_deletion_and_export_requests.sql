-- ============================================================================
-- Migration 017: data_deletion_requests + data_exports
-- ============================================================================
--
-- APPLIED TO PRODUCTION: Supabase version 20260419011530 (approximate)
-- under the name '017_data_deletion_and_export_requests'. Applied via
-- Supabase MCP before this file was committed to disk.
--
-- GDPR Article 17 (Right to Erasure) and Article 20 (Right to Data
-- Portability) compliance infrastructure. Also satisfies the equivalent
-- rights in PDPA (Thailand), DPDP Act 2023 (India), PDP Law 2022
-- (Indonesia), NDPR (Nigeria), POPIA (South Africa), Data Privacy Act
-- (Philippines), Australia Privacy Act 1988, UAE Federal Decree-Law
-- No. 45, Saudi PDPL, and Egypt Data Protection Law 151.
--
-- This file is a checked-in copy of the DDL. Supabase tracks the actual
-- migration by timestamp, not filename, so the 017_ prefix is just
-- ordering for human readability.

-- ----------------------------------------------------------------------------
-- data_deletion_requests — GDPR Article 17
-- ----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.data_deletion_requests (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  user_email      text NOT NULL,
  requested_at    timestamptz NOT NULL DEFAULT now(),
  statutory_deadline timestamptz NOT NULL,
  request_source  text NOT NULL CHECK (request_source IN (
    'user', 'regulator', 'admin', 'automated'
  )),
  jurisdiction    text,
  status          text NOT NULL DEFAULT 'received' CHECK (status IN (
    'received', 'processing', 'completed', 'rejected', 'failed'
  )),
  processing_started_at timestamptz,
  completed_at          timestamptz,
  rejection_reason      text,
  failure_reason        text,
  processed_by          uuid REFERENCES auth.users(id),
  fulfillment_notes     text,
  deletion_manifest     jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.data_deletion_requests IS
  'GDPR Article 17 / Right to Erasure request log. Statutory deadline '
  'defaults to 30 days. Compliance Agent monitors approaching deadlines.';

CREATE INDEX IF NOT EXISTS data_deletion_requests_user_idx
  ON public.data_deletion_requests (user_id, requested_at DESC);

CREATE INDEX IF NOT EXISTS data_deletion_requests_deadline_idx
  ON public.data_deletion_requests (statutory_deadline ASC)
  WHERE status IN ('received', 'processing');

CREATE INDEX IF NOT EXISTS data_deletion_requests_status_idx
  ON public.data_deletion_requests (status, requested_at DESC);

-- ----------------------------------------------------------------------------
-- Shared trigger helpers (idempotent create)
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.set_deletion_statutory_deadline()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.statutory_deadline IS NULL THEN
    NEW.statutory_deadline := NEW.requested_at + INTERVAL '30 days';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS data_deletion_requests_set_deadline ON public.data_deletion_requests;
CREATE TRIGGER data_deletion_requests_set_deadline
  BEFORE INSERT ON public.data_deletion_requests
  FOR EACH ROW
  EXECUTE FUNCTION public.set_deletion_statutory_deadline();

DROP TRIGGER IF EXISTS data_deletion_requests_touch ON public.data_deletion_requests;
CREATE TRIGGER data_deletion_requests_touch
  BEFORE UPDATE ON public.data_deletion_requests
  FOR EACH ROW
  EXECUTE FUNCTION public.touch_updated_at();

-- ----------------------------------------------------------------------------
-- RLS for data_deletion_requests
-- ----------------------------------------------------------------------------

ALTER TABLE public.data_deletion_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY ddr_admin_all ON public.data_deletion_requests
  FOR ALL
  TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND is_admin = true)
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND is_admin = true)
  );

CREATE POLICY ddr_own_read ON public.data_deletion_requests
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY ddr_own_insert ON public.data_deletion_requests
  FOR INSERT
  TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND request_source = 'user'
    AND status = 'received'
    AND processed_by IS NULL
  );

-- ----------------------------------------------------------------------------
-- data_exports — GDPR Article 20
-- ----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.data_exports (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  user_email      text NOT NULL,
  requested_at    timestamptz NOT NULL DEFAULT now(),
  statutory_deadline timestamptz NOT NULL,
  format          text NOT NULL DEFAULT 'json' CHECK (format IN ('json', 'csv', 'zip')),
  status          text NOT NULL DEFAULT 'received' CHECK (status IN (
    'received', 'processing', 'delivered', 'expired', 'failed'
  )),
  processing_started_at timestamptz,
  delivered_at          timestamptz,
  expires_at            timestamptz,
  file_path       text,
  file_size_bytes bigint,
  processed_by    uuid REFERENCES auth.users(id),
  failure_reason  text,
  export_manifest jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.data_exports IS
  'GDPR Article 20 / Right to Data Portability request log. Admin '
  'generates a JSON export and stores a 7-day signed URL. Statutory '
  'deadline defaults to 30 days.';

CREATE INDEX IF NOT EXISTS data_exports_user_idx
  ON public.data_exports (user_id, requested_at DESC);

CREATE INDEX IF NOT EXISTS data_exports_deadline_idx
  ON public.data_exports (statutory_deadline ASC)
  WHERE status IN ('received', 'processing');

CREATE INDEX IF NOT EXISTS data_exports_status_idx
  ON public.data_exports (status, requested_at DESC);

DROP TRIGGER IF EXISTS data_exports_set_deadline ON public.data_exports;
CREATE TRIGGER data_exports_set_deadline
  BEFORE INSERT ON public.data_exports
  FOR EACH ROW
  EXECUTE FUNCTION public.set_deletion_statutory_deadline();

DROP TRIGGER IF EXISTS data_exports_touch ON public.data_exports;
CREATE TRIGGER data_exports_touch
  BEFORE UPDATE ON public.data_exports
  FOR EACH ROW
  EXECUTE FUNCTION public.touch_updated_at();

ALTER TABLE public.data_exports ENABLE ROW LEVEL SECURITY;

CREATE POLICY de_admin_all ON public.data_exports
  FOR ALL
  TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND is_admin = true)
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND is_admin = true)
  );

CREATE POLICY de_own_read ON public.data_exports
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY de_own_insert ON public.data_exports
  FOR INSERT
  TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND status = 'received'
    AND processed_by IS NULL
  );
