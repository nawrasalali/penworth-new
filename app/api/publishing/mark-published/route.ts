import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

/**
 * POST /api/publishing/mark-published
 * body: { projectId, platformSlug, externalUrl }
 *
 * Author records that they've completed the manual publish on a Tier 3
 * platform. Updates project_publications so the Publish page shows it live.
 */
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { projectId, platformSlug, externalUrl } = await request.json();
  if (!projectId || !platformSlug) {
    return NextResponse.json({ error: 'projectId and platformSlug required' }, { status: 400 });
  }

  const { data: platform } = await supabase
    .from('publishing_platforms')
    .select('id')
    .eq('slug', platformSlug)
    .single();
  if (!platform) return NextResponse.json({ error: 'Platform not found' }, { status: 404 });

  const now = new Date().toISOString();
  const { data: existing } = await supabase
    .from('project_publications')
    .select('id')
    .eq('project_id', projectId)
    .eq('platform_id', platform.id)
    .eq('user_id', user.id)
    .maybeSingle();

  if (existing) {
    await supabase
      .from('project_publications')
      .update({
        status: 'published',
        external_url: externalUrl || null,
        published_at: now,
        updated_at: now,
      })
      .eq('id', existing.id);
  } else {
    await supabase.from('project_publications').insert({
      project_id: projectId,
      platform_id: platform.id,
      user_id: user.id,
      publish_tier: 'guided_pdf',
      status: 'published',
      external_url: externalUrl || null,
      published_at: now,
    });
  }

  return NextResponse.json({ success: true });
}
