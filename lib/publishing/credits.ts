import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Shared credit debit / refund primitive for publishing operations.
 *
 * Pattern:
 *   1. call debitPublishingCredits() BEFORE the expensive work
 *   2. if the work succeeds, you're done — the balance is already updated
 *   3. if it fails, call the returned refund() to restore the credits
 *
 * Admins bypass all deduction (is_admin=true in profiles). Free-tier users
 * can publish if they have enough credits from top-ups; the `canBuyCredits`
 * rule in lib/plans.ts already permits that.
 *
 * Deduction order: monthly credits_balance first, then credits_purchased.
 * This maximises rollover headroom for Max-tier subscribers.
 */

export interface DebitResult {
  ok: true;
  isAdmin: boolean;
  /** Refunds the exact amount debited. Safe to call even after success
   *  (it's a server-side guard) but you usually only call it on failure. */
  refund: () => Promise<void>;
}

export interface DebitFailure {
  ok: false;
  status: number;
  error: string;
  code?: string;
  required?: number;
  available?: number;
}

export async function debitPublishingCredits(args: {
  supabase: SupabaseClient;
  userId: string;
  amount: number;
  reason: string; // goes into credit_transactions.notes
}): Promise<DebitResult | DebitFailure> {  const { supabase, userId, amount, reason } = args;

  const { data: profile, error: profileErr } = await supabase
    .from('profiles')
    .select('credits_balance, credits_purchased, is_admin')
    .eq('id', userId)
    .single();

  if (profileErr || !profile) {
    return { ok: false, status: 404, error: 'Profile not found' };
  }

  // Admins bypass the meter entirely — no row in credit_transactions either
  if (profile.is_admin) {
    return {
      ok: true,
      isAdmin: true,
      refund: async () => undefined,
    };
  }

  const total = (profile.credits_balance || 0) + (profile.credits_purchased || 0);
  if (total < amount) {
    return {
      ok: false,
      status: 402,
      error: `Not enough credits. This publish costs ${amount} credits.`,
      code: 'INSUFFICIENT_CREDITS',
      required: amount,
      available: total,
    };
  }

  // Balance-first deduction
  let newBalance = profile.credits_balance || 0;
  let newPurchased = profile.credits_purchased || 0;
  if (newBalance >= amount) {
    newBalance -= amount;
  } else {
    const fromPurchased = amount - newBalance;
    newBalance = 0;
    newPurchased -= fromPurchased;
  }

  const { error: deductErr } = await supabase
    .from('profiles')
    .update({ credits_balance: newBalance, credits_purchased: newPurchased })
    .eq('id', userId);
  if (deductErr) {
    return { ok: false, status: 500, error: 'Failed to deduct credits' };
  }

  // Non-fatal audit log
  try {
    await supabase.from('credit_transactions').insert({
      user_id: userId,
      amount: -amount,
      transaction_type: 'publishing',
      notes: reason,
    });
  } catch {
    // swallow — the balance update is the source of truth
  }

  // Closure-captured snapshot for refund
  const snapshot = {
    balance: profile.credits_balance || 0,
    purchased: profile.credits_purchased || 0,
  };

  return {
    ok: true,
    isAdmin: false,
    refund: async () => {
      await supabase
        .from('profiles')
        .update({
          credits_balance: snapshot.balance,
          credits_purchased: snapshot.purchased,
        })
        .eq('id', userId);
      try {
        await supabase.from('credit_transactions').insert({
          user_id: userId,
          amount,
          transaction_type: 'publishing_refund',
          notes: `Refund: ${reason}`,
        });
      } catch {
        // non-fatal
      }
    },
  };
}

/**
 * Standalone refund — adds `amount` back to the user's monthly balance
 * without a prior debit handle. Use this from routes like the Computer
 * stream endpoint where the initial debit happened in a different route
 * (start) and we can't pass the closure across the boundary.
 *
 * Admin detection mirrors debitPublishingCredits: if profile.is_admin is
 * true, we no-op (they were never charged in the first place).
 */
export async function refundPublishingCredits(args: {
  supabase: SupabaseClient;
  userId: string;
  amount: number;
  reason: string;
}): Promise<void> {
  const { supabase, userId, amount, reason } = args;

  const { data: profile } = await supabase
    .from('profiles')
    .select('credits_balance, is_admin')
    .eq('id', userId)
    .single();
  if (!profile || profile.is_admin) return;

  const newBalance = (profile.credits_balance || 0) + amount;
  await supabase
    .from('profiles')
    .update({ credits_balance: newBalance })
    .eq('id', userId);

  try {
    await supabase.from('credit_transactions').insert({
      user_id: userId,
      amount,
      transaction_type: 'publishing_refund',
      notes: `Refund: ${reason}`,
    });
  } catch {
    // non-fatal
  }
}
