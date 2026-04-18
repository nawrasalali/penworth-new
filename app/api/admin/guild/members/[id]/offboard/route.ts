import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { requireAdmin } from '@/lib/admin/require-admin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/admin/guild/members/[id]/offboard
 * Body: { offboard_type: 'resigned' | 'terminated', reason: string }
 *
 * Wraps the existing guild_offboard_member RPC (shipped pre-Phase-2,
 * verified in pre-flight). This is the canonical path for offboarding —
 * do NOT UPDATE guild_members.status directly. The RPC also expires any
 * unused showcase grants for the member (Phase 1E).
 *
 * Terminal operation: not reversible via the UI. A manual SQL fix-up
 * is needed if an offboard is done in error (un-expire grants, restore
 * status, null the termination timestamp).
 */

const VALID_TYPES = new Set(['resigned', 'terminated']);

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

  if (typeof body.offboard_type !== 'string' || !VALID_TYPES.has(body.offboard_type)) {
    return NextResponse.json(
      { error: `offboard_type must be one of: ${Array.from(VALID_TYPES).join(', ')}` },
      { status: 400 },
    );
  }
  if (typeof body.reason !== 'string' || body.reason.trim().length === 0) {
    return NextResponse.json({ error: 'reason is required' }, { status: 400 });
  }

  const admin = createAdminClient();
  const { data, error } = await admin.rpc('guild_offboard_member', {
    p_guildmember_id: memberId,
    p_offboard_type: body.offboard_type,
    p_reason: body.reason.trim(),
    p_actor_id: gate.userId,
  });

  if (error) {
    console.error('[offboard] RPC error:', error);
    if (error.code === 'P0002') {
      return NextResponse.json({ error: 'Member not found' }, { status: 404 });
    }
    if (error.code === '42501') {
      return NextResponse.json({ error: 'Not authorised' }, { status: 403 });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ data });
}
