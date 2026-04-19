/**
 * POST /api/admin/compliance/requests/export/[id]/fulfil
 *
 * Admin-only. Runs the complete export fulfilment workflow for a
 * data_exports request:
 *
 *   1. Load the request row. Require status in ('received', 'processing', 'failed').
 *      Completed/delivered requests cannot be refulfilled.
 *   2. Transition to 'processing' if currently 'received' or 'failed'.
 *   3. Invoke fulfilExportRequest() from lib/compliance-fulfil.ts.
 *      Per-table failures are tolerated — the JSON file is written
 *      whatever can be collected.
 *   4. On fulfil success: write manifest + file_path + file_size_bytes,
 *      transition to 'delivered', set expires_at = now + 7 days.
 *   5. Email the user the signed URL.
 *   6. On fulfil failure: transition to 'failed' with failure_reason.
 *
 * Audit_log entries are written by the PATCH transition endpoint
 * when we call it internally — not duplicated here.
 *
 * maxDuration is set to 300s (Vercel Pro ceiling) because the JSON
 * build can take 30-90s for a user with heavy activity across 45
 * tables. The admin UI should fire-and-wait; if it times out at the
 * CDN layer (~60s) the background work still completes and the admin
 * can refresh to see the final state.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';
import { fulfilExportRequest } from '@/lib/compliance-fulfil';
import { sendDataExportReadyEmail } from '@/lib/email/compliance';
import { logAuditFromRequest } from '@/lib/audit';
import { isDeadlineBreached } from '@/lib/compliance';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function POST(
  request: NextRequest,
  props: { params: Promise<{ id: string }> },
) {
  try {
    return await handlePost(request, props);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[compliance/fulfil]', message);
    return NextResponse.json({ error: 'internal_error', message }, { status: 500 });
  }
}

async function handlePost(
  request: NextRequest,
  props: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await props.params;

  // Admin gate
  const userClient = await createClient();
  const { data: { user } } = await userClient.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const { data: profile } = await userClient
    .from('profiles')
    .select('is_admin')
    .eq('id', user.id)
    .single();
  if (!profile?.is_admin) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const admin = createServiceClient();

  // ---- Load the request ----
  const { data: req, error: loadErr } = await admin
    .from('data_exports')
    .select('id, user_id, user_email, format, status, statutory_deadline, export_manifest')
    .eq('id', id)
    .maybeSingle();

  if (loadErr || !req) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  if (!['received', 'processing', 'failed'].includes(req.status)) {
    return NextResponse.json(
      { error: 'invalid_state', message: `Cannot fulfil a request in status "${req.status}".`, current_status: req.status },
      { status: 409 },
    );
  }

  if (req.format !== 'json') {
    return NextResponse.json(
      { error: 'format_not_supported', message: 'Auto-fulfilment currently only supports format=json. CSV and ZIP are manual.' },
      { status: 400 },
    );
  }

  // ---- Transition received|failed → processing ----
  const fromStatus = req.status;
  if (fromStatus === 'received' || fromStatus === 'failed') {
    const { error: transitionErr } = await admin
      .from('data_exports')
      .update({
        status: 'processing',
        processing_started_at: new Date().toISOString(),
        processed_by: user.id,
      })
      .eq('id', id)
      .eq('status', fromStatus);

    if (transitionErr) {
      return NextResponse.json(
        { error: 'transition_failed', detail: transitionErr.message },
        { status: 500 },
      );
    }

    // Audit the processing transition
    void logAuditFromRequest(request, {
      actorType: 'admin',
      actorUserId: user.id,
      action: 'admin.override',
      entityType: 'data_export_request',
      entityId: id,
      before: { status: fromStatus },
      after: { status: 'processing' },
      metadata: {
        kind: 'export_transition',
        transition: `${fromStatus}→processing`,
        user_email: req.user_email,
        statutory_deadline: req.statutory_deadline,
        deadline_breached: isDeadlineBreached(req.statutory_deadline),
        trigger: 'fulfil_endpoint',
      },
      severity: 'info',
    });
  }

  // ---- Run fulfilment ----
  const result = await fulfilExportRequest(id, req.user_id);

  // Merge the per-table manifest into whatever's already on the row
  // (in case a previous failed attempt left partial entries).
  const existingManifest = Array.isArray(req.export_manifest) ? req.export_manifest : [];
  const mergedManifest = [...existingManifest, ...result.manifest];

  if (!result.success) {
    // Failure path — record what we got, mark failed
    const failureReason = result.error ?? 'unknown_fulfilment_error';
    const { error: failErr } = await admin
      .from('data_exports')
      .update({
        status: 'failed',
        failure_reason: failureReason,
        export_manifest: mergedManifest,
      })
      .eq('id', id);

    if (failErr) {
      console.error('[compliance/fulfil] failed to mark failed:', failErr);
    }

    void logAuditFromRequest(request, {
      actorType: 'admin',
      actorUserId: user.id,
      action: 'admin.override',
      entityType: 'data_export_request',
      entityId: id,
      before: { status: 'processing' },
      after: { status: 'failed' },
      metadata: {
        kind: 'export_transition',
        transition: 'processing→failed',
        user_email: req.user_email,
        statutory_deadline: req.statutory_deadline,
        deadline_breached: isDeadlineBreached(req.statutory_deadline),
        failure_reason: failureReason,
        manifest_entries_added: result.manifest.length,
      },
      severity: 'warning',
    });

    return NextResponse.json(
      {
        ok: false,
        error: 'fulfilment_failed',
        failure_reason: failureReason,
        manifest_entries_added: result.manifest.length,
      },
      { status: 500 },
    );
  }

  // ---- Success path ----
  const nowIso = new Date().toISOString();
  const { error: deliverErr } = await admin
    .from('data_exports')
    .update({
      status: 'delivered',
      delivered_at: nowIso,
      expires_at: result.signed_url_expires_at,
      file_path: result.file_path,
      file_size_bytes: result.file_size_bytes,
      export_manifest: mergedManifest,
    })
    .eq('id', id);

  if (deliverErr) {
    console.error('[compliance/fulfil] failed to mark delivered:', deliverErr);
    return NextResponse.json(
      { error: 'finalize_failed', detail: deliverErr.message, file_path: result.file_path },
      { status: 500 },
    );
  }

  // Audit delivered
  const breached = isDeadlineBreached(req.statutory_deadline);
  void logAuditFromRequest(request, {
    actorType: 'admin',
    actorUserId: user.id,
    action: 'admin.override',
    entityType: 'data_export_request',
    entityId: id,
    before: { status: 'processing' },
    after: { status: 'delivered' },
    metadata: {
      kind: 'export_transition',
      transition: 'processing→delivered',
      user_email: req.user_email,
      statutory_deadline: req.statutory_deadline,
      deadline_breached: breached,
      file_path: result.file_path,
      file_size_bytes: result.file_size_bytes,
      tables_attempted: result.manifest.length,
      tables_succeeded: result.manifest.filter((m) => m.status === 'success').length,
      tables_failed: result.manifest.filter((m) => m.status === 'error').length,
      trigger: 'fulfil_endpoint',
    },
    severity: breached ? 'critical' : 'info',
  });

  // ---- Pull user profile for the email ----
  const { data: targetProfile } = await admin
    .from('profiles')
    .select('full_name, email')
    .eq('id', req.user_id)
    .maybeSingle();

  const targetEmail = targetProfile?.email ?? req.user_email;
  const userName = targetProfile?.full_name ?? null;

  const emailResult = await sendDataExportReadyEmail({
    to: targetEmail,
    userName,
    signedUrl: result.signed_url,
    expiresAt: result.signed_url_expires_at,
    fileSizeBytes: result.file_size_bytes,
    tablesExported: result.manifest.filter((m) => m.status === 'success').length,
  });

  if (!emailResult.ok) {
    // Non-fatal — the export IS delivered, the user just won't see the
    // email. Admin can grab the signed URL from the response + manually
    // relay. Logged to audit as a warning.
    console.error('[compliance/fulfil] email send failed:', emailResult.error);
    void logAuditFromRequest(request, {
      actorType: 'admin',
      actorUserId: user.id,
      action: 'admin.override',
      entityType: 'data_export_request',
      entityId: id,
      metadata: {
        kind: 'export_email_send_failed',
        user_email: targetEmail,
        email_error: emailResult.error,
      },
      severity: 'warning',
    });
  }

  return NextResponse.json({
    ok: true,
    id,
    status: 'delivered',
    file_path: result.file_path,
    file_size_bytes: result.file_size_bytes,
    signed_url: result.signed_url,
    signed_url_expires_at: result.signed_url_expires_at,
    manifest_summary: {
      tables_attempted: result.manifest.length,
      tables_succeeded: result.manifest.filter((m) => m.status === 'success').length,
      tables_empty: result.manifest.filter((m) => m.status === 'empty').length,
      tables_failed: result.manifest.filter((m) => m.status === 'error').length,
    },
    email_sent: emailResult.ok,
    email_error: emailResult.ok ? null : emailResult.error,
    deadline_breached: breached,
  });
}
