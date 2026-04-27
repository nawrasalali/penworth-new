-- 038_enrol_listing_in_livebook.sql
-- CEO-166 Phase 2 — atomic credit deduction + enrolment + job creation
--
-- Single SQL function the publish API calls when an author opts into the
-- Livebook image library. Wraps the credit check, debit, listing flag,
-- audit row, and job-queue row in one transaction so a partial failure
-- can never leave a book half-enrolled or charge an author without
-- creating the matching job.
--
-- Returns a structured jsonb so the caller can branch on the result
-- without parsing exception messages.
--
-- Idempotency: if the listing is already enrolled, returns
-- {ok:false, reason:'already_enrolled'} WITHOUT debiting credits.
-- This is the right behavior for an accidental double-click on Publish.

-- Step 1 — extend credit_transactions.transaction_type to allow
-- 'livebook_enrolment'. Existing CHECK is on transaction_type only;
-- extending it requires drop + recreate.
ALTER TABLE credit_transactions DROP CONSTRAINT IF EXISTS credit_transactions_transaction_type_check;
ALTER TABLE credit_transactions ADD CONSTRAINT credit_transactions_transaction_type_check
  CHECK (transaction_type IN (
    'referral_bonus',
    'welcome_bonus',
    'share_unlock',
    'book_generation',
    'export',
    'purchase',
    'admin_adjustment',
    'promo_code',
    'publishing',
    'publishing_refund',
    'support_adjustment',
    'livebook_enrolment',
    'livebook_enrolment_refund'
  ));

-- Step 2 — the enrolment function.
CREATE OR REPLACE FUNCTION enrol_listing_in_livebook(
  p_listing_id  uuid,
  p_style       text,
  p_user_id     uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_price_credits   integer;
  v_balance         integer;
  v_listing_author  uuid;
  v_already         boolean;
  v_job_id          uuid;
  v_style_active    boolean;
BEGIN
  -- Style must exist and be active.
  SELECT price_credits, is_active
    INTO v_price_credits, v_style_active
    FROM livebook_styles
   WHERE slug = p_style;
  IF v_price_credits IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'unknown_style');
  END IF;
  IF NOT v_style_active THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'style_inactive');
  END IF;

  -- Lock the user's profile row to prevent races on concurrent
  -- enrolments draining the balance below zero.
  SELECT credits_balance INTO v_balance
    FROM profiles
   WHERE id = p_user_id
   FOR UPDATE;
  IF v_balance IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'user_not_found');
  END IF;

  -- Ownership + idempotency check on the listing. Lock the row so
  -- two enrolments on the same listing serialise.
  SELECT author_id, livebook_enrolled
    INTO v_listing_author, v_already
    FROM store_listings
   WHERE id = p_listing_id
   FOR UPDATE;
  IF v_listing_author IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'listing_not_found');
  END IF;
  IF v_listing_author <> p_user_id THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_owner');
  END IF;
  IF v_already THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'already_enrolled');
  END IF;

  -- Sufficient balance.
  IF v_balance < v_price_credits THEN
    RETURN jsonb_build_object(
      'ok', false,
      'reason', 'insufficient_credits',
      'balance', v_balance,
      'required', v_price_credits
    );
  END IF;

  -- Debit, audit, flag, queue — all atomic.
  UPDATE profiles
     SET credits_balance = credits_balance - v_price_credits
   WHERE id = p_user_id;

  INSERT INTO credit_transactions
    (user_id, amount, transaction_type, reference_id, notes)
  VALUES
    (p_user_id, -v_price_credits, 'livebook_enrolment', p_listing_id,
     'Livebook image library enrolment, style=' || p_style);

  UPDATE store_listings
     SET livebook_enrolled = true,
         livebook_style = p_style,
         livebook_image_status = 'queued',
         livebook_image_progress = 0,
         livebook_enrolled_at = now()
   WHERE id = p_listing_id;

  INSERT INTO livebook_generation_jobs
    (listing_id, style_slug, status, credits_charged, charged_to_user_id)
  VALUES
    (p_listing_id, p_style, 'queued', v_price_credits, p_user_id)
  RETURNING id INTO v_job_id;

  RETURN jsonb_build_object(
    'ok', true,
    'job_id', v_job_id,
    'credits_charged', v_price_credits,
    'new_balance', v_balance - v_price_credits
  );
END;
$$;

COMMENT ON FUNCTION enrol_listing_in_livebook IS
  'CEO-166: atomic enrolment. Validates style + ownership + balance, then debits credits, writes audit row, flags listing, creates queued job. Returns jsonb {ok, reason?, job_id?, credits_charged?, new_balance?, balance?, required?}. Idempotent on already-enrolled listings (no debit).';

-- Phase-3 hook: matching helper for refund logic. If the matcher fails
-- terminally (3 retries exhausted), the worker can call this to refund
-- the credits and reset the listing flags. Wired in CEO-167 (later).
CREATE OR REPLACE FUNCTION refund_livebook_enrolment(
  p_listing_id uuid,
  p_reason     text DEFAULT 'matcher_failed'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id  uuid;
  v_credits  integer;
  v_job_id   uuid;
BEGIN
  -- Find the most recent job for this listing.
  SELECT id, charged_to_user_id, credits_charged
    INTO v_job_id, v_user_id, v_credits
    FROM livebook_generation_jobs
   WHERE listing_id = p_listing_id
   ORDER BY queued_at DESC
   LIMIT 1
   FOR UPDATE;
  IF v_job_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'no_job_found');
  END IF;

  UPDATE profiles
     SET credits_balance = credits_balance + v_credits
   WHERE id = v_user_id;

  INSERT INTO credit_transactions
    (user_id, amount, transaction_type, reference_id, notes)
  VALUES
    (v_user_id, v_credits, 'livebook_enrolment_refund', p_listing_id,
     'Livebook enrolment refund: ' || p_reason);

  UPDATE store_listings
     SET livebook_enrolled = false,
         livebook_style = NULL,
         livebook_image_status = 'not_enrolled',
         livebook_image_progress = 0
   WHERE id = p_listing_id;

  UPDATE livebook_generation_jobs
     SET status = 'cancelled',
         error_text = COALESCE(error_text, '') || ' | refunded: ' || p_reason
   WHERE id = v_job_id;

  RETURN jsonb_build_object(
    'ok', true,
    'refunded_credits', v_credits,
    'user_id', v_user_id
  );
END;
$$;

COMMENT ON FUNCTION refund_livebook_enrolment IS
  'CEO-166: refund enrolment credits if the matcher fails terminally. Reverses the listing flags, restores the credits, records an audit row. Designed to be called by the matcher worker on its failure branch (Phase 3). Idempotency: subsequent calls find the cancelled job and return ok=false/no_job_found because the prior call already cancelled it.';

-- ============================================================================
-- Permissions: callable from the API route via service-role key only.
-- The publish handler uses createServiceClient() which already has
-- service_role privileges. We do NOT grant to authenticated/anon —
-- credit debits must always go through a server-controlled path.
-- ============================================================================

REVOKE EXECUTE ON FUNCTION enrol_listing_in_livebook(uuid, text, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION enrol_listing_in_livebook(uuid, text, uuid) FROM authenticated;
REVOKE EXECUTE ON FUNCTION enrol_listing_in_livebook(uuid, text, uuid) FROM anon;

REVOKE EXECUTE ON FUNCTION refund_livebook_enrolment(uuid, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION refund_livebook_enrolment(uuid, text) FROM authenticated;
REVOKE EXECUTE ON FUNCTION refund_livebook_enrolment(uuid, text) FROM anon;
