-- 030_fix_admin_grant_credits_role_check.sql
--
-- Two purposes:
--
-- 1. Fix the auth call inside admin_grant_credits.
--    The previous body called has_admin_role('super_admin') with a single
--    argument. has_admin_role's signature is (p_user_id uuid, p_required_role
--    text DEFAULT NULL), so a single-arg call binds 'super_admin' to
--    p_user_id and fails with:
--      "invalid input syntax for type uuid: \"super_admin\""
--    Correct call is has_admin_role(v_caller_id, 'super_admin').
--
-- 2. Capture admin_grant_credits in repo as a migration.
--    The function existed only in the live DB (created out-of-band, never
--    committed). This migration is now the source of truth so subsequent
--    edits go through the normal review and apply path.
--
-- Backwards compatible: signature, return columns, behaviour, and security
-- model unchanged. Only the role-check line is patched.
--
-- Tested live before this migration was committed: a Founder click on
-- /admin/command-center/grants previously failed with 42501 "invalid input
-- syntax for type uuid: super_admin"; same click after this migration
-- succeeds and the credits land in credits_ledger with proper audit.

CREATE OR REPLACE FUNCTION public.admin_grant_credits(
  p_target_user_id uuid    DEFAULT NULL,
  p_target_email   text    DEFAULT NULL,
  p_amount         integer DEFAULT NULL,
  p_reason         text    DEFAULT NULL
)
RETURNS TABLE (
  user_id        uuid,
  email          text,
  amount_granted integer,
  new_balance    integer,
  ledger_id      uuid
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_caller_id        uuid := auth.uid();
  v_target_user_id   uuid;
  v_target_email     text;
  v_caller_email     text;
  v_new_balance      integer;
  v_ledger_id        uuid;
  v_description      text;
BEGIN
  -- 1. Authz: caller must be super_admin.
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501';
  END IF;

  -- has_admin_role(uid, role) — both args required. The previous body
  -- called has_admin_role('super_admin') which bound the role string to
  -- the uuid param and 42501'd before any work could happen.
  IF NOT public.has_admin_role(v_caller_id, 'super_admin') THEN
    RAISE EXCEPTION 'super_admin role required' USING ERRCODE = '42501';
  END IF;

  -- 2. Input validation.
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'p_amount must be a positive integer' USING ERRCODE = '22023';
  END IF;

  IF p_target_user_id IS NULL AND (p_target_email IS NULL OR p_target_email = '') THEN
    RAISE EXCEPTION 'must provide p_target_user_id or p_target_email' USING ERRCODE = '22023';
  END IF;

  -- 3. Resolve target user. Email path falls back to auth.users if the
  -- profiles row hasn't been provisioned yet — keeps grants possible for
  -- newly-signed-up users before profile-trigger settles.
  IF p_target_user_id IS NOT NULL THEN
    SELECT id, email INTO v_target_user_id, v_target_email
      FROM public.profiles WHERE id = p_target_user_id;
  ELSE
    SELECT id, email INTO v_target_user_id, v_target_email
      FROM public.profiles WHERE LOWER(email) = LOWER(TRIM(p_target_email));

    IF v_target_user_id IS NULL THEN
      SELECT id, email INTO v_target_user_id, v_target_email
        FROM auth.users WHERE LOWER(email) = LOWER(TRIM(p_target_email));
    END IF;
  END IF;

  IF v_target_user_id IS NULL THEN
    RAISE EXCEPTION 'target user not found' USING ERRCODE = 'P0001';
  END IF;

  -- 4. Caller identity for audit trail (best-effort; falls back to UID).
  SELECT email INTO v_caller_email FROM public.profiles WHERE id = v_caller_id;

  v_description := format(
    'Admin grant by %s (%s credits). Reason: %s',
    COALESCE(v_caller_email, v_caller_id::text),
    p_amount,
    COALESCE(NULLIF(TRIM(p_reason), ''), 'no reason provided')
  );

  -- 5. Apply grant atomically.
  UPDATE public.profiles
     SET credits_balance        = credits_balance + p_amount,
         lifetime_credits_earned = COALESCE(lifetime_credits_earned, 0) + p_amount
   WHERE id = v_target_user_id
   RETURNING credits_balance INTO v_new_balance;

  INSERT INTO public.credits_ledger (
    user_id, amount, balance_after, transaction_type, description
  ) VALUES (
    v_target_user_id, p_amount, v_new_balance, 'admin_adjustment', v_description
  ) RETURNING id INTO v_ledger_id;

  -- 6. Return.
  user_id        := v_target_user_id;
  email          := v_target_email;
  amount_granted := p_amount;
  new_balance    := v_new_balance;
  ledger_id      := v_ledger_id;
  RETURN NEXT;
END;
$function$;

-- Re-grant execute to authenticated + service_role to keep prior callers
-- working. (Idempotent — GRANT is a no-op if the privilege already exists.)
GRANT EXECUTE ON FUNCTION public.admin_grant_credits(uuid, text, integer, text)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_grant_credits(uuid, text, integer, text) IS
  'Grant credits to a target user (by id or email). Caller must be super_admin. '
  'Atomic: profile balance + ledger insert in one transaction. The function is '
  'SECURITY DEFINER so it must be called with a user-context Supabase client '
  '(cookies-bound) — service-role calls have auth.uid()=NULL and 42501 immediately. '
  'See migration 030 commit message for the bug history.';
