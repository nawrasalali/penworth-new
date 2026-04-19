import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';

/**
 * Phase 2 Task 2.7 / Phase 2.5 Commit 10 — shared advisor rate-limit
 * check. Wraps the guild_advisor_consume_turn RPC (migration 015, live
 * in prod). Fail-closed: if the RPC errors, we return 503 — never fall
 * through unauth-protected.
 *
 * Returns either:
 *   { ok: true, turns_today, limit, resets_at }
 *     — quota consumed, caller may proceed
 *   { ok: false, response: NextResponse }
 *     — caller returns response immediately (429 or 503)
 *
 * The RPC envelope matches the one used by nora_consume_turn for
 * consistency.
 */
export async function consumeAdvisorTurn(
  userId: string,
): Promise<
  | {
      ok: true;
      turns_today: number;
      limit: number;
      resets_at: string;
    }
  | { ok: false; response: NextResponse }
> {
  const admin = createAdminClient();
  const { data, error } = await admin.rpc('guild_advisor_consume_turn', {
    p_user_id: userId,
  });

  if (error) {
    console.error('[consumeAdvisorTurn] RPC error:', error);
    return {
      ok: false,
      response: NextResponse.json(
        { error: 'rate_limit_check_failed' },
        { status: 503 },
      ),
    };
  }

  const result = data as {
    allowed?: boolean;
    turns_today?: number;
    limit?: number;
    resets_at?: string;
    message?: string;
  } | null;

  if (!result?.allowed) {
    const resetsAt = result?.resets_at
      ? new Date(result.resets_at).getTime()
      : Date.now() + 24 * 60 * 60 * 1000;
    const retryAfterSecs = Math.max(
      1,
      Math.ceil((resetsAt - Date.now()) / 1000),
    );
    return {
      ok: false,
      response: NextResponse.json(
        {
          error: 'rate_limited',
          message:
            result?.message ??
            "You've reached the daily advisor message limit. It resets in 24 hours.",
          turns_today: result?.turns_today,
          limit: result?.limit,
          resets_at: result?.resets_at,
        },
        {
          status: 429,
          headers: { 'Retry-After': String(retryAfterSecs) },
        },
      ),
    };
  }

  return {
    ok: true,
    turns_today: result.turns_today ?? 0,
    limit: result.limit ?? 0,
    resets_at: result.resets_at ?? '',
  };
}
