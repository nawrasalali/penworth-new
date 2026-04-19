import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/guild/me
 *
 * Authenticated endpoint returning the caller's Guild member state plus the
 * data needed to decide whether to render the probation banner.
 *
 * Response shape:
 *   200 {
 *     is_member:        boolean,
 *     status:           'active' | 'probation' | 'terminated' | 'resigned' | null,
 *     probation_reason: string | null,
 *     deferred_balance: number,          // USD, always a number (0 if no member)
 *     can_use_agents:   boolean,         // mirrors guild_agent_access_allowed
 *     tier:             string | null,
 *   }
 *   401 when unauthenticated
 *
 * Note: this endpoint exists specifically to power the use-agent-access hook
 * on the client side. The authoritative gate for API access is the
 * require-agent-access server helper; this endpoint is purely informational
 * and must never be trusted for authorization decisions.
 */
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const admin = createServiceClient();
  const { data: member } = await admin
    .from('guild_members')
    .select('id, status, probation_reason, tier')
    .eq('user_id', user.id)
    .maybeSingle();

  if (!member) {
    return NextResponse.json({
      is_member: false,
      status: null,
      probation_reason: null,
      deferred_balance: 0,
      can_use_agents: false,
      tier: null,
    });
  }

  // Deferred balance via the authoritative RPC. If the RPC is unavailable we
  // fall back to 0 — worse to block the dashboard than to under-report the
  // balance; the banner uses this only for display.
  const { data: balanceRaw } = await admin.rpc('guild_deferred_balance_usd', {
    p_guildmember_id: member.id,
  });
  const deferred_balance = Number(balanceRaw ?? 0);

  return NextResponse.json({
    is_member: true,
    status: member.status,
    probation_reason: member.probation_reason ?? null,
    deferred_balance,
    can_use_agents: member.status === 'active',
    tier: member.tier,
  });
}
