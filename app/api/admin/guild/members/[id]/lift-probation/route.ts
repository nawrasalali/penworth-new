import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/service';
import { requireAdmin } from '@/lib/admin/require-admin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/admin/guild/members/[id]/lift-probation
 * Body: { note?: string }
 *
 * Calls guild_lift_probation RPC. Note is optional (free text, audit
 * only — returned in the RPC's response jsonb but not stored as a
 * column). Fails with 404 if member not on probation.
 */
export async function POST(
  request: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const gate = await requireAdmin();
  if (!gate.ok) return gate.response;

  const { id: memberId } = await ctx.params;

  let body: any = {};
  try {
    body = await request.json();
  } catch {
    // empty body is fine — note is optional
  }

  const note = typeof body.note === 'string' ? body.note.trim() : '';

  const admin = createServiceClient();
  const { data, error } = await admin.rpc('guild_lift_probation', {
    p_guildmember_id: memberId,
    p_note: note,
    p_actor_id: gate.userId,
  });

  if (error) {
    console.error('[lift-probation] RPC error:', error);
    if (error.code === 'P0002') {
      return NextResponse.json(
        { error: 'Member not found or not on probation' },
        { status: 404 },
      );
    }
    if (error.code === '42501') {
      return NextResponse.json({ error: 'Not authorised' }, { status: 403 });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ data });
}
