import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';
import type { SupabaseClient, User } from '@supabase/supabase-js';

/**
 * Shared gate for every Guild agent endpoint.
 *
 * Returns one of:
 *   - { ok: true, user, admin }   — caller is authenticated AND allowed to use
 *                                   agents (active Guildmember, not probation)
 *   - { ok: false, response }     — NextResponse to return immediately
 *
 * Two failure shapes:
 *   401 { error: 'unauthorized' }
 *      → caller isn't signed in
 *   403 { error: 'agent_access_locked', message: '...' }
 *      → caller is on probation OR not a Guildmember at all. We deliberately
 *        collapse both cases into the same response shape because the client
 *        doesn't need to distinguish them — "you can't use agents right now"
 *        is the operative fact.
 *
 * Uses the service-role (admin) client for the RPC so RLS on guild_members
 * doesn't block the lookup.
 *
 * The RPC `guild_agent_access_allowed(p_user_id uuid) RETURNS boolean` is the
 * single source of truth for whether agents should work. It returns true iff
 * the user has a guild_members row with status='active'. All four suspension
 * states — probation, terminated, resigned, non-member — collapse to false.
 */
export async function requireAgentAccess(): Promise<
  | { ok: true; user: User; admin: SupabaseClient }
  | { ok: false; response: NextResponse }
> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return {
      ok: false,
      response: NextResponse.json({ error: 'unauthorized' }, { status: 401 }),
    };
  }

  const admin = createServiceClient();
  const { data: allowed, error } = await admin.rpc('guild_agent_access_allowed', {
    p_user_id: user.id,
  });

  if (error) {
    // Treat RPC errors as fail-closed — do not leak agents if the gate is broken.
    console.error('[require-agent-access] RPC error:', error);
    return {
      ok: false,
      response: NextResponse.json(
        {
          error: 'agent_access_check_failed',
          message: 'Unable to verify agent access right now. Please try again shortly.',
        },
        { status: 503 },
      ),
    };
  }

  if (!allowed) {
    return {
      ok: false,
      response: NextResponse.json(
        {
          error: 'agent_access_locked',
          message:
            'Your Guild agents are temporarily locked. Visit /guild/dashboard/financials to restore access.',
        },
        { status: 403 },
      ),
    };
  }

  return { ok: true, user, admin };
}
