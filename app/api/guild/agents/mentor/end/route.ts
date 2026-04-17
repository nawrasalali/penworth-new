import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { createClient, createAdminClient } from '@/lib/supabase/server';
import { modelFor, maxTokensFor } from '@/lib/ai/model-router';
import {
  resolveGuildMember,
  setAgentContext,
} from '@/lib/guild/agents/shared';
import {
  buildMentorSummaryPrompt,
  MentorSession,
} from '@/lib/guild/agents/mentor';

export const dynamic = 'force-dynamic';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

/**
 * POST /api/guild/agents/mentor/end
 * Body: { session_id: string }
 * Summarises the session into a journal entry, writes guild_weekly_checkins,
 * clears the active session from agent context.
 */
export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  let body: any;
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }
  const sessionId = String(body?.session_id ?? '');
  if (!sessionId) return NextResponse.json({ error: 'session_id required' }, { status: 400 });

  const admin = createAdminClient();
  const member = await resolveGuildMember(admin, user.id);
  if (!member) return NextResponse.json({ error: 'not a Guild member' }, { status: 403 });

  const { data: ctxRow } = await admin
    .from('guild_agent_context')
    .select('context')
    .eq('guildmember_id', member.id)
    .eq('agent_name', 'mentor')
    .maybeSingle();

  const ctx = ctxRow?.context as { active_session?: MentorSession } | null;
  const session = ctx?.active_session;
  if (!session || session.id !== sessionId) {
    return NextResponse.json({ error: 'session not found' }, { status: 404 });
  }
  if (session.ended_at) {
    return NextResponse.json({ error: 'session already ended' }, { status: 409 });
  }

  const userTurns = session.turns.filter((t) => t.role === 'user').length;
  if (userTurns < 1) {
    return NextResponse.json(
      { error: 'cannot end a session before replying at least once' },
      { status: 400 },
    );
  }

  // Ask Claude for a structured summary
  const summaryPrompt = buildMentorSummaryPrompt(member, session.metrics_snapshot, session.turns);
  const response = await anthropic.messages.create({
    model: modelFor('guild_mentor_summary'),
    max_tokens: maxTokensFor('guild_mentor_summary'),
    system: 'You are a structured-output assistant. Respond with ONLY valid JSON. No prose, no markdown.',
    messages: [{ role: 'user', content: summaryPrompt }],
  });
  const raw = response.content
    .filter((c): c is Anthropic.TextBlock => c.type === 'text')
    .map((c) => c.text)
    .join('\n')
    .trim();
  const cleaned = raw.replace(/```json\s*|\s*```/g, '').trim();

  let summary: {
    headline: string;
    what_happened: string;
    blocker: string | null;
    next_action: { description: string; by_date: string; measurable: boolean };
    mentor_note: string;
    escalate_to_human: boolean;
    escalation_reason: string | null;
  };
  try {
    summary = JSON.parse(cleaned);
  } catch (err) {
    console.error('[mentor.end] JSON parse failed. Raw:', raw);
    return NextResponse.json(
      { error: 'summary generation returned malformed JSON — session preserved, try ending again' },
      { status: 502 },
    );
  }

  // Compose journal entry for storage (plain text)
  const journal = [
    `Headline: ${summary.headline}`,
    `What happened: ${summary.what_happened}`,
    summary.blocker ? `Blocker: ${summary.blocker}` : null,
    `Next action: ${summary.next_action.description} (by ${summary.next_action.by_date})`,
    `Mentor note: ${summary.mentor_note}`,
  ].filter(Boolean).join('\n\n');

  // Upsert into guild_weekly_checkins (unique on guildmember_id + week_of)
  const { data: checkin, error: upsertErr } = await admin
    .from('guild_weekly_checkins')
    .upsert({
      guildmember_id: member.id,
      week_of: session.week_of,
      mentor_journal_entry: journal,
      completion_data: {
        session_id: session.id,
        turn_count: session.turns.length,
        next_action: summary.next_action,
      },
      metrics_snapshot: session.metrics_snapshot,
      escalated_to_human: summary.escalate_to_human,
      escalation_reason: summary.escalation_reason,
    }, { onConflict: 'guildmember_id,week_of' })
    .select('id, week_of')
    .single();

  if (upsertErr) {
    console.error('[mentor.end] checkin upsert failed:', upsertErr);
    return NextResponse.json({ error: 'failed to persist check-in' }, { status: 500 });
  }

  // Clear active session
  session.ended_at = new Date().toISOString();
  await setAgentContext(admin, member.id, 'mentor', {
    last_session: session,
    last_summary: summary,
  });

  return NextResponse.json({
    ok: true,
    checkin_id: checkin.id,
    week_of: checkin.week_of,
    summary,
  });
}
