import { SupabaseClient } from '@supabase/supabase-js';

/**
 * Shared helpers for the member-facing Guild agents (mentor, analyst,
 * strategist). These are NOT applied to the application-review or interview
 * agents — those have their own flows.
 */

export interface GuildMemberCtx {
  id: string;
  user_id: string;
  display_name: string;
  tier: string;
  status: string;
  primary_market: string | null;
  primary_language: string;
  joined_at: string;
  referral_code: string;
}

export async function resolveGuildMember(
  admin: SupabaseClient,
  authUserId: string,
): Promise<GuildMemberCtx | null> {
  const { data } = await admin
    .from('guild_members')
    .select(
      'id, user_id, display_name, tier, status, primary_market, primary_language, joined_at, referral_code',
    )
    .eq('user_id', authUserId)
    .maybeSingle();
  return data ?? null;
}

// ---------------------------------------------------------------------------
// Metrics: a deterministic snapshot of the member's referral performance.
// Used by analyst + strategist as grounding, and embedded in mentor context.
// ---------------------------------------------------------------------------

export interface ReferralMetrics {
  total_referrals: number;
  active_paid: number;
  retention_qualified: number;
  cancelled: number;
  refunded: number;
  last_30d_signups: number;
  last_30d_first_payments: number;

  commission_total_usd: number;
  commission_locked_usd: number;
  commission_pending_usd: number;
  commission_paid_usd: number;
  commission_clawed_back_usd: number;

  this_month_commission_usd: number;
  this_month_signups: number;

  tier_at_today: string;
  days_in_tier: number;
  weeks_since_joined: number;
}

function startOfDaysAgo(days: number): string {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString();
}

export async function loadReferralMetrics(
  admin: SupabaseClient,
  member: GuildMemberCtx,
): Promise<ReferralMetrics> {
  const memberId = member.id;

  const { data: referrals } = await admin
    .from('guild_referrals')
    .select('id, status, created_at, first_paid_at')
    .eq('guildmember_id', memberId);

  const { data: commissions } = await admin
    .from('guild_commissions')
    .select('commission_amount_usd, status, commission_month, earned_at')
    .eq('guildmember_id', memberId);

  const now = new Date();
  const thirty = startOfDaysAgo(30);
  const currentMonth = now.toISOString().slice(0, 7);

  const refs = referrals ?? [];
  const comms = commissions ?? [];

  const metrics: ReferralMetrics = {
    total_referrals: refs.length,
    active_paid: refs.filter((r) => r.status === 'active_paid').length,
    retention_qualified: refs.filter((r) => r.status === 'retention_qualified')
      .length,
    cancelled: refs.filter((r) => r.status === 'cancelled').length,
    refunded: refs.filter((r) => r.status === 'refunded').length,
    last_30d_signups: refs.filter((r) => r.created_at >= thirty).length,
    last_30d_first_payments: refs.filter(
      (r) => r.first_paid_at && r.first_paid_at >= thirty,
    ).length,

    commission_total_usd: sumBy(comms, (c) => Number(c.commission_amount_usd)),
    commission_locked_usd: sumBy(
      comms.filter((c) => c.status === 'locked'),
      (c) => Number(c.commission_amount_usd),
    ),
    commission_pending_usd: sumBy(
      comms.filter((c) => c.status === 'pending'),
      (c) => Number(c.commission_amount_usd),
    ),
    commission_paid_usd: sumBy(
      comms.filter((c) => c.status === 'paid'),
      (c) => Number(c.commission_amount_usd),
    ),
    commission_clawed_back_usd: sumBy(
      comms.filter((c) => c.status === 'clawed_back'),
      (c) => Number(c.commission_amount_usd),
    ),

    this_month_commission_usd: sumBy(
      comms.filter((c) => c.commission_month === currentMonth),
      (c) => Number(c.commission_amount_usd),
    ),
    this_month_signups: refs.filter(
      (r) => r.created_at.slice(0, 7) === currentMonth,
    ).length,

    tier_at_today: member.tier,
    days_in_tier: daysSince(member.joined_at), // coarse — tier_since would be more accurate if available
    weeks_since_joined: Math.floor(daysSince(member.joined_at) / 7),
  };

  return metrics;
}

function sumBy<T>(arr: T[], fn: (t: T) => number): number {
  return Number(arr.reduce((s, x) => s + fn(x), 0).toFixed(2));
}

function daysSince(iso: string): number {
  const then = new Date(iso).getTime();
  return Math.floor((Date.now() - then) / 86_400_000);
}

// ---------------------------------------------------------------------------
// guild_agent_context get/set — one row per (member, agent). JSONB payload.
// ---------------------------------------------------------------------------

export type AgentName = 'mentor' | 'analyst' | 'strategist';

export async function getAgentContext<T = Record<string, unknown>>(
  admin: SupabaseClient,
  memberId: string,
  agentName: AgentName,
): Promise<T | null> {
  const { data } = await admin
    .from('guild_agent_context')
    .select('context')
    .eq('guildmember_id', memberId)
    .eq('agent_name', agentName)
    .maybeSingle();
  return (data?.context as T) ?? null;
}

export async function setAgentContext(
  admin: SupabaseClient,
  memberId: string,
  agentName: AgentName,
  context: Record<string, unknown>,
): Promise<void> {
  await admin.from('guild_agent_context').upsert(
    {
      guildmember_id: memberId,
      agent_name: agentName,
      context,
      last_updated_at: new Date().toISOString(),
    },
    { onConflict: 'guildmember_id,agent_name' },
  );
}
