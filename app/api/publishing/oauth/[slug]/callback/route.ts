import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getOAuthProvider, type StoredOAuthToken } from '@/lib/publishing/oauth-providers';
import { verifyOAuthState } from '@/lib/publishing/oauth-state';
import { encryptCredential } from '@/lib/publishing/credentials';

/**
 * GET /api/publishing/oauth/[slug]/callback?code=...&state=...
 *
 * Handles the OAuth Authorization Code redirect from a Tier 2 platform:
 *   1. Verifies the HMAC-signed state (binds to userId + slug + project)
 *   2. Exchanges the code for an access token server-side
 *   3. Encrypts the token with AES-256-GCM (per-user derived key)
 *   4. Upserts publishing_credentials as status='active'
 *   5. Redirects the user back to /publish with a success toast param
 *
 * All errors redirect to /publish?oauth_error=... so the user sees a clear
 * toast rather than a raw 500. The user is NEVER shown the code or token.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const stateParam = url.searchParams.get('state');
  const providerError = url.searchParams.get('error');

  if (providerError) {
    return NextResponse.redirect(
      new URL(`/publish?oauth_error=provider_denied&detail=${encodeURIComponent(providerError)}`, request.url),
    );
  }
  if (!code || !stateParam) {
    return NextResponse.redirect(
      new URL('/publish?oauth_error=missing_params', request.url),
    );
  }

  // Verify state — fails on expired / tampered / wrong-secret
  let state: { userId: string; slug: string; projectId?: string | null };
  try {
    state = verifyOAuthState(stateParam);
  } catch {
    return NextResponse.redirect(
      new URL('/publish?oauth_error=invalid_state', request.url),
    );
  }
  if (state.slug !== slug) {
    return NextResponse.redirect(
      new URL('/publish?oauth_error=slug_mismatch', request.url),
    );
  }

  // Confirm the session user matches the state user (prevents session-fixation
  // type attacks where a different user completes someone else's flow)
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user || user.id !== state.userId) {
    return NextResponse.redirect(
      new URL('/publish?oauth_error=session_mismatch', request.url),
    );
  }

  const provider = getOAuthProvider(slug);
  if (!provider) {
    return NextResponse.redirect(
      new URL('/publish?oauth_error=unknown_provider', request.url),
    );
  }

  const clientId = process.env[provider.clientIdEnv];
  const clientSecret = process.env[provider.clientSecretEnv];
  if (!clientId || !clientSecret) {
    return NextResponse.redirect(
      new URL(`/publish?oauth_error=not_configured&provider=${slug}`, request.url),
    );
  }

  const redirectUri = new URL(
    `/api/publishing/oauth/${slug}/callback`,
    request.url,
  ).toString();

  // Token exchange — server-to-server, code never reaches the browser
  const tokenBody = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri,
  });

  const tokenHeaders: Record<string, string> = {
    'Content-Type': 'application/x-www-form-urlencoded',
    Accept: 'application/json',
  };

  if (provider.useBasicAuthForTokenExchange) {
    const basic = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
    tokenHeaders.Authorization = `Basic ${basic}`;
  } else {
    tokenBody.set('client_id', clientId);
    tokenBody.set('client_secret', clientSecret);
  }

  let tokenPayload: StoredOAuthToken;
  try {
    const tokenResp = await fetch(provider.tokenUrl, {
      method: 'POST',
      headers: tokenHeaders,
      body: tokenBody.toString(),
    });

    if (!tokenResp.ok) {
      const errBody = await tokenResp.text().catch(() => '');
      console.error(`OAuth token exchange failed [${slug}]:`, tokenResp.status, errBody.slice(0, 300));
      return NextResponse.redirect(
        new URL(`/publish?oauth_error=token_exchange_failed&provider=${slug}`, request.url),
      );
    }

    const raw = (await tokenResp.json()) as {
      access_token: string;
      refresh_token?: string;
      token_type?: string;
      expires_in?: number;
      scope?: string;
    };
    if (!raw.access_token) {
      return NextResponse.redirect(
        new URL(`/publish?oauth_error=no_access_token&provider=${slug}`, request.url),
      );
    }

    const now = Math.floor(Date.now() / 1000);
    tokenPayload = {
      access_token: raw.access_token,
      refresh_token: raw.refresh_token || null,
      token_type: raw.token_type || 'Bearer',
      expires_at: raw.expires_in ? now + raw.expires_in : null,
      scope: raw.scope || null,
      obtained_at: now,
    };
  } catch (err) {
    console.error(`OAuth token exchange exception [${slug}]:`, err);
    return NextResponse.redirect(
      new URL(`/publish?oauth_error=token_exchange_failed&provider=${slug}`, request.url),
    );
  }

  // Look up platform row by slug
  const { data: platform } = await supabase
    .from('publishing_platforms')
    .select('id')
    .eq('slug', slug)
    .single();
  if (!platform) {
    return NextResponse.redirect(
      new URL(`/publish?oauth_error=platform_not_found&provider=${slug}`, request.url),
    );
  }

  // Encrypt + upsert
  let encrypted: string;
  try {
    encrypted = encryptCredential(user.id, tokenPayload as unknown as Record<string, unknown>);
  } catch (err) {
    console.error('Credential encryption failed:', err);
    return NextResponse.redirect(
      new URL('/publish?oauth_error=encryption_unavailable', request.url),
    );
  }

  const nowIso = new Date().toISOString();
  const { error: upsertErr } = await supabase
    .from('publishing_credentials')
    .upsert(
      {
        user_id: user.id,
        platform_id: platform.id,
        auth_type: 'oauth',
        encrypted_payload: encrypted,
        scopes: tokenPayload.scope ? tokenPayload.scope.split(/\s+/).filter(Boolean) : provider.scopes,
        expires_at: tokenPayload.expires_at ? new Date(tokenPayload.expires_at * 1000).toISOString() : null,
        status: 'active',
        updated_at: nowIso,
      },
      { onConflict: 'user_id,platform_id' },
    );

  if (upsertErr) {
    console.error('Credential upsert failed:', upsertErr);
    return NextResponse.redirect(
      new URL('/publish?oauth_error=storage_failed', request.url),
    );
  }

  // Back to /publish with a success flag the UI reads and shows a toast
  const successUrl = new URL('/publish', request.url);
  successUrl.searchParams.set('connected', slug);
  if (state.projectId) successUrl.searchParams.set('project', state.projectId);
  return NextResponse.redirect(successUrl);
}
