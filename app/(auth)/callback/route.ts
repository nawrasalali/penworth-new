import { createClient, createAdminClient } from '@/lib/supabase/server';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { isSupportedLang } from '@/lib/lang-routing';
import { createReferralOnSignup } from '@/lib/guild/commissions';

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get('code');
  const redirect = searchParams.get('redirect') || '/dashboard';
  const langParam = searchParams.get('lang');
  // skip_code=1 indicates this is a post-password-login redirect (no OAuth code
  // to exchange). We still need to resolve the user's language and redirect.
  const skipCode = searchParams.get('skip_code') === '1';

  const supabase = await createClient();

  // Exchange the OAuth code if present
  if (code) {
    const { error, data } = await supabase.auth.exchangeCodeForSession(code);
    if (!error && data?.user) {
      if (isSupportedLang(langParam)) {
        await supabase
          .from('profiles')
          .update({ preferred_language: langParam })
          .eq('id', data.user.id);
      }

      // Try to attach a Guild referral if a code was captured prior to signup.
      // Only runs on signup (not every login) — idempotent on duplicate attempts.
      await attachGuildReferralIfAny(data.user.id);

      // Always return to current origin. Language subdomains are static
      // landing pages; the authenticated app only lives on this host.
      return NextResponse.redirect(`${origin}${redirect}`);
    }
  }

  // No code but session is already established (password login): redirect.
  if (skipCode) {
    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      if (isSupportedLang(langParam)) {
        await supabase
          .from('profiles')
          .update({ preferred_language: langParam })
          .eq('id', user.id);
      }

      // Best-effort referral attachment on first authenticated callback
      await attachGuildReferralIfAny(user.id);

      return NextResponse.redirect(`${origin}${redirect}`);
    }
  }

  return NextResponse.redirect(`${origin}/login?error=Could not authenticate`);
}

/**
 * Reads the penworth_ref cookie and attempts to create a guild_referrals row.
 * No-op if no cookie, code is invalid, or referral already exists.
 * The cookie is cleared after the attachment attempt (success or not) so we
 * never try to double-attach a stale code.
 */
async function attachGuildReferralIfAny(userId: string) {
  try {
    const cookieStore = await cookies();
    const refCookie = cookieStore.get('penworth_ref');
    if (!refCookie?.value) return;

    const code = decodeURIComponent(refCookie.value).trim().toUpperCase();
    if (!code.startsWith('GUILD-')) return;

    const admin = createAdminClient();
    await createReferralOnSignup({
      admin,
      referralCode: code,
      referredUserId: userId,
    });

    // Clear the cookie so we don't keep trying on future logins
    cookieStore.set('penworth_ref', '', {
      path: '/',
      maxAge: 0,
      sameSite: 'lax',
    });
  } catch (err) {
    // Non-fatal — never block auth on referral attachment
    console.error('[auth/callback] Guild referral attach failed:', err);
  }
}
