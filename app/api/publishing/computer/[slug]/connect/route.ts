import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { encryptCredential } from '@/lib/publishing/credentials';

/**
 * POST /api/publishing/computer/[slug]/connect
 * body: { email: string, password: string }
 *
 * Stores login credentials for a platform that Penworth Computer will drive
 * via browser automation (Kobo, Google Play, etc.). We encrypt with the
 * per-user AES-256-GCM key and store in publishing_credentials with
 * auth_type='computer_use'. Email + password never leave this process in
 * plaintext after this route returns — the agent loop decrypts in-memory
 * at the moment of browser login and the buffer drops out of scope
 * immediately after.
 */

// Platforms allowed to use computer-use auth. Add entries as recipes ship.
const COMPUTER_USE_PLATFORMS = new Set(['kobo', 'google_play', 'publishdrive', 'streetlib']);

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  // Admin gate during rollout
  const { data: profile } = await supabase
    .from('profiles')
    .select('is_admin')
    .eq('id', user.id)
    .single();
  if (!profile?.is_admin) {
    return NextResponse.json(
      { error: 'Penworth Computer is in limited preview. Contact support.' },
      { status: 402 },
    );
  }

  if (!COMPUTER_USE_PLATFORMS.has(slug)) {
    return NextResponse.json(
      { error: `Computer-use auth not enabled for ${slug}` },
      { status: 404 },
    );
  }

  const { email, password } = await request.json();
  if (!email || typeof email !== 'string' || !email.includes('@')) {
    return NextResponse.json({ error: 'Valid email required' }, { status: 400 });
  }
  if (!password || typeof password !== 'string' || password.length < 4) {
    return NextResponse.json({ error: 'Password required' }, { status: 400 });
  }

  const { data: platform } = await supabase
    .from('publishing_platforms')
    .select('id, name')
    .eq('slug', slug)
    .single();
  if (!platform) return NextResponse.json({ error: 'Platform not found' }, { status: 404 });

  // Shape mimics StoredOAuthToken so load-credential.ts can decrypt uniformly.
  // The recipe builder reads email + password from this blob directly.
  let encrypted: string;
  try {
    encrypted = encryptCredential(user.id, {
      access_token: 'computer_use', // placeholder — real creds below
      token_type: 'ComputerUse',
      obtained_at: Math.floor(Date.now() / 1000),
      email: email.trim(),
      password,
    } as unknown as Record<string, unknown>);
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
        auth_type: 'computer_use',
        encrypted_payload: encrypted,
        status: 'active',
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id,platform_id' },
    );

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true, platform: platform.name });
}
