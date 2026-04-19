import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { requireAgentAccess } from '@/lib/guild/require-agent-access';
import { consumeAdvisorTurn } from '@/lib/guild/consume-advisor-turn';
import { GUILD_AGENTS } from '@/lib/guild/agents/registry';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Advisor — 501 stub. Rate-limit gate is wired per Phase 2 Task 2.7
 * ahead of the real handler shipping, so the quota enforcement is in
 * place from day one. When the real conversational handler lands,
 * simply replace the 501 return with the actual logic — no additional
 * auth/rate-limit work needed.
 *
 * Order matters:
 *   1. requireAgentAccess — auth + probation/fee gate
 *   2. consumeAdvisorTurn — daily quota (RPC in migration 015)
 *   3. (future) real advisor handler
 *
 * Currently we consume a quota unit for every call even though the
 * response is 501. That's deliberate: during the stub period it
 * discourages repeated polling, and it exercises the RPC in prod so
 * any config drift surfaces early rather than the day the real
 * handler ships.
 */
async function handle() {
  const gate = await requireAgentAccess();
  if (!gate.ok) return gate.response;

  // Rate-limit check. If denied, return 429 with Retry-After.
  // Uses the authenticated user id from the cookie session.
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    // Should not happen — requireAgentAccess would have returned
    // earlier. Defensive belt-and-suspenders.
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  const rateLimit = await consumeAdvisorTurn(user.id);
  if (!rateLimit.ok) return rateLimit.response;

  return NextResponse.json(
    { error: 'agent_not_yet_available', agent: 'advisor', status: GUILD_AGENTS.advisor.status },
    { status: 501 },
  );
}

export async function GET() {
  return handle();
}

export async function POST() {
  return handle();
}
