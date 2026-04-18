import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { requireAdmin } from '@/lib/admin/require-admin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/admin/guild/members/[id]/trigger-probation
 * Body: { reason: string }
 *
 * Calls guild_trigger_probation RPC with actor_id = authenticated admin.
 * The RPC itself double-checks is_admin (defense in depth). Idempotent —
 * returns already_on_probation=true if already probated, no error.
 */
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

  if (typeof body.reason !== 'string' || body.reason.trim().length === 0) {
    return NextResponse.json(
      { error: 'reason is required' },
      { status: 400 },
    );
  }

  const admin = createAdminClient();
  const { data, error } = await admin.rpc('guild_trigger_probation', {
    p_guildmember_id: memberId,
    p_reason: body.reason.trim(),
    p_actor_id: gate.userId,
  });

  if (error) {
    console.error('[trigger-probation] RPC error:', error);
    // Map known PL/pgSQL error codes to HTTP statuses.
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
