import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Apply an author referral code to a newly-signed-up user.
 *
 * Used by:
 *   - app/auth/callback/route.ts — applies a cookie-stored code post-confirm
 *   - app/api/referrals POST  — applies a code submitted via API
 *
 * Both paths share the same invariants:
 *   1. One referrer per account (immutable once set)
 *   2. Self-referral blocked
 *   3. Welcome bonus: +100 credits to the new user (incremented, not overwritten)
 *   4. Idempotent — calling twice with the same code is safe (returns
 *      'already_referred' the second time)
 *
 * Caller must use a service-role client. RLS will block profile updates
 * with an anon client.
 */

export const WELCOME_REFERRAL_CREDITS = 100;

export interface ApplyAuthorReferralResult {
  ok: boolean;
  reason:
    | 'success'
    | 'invalid_code'
    | 'already_referred'
    | 'self_referral'
    | 'referrer_not_found'
    | 'lookup_failed'
    | 'update_failed';
  welcomeCredits?: number;
  referrerId?: string;
}

export async function applyAuthorReferral(
  admin: SupabaseClient,
  refereeUserId: string,
  rawCode: string,
): Promise<ApplyAuthorReferralResult> {
  const code = rawCode.trim().toUpperCase();

  // Author codes are not GUILD- prefixed (those route through guild flow)
  if (!code || code.startsWith('GUILD-') || !/^[A-Z0-9]{6,12}$/.test(code)) {
    return { ok: false, reason: 'invalid_code' };
  }

  const { data: refereeProfile, error: refereeErr } = await admin
    .from('profiles')
    .select('id, referred_by, credits_balance, lifetime_credits_earned')
    .eq('id', refereeUserId)
    .single();

  if (refereeErr || !refereeProfile) {
    return { ok: false, reason: 'lookup_failed' };
  }

  if (refereeProfile.referred_by) {
    // Idempotent: already referred. Not an error, just a no-op.
    return { ok: false, reason: 'already_referred' };
  }

  const { data: referrer, error: referrerErr } = await admin
    .from('profiles')
    .select('id')
    .eq('referral_code', code)
    .single();

  if (referrerErr || !referrer) {
    return { ok: false, reason: 'referrer_not_found' };
  }

  if (referrer.id === refereeUserId) {
    return { ok: false, reason: 'self_referral' };
  }

  // Stamp the referrer
  const { error: stampErr } = await admin
    .from('profiles')
    .update({ referred_by: referrer.id })
    .eq('id', refereeUserId);

  if (stampErr) {
    return { ok: false, reason: 'update_failed' };
  }

  // Insert pending referrals row (gets credited later when referee
  // publishes their first book — see lib/referrals.ts)
  await admin.from('referrals').insert({
    referrer_id: referrer.id,
    referee_id: refereeUserId,
    status: 'pending',
  });
  // Duplicate-row errors are fine (race-safe); we don't surface them.

  // Increment welcome credits — never overwrite (would zero out
  // monthly free grant or any prior balance)
  const newBalance = (refereeProfile.credits_balance || 0) + WELCOME_REFERRAL_CREDITS;
  const newLifetime =
    (refereeProfile.lifetime_credits_earned || 0) + WELCOME_REFERRAL_CREDITS;

  await admin
    .from('profiles')
    .update({
      credits_balance: newBalance,
      lifetime_credits_earned: newLifetime,
    })
    .eq('id', refereeUserId);

  await admin.from('credit_transactions').insert({
    user_id: refereeUserId,
    amount: WELCOME_REFERRAL_CREDITS,
    transaction_type: 'welcome_bonus',
    notes: `Welcome bonus via referral code ${code}`,
  });

  return {
    ok: true,
    reason: 'success',
    welcomeCredits: WELCOME_REFERRAL_CREDITS,
    referrerId: referrer.id,
  };
}
