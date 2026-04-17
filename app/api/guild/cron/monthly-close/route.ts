import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { runMonthlyClose } from '@/lib/guild/commissions';

export const runtime = 'nodejs';
export const maxDuration = 300; // can be long if many Guildmembers
export const dynamic = 'force-dynamic';

/**
 * GET /api/guild/cron/monthly-close
 *
 * Runs on the last day of each month at 23:59 Adelaide time (13:29 UTC next day,
 * accounting for DST). Locks all eligible commissions (pending + retention
 * qualified) into 'locked' state, then aggregates per Guildmember and creates
 * guild_payouts rows for anyone over the $50 threshold whose payout method is
 * set.
 *
 * After this runs, an admin reviews the queued payouts and approves them for
 * the first business day of the following month.
 *
 * Query params:
 *   ?month=YYYY-MM   Override the target month (for manual close or backfill).
 *                    Default: current month in Adelaide timezone.
 */
export async function GET(request: NextRequest) {
  // Gate by CRON_SECRET
  const auth = request.headers.get('authorization');
  const expected = process.env.CRON_SECRET;
  if (expected && auth !== `Bearer ${expected}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const url = new URL(request.url);
    const monthParam = url.searchParams.get('month');

    // Default to current month in Adelaide time
    const month = monthParam || adelaideCurrentMonth();

    if (!/^\d{4}-\d{2}$/.test(month)) {
      return NextResponse.json(
        { error: 'month must be YYYY-MM format' },
        { status: 400 },
      );
    }

    const admin = createAdminClient();
    const result = await runMonthlyClose(admin, month);

    return NextResponse.json({
      ok: true,
      closed_month: month,
      ran_at: new Date().toISOString(),
      ...result,
    });
  } catch (err: any) {
    console.error('[cron/monthly-close] Error:', err);
    return NextResponse.json(
      { error: err?.message || 'Monthly close failed' },
      { status: 500 },
    );
  }
}

/**
 * Returns the month just ended (YYYY-MM) in Adelaide time. When this cron
 * runs on the 1st of a month at Adelaide midnight, we want to close the
 * month that just ended, not the new one.
 */
function adelaideCurrentMonth(): string {
  // Take "now" in Adelaide, subtract 1 day, and format the resulting month.
  // This correctly returns the previous month when invoked on the 1st.
  const now = new Date();
  const dayBefore = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Australia/Adelaide',
    year: 'numeric',
    month: '2-digit',
  });
  const parts = formatter.formatToParts(dayBefore);
  const year = parts.find((p) => p.type === 'year')?.value;
  const mon = parts.find((p) => p.type === 'month')?.value;
  return `${year}-${mon}`;
}
