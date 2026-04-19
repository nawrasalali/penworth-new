import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';
import {
  sendGuildInterviewInvitationEmail,
  sendGuildDeclineEmail,
} from '@/lib/email/guild';
import { logAuditFromRequest } from '@/lib/audit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Action = 'accept' | 'decline';

interface ReviewPayload {
  application_id: string;
  action: Action;
  decision_reason: string | null;
}

/**
 * POST /api/guild/admin/review
 *
 * Admin-only endpoint. Processes a decision on a Guild application.
 *
 * The state machine (as of Apr 2026):
 *   pending_review
 *     ↓ admin clicks Accept in the review UI
 *   invited_to_interview           ← this endpoint lives here
 *     ↓ member books + conducts voice interview
 *   interview_scheduled → interview_completed
 *     ↓ admin grades rubric_result = 'pass' via /api/guild/admin/grade-rubric
 *     ↓ admin then finalizes via /api/guild/admin/finalize-acceptance
 *   accepted
 *
 * Actions:
 *   - accept  → calls guild_invite_to_interview RPC (pending_review → invited_to_interview)
 *               then sends the voice-interview booking invitation
 *   - decline → sets application_status = 'declined', sends polite decline email
 *
 * The legacy 'invite' action is gone. Grading and finalization are each their
 * own endpoint now — see grade-rubric and finalize-acceptance.
 */
export async function POST(request: NextRequest) {
  // Verify admin
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const { data: profile } = await supabase
    .from('profiles')
    .select('is_admin')
    .eq('id', user.id)
    .single();
  if (!profile?.is_admin) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  // Parse body
  let payload: ReviewPayload;
  try {
    payload = (await request.json()) as ReviewPayload;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  if (!payload.application_id || !payload.action) {
    return NextResponse.json({ error: 'application_id and action are required' }, { status: 400 });
  }

  if (!['accept', 'decline'].includes(payload.action)) {
    return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
  }

  const admin = createServiceClient();

  // Load the application — we need it for the decline email and to fail fast
  // on missing rows before making the RPC call.
  const { data: app, error: loadError } = await admin
    .from('guild_applications')
    .select('id, email, full_name, primary_language, application_status')
    .eq('id', payload.application_id)
    .single();

  if (loadError || !app) {
    return NextResponse.json({ error: 'Application not found' }, { status: 404 });
  }

  try {
    if (payload.action === 'accept') {
      return await handleAccept(admin, app, user.id, request);
    }
    if (payload.action === 'decline') {
      return await handleDecline(admin, app, user.id, payload.decision_reason, request);
    }
  } catch (err) {
    console.error('[guild/admin/review]', err);
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }

  return NextResponse.json({ error: 'Unhandled action' }, { status: 400 });
}

// ---------------------------------------------------------------------------

async function handleAccept(admin: any, app: any, adminUserId: string, request: NextRequest) {
  // Transition pending_review → invited_to_interview via the RPC.
  // The RPC enforces the correct source state and is idempotent on re-calls.
  const { data: result, error } = await admin.rpc('guild_invite_to_interview', {
    p_application_id: app.id,
    p_actor_id: adminUserId,
  });

  if (error) {
    console.error('[accept] RPC error:', error);
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  // Send the voice-interview invitation. The booking URL points at the main
  // app (new.penworth.ai) — the guild subdomain is marketing-only and has no
  // /interview/schedule route deployed there.
  await sendGuildInterviewInvitationEmail({
    email: result.email ?? app.email,
    fullName: app.full_name,
    applicationId: result.application_id ?? app.id,
    language: app.primary_language,
  });

  // Audit — guild.invite_to_interview. NOT guild.accept — that's the
  // final post-rubric event in finalize-acceptance. This is the mid-
  // pipeline "proceed to voice interview" step.
  void logAuditFromRequest(request, {
    actorType: 'admin',
    actorUserId: adminUserId,
    action: 'guild.invite_to_interview',
    entityType: 'guild_application',
    entityId: app.id,
    before: { application_status: app.application_status },
    after: { application_status: 'invited_to_interview' },
    metadata: {
      already_invited: result.already_invited ?? false,
      applicant_email: app.email,
      applicant_full_name: app.full_name,
      applicant_language: app.primary_language,
    },
  });

  return NextResponse.json({
    ok: true,
    status: 'invited_to_interview',
    already_invited: result.already_invited ?? false,
  });
}

async function handleDecline(
  admin: any,
  app: any,
  adminUserId: string,
  decisionReason: string | null,
  request: NextRequest,
) {
  const { error } = await admin
    .from('guild_applications')
    .update({
      application_status: 'declined',
      decision_reason: decisionReason || null,
      decided_by: adminUserId,
      decided_at: new Date().toISOString(),
    })
    .eq('id', app.id);

  if (error) {
    console.error('[decline] Update error:', error);
    return NextResponse.json({ error: 'Failed to update application' }, { status: 500 });
  }

  await sendGuildDeclineEmail({
    email: app.email,
    fullName: app.full_name,
  });

  // Audit — guild.decline. Declines are relevant for board reports
  // (application quality trends, decline-reason patterns) and for
  // applicants who dispute the decision ('show me every step of the
  // decision process' → entity timeline via audit_log_entity_idx).
  void logAuditFromRequest(request, {
    actorType: 'admin',
    actorUserId: adminUserId,
    action: 'guild.decline',
    entityType: 'guild_application',
    entityId: app.id,
    before: { application_status: app.application_status },
    after: {
      application_status: 'declined',
      decision_reason: decisionReason ?? null,
    },
    metadata: {
      applicant_email: app.email,
      applicant_full_name: app.full_name,
      applicant_language: app.primary_language,
    },
  });

  return NextResponse.json({ ok: true, status: 'declined' });
}
