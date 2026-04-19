import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { createClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';
import { modelFor, maxTokensFor } from '@/lib/ai/model-router';
import {
  resolveGuildMember,
  setAgentContext,
} from '@/lib/guild/agents/shared';
import {
  buildMentorSystemPrompt,
  MentorSession,
  MentorTurn,
} from '@/lib/guild/agents/mentor';
import { requireAgentAccess } from '@/lib/guild/require-agent-access';

export const dynamic = 'force-dynamic';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const MAX_TURNS_PER_SIDE = 12; // hard cap — ~24 messages total

/**
 * POST /api/guild/agents/mentor/continue
 * Body: { session_id: string, message: string }
 * Appends the user's message, asks Claude for the next reply, persists both.
 */
export async function POST(req: NextRequest) {
  const gate = await requireAgentAccess();
  if (!gate.ok) return gate.response;
  const { user, admin } = gate;

  let body: any;
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }
  const sessionId = String(body?.session_id ?? '');
  const userMessage = typeof body?.message === 'string' ? body.message.trim() : '';

  if (!sessionId) return NextResponse.json({ error: 'session_id required' }, { status: 400 });
  if (userMessage.length < 1) return NextResponse.json({ error: 'message required' }, { status: 400 });
  if (userMessage.length > 4000) return NextResponse.json({ error: 'message too long (4000 char max)' }, { status: 400 });

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
  if (userTurns >= MAX_TURNS_PER_SIDE) {
    return NextResponse.json(
      { error: 'turn limit reached — end the session' },
      { status: 409 },
    );
  }

  // Append user turn
  const now = new Date().toISOString();
  session.turns.push({ role: 'user', content: userMessage, at: now });

  // Build the Anthropic conversation
  const system = buildMentorSystemPrompt(member, session.metrics_snapshot);
  // Cache hit on the system prompt established by mentor/start.
  // 5-min TTL comfortably covers a typical check-in (5-10 turns
  // spaced 30s-2min apart).
  const response = await anthropic.messages.create({
    model: modelFor('guild_mentor_turn'),
    max_tokens: maxTokensFor('guild_mentor_turn'),
    system: [
      { type: 'text', text: system, cache_control: { type: 'ephemeral' } },
    ],
    messages: session.turns.map((t: MentorTurn) => ({
      role: t.role,
      content: t.content,
    })),
  });

  const reply = response.content
    .filter((c): c is Anthropic.TextBlock => c.type === 'text')
    .map((c) => c.text)
    .join('\n')
    .trim();

  session.turns.push({
    role: 'assistant',
    content: reply,
    at: new Date().toISOString(),
  });

  await setAgentContext(admin, member.id, 'mentor', { active_session: session });

  return NextResponse.json({
    session_id: session.id,
    assistant_message: reply,
    turns_remaining: MAX_TURNS_PER_SIDE - (userTurns + 1),
  });
}
