import { NextRequest, NextResponse } from 'next/server';
import { requireAdminRoleForApi } from '@/lib/admin/require-admin-role';
import { createServiceClient } from '@/lib/supabase/service';
import { logAuditFromRequest } from '@/lib/audit';

export const runtime = 'nodejs';

/**
 * POST /api/admin/alerts/[id]/ack
 *
 * Body: { note: string }
 *
 * Writes acknowledged_by + acknowledged_at on the alert row. The note
 * doesn't get its own column on alert_log (the live schema has no
 * acknowledgement_note field) — instead, we append it to the body so
 * the audit record stays immutable and searchable in one place.
 *
 * Scoping: any admin can ack any alert. The brief notes that
 * ownership of categories matters (financial alerts → finance_admin)
 * but the live schema doesn't have per-category ack RBAC and adding
 * it would need a schema change. First cut: open to any admin, the
 * acknowledger's identity is recorded so audit is intact.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const gate = await requireAdminRoleForApi();
  if (!gate.ok) return gate.response;

  const { id } = await params;

  let body: { note?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }

  const note = typeof body.note === 'string' ? body.note.trim() : '';
  if (note.length < 3) {
    return NextResponse.json(
      { error: 'note_too_short', message: 'Provide a note of at least 3 characters.' },
      { status: 400 },
    );
  }
  if (note.length > 1000) {
    return NextResponse.json(
      { error: 'note_too_long', message: 'Note must be 1000 characters or fewer.' },
      { status: 400 },
    );
  }

  const admin = createServiceClient();

  // Fetch existing row so we can append to body rather than replace.
  const { data: row, error: fetchErr } = await admin
    .from('alert_log')
    .select('id, body, acknowledged_at')
    .eq('id', id)
    .maybeSingle();

  if (fetchErr || !row) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }
  if (row.acknowledged_at) {
    return NextResponse.json(
      { error: 'already_acknowledged' },
      { status: 409 },
    );
  }

  const appendedBody =
    `${row.body}\n\n--\nAcknowledged by admin at ${new Date().toISOString()}: ${note}`;

  const { error: updateErr } = await admin
    .from('alert_log')
    .update({
      acknowledged_by: gate.userId,
      acknowledged_at: new Date().toISOString(),
      body: appendedBody,
    })
    .eq('id', id);

  if (updateErr) {
    console.error('[alerts/ack] update failed:', updateErr);
    return NextResponse.json({ error: 'update_failed' }, { status: 500 });
  }

  // Audit log — append-only business record of who acknowledged what.
  // Fire-and-forget; a logAudit failure must not break the ack UX.
  void logAuditFromRequest(request, {
    actorType: 'admin',
    actorUserId: gate.userId,
    action: 'pipeline.alert.ack',
    entityType: 'pipeline_alert',
    entityId: id,
    before: { acknowledged: false },
    after: { acknowledged: true, acknowledged_at: new Date().toISOString() },
    metadata: { note, route: '/api/admin/alerts/[id]/ack' },
    severity: 'info',
  });

  return NextResponse.json({ ok: true });
}
