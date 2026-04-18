import { NextRequest, NextResponse } from 'next/server';
import { createClient, createAdminClient } from '@/lib/supabase/server';
import {
  sendGuildInterviewInvitationEmail,
  sendGuildPostInterviewCodeEmail,
} from '@/lib/email/guild';
import { logAuditFromRequest } from '@/lib/audit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/guild/admin/resend-acceptance
 *
 * Admin-only. Re-sends the email that corresponds to the application's current
 * state in the acceptance flow. A single endpoint serves both stages:
 *
 *   application_status = 'invited_to_interview'
 *     → resends the voice-interview booking invitation
 *
 *   application_status = 'accepted' (member row exists)
 *     → resends the post-interview code-reveal email
 *
 *   anything else → 409 with explanation
 *
 * Body: { application_id? } or { member_id? } or { user_id? } — one required.
 * Resolution priority: application_id → member_id → user_id.
 */
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: profile } = await supabase
    .from('profiles')
    .select('is_admin')
    .eq('id', user.id)
    .single();
  if (!profile?.is_admin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  let body: { application_id?: string; member_id?: string; user_id?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  if (!body.application_id && !body.member_id && !body.user_id) {
    return NextResponse.json(
      { error: 'application_id, member_id, or user_id is required' },
      { status: 400 },
    );
  }

  const admin = createAdminClient();

  // ------------------------------------------------------------------
  // Resolve the application — it's the source of truth for state.
  // ------------------------------------------------------------------
  let application: {
    id: string;
    email: string;
    full_name: string;
    primary_language: string;
    application_status: string;
  } | null = null;

  if (body.application_id) {
    const { data } = await admin
      .from('guild_applications')
      .select('id, email, full_name, primary_language, application_status')
      .eq('id', body.application_id)
      .single();
    application = data;
  } else if (body.member_id || body.user_id) {
    // Look up the member first, then walk to the application via application_id.
    const { data: member } = await admin
      .from('guild_members')
      .select('application_id')
      .match(body.member_id ? { id: body.member_id } : { user_id: body.user_id })
      .single();

    if (member?.application_id) {
      const { data } = await admin
        .from('guild_applications')
        .select('id, email, full_name, primary_language, application_status')
        .eq('id', member.application_id)
        .single();
      application = data;
    }
  }

  if (!application) {
    return NextResponse.json({ error: 'Application not found' }, { status: 404 });
  }

  // ------------------------------------------------------------------
  // Branch on application_status.
  // ------------------------------------------------------------------
  if (application.application_status === 'invited_to_interview') {
    const result = await sendGuildInterviewInvitationEmail({
      email: application.email,
      fullName: application.full_name,
      applicationId: application.id,
      language: application.primary_language,
    });

    // Audit — admin.override. Resends are benign (info severity) but
    // they DO happen, and an applicant complaining 'I never got the
    // email' might turn out to be a case where the admin resent 3
    // times to a typo'd address. The audit trail captures it.
    void logAuditFromRequest(request, {
      actorType: 'admin',
      actorUserId: user.id,
      action: 'admin.override',
      entityType: 'guild_application',
      entityId: application.id,
      metadata: {
        kind: 'resend_interview_invitation',
        sent_to: application.email,
        email_success: result.success,
        email_error: result.success ? undefined : String(result.error ?? 'unknown'),
      },
    });

    return NextResponse.json({
      ok: result.success,
      kind: 'interview_invitation',
      sent_to: application.email,
      error: result.success ? undefined : String(result.error ?? 'unknown'),
    });
  }

  if (application.application_status === 'accepted') {
    // Pull member record for the referral code + display name + tier.
    const { data: member, error: memberErr } = await admin
      .from('guild_members')
      .select('display_name, referral_code, tier')
      .eq('application_id', application.id)
      .single();

    if (memberErr || !member) {
      return NextResponse.json(
        {
          error: 'Application is accepted but no guild_members row found. Inconsistent state — investigate.',
          application_id: application.id,
        },
        { status: 409 },
      );
    }

    const result = await sendGuildPostInterviewCodeEmail({
      email: application.email,
      displayName: member.display_name || application.full_name,
      referralCode: member.referral_code,
      tier: member.tier,
    });

    // Audit — admin.override for a code-reveal resend. Referral codes
    // aren't secret per-se (Guild members share them publicly to drive
    // signups), but resending the welcome email unnecessarily could
    // cause confusion ('did I lose my membership?'). Board reports
    // aggregate these as a product-experience signal.
    void logAuditFromRequest(request, {
      actorType: 'admin',
      actorUserId: user.id,
      action: 'admin.override',
      entityType: 'guild_application',
      entityId: application.id,
      metadata: {
        kind: 'resend_post_interview_code',
        sent_to: application.email,
        referral_code: member.referral_code,
        tier: member.tier,
        email_success: result.success,
        email_error: result.success ? undefined : String(result.error ?? 'unknown'),
      },
    });

    return NextResponse.json({
      ok: result.success,
      kind: 'post_interview_code',
      sent_to: application.email,
      referral_code: member.referral_code,
      error: result.success ? undefined : String(result.error ?? 'unknown'),
    });
  }

  // Anything else is not a valid resend target.
  return NextResponse.json(
    {
      error: `Cannot resend acceptance email for application in status "${application.application_status}". Valid statuses are "invited_to_interview" or "accepted".`,
      application_id: application.id,
      application_status: application.application_status,
    },
    { status: 409 },
  );
}
