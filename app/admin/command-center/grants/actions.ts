'use server';

import { requireAdminRole } from '@/lib/admin/require-admin-role';
import { createClient } from '@/lib/supabase/server';
import { revalidatePath } from 'next/cache';

/**
 * Server action: grant credits to a target user by email (preferred) or
 * user_id. Wraps the admin_grant_credits RPC and re-validates the page
 * so the recent-grants table updates immediately after submit.
 *
 * Auth: requireAdminRole('super_admin') — pre-validates the caller is a
 * super_admin so a non-admin cannot invoke this action from a crafted
 * request.
 *
 * Client choice: user-context client (cookies-bound, anon-key) — NOT
 * service-role. The RPC is SECURITY DEFINER and internally checks
 * auth.uid() + has_admin_role('super_admin') for caller identity and
 * audit trail (v_caller_id, v_caller_email in the ledger description).
 * Calling via service-role makes auth.uid() NULL and raises
 * "authentication required" 42501. The SECURITY DEFINER attribute on
 * the RPC handles privilege elevation regardless of caller client.
 */
export async function grantCreditsAction(formData: FormData) {
  await requireAdminRole('super_admin');

  const email = String(formData.get('email') ?? '').trim();
  const amountRaw = String(formData.get('amount') ?? '').trim();
  const reason = String(formData.get('reason') ?? '').trim();

  const amount = Number.parseInt(amountRaw, 10);
  if (!email) {
    return { ok: false as const, error: 'Email is required.' };
  }
  if (!Number.isInteger(amount) || amount <= 0) {
    return { ok: false as const, error: 'Amount must be a positive integer.' };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc('admin_grant_credits', {
    p_target_email: email,
    p_amount: amount,
    p_reason: reason || null,
  });

  if (error) {
    return { ok: false as const, error: error.message };
  }

  const row = Array.isArray(data) ? data[0] : data;
  revalidatePath('/admin/command-center/grants');

  // OUT-param names are prefixed with out_ since migration 031 to avoid
  // colliding with profiles.email / credits_ledger.user_id inside the
  // function body. Old keys (email, amount_granted, …) no longer exist.
  return {
    ok: true as const,
    email: row?.out_email ?? email,
    amountGranted: row?.out_amount_granted ?? amount,
    newBalance: row?.out_new_balance ?? null,
    ledgerId: row?.out_ledger_id ?? null,
  };
}
