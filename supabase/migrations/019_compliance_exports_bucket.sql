-- ============================================================================
-- Migration 019: compliance-exports storage bucket
-- ============================================================================
--
-- APPLIED TO PRODUCTION via Supabase MCP (prior session). This file is a
-- checked-in copy of the DDL for version control.
--
-- Private storage bucket for GDPR Article 20 data export files. Access
-- patterns:
--
--   - WRITE: only the service role (admin-initiated fulfilment writes
--     here; nothing else). No public write access.
--   - READ: only the service role, which is how the admin endpoint
--     generates the signed URL that gets emailed to the user. End
--     users never hit the bucket directly — they click a signed URL
--     that expires after 7 days.
--
-- File naming convention:
--   compliance-exports/{user_id}/{export_request_id}.{format}
--
-- This means:
--   - Files are partitioned by user (readable namespace)
--   - Each request gets its own file (immutable history)
--   - Deleting the request row does NOT auto-delete the file
--     (admin cleanup of expired exports is a separate concern)
--
-- Size limit: 500 MB. A reasonable JSON dump of a single user's
-- projects, chapters, and transactions is typically <5 MB. The
-- ceiling exists to catch runaway exports (e.g. an institution
-- account with thousands of projects).

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'compliance-exports',
  'compliance-exports',
  false,
  524288000,  -- 500 MB
  ARRAY['application/json', 'application/zip', 'text/csv']
)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "compliance_exports_admin_read"
ON storage.objects
FOR SELECT
TO authenticated
USING (
  bucket_id = 'compliance-exports'
  AND EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND is_admin = true
  )
);

CREATE POLICY "compliance_exports_admin_write"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'compliance-exports'
  AND EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND is_admin = true
  )
);

CREATE POLICY "compliance_exports_admin_delete"
ON storage.objects
FOR DELETE
TO authenticated
USING (
  bucket_id = 'compliance-exports'
  AND EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND is_admin = true
  )
);
