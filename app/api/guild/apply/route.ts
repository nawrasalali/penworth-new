import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';
import { sendGuildApplicationReceivedEmail } from '@/lib/email/guild';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface ApplicationPayload {
  full_name: string;
  email: string;
  country: string;
  primary_language: string;
  reason: string;
  reason_other: string | null;
  social_links: string[];
  motivation_statement: string;
  referred_by_code: string | null;
}

/**
 * POST /api/guild/apply
 * Public endpoint. Anyone may submit an application.
 * Runs automated review scoring, persists, and emails the applicant.
 *
 * Security note: if the visitor is authenticated, we ignore any email
 * value in the request body and use their session email instead. This
 * is defense-in-depth — the client already locks the email field when
 * authenticated (see app/guild/apply/page.tsx), but a malicious or
 * buggy client cannot bypass that lock server-side.
 */
export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as ApplicationPayload;

    // If the caller is authenticated, force body.email to their session email.
    // This prevents a signed-in user from submitting an application under a
    // different address than the one linked to their Penworth account.
    try {
      const userClient = await createClient();
      const { data: userData } = await userClient.auth.getUser();
      if (userData.user?.email) {
        body.email = userData.user.email;
      }
    } catch (authErr) {
      // No session is fine — unauthenticated applications are allowed.
      // We log and continue with whatever email was in the body.
      console.log('[guild/apply] No session; using body email.', authErr);
    }

    // Server-side validation (client validation is not trusted)
    const validation = validateApplication(body);
    if (!validation.ok) {
      return NextResponse.json({ error: validation.error }, { status: 400 });
    }

    const supabase = createServiceClient();

    // Duplicate email check — one application per email every 90 days
    const { data: existing } = await supabase
      .from('guild_applications')
      .select('id, application_status, created_at')
      .eq('email', body.email.toLowerCase())
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (existing) {
      const createdAt = new Date(existing.created_at);
      const daysSince = (Date.now() - createdAt.getTime()) / (1000 * 60 * 60 * 24);
      const activeStatuses = [
        'pending_review',
        'invited_to_interview',
        'interview_scheduled',
        'interview_completed',
        'accepted',
      ];
      if (activeStatuses.includes(existing.application_status)) {
        return NextResponse.json(
          {
            error:
              'An application for this email is already in progress. Check your inbox for the latest status email.',
            application_id: existing.id,
          },
          { status: 409 },
        );
      }
      // Declined or auto-declined: must wait 90 days
      if (daysSince < 90) {
        const wait = Math.ceil(90 - daysSince);
        return NextResponse.json(
          {
            error: `A previous application for this email was not successful. You may reapply in ${wait} day${wait === 1 ? '' : 's'}.`,
          },
          { status: 409 },
        );
      }
    }

    // Capture request metadata for fraud review
    const ip =
      request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
      request.headers.get('x-real-ip') ||
      null;
    const userAgent = request.headers.get('user-agent') || null;

    // Automated review scoring (0-100)
    const autoReview = runAutoReview(body);

    // Insert the application row
    const { data: inserted, error: insertError } = await supabase
      .from('guild_applications')
      .insert({
        email: body.email.toLowerCase(),
        full_name: body.full_name,
        country: body.country,
        primary_language: body.primary_language,
        reason: body.reason,
        reason_other: body.reason_other,
        social_links: body.social_links,
        motivation_statement: body.motivation_statement,
        referred_by_code: body.referred_by_code || null,
        ip_address: ip,
        user_agent: userAgent,
        application_status: autoReview.score < 40 ? 'auto_declined' : 'pending_review',
        auto_review_score: autoReview.score,
        auto_review_flags: autoReview.flags,
        decision_reason:
          autoReview.score < 40
            ? 'Automated review score below acceptance threshold.'
            : null,
      })
      .select('id, application_status')
      .single();

    if (insertError || !inserted) {
      console.error('[guild/apply] Insert error:', insertError);

      // Postgres unique_violation (SQLSTATE 23505) is raised by the
      // guild_applications_before_insert trigger when the applicant is
      // already an active Guildmember. Translate to a clean 409.
      if (insertError && (insertError as any).code === '23505') {
        // Trigger HINT distinguishes the Guildmember case from any future
        // unique_violation (e.g. if we add a UNIQUE(user_id,status) index).
        const hint = ((insertError as any).hint || '').toLowerCase();
        const isGuildmember = hint.includes('guildmember') ||
          ((insertError as any).message || '').toLowerCase().includes('already an active guild member');

        return NextResponse.json(
          {
            error: isGuildmember
              ? 'You are already an active Guildmember. Visit your Guild dashboard instead of re-applying.'
              : 'You already have an application in review. Check your email for updates or visit /guild/apply/status.',
          },
          { status: 409 },
        );
      }

      return NextResponse.json(
        { error: 'Unable to save your application. Please try again in a moment.' },
        { status: 500 },
      );
    }

    // Fire-and-forget email (do not block response on email delivery)
    sendGuildApplicationReceivedEmail({
      email: body.email,
      fullName: body.full_name,
      status: inserted.application_status as 'pending_review' | 'auto_declined',
      applicationId: inserted.id,
    }).catch((err) => console.error('[guild/apply] Email error:', err));

    return NextResponse.json({
      ok: true,
      application_id: inserted.id,
      status: inserted.application_status,
    });
  } catch (err) {
    console.error('[guild/apply] Unexpected error:', err);
    return NextResponse.json(
      { error: 'An unexpected error occurred. Please try again.' },
      { status: 500 },
    );
  }
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

function validateApplication(p: Partial<ApplicationPayload>): { ok: true } | { ok: false; error: string } {
  if (!p.full_name || p.full_name.trim().length < 2) {
    return { ok: false, error: 'Full name is required.' };
  }
  if (p.full_name.length > 120) {
    return { ok: false, error: 'Name is too long.' };
  }
  // Reject submissions where the entire name is just a title (Mr., Dr., etc.)
  const TITLES = new Set([
    'mr', 'mrs', 'ms', 'mx', 'miss', 'dr', 'prof', 'professor',
    'sir', 'madam', 'lord', 'lady', 'rev', 'reverend', 'fr', 'father',
    'sr', 'sister', 'br', 'brother', 'hon', 'honourable', 'honorable',
    'sheikh', 'sayyid', 'sayed', 'hajji', 'hajj',
  ]);
  const nameParts = p.full_name.trim().split(/\s+/);
  const hasRealNamePart = nameParts.some((part) => {
    const stripped = part.replace(/[.,]/g, '').toLowerCase();
    return stripped.length >= 2 && !TITLES.has(stripped);
  });
  if (!hasRealNamePart) {
    return { ok: false, error: 'Please enter your first and last name (not just a title).' };
  }
  if (!p.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(p.email)) {
    return { ok: false, error: 'A valid email address is required.' };
  }
  if (!p.country || p.country.length > 80) {
    return { ok: false, error: 'Country is required.' };
  }
  if (!p.primary_language || p.primary_language.length > 8) {
    return { ok: false, error: 'Language is required.' };
  }
  if (!p.reason) {
    return { ok: false, error: 'Please select a reason for applying.' };
  }
  if (p.reason === 'other' && (!p.reason_other || p.reason_other.trim().length < 3)) {
    return { ok: false, error: 'Please describe your reason.' };
  }
  if (!p.motivation_statement || p.motivation_statement.trim().length < 40) {
    return { ok: false, error: 'Your motivation statement must be at least 40 characters.' };
  }
  if (p.motivation_statement.length > 2000) {
    return { ok: false, error: 'Your motivation statement is too long.' };
  }
  if (p.social_links && p.social_links.length > 5) {
    return { ok: false, error: 'Maximum 5 social links.' };
  }
  // Validate URLs if provided
  for (const link of p.social_links || []) {
    if (link && !isValidUrl(link)) {
      return { ok: false, error: `"${link}" is not a valid URL.` };
    }
  }
  return { ok: true };
}

function isValidUrl(s: string): boolean {
  try {
    const u = new URL(s);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Automated review scoring
// Scores 0-100. Below 40 = auto decline. Above 40 = proceed to interview.
// Conservative heuristics; no harsh penalties for new applicants with small audiences.
// ---------------------------------------------------------------------------

function runAutoReview(p: ApplicationPayload): { score: number; flags: string[] } {
  let score = 50; // neutral starting point
  const flags: string[] = [];

  // Motivation statement quality
  const motivation = p.motivation_statement.trim();
  const wordCount = motivation.split(/\s+/).length;
  if (wordCount >= 20) score += 10;
  if (wordCount >= 40) score += 5;
  if (wordCount < 10) {
    score -= 15;
    flags.push('motivation_too_brief');
  }

  // Detect low-effort motivation content
  const lowEffortPatterns = [
    /^(hi|hello|hey)[\s.!]*$/i,
    /^money$/i,
    /^just (want|need) money/i,
    /^because i need money/i,
  ];
  if (lowEffortPatterns.some((p) => p.test(motivation))) {
    score -= 30;
    flags.push('low_effort_motivation');
  }

  // Detect repetition / spam
  const words = motivation.toLowerCase().split(/\s+/);
  const uniqueWords = new Set(words);
  if (words.length > 20 && uniqueWords.size / words.length < 0.4) {
    score -= 20;
    flags.push('repetitive_motivation');
  }

  // Social link presence
  const validLinks = (p.social_links || []).filter(isValidUrl);
  if (validLinks.length >= 1) score += 10;
  if (validLinks.length >= 2) score += 5;
  if (validLinks.length >= 3) score += 5;
  if (validLinks.length === 0) {
    flags.push('no_social_links');
    // No penalty — many quality applicants have no public presence
  }

  // Bonus for referred applications
  if (p.referred_by_code) {
    score += 5;
    flags.push('referred_by_guildmember');
  }

  // Disposable email domain detection
  const emailDomain = p.email.split('@')[1]?.toLowerCase() || '';
  const disposableDomains = [
    'tempmail', 'mailinator', 'guerrillamail', '10minutemail', 'throwaway',
    'yopmail', 'getnada', 'dispostable', 'fakeinbox', 'trashmail',
  ];
  if (disposableDomains.some((d) => emailDomain.includes(d))) {
    score -= 40;
    flags.push('disposable_email');
  }

  // Email local part looks suspicious (lots of random chars)
  const emailLocal = p.email.split('@')[0] || '';
  if (/^[a-z]{8,}\d{4,}$/i.test(emailLocal) && !p.referred_by_code) {
    score -= 10;
    flags.push('suspicious_email_pattern');
  }

  // Clamp 0-100
  score = Math.max(0, Math.min(100, score));

  return { score, flags };
}
