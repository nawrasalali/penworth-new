import { createClient } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';
import { isSupportedLang } from '@/lib/lang-routing';
import { LEGAL_DOCUMENTS, LEGAL_DOCUMENT_KEYS, type LegalDocumentKey } from '@/lib/legal/documents';

/**
 * Best-effort recording of legal consent for a user who just completed auth.
 *
 * The signup form attempts a client-side POST to /api/legal/consent, but that
 * fetch needs a live session — which OAuth signups don't have until this
 * callback lands, and email-verify signups only have after they click the link.
 * So we record consent here as a fallback, but only for documents the user
 * has NOT already consented to (avoids dupe rows for users who signed up
 * with email + password and got their client-side POST through).
 *
 * Captures IP + user-agent from the callback request headers. Silent-fail:
 * never blocks the post-auth redirect.
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
      // Persist the sign-up language on first OAuth callback. Idempotent
      // for returning users — we only update when a lang param is present.
      if (isSupportedLang(langParam)) {
        await supabase
          .from('profiles')
          .update({ preferred_language: langParam })
          .eq('id', data.user.id);
      }

      await recordConsentIfFirstTime(request, supabase, data.user.id);

      // Always return to the current origin. Language subdomains are
      // static landing pages; the authenticated app lives here. The
      // in-app shell reads profiles.preferred_language for its locale.
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

      await recordConsentIfFirstTime(request, supabase, user.id);

      return NextResponse.redirect(`${origin}${redirect}`);
    }
  }

  return NextResponse.redirect(`${origin}/login?error=Could not authenticate`);
}
