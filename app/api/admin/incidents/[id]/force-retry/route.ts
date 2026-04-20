import { NextRequest, NextResponse } from 'next/server';
import { requireAdminRoleForApi } from '@/lib/admin/require-admin-role';
import { createServiceClient } from '@/lib/supabase/service';
import { inngest } from '@/inngest/client';
import { logAuditFromRequest } from '@/lib/audit';

export const runtime = 'nodejs';

/**
 * POST /api/admin/incidents/[id]/force-retry
 *
 * Super-admin only. Bypasses pipeline_should_auto_retry entirely and
 * manually re-fires the restart event.
 *
 * What this does:
 *   1. Flip session pipeline_status='recovering', pulse heartbeat, keep
 *      failure_count as-is (this is an admin override, not an
 *      additional attempt from the auto-recovery's perspective)
 *   2. Mark the incident resolved with recovery_action_taken='force_retry'
 *   3. Fire inngest pipeline.restart-agent event
 *
 * What this does NOT do:
 *   - Re-trigger book/write. The restart-agent consumer is the right
 *     path; this endpoint is about the admin deciding retry is okay,
 *     not about doing the restart directly. If no consumer exists,
 *     the session flips to recovering and the next pipeline-health
 *     cron cycle will detect it stuck again and proceed through the
 *     normal decision path — which, because failure_count is
 *     unchanged, will retry again via the normal cron bump.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const gate = await requireAdminRoleForApi('super_admin');
  if (!gate.ok) return gate.response;

  const { id } = await params;

  const admin = createServiceClient();

  const { data: incident, error: fetchErr } = await admin
    .from('pipeline_incidents')
    .select('id, session_id, user_id, agent, resolved')
    .eq('id', id)
    .maybeSingle();

  if (fetchErr || !incident) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }
  if (!incident.session_id) {
    return NextResponse.json(
      { error: 'no_session', message: 'Incident has no associated session to retry.' },
      { status: 400 },
    );
  }

  // Flip session to recovering, pulse heartbeat.
  await admin
    .from('interview_sessions')
    .update({
      pipeline_status: 'recovering',
      agent_heartbeat_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      last_failure_reason: `force-retry by admin (incident ${id})`,
      last_failure_at: new Date().toISOString(),
    })
    .eq('id', incident.session_id);

  // Mark incident resolved with the force_retry marker.
  if (!incident.resolved) {
    await admin
      .from('pipeline_incidents')
      .update({
        resolved: true,
        resolved_at: new Date().toISOString(),
        resolution_note: 'Force-retry triggered by super_admin',
        recovery_action_taken: 'force_retry',
      })
      .eq('id', id);
  }

  // Audit log — the admin's force_retry action itself is the business
  // event. Fire-and-forget; logAudit failure must not break the flow.
  // Logged here (after DB side-effects, before Inngest send) because
  // the admin action is committed at this point regardless of whether
  // the downstream Inngest event lands.
  void logAuditFromRequest(request, {
    actorType: 'admin',
    actorUserId: gate.userId,
    action: 'pipeline.incident.force_retry',
    entityType: 'pipeline_incident',
    entityId: id,
    after: {
      session_id: incident.session_id,
      pipeline_status: 'recovering',
      recovery_action_taken: 'force_retry',
    },
    metadata: {
      session_id: incident.session_id,
      agent: incident.agent,
      source: 'super_admin',
      route: '/api/admin/incidents/[id]/force-retry',
    },
    severity: 'warning', // force-retry bypasses auto-recovery logic; worth a glance
  });

  // Fire the Inngest restart event. Same shape as the pipeline-health
  // cron fires — so if a consumer is ever built, it handles both
  // paths the same way.
  try {
    await inngest.send({
      name: 'pipeline.restart-agent',
      data: {
        sessionId: incident.session_id,
        userId: incident.user_id,
        agent: incident.agent,
        attempt: -1, // sentinel: admin force-retry, not counted in failure_count
        incidentId: incident.id,
        source: 'admin_force_retry',
      },
    });
  } catch (sendErr) {
    console.error('[incidents/force-retry] inngest.send failed:', sendErr);
    // Session is already marked recovering; admin will see the state
    // change in the UI. The next cron cycle will re-detect if nothing
    // happens.
    return NextResponse.json(
      {
        ok: true,
        warning: 'event_send_failed',
        message: 'Session marked recovering but Inngest event send failed. Cron will retry.',
      },
      { status: 207 },
    );
  }

  return NextResponse.json({ ok: true });
}
