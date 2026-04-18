import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

/**
 * Shared admin-gate for all /api/admin/* mutation routes.
 *
 * Server-side checks is_admin on the authenticated user's profile. The
 * admin page layout already redirects non-admins, but the API routes
 * are independent entry points that could be hit directly — e.g., a
 * browser session that lost admin privilege, or a curl call with a
 * stolen cookie. Each mutation route re-checks rather than trusting
 * the layout gate.
 *
 * Returns:
 *   { ok: true, userId }           — admin confirmed
 *   { ok: false, response }        — 401 or 403 NextResponse ready to return
 */
export async function requireAdmin(): Promise<
  | { ok: true; userId: string }
  | { ok: false; response: NextResponse }
> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return {
      ok: false,
      response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
    };
  }

  const { data: profile, error } = await supabase
    .from('profiles')
    .select('is_admin')
    .eq('id', user.id)
    .maybeSingle();

  if (error) {
    console.error('[requireAdmin] profile lookup error:', error);
    return {
      ok: false,
      response: NextResponse.json(
        { error: 'Profile lookup failed' },
        { status: 500 },
      ),
    };
  }

  if (!profile?.is_admin) {
    return {
      ok: false,
      response: NextResponse.json({ error: 'Forbidden' }, { status: 403 }),
    };
  }

  return { ok: true, userId: user.id };
}
