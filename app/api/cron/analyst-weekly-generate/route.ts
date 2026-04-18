import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { generateWeeklyAnalystReport } from '@/lib/guild/agents/analyst-generator';
import type { GuildMemberCtx } from '@/lib/guild/agents/shared';

export const runtime = 'nodejs';
export const maxDuration = 300;
export const dynamic = 'force-dynamic';

/**
 * Phase 2 Commit 6 — Analyst weekly generation cron.
 *
 * Scheduled by vercel.json as "0 6 * * 1" — Monday 06:00 UTC.
 * Iterates all active Guildmembers and calls
 * generateWeeklyAnalystReport() for each, writing the weekly report
 * into guild_agent_context.context.weekly_report.
 *
 * Cost note: ~85% reduction vs daily runs. One Claude Sonnet call per
 * active member per week rather than per day.
 *
 * Concurrency: inline semaphore limits in-flight Claude calls to 10 at
 * a time — enough to stay well under the Anthropic API rate ceiling
 * while getting the batch done fast. No p-limit dependency added for
 * a 15-line helper.
 *
 * Authentication: Vercel Cron sends Authorization: Bearer CRON_SECRET
 * when the env var is set. Matches the pattern of the existing
 * retention-check and monthly-close crons.
 *
 * Failure handling: each member generation is wrapped in
 * generateWeeklyAnalystReport which already catches and logs failures,
 * returning null. The cron collects per-member outcomes but never
 * aborts — if one member's report fails, the other 999 still succeed.
 */

const CONCURRENCY = 10;

export async function GET(request: NextRequest) {
  const auth = request.headers.get('authorization');
  const expected = process.env.CRON_SECRET;
  if (expected && auth !== `Bearer ${expected}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const startedAt = Date.now();
  const admin = createAdminClient();

  // Select active members only. Probated / terminated / resigned don't
  // get reports — they either have agent access locked (probation,
  // Phase 1D) or are off the platform. The same filter will apply
  // naturally when Nora's matcher tries to surface a report for
  // non-active members.
  //
  // Select the exact columns GuildMemberCtx expects; see
  // lib/guild/agents/shared.ts.
  const { data: members, error: memberErr } = await admin
    .from('guild_members')
    .select(
      'id, user_id, display_name, tier, status, primary_market, primary_language, joined_at, referral_code',
    )
    .eq('status', 'active');

  if (memberErr) {
    console.error('[cron/analyst-weekly-generate] member select error:', memberErr);
    return NextResponse.json({ error: memberErr.message }, { status: 500 });
  }

  const roster = (members || []) as GuildMemberCtx[];
  const total = roster.length;

  // Inline concurrency limiter. Runs CONCURRENCY workers that pull from
  // a shared queue until empty. Simpler than pulling in p-limit.
  let cursor = 0;
  let succeeded = 0;
  let failed = 0;

  async function worker() {
    while (true) {
      const i = cursor++;
      if (i >= roster.length) return;
      const member = roster[i];
      try {
        const result = await generateWeeklyAnalystReport(admin, member);
        if (result) {
          succeeded++;
        } else {
          failed++;
        }
      } catch (err) {
        failed++;
        console.error(
          '[cron/analyst-weekly-generate] unexpected throw for member',
          member.id,
          err,
        );
      }
    }
  }

  const workerCount = Math.min(CONCURRENCY, total || 1);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));

  const durationMs = Date.now() - startedAt;
  console.log(
    `[cron/analyst-weekly-generate] done: ${succeeded}/${total} succeeded, ${failed} failed, ${durationMs}ms`,
  );

  return NextResponse.json({
    ok: true,
    ran_at: new Date().toISOString(),
    total,
    succeeded,
    failed,
    duration_ms: durationMs,
  });
}
