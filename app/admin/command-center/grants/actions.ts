'use server';

import { requireAdminRole } from '@/lib/admin/require-admin-role';
import { createServiceClient } from '@/lib/supabase/service';
import { revalidatePath } from 'next/cache';

/**
 * Server action: grant credits to a target user by email (preferred) or
 * user_id. Wraps the admin_grant_credits RPC and re-validates the page
 * so the recent-grants table updates immediately after submit.
 *
 * Auth: requireAdminRole('super_admin') — reuses the same gate the page
 * uses, so a non-admin cannot invoke this action from a crafted request.
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

  const admin = createServiceClient();
  const { data, error } = await admin.rpc('admin_grant_credits', {
    p_target_email: email,
    p_amount: amount,
    p_reason: reason || null,
  });

  if (error) {
    return { ok: false as const, error: error.message };
  }

  const row = Array.isArray(data) ? data[0] : data;
  revalidatePath('/admin/command-center/grants');

  return {
    ok: true as const,
    email: row?.email ?? email,
    amountGranted: row?.amount_granted ?? amount,
    newBalance: row?.new_balance ?? null,
    ledgerId: row?.ledger_id ?? null,
  };
}
