import { createClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { isSupportedLang } from '@/lib/lang-routing';
import { LEGAL_DOCUMENTS, LEGAL_DOCUMENT_KEYS, type LegalDocumentKey } from '@/lib/legal/documents';
import { createReferralOnSignup } from '@/lib/guild/commissions';
import { applyAuthorReferral } from '@/lib/referrals/apply';

/**
 * Best-effort recording of legal consent for a user who just completed auth.
 *
 * Consent is now primarily captured by the first-login modal in
 * app/(dashboard)/layout.tsx once the user reaches the authenticated shell.
 * This callback helper remains as a backstop for OAuth signups — records
 * rows for documents the user hasn't yet consented to. Silent-fail.
 */
async function recordConsentIfFirstTime(
  request: Request,
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
) {
  try {
    const { data: existing } = await supabase
      .from('consent_records')
      .select('document_key')
      .eq('user_id', userId);

    const already = new Set((existing ?? []).map((r) => r.document_key as string));
    const toRecord = LEGAL_DOCUMENT_KEYS.filter((key) => !already.has(key));
    if (toRecord.length === 0) return;

    const forwarded = request.headers.get('x-forwarded-for') ?? '';
    const ip = forwarded.split(',')[0]?.trim() || null;
    const userAgent = request.headers.get('user-agent') || null;

    const rows = toRecord.map((key: LegalDocumentKey) => ({
      user_id: userId,
      document_key: key,
      document_version: LEGAL_DOCUMENTS[key].version,
      ip_address: ip,
      user_agent: userAgent,
    }));

    await supabase.from('consent_records').insert(rows);
  } catch (err) {
    console.warn('[auth/callback] consent recording failed:', err);
  }
}

/**
 * Reads the penworth_ref cookie and attempts to create a guild_referrals row.
 * No-op if no cookie, code is invalid, or referral already exists.
 * Cookie cleared after attempt so we never double-attach a stale code.
 */
async function attachGuildReferralIfAny(userId: string) {
  try {
    const cookieStore = await cookies();
    const refCookie = cookieStore.get('penworth_ref');
    if (!refCookie?.value) return;

    const code = decodeURIComponent(refCookie.value).trim().toUpperCase();
    if (!code.startsWith('GUILD-')) return;

    const admin = createServiceClient();
    await createReferralOnSignup({
      admin,
      referralCode: code,
      referredUserId: userId,
    });

    cookieStore.set('penworth_ref', '', {
      path: '/',
      maxAge: 0,
      sameSite: 'lax',
    });
  } catch (err) {
    console.error('[auth/callback] Guild referral attach failed:', err);
  }
}

/**
 * Reads the penworth_author_ref cookie and applies an author (non-Guild)
 * referral code to the new user. No-op if cookie missing, code invalid,
 * or user already has a referrer. Cookie cleared after attempt.
 */
async function attachAuthorReferralIfAny(userId: string) {
  try {
    const cookieStore = await cookies();
    const refCookie = cookieStore.get('penworth_author_ref');
    if (!refCookie?.value) return;

    const code = decodeURIComponent(refCookie.value).trim().toUpperCase();
    if (!code || code.startsWith('GUILD-')) return;

    const admin = createServiceClient();
    const result = await applyAuthorReferral(admin, userId, code);
    if (!result.ok) {
      console.log(
        `[auth/callback] author referral attach skipped: ${result.reason}`,
      );
    }

    cookieStore.set('penworth_author_ref', '', {
      path: '/',
      maxAge: 0,
      sameSite: 'lax',
    });
  } catch (err) {
    console.error('[auth/callback] Author referral attach failed:', err);
  }
}

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get('code');
  const redirect = searchParams.get('redirect') || '/dashboard';
  const langParam = searchParams.get('lang');
  // skip_code=1 indicates this is a post-password-login redirect (no OAuth
  // code to exchange). Session is already established via cookies.
  const skipCode = searchParams.get('skip_code') === '1';

  const supabase = await createClient();

  // Exchange the OAuth code if present (Google / magic-link flow)
  if (code) {
    const { error, data } = await supabase.auth.exchangeCodeForSession(code);
    if (!error && data?.user) {
      if (isSupportedLang(langParam)) {
        await supabase
          .from('profiles')
          .update({ preferred_language: langParam })
          .eq('id', data.user.id);
      }

      await recordConsentIfFirstTime(request, supabase, data.user.id);
      await attachGuildReferralIfAny(data.user.id);
      await attachAuthorReferralIfAny(data.user.id);

      return NextResponse.redirect(`${origin}${redirect}`);
    }
    // Log exchange failures to see what's really going wrong when a user
    // reports "Could not authenticate". Common causes: code expired, code
    // already used, PKCE verifier cookie mismatch across subdomains.
    if (error) {
      console.error('[auth/callback] exchangeCodeForSession failed:', error.message, error);
    }
  }

  // No code but session already established (password login with skip_code=1)
  if (skipCode) {
    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      if (isSupportedLang(langParam)) {
        await supabase
          .from('profiles')
          .update({ preferred_language: langParam })
          .eq('id', user.id);
      }

      await recordConsentIfFirstTime(request, supabase, user.id);
      await attachGuildReferralIfAny(user.id);
      await attachAuthorReferralIfAny(user.id);

      return NextResponse.redirect(`${origin}${redirect}`);
    }
  }

  return NextResponse.redirect(`${origin}/login?error=Could not authenticate`);
}
