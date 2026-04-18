import { NextResponse } from 'next/server';
import { requireAgentAccess } from '@/lib/guild/require-agent-access';
import { GUILD_AGENTS } from '@/lib/guild/agents/registry';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Coach — coming soon.
 * Probation check runs BEFORE 501 so account-health messaging wins.
 */
async function handle() {
  const gate = await requireAgentAccess();
  if (!gate.ok) return gate.response;

  return NextResponse.json(
    { error: 'agent_not_yet_available', agent: 'coach', status: GUILD_AGENTS.coach.status },
    { status: 501 },
  );
}

export async function GET() {
  return handle();
}

export async function POST() {
  return handle();
}
