import { NextRequest, NextResponse } from 'next/server';
import { createClient, createAdminClient } from '@/lib/supabase/server';
import { sendGuildPostInterviewCodeEmail } from '@/lib/email/guild';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type RubricResult = 'pass' | 'fail';

interface RubricPayload {
  application_id: string;
  rubric_result: RubricResult;
  reviewer_notes?: string | null;
  tier?: string; // Optional — defaults to 'apprentice' on pass
}

/**
 * POST /api/guild/admin/interview-rubric
 *
 * Admin-only. Grades the voice-interview rubric and — on a 'pass' result —
 * finalizes Guild acceptance via the guild_finalize_acceptance RPC.
 *
 * State transition on pass:
 *   application_status: interview_completed → accepted
 *   guild_members row is created (with referral_code auto-generated,
 *     5 showcase grants seeded, 90-day account_fee_starts_at set)
 *   → post-interview code-reveal email is sent
 *
 * On fail: the rubric_result is recorded and the application status stays at
 * interview_completed so admin can decline via the review endpoint separately.
 * (We deliberately don't auto-decline here — rubric grading and final
 * disposition are separate human decisions.)
 *
 * Body: { application_id, rubric_result: 'pass' | 'fail', reviewer_notes?, tier? }
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

  let payload: RubricPayload;
  try {
    payload = (await request.json()) as RubricPayload;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  if (!payload.application_id) {
    return NextResponse.json({ error: 'application_id is required' }, { status: 400 });
  }
  if (!['pass', 'fail'].includes(payload.rubric_result)) {
    return NextResponse.json(
      { error: "rubric_result must be 'pass' or 'fail'" },
      { status: 400 },
    );
  }

  const admin = createAdminClient();

  // Fetch application + linked voice interview
  const { data: app, error: appErr } = await admin
    .from('guild_applications')
    .select('id, voice_interview_id, application_status')
    .eq('id', payload.application_id)
    .single();

  if (appErr || !app) {
    return NextResponse.json({ error: 'Application not found' }, { status: 404 });
  }
  if (!app.voice_interview_id) {
    return NextResponse.json(
      { error: 'No voice interview linked to this application' },
      { status: 400 },
    );
  }

  // Persist rubric result on the interview row.
  const { error: updateErr } = await admin
    .from('guild_voice_interviews')
    .update({
      rubric_result: payload.rubric_result,
      reviewer_notes: payload.reviewer_notes ?? null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', app.voice_interview_id);

  if (updateErr) {
    console.error('[interview-rubric] Update error:', updateErr);
    return NextResponse.json({ error: 'Failed to record rubric result' }, { status: 500 });
  }

  // On fail, we stop here — finalization only happens on pass.
  if (payload.rubric_result === 'fail') {
    return NextResponse.json({
      ok: true,
      rubric_result: 'fail',
      application_id: app.id,
      note: 'Rubric recorded. Use the review endpoint to decline the application.',
    });
  }

  // Pass path: finalize via the RPC. The RPC:
  //   - validates interview_completed + rubric_result='pass'
  //   - transitions application_status → 'accepted'
  //   - inserts guild_members row (referral_code auto-generated, 5 showcase
  //     grants seeded, 90-day account_fee_starts_at set)
  //   - is idempotent: returns already_accepted=true if re-invoked
  const { data: result, error: rpcErr } = await admin.rpc('guild_finalize_acceptance', {
    p_application_id: app.id,
    p_tier: payload.tier ?? 'apprentice',
    p_actor_id: user.id,
  });

  if (rpcErr) {
    console.error('[interview-rubric] Finalize RPC error:', rpcErr);
    return NextResponse.json({ error: rpcErr.message }, { status: 400 });
  }

  // Send the code-reveal email. (Only fire the email on the first finalization;
  // re-grades that hit the idempotency branch still re-send so the member can
  // recover the code if they lost the first email.)
  const emailResult = await sendGuildPostInterviewCodeEmail({
    email: result.email,
    displayName: result.display_name || 'Guild member',
    referralCode: result.referral_code,
    tier: result.tier ?? 'apprentice',
  });

  return NextResponse.json({
    ok: true,
    rubric_result: 'pass',
    application_id: result.application_id,
    member_id: result.member_id,
    referral_code: result.referral_code,
    tier: result.tier,
    already_accepted: result.already_accepted ?? false,
    email_sent: emailResult.success,
    email_error: emailResult.success ? undefined : String(emailResult.error ?? 'unknown'),
  });
}
