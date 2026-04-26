-- Telemetry table for client-side auth errors. Filled by the signup/login
-- pages whenever supabase-js returns or throws an error so we can diagnose
-- user-specific failures without bouncing screenshots back and forth.
--
-- PII handling: we store a sha256 hash of the lowercased email rather than
-- the email itself. That gives us "is this the same user retrying" without
-- holding contact info. The error message and code are useful diagnostic
-- text from Supabase / supabase-js, never user-supplied.
--
-- Applied to production 2026-04-26 via Supabase Management API.
CREATE TABLE IF NOT EXISTS public.auth_client_errors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  context text NOT NULL,                    -- 'signup' | 'login' | 'signup_oauth' | 'login_oauth' | 'forgot_password'
  email_hash text,                          -- sha256(lower(email)), nullable for OAuth flows
  error_kind text,                          -- 'returned' (structured supabase error) | 'thrown' (exception)
  message text,                             -- err.message verbatim
  status integer,                           -- err.status if present
  code text,                                -- err.code if present
  user_agent text,
  url text,                                 -- window.location.href
  meta jsonb DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS auth_client_errors_created_idx
  ON public.auth_client_errors (created_at DESC);
CREATE INDEX IF NOT EXISTS auth_client_errors_email_hash_idx
  ON public.auth_client_errors (email_hash, created_at DESC);
CREATE INDEX IF NOT EXISTS auth_client_errors_context_idx
  ON public.auth_client_errors (context, created_at DESC);

ALTER TABLE public.auth_client_errors ENABLE ROW LEVEL SECURITY;

-- Anyone (including unauthenticated users on the signup page) can insert,
-- but nobody can read or modify. Reads happen via service-role from CEO
-- queries / Command Center.
DROP POLICY IF EXISTS "auth_client_errors_anon_insert" ON public.auth_client_errors;
CREATE POLICY "auth_client_errors_anon_insert"
  ON public.auth_client_errors
  FOR INSERT
  TO anon, authenticated
  WITH CHECK (true);

-- Admins can SELECT for diagnostics
DROP POLICY IF EXISTS "auth_client_errors_admin_select" ON public.auth_client_errors;
CREATE POLICY "auth_client_errors_admin_select"
  ON public.auth_client_errors
  FOR SELECT
  TO authenticated
  USING (is_admin_user(auth.uid()));

COMMENT ON TABLE public.auth_client_errors IS
  'Client-side auth failure telemetry. Inserted by signup/login pages on any error. SECURITY: insert-only for anon; admins read via RLS. Email is sha256-hashed; never store raw addresses here.';
