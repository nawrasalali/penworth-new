import { NextRequest, NextResponse } from 'next/server';
import { requireAdminRoleForApi } from '@/lib/admin/require-admin-role';
import { createServiceClient } from '@/lib/supabase/service';
import { logAuditFromRequest } from '@/lib/audit';

export const runtime = 'nodejs';

const VALID_ACTIONS = ['retry', 'escalate', 'user_fault', 'known_issue'] as const;
type ResolutionAction = (typeof VALID_ACTIONS)[number];

/**
 * POST /api/admin/incidents/[id]/resolve
 *
 * Body: { note: string, action: 'retry' | 'escalate' | 'user_fault' | 'known_issue' }
 *
 * Marks pipeline_incidents.resolved = true with resolution_note and
 * recovery_action_taken set. Does NOT write session state changes —
 * resolving an incident is bookkeeping, not a pipeline action. If the
 * action is 'retry', the next pipeline-health cron cycle will pick up
 * the (still-stuck) session and re-decide; if 'escalate' the session
 * stays stuck for manual intervention.
 *
 * This keeps the resolve endpoint pure: one row updated, one side
 * effect (reading for validation). The force-retry endpoint is a
 * separate surface for when the admin wants to actually fire the
 * restart event.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const gate = await requireAdminRoleForApi();
  if (!gate.ok) return gate.response;

  const { id } = await params;

  let body: { note?: unknown; action?: unknown };
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

  const action = body.action;
  if (typeof action !== 'string' || !VALID_ACTIONS.includes(action as ResolutionAction)) {
    return NextResponse.json(
      { error: 'invalid_action', message: `action must be one of ${VALID_ACTIONS.join(', ')}` },
      { status: 400 },
    );
  }

  const admin = createServiceClient();

  const { data: incident, error: fetchErr } = await admin
    .from('pipeline_incidents')
    .select('id, resolved')
    .eq('id', id)
    .maybeSingle();

  if (fetchErr || !incident) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }
  if (incident.resolved) {
    return NextResponse.json({ error: 'already_resolved' }, { status: 409 });
  }

  const { error: updateErr } = await admin
    .from('pipeline_incidents')
    .update({
      resolved: true,
      resolved_at: new Date().toISOString(),
      resolution_note: `[${action}] ${note}`,
      recovery_action_taken: `admin_resolve:${action}`,
    })
    .eq('id', id);

  if (updateErr) {
    console.error('[incidents/resolve] update failed:', updateErr);
    return NextResponse.json({ error: 'update_failed' }, { status: 500 });
  }

  // Audit log — canonical business-event record. Fire-and-forget;
  // a logAudit failure must not break the resolve UX.
  void logAuditFromRequest(request, {
    actorType: 'admin',
    actorUserId: gate.userId,
    action: 'pipeline.incident.resolve',
    entityType: 'pipeline_incident',
    entityId: id,
    before: { resolved: false },
    after: {
      resolved: true,
      resolution_note: `[${action}] ${note}`,
      recovery_action_taken: `admin_resolve:${action}`,
    },
    metadata: { action, note, route: '/api/admin/incidents/[id]/resolve' },
    severity: 'info',
  });

  return NextResponse.json({ ok: true });
}
