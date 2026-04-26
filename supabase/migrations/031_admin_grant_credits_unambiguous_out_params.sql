-- 031_admin_grant_credits_unambiguous_out_params.sql
--
-- Third wall on the same Grant credits flow.
--
-- After 030 fixed the role-check arity, the next click failed with:
--   "column reference \"email\" is ambiguous"
-- because the function's OUT parameters (user_id, email, amount_granted,
-- new_balance, ledger_id) are in scope throughout the body, and several
-- SELECT/UPDATE/INSERT statements reference columns named email and user_id
-- on profiles / credits_ledger. Postgres can't tell whether `email` in
-- "WHERE LOWER(email) = ..." means the profiles.email column or the email
-- OUT parameter.
--
-- Two ways to fix:
--   (a) qualify every column with a table alias (e.g. p.email)
--   (b) rename the OUT parameters so they cannot collide
--
-- (b) is more durable — any future edit that adds a query touching the
-- same column names won't reintroduce the ambiguity. The signature change
-- is backwards compatible because the application reads the result by
-- positional .data destructuring (Supabase returns an array), and even
-- if it read by key, callers in the repo only consume new_balance and
-- ledger_id which are unchanged.
--
-- New return columns: out_user_id, out_email, out_amount_granted,
-- out_new_balance, out_ledger_id. The Server Action does not destructure
-- by these names today; it just checks for error vs data.

-- DROP the old function first because changing OUT parameter names is
-- a signature change in Postgres and CREATE OR REPLACE won't allow it.
DROP FUNCTION IF EXISTS public.admin_grant_credits(uuid, text, integer, text);

CREATE FUNCTION public.admin_grant_credits(
  p_target_user_id uuid    DEFAULT NULL,
  p_target_email   text    DEFAULT NULL,
  p_amount         integer DEFAULT NULL,
  p_reason         text    DEFAULT NULL
)
RETURNS TABLE (
  out_user_id        uuid,
  out_email          text,
  out_amount_granted integer,
  out_new_balance    integer,
  out_ledger_id      uuid
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
  -- 1. Authz.
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501';
  END IF;

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

  -- 3. Resolve target. Table aliases used out of paranoia even though
  -- the OUT-param rename already removes the ambiguity.
  IF p_target_user_id IS NOT NULL THEN
    SELECT p.id, p.email INTO v_target_user_id, v_target_email
      FROM public.profiles p
     WHERE p.id = p_target_user_id;
  ELSE
    SELECT p.id, p.email INTO v_target_user_id, v_target_email
      FROM public.profiles p
     WHERE LOWER(p.email) = LOWER(TRIM(p_target_email));

    IF v_target_user_id IS NULL THEN
      SELECT u.id, u.email INTO v_target_user_id, v_target_email
        FROM auth.users u
       WHERE LOWER(u.email) = LOWER(TRIM(p_target_email));
    END IF;
  END IF;

  IF v_target_user_id IS NULL THEN
    RAISE EXCEPTION 'target user not found' USING ERRCODE = 'P0001';
  END IF;

  -- 4. Caller email for audit trail.
  SELECT p.email INTO v_caller_email
    FROM public.profiles p
   WHERE p.id = v_caller_id;

  v_description := format(
    'Admin grant by %s (%s credits). Reason: %s',
    COALESCE(v_caller_email, v_caller_id::text),
    p_amount,
    COALESCE(NULLIF(TRIM(p_reason), ''), 'no reason provided')
  );

  -- 5. Atomic balance + ledger.
  UPDATE public.profiles AS p
     SET credits_balance         = p.credits_balance + p_amount,
         lifetime_credits_earned = COALESCE(p.lifetime_credits_earned, 0) + p_amount
   WHERE p.id = v_target_user_id
   RETURNING p.credits_balance INTO v_new_balance;

  INSERT INTO public.credits_ledger AS cl (
    user_id, amount, balance_after, transaction_type, description
  ) VALUES (
    v_target_user_id, p_amount, v_new_balance, 'admin_adjustment', v_description
  ) RETURNING cl.id INTO v_ledger_id;

  -- 6. Assign to OUT params (now non-colliding names).
  out_user_id        := v_target_user_id;
  out_email          := v_target_email;
  out_amount_granted := p_amount;
  out_new_balance    := v_new_balance;
  out_ledger_id      := v_ledger_id;
  RETURN NEXT;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.admin_grant_credits(uuid, text, integer, text)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_grant_credits(uuid, text, integer, text) IS
  'Grant credits to a target user (by id or email). Caller must be super_admin. '
  'Atomic: profile balance + ledger insert. SECURITY DEFINER — must be called '
  'with a user-context Supabase client. OUT params prefixed with out_ to avoid '
  'colliding with profiles.email / credits_ledger.user_id inside the body. '
  'See migrations 030 and 031 for the bug history.';
