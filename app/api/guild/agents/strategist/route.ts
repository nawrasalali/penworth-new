import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { createClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';
import { modelFor, maxTokensFor } from '@/lib/ai/model-router';
import {
  resolveGuildMember,
  loadReferralMetrics,
  getAgentContext,
  logGuildAgentUsage,
} from '@/lib/guild/agents/shared';
import { buildStrategistPrompt, StrategistPlan, nextMondayUtc, planEndDate } from '@/lib/guild/agents/strategist';
import { AnalystReport } from '@/lib/guild/agents/analyst';
import { requireAgentAccess } from '@/lib/guild/require-agent-access';

export const dynamic = 'force-dynamic';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

/**
 * GET /api/guild/agents/strategist         — returns latest active plan
 * POST /api/guild/agents/strategist        — generates a new plan, supersedes
 *                                            any existing active plan
 *
 * Plans land in guild_growth_plans with status='active'. Generating a new plan
 * marks the previous active plan 'superseded' and inserts the new one with an
 * incremented plan_version. History is preserved.
 */

export async function GET(_req: NextRequest) {
  const gate = await requireAgentAccess();
  if (!gate.ok) return gate.response;
  const { user, admin } = gate;

  const member = await resolveGuildMember(admin, user.id);
  if (!member) return NextResponse.json({ error: 'not a Guild member' }, { status: 403 });

  const { data: active } = await admin
    .from('guild_growth_plans')
    .select('*')
    .eq('guildmember_id', member.id)
    .eq('status', 'active')
    .order('plan_version', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!active) {
    return NextResponse.json({ plan: null });
  }

  return NextResponse.json({
    plan_id: active.id,
    plan_version: active.plan_version,
    start_date: active.start_date,
    end_date: active.end_date,
    current_week: active.current_week,
    status: active.status,
    completion_pct: active.completion_pct,
    plan: active.plan_document as StrategistPlan,
  });
}

export async function POST(_req: NextRequest) {
  const gate = await requireAgentAccess();
  if (!gate.ok) return gate.response;
  const { user, admin } = gate;

  const member = await resolveGuildMember(admin, user.id);
  if (!member) return NextResponse.json({ error: 'not a Guild member' }, { status: 403 });
  if (member.status === 'terminated' || member.status === 'resigned') {
    return NextResponse.json(
      { error: `membership ${member.status}` },
      { status: 403 },
    );
  }

  const metrics = await loadReferralMetrics(admin, member);

  // Grounding — latest mentor next_action and latest analyst report
  const mentorCtx = await getAgentContext<{
    last_summary?: {
      next_action?: { description: string; by_date: string; measurable: boolean };
    };
  }>(admin, member.id, 'mentor');

  const analystCtx = await getAgentContext<{
    reports?: Record<string, AnalystReport>;
  }>(admin, member.id, 'analyst');

  const latestAnalystDate = Object.keys(analystCtx?.reports ?? {}).sort().pop();
  const latestAnalystReport = latestAnalystDate
    ? analystCtx!.reports![latestAnalystDate]
    : null;

  const prompt = buildStrategistPrompt(member, metrics, {
    mentor_last_next_action: mentorCtx?.last_summary?.next_action
      ? {
          description: mentorCtx.last_summary.next_action.description,
          by_date: mentorCtx.last_summary.next_action.by_date,
        }
      : null,
    analyst_report: latestAnalystReport,
  });

  const response = await anthropic.messages.create({
    model: modelFor('guild_strategist_plan'),
    max_tokens: maxTokensFor('guild_strategist_plan'),
    system: 'You are a structured-output assistant. Respond with ONLY valid JSON. No prose, no markdown fences.',
    messages: [{ role: 'user', content: prompt }],
  });

  const raw = response.content
    .filter((c): c is Anthropic.TextBlock => c.type === 'text')
    .map((c) => c.text)
    .join('\n')
    .trim();

  // Best-effort cost log. Logged before parse — tokens are spent
  // whether or not the JSON parses cleanly. `week_start` captures
  // which week the plan targets so the CFO Agent can correlate
  // strategist spend with plan cadence if needed later.
  void logGuildAgentUsage(admin, {
    userId: user.id,
    memberId: member.id,
    task: 'guild_strategist_plan',
    usage: response.usage,
    metadata: {
      week_start: nextMondayUtc(),
      had_prior_mentor_action: Boolean(mentorCtx?.last_summary?.next_action),
      had_prior_analyst_report: Boolean(latestAnalystReport),
    },
  });

  const cleaned = raw.replace(/```json\s*|\s*```/g, '').trim();

  let plan: StrategistPlan;
  try {
    plan = JSON.parse(cleaned);
  } catch (err) {
    console.error('[strategist] JSON parse failed. Raw:', raw);
    return NextResponse.json(
      { error: 'strategist returned malformed JSON' },
      { status: 502 },
    );
  }

  // Shape check
  if (
    !plan.thesis ||
    !Array.isArray(plan.actions) ||
    plan.actions.length < 3 ||
    plan.actions.length > 5 ||
    !plan.checkpoint
  ) {
    return NextResponse.json(
      { error: 'strategist plan failed validation (need 3-5 actions, thesis, checkpoint)' },
      { status: 502 },
    );
  }

  // Sum effort_minutes defensively — model sometimes forgets
  plan.total_minutes = plan.actions.reduce(
    (s, a) => s + (Number(a.effort_minutes) || 0),
    0,
  );
  plan.generated_at = new Date().toISOString();

  // Normalise start date to next Monday UTC so it's deterministic,
  // regardless of what the model put in week_starting
  const start = nextMondayUtc();
  const end = planEndDate(start);
  plan.week_starting = start;

  // Supersede prior active plan(s), then insert new one with bumped version
  const { data: prevActive } = await admin
    .from('guild_growth_plans')
    .select('plan_version')
    .eq('guildmember_id', member.id)
    .eq('status', 'active')
    .order('plan_version', { ascending: false })
    .limit(1);

  const nextVersion = (prevActive?.[0]?.plan_version ?? 0) + 1;

  await admin
    .from('guild_growth_plans')
    .update({
      status: 'superseded',
      updated_at: new Date().toISOString(),
    })
    .eq('guildmember_id', member.id)
    .eq('status', 'active');

  const { data: inserted, error: insertErr } = await admin
    .from('guild_growth_plans')
    .insert({
      guildmember_id: member.id,
      plan_version: nextVersion,
      plan_document: plan,
      start_date: start,
      end_date: end,
      current_week: 1,
      status: 'active',
      completion_pct: 0,
    })
    .select('id, plan_version, start_date, end_date')
    .single();

  if (insertErr) {
    console.error('[strategist] plan insert failed:', insertErr);
    return NextResponse.json(
      { error: 'failed to persist plan' },
      { status: 500 },
    );
  }

  return NextResponse.json({
    plan_id: inserted.id,
    plan_version: inserted.plan_version,
    start_date: inserted.start_date,
    end_date: inserted.end_date,
    plan,
  });
}
