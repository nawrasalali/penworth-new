import { NextRequest, NextResponse } from 'next/server';
import { createClient, createAdminClient } from '@/lib/supabase/server';
import {
  sendGuildInterviewInviteEmail,
  sendGuildAcceptanceEmail,
  sendGuildDeclineEmail,
} from '@/lib/email/guild';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Action = 'invite' | 'accept' | 'decline';

interface ReviewPayload {
  application_id: string;
  action: Action;
  decision_reason: string | null;
}

const GUILD_URL = 'https://guild.penworth.ai';

/**
 * POST /api/guild/admin/review
 *
 * Admin-only endpoint. Processes a decision on an application.
 * - invite  → status: invited_to_interview, sends interview booking email
 * - accept  → creates guild_members row, sends welcome email
 * - decline → status: declined, sends polite decline email
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

  if (!['invite', 'accept', 'decline'].includes(payload.action)) {
    return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
  }

  const admin = createAdminClient();

  // Load application
  const { data: app, error: loadError } = await admin
    .from('guild_applications')
    .select('*')
    .eq('id', payload.application_id)
    .single();

  if (loadError || !app) {
    return NextResponse.json({ error: 'Application not found' }, { status: 404 });
  }

  if (
    !['pending_review', 'interview_completed'].includes(app.application_status) &&
    payload.action !== 'decline'
  ) {
    return NextResponse.json(
      {
        error: `Cannot ${payload.action} an application in status "${app.application_status}"`,
      },
      { status: 400 },
    );
  }

  try {
    if (payload.action === 'invite') {
      return await handleInvite(admin, app, user.id);
    }
    if (payload.action === 'accept') {
      return await handleAccept(admin, app, user.id);
    }
    if (payload.action === 'decline') {
      return await handleDecline(admin, app, user.id, payload.decision_reason);
    }
  } catch (err) {
    console.error('[guild/admin/review]', err);
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }

  return NextResponse.json({ error: 'Unhandled action' }, { status: 400 });
}

// ---------------------------------------------------------------------------

async function handleInvite(admin: any, app: any, adminUserId: string) {
  // Update status
  const { error } = await admin
    .from('guild_applications')
    .update({
      application_status: 'invited_to_interview',
      decided_by: adminUserId,
      decided_at: new Date().toISOString(),
    })
    .eq('id', app.id);

  if (error) {
    console.error('[invite] Update error:', error);
    return NextResponse.json({ error: 'Failed to update application' }, { status: 500 });
  }

  // Send invitation email — booking URL placeholder until voice interview system is built
  const bookingUrl = `${GUILD_URL}/interview/schedule?application_id=${app.id}`;
  await sendGuildInterviewInviteEmail({
    email: app.email,
    fullName: app.full_name,
    bookingUrl,
    language: app.primary_language,
  });

  return NextResponse.json({ ok: true, status: 'invited_to_interview' });
}

async function handleAccept(admin: any, app: any, adminUserId: string) {
  // Check if user already exists with this email
  const { data: existingProfile } = await admin
    .from('profiles')
    .select('id, email')
    .eq('email', app.email.toLowerCase())
    .maybeSingle();

  let userId: string;
  let needsOnboarding = true;

  if (existingProfile) {
    userId = existingProfile.id;
  } else {
    // Create auth user with invite email (Supabase will send password-setup email)
    const { data: newUser, error: userError } = await admin.auth.admin.inviteUserByEmail(
      app.email.toLowerCase(),
      {
        data: {
          full_name: app.full_name,
          guild_member: true,
        },
      },
    );
    if (userError || !newUser?.user) {
      console.error('[accept] User creation error:', userError);
      return NextResponse.json(
        { error: 'Failed to create user account' },
        { status: 500 },
      );
    }
    userId = newUser.user.id;

    // Ensure profile row exists
    await admin.from('profiles').upsert({
      id: userId,
      email: app.email.toLowerCase(),
      full_name: app.full_name,
    });
  }

  // Generate referral code from name
  const referralCode = generateReferralCode(app.full_name);

  // Create guild_members row
  const { data: member, error: memberError } = await admin
    .from('guild_members')
    .insert({
      user_id: userId,
      application_id: app.id,
      tier: 'apprentice',
      tier_since: new Date().toISOString(),
      referral_code: referralCode,
      display_name: app.full_name,
      primary_market: app.country,
      primary_language: app.primary_language,
      status: 'active',
      payout_method: 'pending',
    })
    .select('id, referral_code')
    .single();

  if (memberError) {
    console.error('[accept] Member creation error:', memberError);
    return NextResponse.json(
      { error: `Failed to create Guildmember: ${memberError.message}` },
      { status: 500 },
    );
  }

  // Record the initial tier promotion
  await admin.from('guild_tier_promotions').insert({
    guildmember_id: member.id,
    from_tier: null,
    to_tier: 'apprentice',
    promotion_reason: 'initial_acceptance',
    evidence: { accepted_by: adminUserId, application_id: app.id },
    promoted_by: adminUserId,
  });

  // Update application
  await admin
    .from('guild_applications')
    .update({
      application_status: 'accepted',
      decided_by: adminUserId,
      decided_at: new Date().toISOString(),
    })
    .eq('id', app.id);

  // Seed default agent contexts
  const agents = ['scout', 'coach', 'creator', 'mentor', 'analyst', 'strategist', 'advisor', 'shared'];
  await admin.from('guild_agent_context').insert(
    agents.map((agent) => ({
      guildmember_id: member.id,
      agent_name: agent,
      context: {
        initialized_at: new Date().toISOString(),
        applicant_name: app.full_name,
        applicant_country: app.country,
        applicant_language: app.primary_language,
        social_links: app.social_links,
        motivation: app.motivation_statement,
      },
    })),
  );

  // Send welcome email
  await sendGuildAcceptanceEmail({
    email: app.email,
    fullName: app.full_name,
    referralCode: member.referral_code,
    dashboardUrl: `${GUILD_URL}/dashboard`,
  });

  return NextResponse.json({
    ok: true,
    status: 'accepted',
    member_id: member.id,
    referral_code: member.referral_code,
  });
}

async function handleDecline(
  admin: any,
  app: any,
  adminUserId: string,
  decisionReason: string | null,
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

  return NextResponse.json({ ok: true, status: 'declined' });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function generateReferralCode(fullName: string): string {
  // Take first name, remove diacritics, uppercase, and append a short random suffix
  const firstName = fullName.trim().split(/\s+/)[0] || 'GUILD';
  const normalized = firstName
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]/g, '')
    .toUpperCase()
    .slice(0, 10) || 'GUILD';
  const suffix = Math.floor(Math.random() * 9000 + 1000); // 4-digit random
  return `GUILD-${normalized}${suffix}`;
}
