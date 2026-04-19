import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { createClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';
import { modelFor, maxTokensFor } from '@/lib/ai/model-router';
import {
  resolveGuildMember,
  loadReferralMetrics,
  getAgentContext,
  setAgentContext,
  logGuildAgentUsage,
  GuildMemberCtx,
} from '@/lib/guild/agents/shared';
import {
  AnalystReport,
  TimeseriesPoint,
  buildAnalystPrompt,
} from '@/lib/guild/agents/analyst';
import { requireAgentAccess } from '@/lib/guild/require-agent-access';

export const dynamic = 'force-dynamic';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

/**
 * GET /api/guild/agents/analyst         — returns the cached report (or 404)
 * POST /api/guild/agents/analyst        — forces fresh generation
 *
 * The cache is keyed by (member_id, YYYY-MM-DD). Repeat GETs on the same day
 * return the same report. POST refreshes regardless.
 */

export async function GET(_req: NextRequest) {
  return handle(_req, { forceFresh: false });
}
export async function POST(_req: NextRequest) {
  return handle(_req, { forceFresh: true });
}

async function handle(
  _req: NextRequest,
  opts: { forceFresh: boolean },
): Promise<NextResponse> {
  // Auth + probation check in one call. Account-health failures (probation)
  // return 403 agent_access_locked; auth failures return 401.
  const gate = await requireAgentAccess();
  if (!gate.ok) return gate.response;
  const { user, admin } = gate;

  const member = await resolveGuildMember(admin, user.id);
  if (!member) return NextResponse.json({ error: 'not a Guild member' }, { status: 403 });

  const today = new Date().toISOString().slice(0, 10);

  // Check cache
  const cached = await getAgentContext<{
    reports?: Record<string, AnalystReport>;
  }>(admin, member.id, 'analyst');

  if (!opts.forceFresh && cached?.reports?.[today]) {
    return NextResponse.json({ report: cached.reports[today], cached: true });
  }

  const metrics = await loadReferralMetrics(admin, member);
  const series = await loadWeeklyTimeseries(admin, member, 12);

  // Build + call
  const prompt = buildAnalystPrompt(member, metrics, series);
  const response = await anthropic.messages.create({
    model: modelFor('guild_analyst_report'),
    max_tokens: maxTokensFor('guild_analyst_report'),
    system: 'You are a structured-output assistant. Respond with ONLY valid JSON. No prose, no markdown fences.',
    messages: [{ role: 'user', content: prompt }],
  });

  const raw = response.content
    .filter((c): c is Anthropic.TextBlock => c.type === 'text')
    .map((c) => c.text)
    .join('\n')
    .trim();

  // Best-effort cost log. Logged before parse — tokens are spent
  // whether or not the JSON parses cleanly.
  void logGuildAgentUsage(admin, {
    userId: user.id,
    memberId: member.id,
    task: 'guild_analyst_report',
    usage: response.usage,
    metadata: {
      date: today,
      forced_fresh: opts.forceFresh,
      weeks_of_series: series.length,
    },
  });

  const cleaned = raw.replace(/```json\s*|\s*```/g, '').trim();

  let report: AnalystReport;
  try {
    report = JSON.parse(cleaned);
  } catch (err) {
    console.error('[analyst] JSON parse failed. Raw:', raw);
    return NextResponse.json(
      { error: 'analyst returned malformed JSON' },
      { status: 502 },
    );
  }

  // Sanity-check the shape
  if (
    !report.headline ||
    !report.momentum ||
    !Array.isArray(report.what_is_working) ||
    !Array.isArray(report.what_is_not) ||
    !Array.isArray(report.watch_next)
  ) {
    return NextResponse.json(
      { error: 'analyst report missing required fields' },
      { status: 502 },
    );
  }

  // Cache with today's date; keep up to the last 30 reports for history
  const priorReports = cached?.reports ?? {};
  const updatedReports = { ...priorReports, [today]: report };
  const datesSorted = Object.keys(updatedReports).sort();
  while (datesSorted.length > 30) {
    const oldest = datesSorted.shift()!;
    delete updatedReports[oldest];
  }

  await setAgentContext(admin, member.id, 'analyst', {
    reports: updatedReports,
    last_series: series,
  });

  return NextResponse.json({ report, cached: false });
}

/**
 * Build N weeks of weekly points (most recent last) from guild_referrals +
 * guild_commissions. One DB read each; aggregated in memory.
 */
async function loadWeeklyTimeseries(
  admin: ReturnType<typeof createServiceClient>,
  member: GuildMemberCtx,
  weeks: number,
): Promise<TimeseriesPoint[]> {
  const cutoff = new Date();
  cutoff.setUTCDate(cutoff.getUTCDate() - weeks * 7);
  cutoff.setUTCHours(0, 0, 0, 0);
  const cutoffIso = cutoff.toISOString();

  const [{ data: refs }, { data: comms }] = await Promise.all([
    admin
      .from('guild_referrals')
      .select('created_at, first_paid_at')
      .eq('guildmember_id', member.id)
      .gte('created_at', cutoffIso),
    admin
      .from('guild_commissions')
      .select('commission_amount_usd, earned_at, status')
      .eq('guildmember_id', member.id)
      .gte('earned_at', cutoffIso),
  ]);

  // Build weekly buckets keyed by Monday of each week
  const buckets = new Map<
    string,
    { signups: number; first_payments: number; commission_usd: number }
  >();
  for (let i = 0; i < weeks; i++) {
    const d = new Date();
    d.setUTCHours(0, 0, 0, 0);
    const day = d.getUTCDay();
    const mondayOffset = day === 0 ? -6 : 1 - day;
    d.setUTCDate(d.getUTCDate() + mondayOffset - i * 7);
    buckets.set(d.toISOString().slice(0, 10), {
      signups: 0,
      first_payments: 0,
      commission_usd: 0,
    });
  }

  function mondayOf(iso: string): string {
    const d = new Date(iso);
    d.setUTCHours(0, 0, 0, 0);
    const day = d.getUTCDay();
    const offset = day === 0 ? -6 : 1 - day;
    d.setUTCDate(d.getUTCDate() + offset);
    return d.toISOString().slice(0, 10);
  }

  for (const r of refs ?? []) {
    const k = mondayOf(r.created_at);
    const b = buckets.get(k);
    if (b) b.signups += 1;
    if (r.first_paid_at) {
      const k2 = mondayOf(r.first_paid_at);
      const b2 = buckets.get(k2);
      if (b2) b2.first_payments += 1;
    }
  }
  for (const c of comms ?? []) {
    if (c.status === 'clawed_back') continue;
    const k = mondayOf(c.earned_at);
    const b = buckets.get(k);
    if (b) b.commission_usd += Number(c.commission_amount_usd);
  }

  return Array.from(buckets.entries())
    .map(([week_start, v]) => ({
      week_start,
      signups: v.signups,
      first_payments: v.first_payments,
      commission_usd: Number(v.commission_usd.toFixed(2)),
    }))
    .sort((a, b) => (a.week_start < b.week_start ? -1 : 1));
}
