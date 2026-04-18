import { NextResponse } from 'next/server';
import { requireAgentAccess } from '@/lib/guild/require-agent-access';
import { GUILD_AGENTS } from '@/lib/guild/agents/registry';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Scout — coming soon.
 *
 * Critical ordering: account-health check runs BEFORE the 501 so probationed
 * members get the probation message, not a misleading "coming soon" message
 * when the real issue is that their agents are locked.
 */
async function handle() {
  const gate = await requireAgentAccess();
  if (!gate.ok) return gate.response;

  return NextResponse.json(
    { error: 'agent_not_yet_available', agent: 'scout', status: GUILD_AGENTS.scout.status },
    { status: 501 },
  );
}

export async function GET() {
  return handle();
}

export async function POST() {
  return handle();
}
