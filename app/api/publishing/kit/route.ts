import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { ensurePublishingMetadata, validateForPublishing } from '@/lib/publishing/metadata';
import { getKitBuilder } from '@/lib/publishing/publish-kits';

/**
 * GET /api/publishing/kit?projectId=<uuid>&platformSlug=<slug>
 *
 * Returns the publish-kit payload for a Tier 3 (guided_pdf) platform.
 * Also records a `guide_generated` status in project_publications so the
 * Publish page can show "Kit ready" state.
 */
export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const url = new URL(request.url);
  const projectId = url.searchParams.get('projectId');
  const platformSlug = url.searchParams.get('platformSlug');
  if (!projectId || !platformSlug) {
    return NextResponse.json({ error: 'projectId and platformSlug required' }, { status: 400 });
  }

  // Load platform
  const { data: platform } = await supabase
    .from('publishing_platforms')
    .select('*')
    .eq('slug', platformSlug)
    .single();

  if (!platform) return NextResponse.json({ error: 'Platform not found' }, { status: 404 });
  if (platform.publish_tier !== 'guided_pdf') {
    return NextResponse.json(
      { error: 'Publish kits are only for guided platforms. This platform uses auto-publish or Penworth Store.' },
      { status: 400 },
    );
  }

  const meta = await ensurePublishingMetadata(supabase, projectId, user.id);
  if (!meta) return NextResponse.json({ error: 'Project not found' }, { status: 404 });

  // Validate — return what's missing so the UI can prompt the author
  const validation = validateForPublishing(meta, 'guided_pdf');
  if (!validation.ok) {
    return NextResponse.json(
      {
        error: 'Publishing metadata incomplete',
        missing: validation.missing,
        metadata: meta,
      },
      { status: 422 },
    );
  }

  const builder = getKitBuilder(platformSlug);
  if (!builder) return NextResponse.json({ error: 'No kit builder for this platform' }, { status: 404 });
  const kit = builder(meta);

  // Upsert project_publications row with 'guide_generated' status
  const { data: existing } = await supabase
    .from('project_publications')
    .select('id, status')
    .eq('project_id', projectId)
    .eq('platform_id', platform.id)
    .eq('user_id', user.id)
    .maybeSingle();

  const now = new Date().toISOString();
  if (existing) {
    await supabase
      .from('project_publications')
      .update({
        status: existing.status === 'published' ? 'published' : 'guide_generated',
        publish_tier: 'guided_pdf',
        guide_generated_at: now,
        updated_at: now,
      })
      .eq('id', existing.id);
  } else {
    await supabase.from('project_publications').insert({
      project_id: projectId,
      platform_id: platform.id,
      user_id: user.id,
      publish_tier: 'guided_pdf',
      status: 'guide_generated',
      guide_generated_at: now,
    });
  }

  return NextResponse.json({ kit, metadata: meta });
}
