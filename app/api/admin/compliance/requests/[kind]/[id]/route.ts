/**
 * PATCH /api/admin/compliance/requests/[kind]/[id]
 *
 * Admin-only. Transitions a data-subject-rights request through its
 * state machine.
 *
 * Path:
 *   kind = 'deletion' | 'export'
 *   id   = the request UUID
 *
 * Body:
 *   {
 *     to: <target status>,
 *     note?: <fulfillment note>,
 *     rejection_reason?: <required when to=rejected>,
 *     failure_reason?: <required when to=failed>,
 *     manifest?: <array of {table_name, rows_deleted, timestamp} objects
 *                 to MERGE into deletion_manifest / export_manifest>
 *   }
 *
 * Enforces the explicit state-transition table per lifecycle so admins
 * cannot skip states or move backwards. Every transition writes an
 * audit_log row with severity escalated for deadline-breached requests.
 *
 * Matches the same transition-validation pattern already used by the
 * Guild payout admin route (commit d8bec27).
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';
import { logAuditFromRequest, type AuditSeverity } from '@/lib/audit';
import { isDeadlineBreached } from '@/lib/compliance';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type DeletionStatus = 'received' | 'processing' | 'completed' | 'rejected' | 'failed';
type ExportStatus = 'received' | 'processing' | 'delivered' | 'expired' | 'failed';

/**
 * Explicit state-machine tables — same shape as the Guild payout
 * transitions in app/api/admin/guild/payouts/[payoutId]/route.ts.
 * Anything not listed here is rejected with 409.
 *
 * Note 'failed' allows retry back to 'processing' — useful when the
 * fulfilment logic hits a transient error (DB lock, storage upload
 * timeout) that will succeed on a second attempt.
 */
const DELETION_TRANSITIONS: Record<DeletionStatus, DeletionStatus[]> = {
  received: ['processing', 'rejected'],
  processing: ['completed', 'failed', 'rejected'],
  failed: ['processing', 'rejected'],
  completed: [],
  rejected: [],
};

const EXPORT_TRANSITIONS: Record<ExportStatus, ExportStatus[]> = {
  received: ['processing', 'failed'],
  processing: ['delivered', 'failed'],
  failed: ['processing'],
  delivered: ['expired'],
  expired: [],
};

export async function PATCH(
  request: NextRequest,
  props: { params: Promise<{ kind: string; id: string }> },
) {
  try {
    return await handlePatch(request, props);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[compliance/requests]', message);
    return NextResponse.json({ error: 'internal_error', message }, { status: 500 });
  }
}

async function handlePatch(
  request: NextRequest,
  props: { params: Promise<{ kind: string; id: string }> },
): Promise<NextResponse> {
  const params = await props.params;
  const { kind, id } = params;

  if (kind !== 'deletion' && kind !== 'export') {
    return NextResponse.json(
      { error: 'invalid_kind', message: "kind must be 'deletion' or 'export'" },
      { status: 400 },
    );
  }

  // Admin gate (matches existing pattern in /api/admin/guild/payouts/...)
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('is_admin')
    .eq('id', user.id)
    .single();
  if (!profile?.is_admin) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  let body: any;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }

  const to = String(body?.to ?? '');
  const note = typeof body?.note === 'string' ? body.note.trim() : null;
  const rejectionReason = typeof body?.rejection_reason === 'string' ? body.rejection_reason.trim() : null;
  const failureReason = typeof body?.failure_reason === 'string' ? body.failure_reason.trim() : null;
  const manifest = Array.isArray(body?.manifest) ? body.manifest : null;

  const admin = createServiceClient();
  const table = kind === 'deletion' ? 'data_deletion_requests' : 'data_exports';
  const manifestCol = kind === 'deletion' ? 'deletion_manifest' : 'export_manifest';

  // Load the row to check current status + deadline. Only select the
  // manifest column that actually exists on this table — requesting the
  // other one yields a Postgrest "column does not exist" error.
  const { data: current, error: loadErr } = await admin
    .from(table)
    .select(`id, status, user_id, user_email, statutory_deadline, ${manifestCol}`)
    .eq('id', id)
    .maybeSingle();

  if (loadErr || !current) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  const from = current.status as DeletionStatus | ExportStatus;
  const transitions = kind === 'deletion' ? DELETION_TRANSITIONS : EXPORT_TRANSITIONS;
  const allowed = (transitions as any)[from] ?? [];

  if (!allowed.includes(to)) {
    return NextResponse.json(
      { error: 'invalid_transition', from, to, allowed },
      { status: 409 },
    );
  }

  // Validate required fields per target state
  if (to === 'rejected' && !rejectionReason) {
    return NextResponse.json({ error: 'rejection_reason_required' }, { status: 400 });
  }
  if (to === 'failed' && !failureReason) {
    return NextResponse.json({ error: 'failure_reason_required' }, { status: 400 });
  }

  // Build update payload
  const now = new Date().toISOString();
  const updates: Record<string, any> = { status: to };

  if (to === 'processing') {
    updates.processing_started_at = now;
    updates.processed_by = user.id;
  }

  if (to === 'completed') {
    updates.completed_at = now;
    updates.processed_by = user.id;
  }

  if (kind === 'export' && to === 'delivered') {
    updates.delivered_at = now;
    updates.processed_by = user.id;
    // Signed-URL expiry 7 days from delivery
    updates.expires_at = new Date(Date.now() + 7 * 86_400_000).toISOString();
  }

  if (to === 'rejected') {
    updates.rejection_reason = rejectionReason;
    updates.processed_by = user.id;
  }

  if (to === 'failed') {
    updates.failure_reason = failureReason;
  }

  if (note) {
    // Only exists on deletion table; exports don't have fulfillment_notes.
    if (kind === 'deletion') updates.fulfillment_notes = note;
  }

  if (manifest) {
    // Merge new manifest entries with existing. Both tables use JSONB
    // array with the same structure. manifestCol is declared above at
    // the same scope as `table` — reuse it here.
    const existing = (current as any)[manifestCol] ?? [];
    updates[manifestCol] = [...existing, ...manifest];
  }

  const { error: updErr } = await admin
    .from(table)
    .update(updates)
    .eq('id', id)
    .eq('status', from); // optimistic concurrency

  if (updErr) {
    console.error('[compliance/requests] update failed:', updErr);
    return NextResponse.json({ error: 'update_failed', detail: updErr.message }, { status: 500 });
  }

  // Audit — severity escalates if the statutory deadline has already
  // been breached. A completion AFTER deadline is still a breach (the
  // legal clock has run out) and should surface in the Command Center
  // critical lane.
  const breached = isDeadlineBreached(current.statutory_deadline);
  let severity: AuditSeverity = 'info';
  if (to === 'rejected' || to === 'failed') severity = 'warning';
  if (breached) severity = 'critical';

  void logAuditFromRequest(request, {
    actorType: 'admin',
    actorUserId: user.id,
    action: 'admin.override',
    entityType: kind === 'deletion' ? 'data_deletion_request' : 'data_export_request',
    entityId: id,
    before: { status: from },
    after: {
      status: to,
      rejection_reason: rejectionReason ?? undefined,
      failure_reason: failureReason ?? undefined,
    },
    metadata: {
      kind: `${kind}_transition`,
      transition: `${from}→${to}`,
      user_email: current.user_email,
      statutory_deadline: current.statutory_deadline,
      deadline_breached: breached,
      note: note ?? undefined,
      manifest_entries_added: manifest?.length ?? 0,
    },
    severity,
  });

  return NextResponse.json({
    ok: true,
    from,
    to,
    id,
    deadline_breached: breached,
  });
}
