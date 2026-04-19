import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { runRetentionCheck } from '@/lib/guild/commissions';
import { requireCronAuth } from '@/lib/cron/require-cron-auth';

export const runtime = 'nodejs';
export const maxDuration = 60;
export const dynamic = 'force-dynamic';

/**
 * GET /api/guild/cron/retention-check
 *
 * Runs daily at 00:15 Adelaide time (13:45 UTC).
 *
 * Promotes guild_referrals from 'active_paid' to 'retention_qualified' once
 * they have been paid for 60 consecutive days. Only retention-qualified
 * referrals count toward Guild tier advancement, and only their commissions
 * can be locked in the monthly close.
 *
 * Authentication: requireCronAuth validates the Authorization bearer
 * against CRON_SECRET. Fail-closed: if CRON_SECRET is unset we 500
 * rather than pass silently. Vercel Cron auto-signs scheduled calls.
 */
export async function GET(request: NextRequest) {
  const unauthorized = requireCronAuth(request);
  if (unauthorized) return unauthorized;

  try {
    const admin = createAdminClient();
    const result = await runRetentionCheck(admin);
    return NextResponse.json({
      ok: true,
      ran_at: new Date().toISOString(),
      ...result,
    });
  } catch (err: any) {
    console.error('[cron/retention-check] Error:', err);
    return NextResponse.json(
      { error: err?.message || 'Retention check failed' },
      { status: 500 },
    );
  }
}
