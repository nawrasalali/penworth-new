import { NextRequest, NextResponse } from 'next/server';

/**
 * Phase 2.5 Item 1 — CRON_SECRET hardening.
 *
 * Shared authorization gate for every /api/cron/* and
 * /api/guild/cron/* route. Returns null when the caller supplies a
 * valid Bearer token matching process.env.CRON_SECRET, or a
 * ready-to-return 401 NextResponse when they don't.
 *
 * FAIL-CLOSED BY DESIGN
 *
 * The pre-existing pattern in each cron route was:
 *
 *   const auth = request.headers.get('authorization');
 *   const expected = process.env.CRON_SECRET;
 *   if (expected && auth !== `Bearer ${expected}`) { 401 }
 *
 * That `expected &&` guard is fail-open: when CRON_SECRET is unset
 * (as it was in prod during Phase 2 verification), the check skips
 * and any anonymous caller can trigger expensive scheduled jobs —
 * including the analyst weekly cron that issues one Claude Sonnet
 * call per active Guildmember.
 *
 * This helper removes the escape hatch. If CRON_SECRET is unset, the
 * function returns 500 'server_misconfigured' — ALL callers fail,
 * including legitimate Vercel Cron invocations. That's intentional:
 * a silent failure for Vercel is preferable to an open endpoint.
 *
 * DEPLOY ORDER (per brief A3)
 *
 * The env var must be set in the Vercel project BEFORE any deploy
 * containing this helper lands on main. Otherwise scheduled crons
 * will 500 until the env var is configured.
 *
 *   1. openssl rand -hex 32
 *   2. Add to Vercel env for Production + Preview on the
 *      penworth-new and guild.penworth.ai projects (they share a
 *      codebase so they share the cron list)
 *   3. Merge + push
 *
 * Development env is not set — local dev doesn't invoke Vercel crons,
 * so there's no use case there.
 */
export function requireCronAuth(req: NextRequest): NextResponse | null {
  const expected = process.env.CRON_SECRET;
  if (!expected) {
    console.error(
      '[cron-auth] CRON_SECRET is not set in the environment. Rejecting all callers.',
    );
    return NextResponse.json(
      { error: 'server_misconfigured' },
      { status: 500 },
    );
  }

  const authHeader = req.headers.get('authorization');
  if (authHeader !== `Bearer ${expected}`) {
    return NextResponse.json(
      { error: 'unauthorized' },
      { status: 401 },
    );
  }

  return null;
}
