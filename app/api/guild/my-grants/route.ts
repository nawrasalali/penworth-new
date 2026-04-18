import { NextResponse } from 'next/server';
import { createClient, createAdminClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/guild/my-grants
 *
 * Returns the current Guildmember's showcase-grant state for the five
 * categories. Used by the new-project flow to decide whether to render
 * the "grant available" banner (Task 1E.3) and by any client UI that
 * wants a quick "do I have any grants left?" signal.
 *
 * Response shape:
 *   { is_member: false }                           — not a Guildmember
 *   { is_member: true, unused_categories: string[], grants: [...] }
 *
 * The grants array is the raw per-row state so clients can render the
 * 5-tile grid without a second call if they want. unused_categories is
 * a convenience for the common "anything free?" check.
 *
 * Note: this endpoint is intentionally unauthenticated-style (relies on
 * session cookie). If the session is missing we return 401 like every
 * other /api/guild route.
 */
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const admin = createAdminClient();
  const { data: member } = await admin
    .from('guild_members')
    .select('id')
    .eq('user_id', user.id)
    .maybeSingle();

  if (!member) {
    // Non-members get a clean negative response so the new-project page
    // can render normally without a 4xx.
    return NextResponse.json({ is_member: false });
  }

  // Query the table directly (aggregate view doesn't return per-row state).
  const { data: grants, error } = await admin
    .from('guild_showcase_grants')
    .select('id, category, status, project_id, used_at')
    .eq('guildmember_id', member.id)
    .order('category');

  if (error) {
    console.error('[my-grants] grants select error:', error);
    return NextResponse.json(
      { is_member: true, unused_categories: [], grants: [] },
      { status: 200 },
    );
  }

  const unused_categories = (grants || [])
    .filter((g) => g.status === 'unused')
    .map((g) => g.category);

  return NextResponse.json({
    is_member: true,
    unused_categories,
    grants: grants || [],
  });
}
