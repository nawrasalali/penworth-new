import { NextRequest, NextResponse } from 'next/server';
import { createClient, createAdminClient } from '@/lib/supabase/server';
import { sendGuildAcceptanceEmail } from '@/lib/email/guild';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/guild/admin/resend-acceptance
 *
 * Admin-only. Resends the Guild acceptance email for a specific member whose
 * original email never arrived or was lost. Writes the Resend API result to
 * the response so the admin can see what happened.
 *
 * Body: { member_id } or { user_id } (one required)
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

  let body: { member_id?: string; user_id?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  if (!body.member_id && !body.user_id) {
    return NextResponse.json({ error: 'member_id or user_id is required' }, { status: 400 });
  }

  const admin = createAdminClient();

  const { data: member, error: loadError } = await admin
    .from('guild_members')
    .select('id, user_id, display_name, referral_code, application_id')
    .match(body.member_id ? { id: body.member_id } : { user_id: body.user_id })
    .single();

  if (loadError || !member) {
    return NextResponse.json({ error: 'Member not found' }, { status: 404 });
  }

  // Pull the email off the auth user since guild_members doesn't store it.
  const { data: authUser } = await admin.auth.admin.getUserById(member.user_id);
  const email = authUser?.user?.email;
  if (!email) {
    return NextResponse.json({ error: 'No email on file for this member' }, { status: 400 });
  }

  const result = await sendGuildAcceptanceEmail({
    email,
    fullName: member.display_name || 'Guild member',
    referralCode: member.referral_code,
    dashboardUrl: 'https://guild.penworth.ai/dashboard',
  });

  return NextResponse.json({
    ok: result.success,
    sent_to: email,
    referral_code: member.referral_code,
    // Expose Resend's raw error for diagnosis — admin-only endpoint so safe
    error: result.success ? undefined : String(result.error ?? 'unknown'),
  });
}
