import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

/**
 * GET /api/publishing/platforms?projectId=<uuid>
 *
 * Returns all active platforms with their tier metadata + per-project
 * publication status (if a project is specified) + connection status
 * (whether the user has valid credentials stored for api_auto platforms).
 */
export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const projectId = new URL(request.url).searchParams.get('projectId');

  const { data: platforms, error: platErr } = await supabase
    .from('publishing_platforms')
    .select('*')
    .eq('is_active', true)
    .order('display_order');

  if (platErr) {
    return NextResponse.json({ error: platErr.message }, { status: 500 });
  }

  // Pull user credentials once
  const { data: creds } = await supabase
    .from('publishing_credentials')
    .select('platform_id, status, expires_at')
    .eq('user_id', user.id)
    .eq('status', 'active');

  const credByPlatform = new Map((creds || []).map((c) => [c.platform_id, c]));

  // If projectId provided, also fetch publication status per platform
  let pubByPlatform = new Map<string, any>();
  if (projectId) {
    const { data: pubs } = await supabase
      .from('project_publications')
      .select('*')
      .eq('project_id', projectId)
      .eq('user_id', user.id);
    pubByPlatform = new Map((pubs || []).map((p) => [p.platform_id, p]));
  }

  const enriched = (platforms || []).map((p) => ({
    id: p.id,
    slug: p.slug,
    name: p.name,
    description: p.description,
    tagline: p.tagline,
    royalty_rate: p.royalty_rate,
    reach_description: p.reach_description,
    avg_publish_time_minutes: p.avg_publish_time_minutes,
    website_url: p.website_url,
    submission_url: p.submission_url,
    publish_tier: p.publish_tier,
    oauth_provider: p.oauth_provider,
    is_connected: credByPlatform.has(p.id),
    publication: pubByPlatform.get(p.id) || null,
  }));

  const byTier = {
    penworth_store: enriched.filter((p) => p.publish_tier === 'penworth_store'),
    api_auto: enriched.filter((p) => p.publish_tier === 'api_auto'),
    guided_pdf: enriched.filter((p) => p.publish_tier === 'guided_pdf'),
  };

  return NextResponse.json({ platforms: enriched, byTier });
}
