import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { runRetentionCheck } from '@/lib/guild/commissions';

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
 * Authentication: Vercel Cron includes Authorization: Bearer CRON_SECRET
 * automatically when CRON_SECRET is set in the environment.
 */
export async function GET(request: NextRequest) {
  // Gate by the CRON_SECRET when available
  const auth = request.headers.get('authorization');
  const expected = process.env.CRON_SECRET;
  if (expected && auth !== `Bearer ${expected}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

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
