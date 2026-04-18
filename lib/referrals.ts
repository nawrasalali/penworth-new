import { SupabaseClient } from '@supabase/supabase-js';

/**
 * Credits the referrer when their referee (the user identified by `refereeId`)
 * publishes their first document. Idempotent — safe to call on every publish.
 *
 * Flow:
 *   1. Look up the referee's row in `referrals` (status='pending').
 *      No row → no referrer → bail.
 *      Row exists but already 'credited' → bail.
 *   2. Transition the row to 'credited', stamp timestamps.
 *   3. Add REFERRAL_CREDIT_AWARD credits to the referrer's balance.
 *   4. Write a `credit_transactions` row.
 *   5. Flip the referrer's `has_referred_users = true` so their own
 *      exports stop showing the watermark.
 *
 * This is called AFTER the project's own `status` is flipped to 'published'
 * in `app/api/publishing/penworth-store/route.ts`. If anything in here fails,
 * the publish flow still succeeds — referral crediting is a best-effort
 * background-style operation, not a hard dependency of publishing.
 *
 * Returns { credited: boolean, reason: string } for diagnostics. The caller
 * should not surface the result to the user — credits appear in their
 * referrer's dashboard on next load.
 */

export const REFERRAL_CREDIT_AWARD = 500;

export interface CreditReferralResult {
  credited: boolean;
  reason: string;
  referrerId?: string;
  creditsAwarded?: number;
}

/**
 * Credit the referrer for the given referee's first published document.
 * Uses the service-role / server Supabase client — callers must not pass
 * an anon client, or RLS will block the referrer-profile update.
 */
export async function creditReferralIfEligible(
  supabase: SupabaseClient,
  refereeId: string,
): Promise<CreditReferralResult> {
  // 1. Fetch the referee's pending referral row (there should be at most one).
  const { data: referralRow, error: referralErr } = await supabase
    .from('referrals')
    .select('id, referrer_id, status, credits_awarded')
    .eq('referee_id', refereeId)
    .maybeSingle();

  if (referralErr) {
    console.error('[referrals.credit] load error:', referralErr);
    return { credited: false, reason: 'lookup_failed' };
  }

  if (!referralRow) {
    return { credited: false, reason: 'no_referral' };
  }

  if (referralRow.status === 'credited') {
    return { credited: false, reason: 'already_credited' };
  }

  const referrerId = referralRow.referrer_id as string;
  const now = new Date().toISOString();

  // 2. Transition the referral row. Using an eq-and-neq guard so a concurrent
  //    call can't double-credit — if another request flipped it to 'credited'
  //    between the read above and the update here, the update affects 0 rows
  //    and we bail.
  const { data: updatedReferrals, error: updateErr } = await supabase
    .from('referrals')
    .update({
      status: 'credited',
      qualified_at: now,
      credited_at: now,
      credits_awarded: REFERRAL_CREDIT_AWARD,
    })
    .eq('id', referralRow.id)
    .eq('status', 'pending')
    .select('id');

  if (updateErr) {
    console.error('[referrals.credit] status update error:', updateErr);
    return { credited: false, reason: 'update_failed' };
  }

  if (!updatedReferrals || updatedReferrals.length === 0) {
    // Race: another request got there first. Not an error, just a no-op.
    return { credited: false, reason: 'race_already_credited' };
  }

  // 3. Read the referrer's current balance + flags, then write incremented
  //    values. PostgREST doesn't expose atomic counter updates without a
  //    stored function, so this is a read-modify-write — acceptable because
  //    the guard in step 2 already gates against double-crediting.
  const { data: referrer, error: referrerErr } = await supabase
    .from('profiles')
    .select('credits_balance, lifetime_credits_earned, has_referred_users')
    .eq('id', referrerId)
    .single();

  if (referrerErr || !referrer) {
    console.error('[referrals.credit] referrer lookup error:', referrerErr);
    // The referral row is already flipped to 'credited' at this point. We
    // can't easily roll back without a second update, and leaving the row
    // as 'credited' without the balance update would hide the problem on
    // next run. Surface this loudly in logs; ops can reconcile.
    return {
      credited: false,
      reason: 'referrer_not_found',
      referrerId,
    };
  }

  const currentBalance = referrer.credits_balance || 0;
  const currentLifetime = referrer.lifetime_credits_earned || 0;

  const { error: profileUpdateErr } = await supabase
    .from('profiles')
    .update({
      credits_balance: currentBalance + REFERRAL_CREDIT_AWARD,
      lifetime_credits_earned: currentLifetime + REFERRAL_CREDIT_AWARD,
      has_referred_users: true,
    })
    .eq('id', referrerId);

  if (profileUpdateErr) {
    console.error('[referrals.credit] referrer update error:', profileUpdateErr);
    return {
      credited: false,
      reason: 'referrer_update_failed',
      referrerId,
    };
  }

  // 4. Write the transaction log row. Schema: transaction_type must be one
  //    of the values in the CHECK constraint — 'referral_bonus' is allowed.
  const { error: txErr } = await supabase.from('credit_transactions').insert({
    user_id: referrerId,
    amount: REFERRAL_CREDIT_AWARD,
    transaction_type: 'referral_bonus',
    reference_id: referralRow.id,
    notes: `Referral credit for referee publishing first document`,
  });

  if (txErr) {
    // Non-fatal — the balance is already updated. Log and continue.
    console.error('[referrals.credit] transaction log error:', txErr);
  }

  return {
    credited: true,
    reason: 'success',
    referrerId,
    creditsAwarded: REFERRAL_CREDIT_AWARD,
  };
}
