-- 036_livebook_image_library_policies.sql
-- CEO-163 — Livebook image library: RLS policies
--
-- Split from migration 035 because CREATE POLICY silently drops when
-- batched with CREATE TABLE / CREATE INDEX in the same apply_migration
-- call (CEO-149 burn 2026-04-26 — pg_policies came back empty after
-- 032 batched policies+table).

-- ============================================================================
-- livebook_styles — public read, super_admin write
-- ============================================================================
-- The style catalogue is shown in the publish modal to every author, so
-- anon read is fine. Writes are admin-only.

CREATE POLICY livebook_styles_select_public
  ON livebook_styles
  FOR SELECT
  TO public
  USING (true);

CREATE POLICY livebook_styles_admin_all
  ON livebook_styles
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
        AND profiles.admin_role = 'super_admin'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
        AND profiles.admin_role = 'super_admin'
    )
  );

-- ============================================================================
-- livebook_image_library — public read of active images, super_admin write
-- ============================================================================
-- Authors and readers don't query the library directly; the worker does
-- via service-role key. But we keep public SELECT enabled so the future
-- "preview the style" UI can show sample thumbnails. Inactive images
-- (retired for quality reasons) are hidden from public.

CREATE POLICY livebook_image_library_select_active
  ON livebook_image_library
  FOR SELECT
  TO public
  USING (is_active = true);

CREATE POLICY livebook_image_library_admin_all
  ON livebook_image_library
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
        AND profiles.admin_role = 'super_admin'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
        AND profiles.admin_role = 'super_admin'
    )
  );

-- ============================================================================
-- livebook_generation_jobs — author sees own jobs, super_admin sees all
-- ============================================================================

CREATE POLICY livebook_jobs_select_own
  ON livebook_generation_jobs
  FOR SELECT
  TO authenticated
  USING (
    charged_to_user_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
        AND profiles.admin_role = 'super_admin'
    )
  );

CREATE POLICY livebook_jobs_admin_all
  ON livebook_generation_jobs
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
        AND profiles.admin_role = 'super_admin'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
        AND profiles.admin_role = 'super_admin'
    )
  );
