import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { requireAdmin } from '@/lib/admin/require-admin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/admin/tickets/[id]/replies
 * Body: { body: string, is_internal_note?: boolean }
 *
 * Posts an admin reply to a support ticket. Derives author_id from the
 * authenticated admin session — never trust a client-supplied author_id.
 * author_role is hardcoded to 'admin' here because the admin gate above
 * guarantees the caller is an admin.
 *
 * Schema assumptions for support_ticket_replies (verified by pre-flight):
 *   ticket_id        uuid FK to support_tickets
 *   author_id        uuid FK-less by convention (user who wrote the reply)
 *   author_role      text ('admin' | 'user' | 'nora' | 'system')
 *   body             text NOT NULL
 *   is_internal_note boolean DEFAULT false
 *   created_at       timestamptz DEFAULT now()
 *
 * Uses createAdminClient so the INSERT bypasses any RLS on
 * support_ticket_replies. Authorization is the is_admin gate at the top.
 */
export async function POST(
  request: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const gate = await requireAdmin();
  if (!gate.ok) return gate.response;

  const { id: ticketId } = await ctx.params;

  let body: any;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  if (typeof body.body !== 'string' || body.body.trim().length === 0) {
    return NextResponse.json(
      { error: 'body must be a non-empty string' },
      { status: 400 },
    );
  }

  const isInternal =
    typeof body.is_internal_note === 'boolean' ? body.is_internal_note : false;

  const admin = createAdminClient();

  // Sanity-check the ticket exists so we fail with a clean 404 rather than
  // a FK violation or silent drop. Cheap point-lookup.
  const { data: ticket } = await admin
    .from('support_tickets')
    .select('id, status')
    .eq('id', ticketId)
    .maybeSingle();

  if (!ticket) {
    return NextResponse.json({ error: 'Ticket not found' }, { status: 404 });
  }

  const { data: reply, error } = await admin
    .from('support_ticket_replies')
    .insert({
      ticket_id: ticketId,
      author_id: gate.userId,
      author_role: 'admin',
      body: body.body.trim(),
      is_internal_note: isInternal,
    })
    .select()
    .maybeSingle();

  if (error) {
    console.error('[POST /api/admin/tickets/:id/replies] insert error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Small UX courtesy: if the ticket is currently 'open' and an admin
  // replies (non-internal), bump to 'in_progress'. Internal notes don't
  // count — they're admin-to-admin. We don't override other statuses
  // (if ticket was closed and an admin adds a note, leave it closed).
  if (!isInternal && ticket.status === 'open') {
    await admin
      .from('support_tickets')
      .update({ status: 'in_progress' })
      .eq('id', ticketId);
  }

  return NextResponse.json({ data: reply }, { status: 201 });
}
