import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { encryptCredential } from '@/lib/publishing/credentials';

/**
 * POST /api/publishing/apikey/[slug]/connect
 * body: { apiKey: string }
 *
 * Connects a Tier 2 platform that uses a long-lived API key instead of
 * OAuth (Payhip is the first). We accept the key, encrypt it with the
 * per-user AES-256-GCM key, and store it in the same publishing_credentials
 * table as OAuth tokens — just with auth_type='api_key'.
 *
 * The encrypted payload mimics the OAuth shape (access_token = api key)
 * so the publish adapters read it uniformly.
 */

const API_KEY_PLATFORMS: Record<string, { slug: string; displayName: string; validatePattern?: RegExp }> = {
  payhip: { slug: 'payhip', displayName: 'Payhip' },
};

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: profile } = await supabase
    .from('profiles')
    .select('is_admin')
    .eq('id', user.id)
    .single();
  if (!profile?.is_admin) {
    return NextResponse.json(
      { error: 'API-key connections are in limited preview. Contact support.' },
      { status: 402 },
    );
  }

  const cfg = API_KEY_PLATFORMS[slug];
  if (!cfg) {
    return NextResponse.json({ error: 'Unknown platform' }, { status: 404 });
  }

  const { apiKey } = await request.json();
  if (!apiKey || typeof apiKey !== 'string' || apiKey.length < 8) {
    return NextResponse.json({ error: 'API key required' }, { status: 400 });
  }

  const { data: platform } = await supabase
    .from('publishing_platforms')
    .select('id')
    .eq('slug', slug)
    .single();
  if (!platform) return NextResponse.json({ error: 'Platform not found' }, { status: 404 });

  // Encrypt with the OAuth-style shape so publish adapters read it uniformly
  let encrypted: string;
  try {
    encrypted = encryptCredential(user.id, {
      access_token: apiKey.trim(),
      token_type: 'ApiKey',
      obtained_at: Math.floor(Date.now() / 1000),
    });
  } catch (err) {
    console.error('Credential encryption failed:', err);
    return NextResponse.json({ error: 'Secure storage unavailable' }, { status: 503 });
  }

  const { error } = await supabase
    .from('publishing_credentials')
    .upsert(
      {
        user_id: user.id,
        platform_id: platform.id,
        auth_type: 'api_key',
        encrypted_payload: encrypted,
        status: 'active',
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id,platform_id' },
    );

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true, platform: cfg.displayName });
}
