import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { requireAdmin } from '@/lib/admin/require-admin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/admin/tickets/[id]/merge
 * Body: { target_ticket_id: string }
 *
 * Merges the source ticket (path param) INTO the target ticket.
 *   - source.status       = 'merged'
 *   - source.merged_into  = target_ticket_id
 *   - adds a system reply on the target noting the merge, for thread context
 *
 * Does NOT physically move replies from source to target — the merge
 * tag on the source preserves its thread for audit. Admins following up
 * will read the target's thread plus the system reply pointing at the
 * source's number.
 *
 * Guards:
 *   - caller must be admin
 *   - both tickets must exist and be different ids
 *   - target ticket must not already be in status='merged' (no merging
 *     into an already-merged ticket — find the canonical target instead)
 */
export async function POST(
  request: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const gate = await requireAdmin();
  if (!gate.ok) return gate.response;

  const { id: sourceId } = await ctx.params;

  let body: any;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const targetId = typeof body.target_ticket_id === 'string' ? body.target_ticket_id : null;
  if (!targetId) {
    return NextResponse.json(
      { error: 'target_ticket_id is required' },
      { status: 400 },
    );
  }
  if (targetId === sourceId) {
    return NextResponse.json(
      { error: 'Cannot merge a ticket into itself' },
      { status: 400 },
    );
  }

  const admin = createAdminClient();

  // Fetch both tickets to validate state.
  const { data: both } = await admin
    .from('support_tickets')
    .select('id, ticket_number, status')
    .in('id', [sourceId, targetId]);

  if (!both || both.length < 2) {
    return NextResponse.json(
      { error: 'Source or target ticket not found' },
      { status: 404 },
    );
  }

  const source = both.find((t) => t.id === sourceId);
  const target = both.find((t) => t.id === targetId);
  if (!source || !target) {
    return NextResponse.json(
      { error: 'Source or target ticket not found' },
      { status: 404 },
    );
  }
  if (target.status === 'merged') {
    return NextResponse.json(
      { error: 'Target ticket is itself merged; use the canonical target' },
      { status: 400 },
    );
  }

  // Update source first, then reply. If the reply fails, the source is
  // still marked merged — acceptable; better to have the merge done and
  // the reply retryable than the reverse. An admin can add the bridging
  // note manually from the target thread.
  const { error: updErr } = await admin
    .from('support_tickets')
    .update({ status: 'merged', merged_into: targetId })
    .eq('id', sourceId);

  if (updErr) {
    console.error('[POST /api/admin/tickets/:id/merge] source update error:', updErr);
    return NextResponse.json({ error: updErr.message }, { status: 500 });
  }

  // System reply on target linking the merge. author_role='system' so UI
  // can render it distinctly from admin/user replies.
  const { error: replyErr } = await admin
    .from('support_ticket_replies')
    .insert({
      ticket_id: targetId,
      author_id: gate.userId,
      author_role: 'system',
      body: `Merged ${source.ticket_number} into this ticket.`,
      is_internal_note: false,
    });

  if (replyErr) {
    console.error('[POST /api/admin/tickets/:id/merge] bridging reply error:', replyErr);
    // Non-fatal: the source is already merged. Return 200 with warning.
    return NextResponse.json(
      {
        data: { source_id: sourceId, target_id: targetId },
        warning: 'Merge completed but bridging reply failed — add manually',
      },
      { status: 200 },
    );
  }

  return NextResponse.json({
    data: {
      source_id: sourceId,
      target_id: targetId,
      target_number: target.ticket_number,
    },
  });
}
