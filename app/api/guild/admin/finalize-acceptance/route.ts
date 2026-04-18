import { NextRequest, NextResponse } from 'next/server';
import { createClient, createAdminClient } from '@/lib/supabase/server';
import { sendGuildPostInterviewCodeEmail } from '@/lib/email/guild';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface FinalizePayload {
  application_id: string;
  tier?: string; // Defaults to 'apprentice' — promotions happen later via tier logic
}

/**
 * POST /api/guild/admin/finalize-acceptance
 *
 * Admin-only endpoint. Called after a rubric has been graded 'pass' to
 * finalize the member's acceptance. Wraps the guild_finalize_acceptance RPC:
 *
 *   - validates interview_completed + rubric_result='pass'
 *   - transitions application_status → 'accepted'
 *   - inserts guild_members row (referral_code auto-generated, 5 showcase
 *     grants seeded, account_fee_starts_at = joined_at + 90 days)
 *   - idempotent: returns already_accepted=true on repeat call
 *
 * On success, sends the post-interview code-reveal email. Even on the
 * already_accepted branch we re-send — if the original email was lost, the
 * admin can trigger this endpoint again to get the member their code.
 *
 * Body: { application_id, tier? }
 */
export async function POST(request: NextRequest) {
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

  let payload: FinalizePayload;
  try {
    payload = (await request.json()) as FinalizePayload;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  if (!payload.application_id) {
    return NextResponse.json({ error: 'application_id is required' }, { status: 400 });
  }

  const admin = createAdminClient();
  const { data: result, error } = await admin.rpc('guild_finalize_acceptance', {
    p_application_id: payload.application_id,
    p_tier: payload.tier ?? 'apprentice',
    p_actor_id: user.id,
  });

  if (error) {
    console.error('[finalize-acceptance] RPC error:', error);
    return NextResponse.json({ error: error.message, code: error.code ?? undefined }, { status: 400 });
  }

  // Fire the code-reveal email.
  const emailResult = await sendGuildPostInterviewCodeEmail({
    email: result.email,
    displayName: result.display_name || 'Guild member',
    referralCode: result.referral_code,
    tier: result.tier ?? 'apprentice',
  });

  return NextResponse.json({
    ok: true,
    application_id: result.application_id,
    member_id: result.member_id,
    referral_code: result.referral_code,
    tier: result.tier,
    already_accepted: result.already_accepted ?? false,
    email_sent: emailResult.success,
    email_error: emailResult.success ? undefined : String(emailResult.error ?? 'unknown'),
  });
}
