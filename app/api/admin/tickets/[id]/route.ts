import { NextRequest, NextResponse } from 'next/server';
import { createClient, createAdminClient } from '@/lib/supabase/server';
import { requireAdmin } from '@/lib/admin/require-admin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * PATCH /api/admin/tickets/[id]
 * Body: { status?: string, assigned_to?: string | null }
 *
 * Updates status and/or assignee on a ticket. Validates:
 *   - caller is admin
 *   - status is in the allowed set (no 'merged' — that's set only by the
 *     merge action endpoint)
 *   - if assigned_to is set, the target user has is_admin=true (per A9:
 *     support_tickets.assigned_to is FK-less by convention; integrity is
 *     enforced here)
 *
 * Uses createAdminClient for the UPDATE so we bypass RLS on the tickets
 * table — the is_admin gate at the top is the authorization boundary.
 */

const ALLOWED_STATUS = new Set([
  'open',
  'in_progress',
  'awaiting_user',
  'resolved',
  'closed_no_response',
]);

export async function PATCH(
  request: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const gate = await requireAdmin();
  if (!gate.ok) return gate.response;

  const { id } = await ctx.params;

  let body: any;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const patch: Record<string, unknown> = {};

  if ('status' in body) {
    if (typeof body.status !== 'string' || !ALLOWED_STATUS.has(body.status)) {
      return NextResponse.json(
        { error: `Invalid status. Allowed: ${Array.from(ALLOWED_STATUS).join(', ')}` },
        { status: 400 },
      );
    }
    patch.status = body.status;
  }

  if ('assigned_to' in body) {
    if (body.assigned_to === null) {
      patch.assigned_to = null;
    } else if (typeof body.assigned_to === 'string') {
      // Validate the target is actually an admin. A9: support_tickets has
      // no FK on this column; we enforce integrity here.
      const supabase = await createClient();
      const { data: target } = await supabase
        .from('profiles')
        .select('is_admin')
        .eq('id', body.assigned_to)
        .maybeSingle();

      if (!target?.is_admin) {
        return NextResponse.json(
          { error: 'assigned_to must reference an admin user' },
          { status: 400 },
        );
      }
      patch.assigned_to = body.assigned_to;
    } else {
      return NextResponse.json(
        { error: 'assigned_to must be null or a uuid string' },
        { status: 400 },
      );
    }
  }

  if (Object.keys(patch).length === 0) {
    return NextResponse.json(
      { error: 'No patchable fields supplied' },
      { status: 400 },
    );
  }

  const admin = createAdminClient();
  const { data, error } = await admin
    .from('support_tickets')
    .update(patch)
    .eq('id', id)
    .select()
    .maybeSingle();

  if (error) {
    console.error('[PATCH /api/admin/tickets/:id] update error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (!data) {
    return NextResponse.json({ error: 'Ticket not found' }, { status: 404 });
  }

  return NextResponse.json({ data });
}
