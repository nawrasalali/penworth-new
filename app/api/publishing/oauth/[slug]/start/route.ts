import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getOAuthProvider } from '@/lib/publishing/oauth-providers';
import { signOAuthState } from '@/lib/publishing/oauth-state';

/**
 * GET /api/publishing/oauth/[slug]/start?projectId=<optional>
 *
 * Kicks off an OAuth Authorization Code Grant for a Tier 2 platform:
 *   1. Ensures the caller is authenticated
 *   2. Admin-gate during rollout (paid rollout follows a credit-deduction model)
 *   3. Builds a signed HMAC state carrying userId + slug + projectId + nonce + iat
 *   4. 302s to the provider's authorize URL
 *
 * The callback at /api/publishing/oauth/[slug]/callback verifies the state,
 * exchanges the code, encrypts the token, and redirects the user back into
 * /publish with a toast-ready query param.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;

  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Admin gate for rollout — until Tier 2 is credit-metered, only admins
  // can connect external accounts. Mirrors the narration gate.
  const { data: profile } = await supabase
    .from('profiles')
    .select('is_admin')
    .eq('id', user.id)
    .single();
  if (!profile?.is_admin) {
    return NextResponse.redirect(
      new URL('/publish?oauth_error=preview_only', request.url),
    );
  }

  const provider = getOAuthProvider(slug);
  if (!provider) {
    return NextResponse.json({ error: 'Unknown OAuth provider' }, { status: 404 });
  }

  const clientId = process.env[provider.clientIdEnv];
  if (!clientId) {
    return NextResponse.redirect(
      new URL(`/publish?oauth_error=not_configured&provider=${slug}`, request.url),
    );
  }

  const projectId = request.nextUrl.searchParams.get('projectId');

  let state: string;
  try {
    state = signOAuthState({ userId: user.id, slug, projectId });
  } catch (err) {
    console.error('OAuth state signing failed:', err);
    return NextResponse.redirect(
      new URL('/publish?oauth_error=config_error', request.url),
    );
  }

  const redirectUri = new URL(
    `/api/publishing/oauth/${slug}/callback`,
    request.url,
  ).toString();

  const authorizeUrl = new URL(provider.authorizeUrl);
  authorizeUrl.searchParams.set('response_type', 'code');
  authorizeUrl.searchParams.set('client_id', clientId);
  authorizeUrl.searchParams.set('redirect_uri', redirectUri);
  authorizeUrl.searchParams.set('scope', provider.scopes.join(' '));
  authorizeUrl.searchParams.set('state', state);

  return NextResponse.redirect(authorizeUrl.toString());
}
