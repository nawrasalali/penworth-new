import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/service';
import { requireAdmin } from '@/lib/admin/require-admin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/admin/guild/members/[id]/promote-tier
 * Body: { new_tier: string, reason: string }
 *
 * Calls guild_promote_tier RPC. Writes an audit row to
 * guild_tier_promotions with promotion_reason='manual_override' and
 * evidence={note: reason}. Returns no_change=true if the member is
 * already on the requested tier (RPC handles this idempotently).
 */

const VALID_TIERS = new Set([
  'apprentice',
  'journeyman',
  'artisan',
  'master',
  'fellow',
  'emeritus',
]);

export async function POST(
  request: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const gate = await requireAdmin();
  if (!gate.ok) return gate.response;

  const { id: memberId } = await ctx.params;

  let body: any;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  if (typeof body.new_tier !== 'string' || !VALID_TIERS.has(body.new_tier)) {
    return NextResponse.json(
      { error: `new_tier must be one of: ${Array.from(VALID_TIERS).join(', ')}` },
      { status: 400 },
    );
  }
  if (typeof body.reason !== 'string' || body.reason.trim().length === 0) {
    return NextResponse.json({ error: 'reason is required' }, { status: 400 });
  }

  const admin = createServiceClient();
  const { data, error } = await admin.rpc('guild_promote_tier', {
    p_guildmember_id: memberId,
    p_new_tier: body.new_tier,
    p_reason: body.reason.trim(),
    p_actor_id: gate.userId,
  });

  if (error) {
    console.error('[promote-tier] RPC error:', error);
    if (error.code === 'P0002') {
      return NextResponse.json({ error: 'Member not found' }, { status: 404 });
    }
    if (error.code === '42501') {
      return NextResponse.json({ error: 'Not authorised' }, { status: 403 });
    }
    if (error.code === '22023') {
      return NextResponse.json({ error: 'Invalid tier' }, { status: 400 });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ data });
}
