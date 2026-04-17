import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

/**
 * POST /api/publishing/oauth/[slug]/disconnect
 *
 * Marks the user's credential as revoked. We DON'T delete the row — we
 * keep the audit trail. A fresh /start flow creates a new row that
 * overwrites the old via the (user_id, platform_id) unique constraint.
 *
 * Note: we don't call the provider's token-revocation endpoint because
 * most of our Tier 2 partners don't expose one. If/when they do, wire
 * a provider-specific revoke here.
 */
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: platform } = await supabase
    .from('publishing_platforms')
    .select('id')
    .eq('slug', slug)
    .single();
  if (!platform) return NextResponse.json({ error: 'Unknown platform' }, { status: 404 });

  const { error } = await supabase
    .from('publishing_credentials')
    .update({ status: 'revoked', updated_at: new Date().toISOString() })
    .eq('user_id', user.id)
    .eq('platform_id', platform.id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
