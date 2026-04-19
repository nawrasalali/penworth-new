import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import Anthropic from '@anthropic-ai/sdk';
import { createClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';
import { modelFor, maxTokensFor } from '@/lib/ai/model-router';
import {
  resolveGuildMember,
  loadReferralMetrics,
  setAgentContext,
  logGuildAgentUsage,
} from '@/lib/guild/agents/shared';
import {
  buildMentorSystemPrompt,
  currentWeekOf,
  MentorSession,
} from '@/lib/guild/agents/mentor';
import { requireAgentAccess } from '@/lib/guild/require-agent-access';

export const dynamic = 'force-dynamic';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

/**
 * POST /api/guild/agents/mentor/start
 * Opens a weekly check-in session. Returns session_id + opening message.
 * If a session already exists for this week, returns that one unchanged
 * (idempotency — you can't start two check-ins in one week).
 */
export async function POST(_req: NextRequest) {
  // Auth + probation check in one call. Probationed members are blocked here.
  // This is a business-rule change: mentor was previously accessible on
  // probation — Phase 1D moves to "probation locks all agents".
  const gate = await requireAgentAccess();
  if (!gate.ok) return gate.response;
  const { user, admin } = gate;

  const member = await resolveGuildMember(admin, user.id);
  if (!member)
    return NextResponse.json({ error: 'not a Guild member' }, { status: 403 });
  // Defense-in-depth: the gate already rejects non-'active' members via the
  // RPC, but keep this check in case the gate is ever loosened.
  if (member.status !== 'active') {
    return NextResponse.json(
      { error: `membership ${member.status}` },
      { status: 403 },
    );
  }

  // If this week already has a completed check-in, refuse — members do one
  // per week.
  const weekOf = currentWeekOf();
  const { data: existing } = await admin
    .from('guild_weekly_checkins')
    .select('id, mentor_journal_entry')
    .eq('guildmember_id', member.id)
    .eq('week_of', weekOf)
    .maybeSingle();
  if (existing?.mentor_journal_entry) {
    return NextResponse.json(
      {
        error: 'already checked in this week',
        week_of: weekOf,
        existing_checkin_id: existing.id,
      },
      { status: 409 },
    );
  }

  // If there's an in-flight session in agent context, return it rather than
  // starting a new one — survives page reloads.
  const { data: ctxRow } = await admin
    .from('guild_agent_context')
    .select('context')
    .eq('guildmember_id', member.id)
    .eq('agent_name', 'mentor')
    .maybeSingle();
  const prior = ctxRow?.context as { active_session?: MentorSession } | null;
  if (prior?.active_session && !prior.active_session.ended_at) {
    return NextResponse.json({
      session_id: prior.active_session.id,
      week_of: prior.active_session.week_of,
      turns: prior.active_session.turns,
      resumed: true,
    });
  }

  const metrics = await loadReferralMetrics(admin, member);

  // Ask Claude for the opening line
  const system = buildMentorSystemPrompt(member, metrics);
  // Prompt caching: the system prompt is built from member context
  // + this week's referral metrics and stays identical across every
  // turn of the check-in. Writing the cache here means continue/end
  // calls within the 5-minute TTL pay 10× less for the system prompt.
  const response = await anthropic.messages.create({
    model: modelFor('guild_mentor_turn'),
    max_tokens: maxTokensFor('guild_mentor_turn'),
    system: [
      { type: 'text', text: system, cache_control: { type: 'ephemeral' } },
    ],
    messages: [
      {
        role: 'user',
        content:
          '[Begin the weekly check-in. Greet me briefly, acknowledge this week\'s numbers specifically, and ask your first question.]',
      },
    ],
  });
  const opening = response.content
    .filter((c): c is Anthropic.TextBlock => c.type === 'text')
    .map((c) => c.text)
    .join('\n')
    .trim();

  // Best-effort cost log — first turn of a check-in, writes the system-
  // prompt cache. Subsequent `continue` turns will show cache_read hits.
  void logGuildAgentUsage(admin, {
    userId: user.id,
    memberId: member.id,
    task: 'guild_mentor_turn',
    usage: response.usage,
    metadata: { phase: 'start', week_of: weekOf },
  });

  const session: MentorSession = {
    id: randomUUID(),
    started_at: new Date().toISOString(),
    week_of: weekOf,
    metrics_snapshot: metrics,
    turns: [
      {
        role: 'assistant',
        content: opening,
        at: new Date().toISOString(),
      },
    ],
  };

  await setAgentContext(admin, member.id, 'mentor', { active_session: session });

  return NextResponse.json({
    session_id: session.id,
    week_of: session.week_of,
    turns: session.turns,
    resumed: false,
  });
}
