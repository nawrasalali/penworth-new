import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { ensurePublishingMetadata, validateForPublishing } from '@/lib/publishing/metadata';
import { loadActiveCredential } from '@/lib/publishing/load-credential';
import {
  publishToDraft2Digital,
  buildManuscriptDocx,
  loadProjectForPublish,
  D2DError,
} from '@/lib/publishing/draft2digital';

export const runtime = 'nodejs';
export const maxDuration = 120;

/**
 * POST /api/publishing/tier2/[slug]/publish
 * body: { projectId }
 *
 * Auto-publishes a project to a Tier 2 platform:
 *   1. Auth + admin gate (rollout)
 *   2. Load metadata (422 if incomplete)
 *   3. Load active OAuth credential (428 if not connected)
 *   4. Build manuscript + cover buffers
 *   5. Call the platform-specific adapter
 *   6. Write project_publications with external URL or error
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  // Admin gate for rollout — credit-metering comes later
  const { data: profile } = await supabase
    .from('profiles')
    .select('is_admin')
    .eq('id', user.id)
    .single();
  if (!profile?.is_admin) {
    return NextResponse.json(
      { error: 'Auto-publish is in limited preview. Contact support for early access.' },
      { status: 402 },
    );
  }

  const { projectId } = await request.json();
  if (!projectId) return NextResponse.json({ error: 'projectId required' }, { status: 400 });

  // Resolve platform + validate tier
  const { data: platform } = await supabase
    .from('publishing_platforms')
    .select('id, name, slug, publish_tier, oauth_provider')
    .eq('slug', slug)
    .single();
  if (!platform) return NextResponse.json({ error: 'Platform not found' }, { status: 404 });
  if (platform.publish_tier !== 'api_auto') {
    return NextResponse.json(
      { error: 'Auto-publish only available for Tier 2 platforms' },
      { status: 400 },
    );
  }

  // Metadata gate
  const metadata = await ensurePublishingMetadata(supabase, projectId, user.id);
  if (!metadata) return NextResponse.json({ error: 'Project not found' }, { status: 404 });
  const validation = validateForPublishing(metadata, 'api_auto');
  if (!validation.ok) {
    return NextResponse.json(
      { error: 'Publishing metadata incomplete', missing: validation.missing },
      { status: 422 },
    );
  }

  // Credential gate
  const oauthProvider = platform.oauth_provider;
  if (!oauthProvider) {
    return NextResponse.json(
      { error: `No OAuth provider configured for ${platform.name}` },
      { status: 501 },
    );
  }
  const credential = await loadActiveCredential(supabase, user.id, oauthProvider);
  if (!credential) {
    return NextResponse.json(
      { error: `Connect your ${platform.name} account first`, code: 'not_connected' },
      { status: 428 },
    );
  }

  // Load project bits
  const bundle = await loadProjectForPublish(supabase, projectId, user.id);
  if (!bundle) {
    return NextResponse.json({ error: 'No completed chapters to publish' }, { status: 400 });
  }

  // Mark in-progress
  const { data: existingPub } = await supabase
    .from('project_publications')
    .select('id, retry_count')
    .eq('project_id', projectId)
    .eq('platform_id', platform.id)
    .eq('user_id', user.id)
    .maybeSingle();

  const nowIso = new Date().toISOString();
  if (existingPub) {
    await supabase
      .from('project_publications')
      .update({
        status: 'in_progress',
        publish_tier: 'api_auto',
        error_message: null,
        retry_count: (existingPub.retry_count || 0) + 1,
        updated_at: nowIso,
      })
      .eq('id', existingPub.id);
  } else {
    await supabase.from('project_publications').insert({
      project_id: projectId,
      platform_id: platform.id,
      user_id: user.id,
      publish_tier: 'api_auto',
      status: 'in_progress',
    });
  }

  // Build files
  const manuscriptBuffer = await buildManuscriptDocx(
    metadata.title,
    metadata.author_name,
    bundle.chapters,
  );
  let coverBuffer: Buffer | null = null;
  if (bundle.coverUrl) {
    try {
      const coverResp = await fetch(bundle.coverUrl);
      if (coverResp.ok) coverBuffer = Buffer.from(await coverResp.arrayBuffer());
    } catch {
      // non-fatal
    }
  }

  // Dispatch to the platform-specific adapter
  try {
    if (oauthProvider === 'draft2digital') {
      const result = await publishToDraft2Digital({
        token: credential.token,
        metadata,
        manuscriptBuffer,
        manuscriptFilename: 'manuscript.docx',
        coverBuffer,
      });

      const externalUrl = `https://www.draft2digital.com/book/${result.bookId}`;
      await supabase
        .from('project_publications')
        .update({
          status: 'published',
          external_url: externalUrl,
          published_at: new Date().toISOString(),
          automation_log: { bookId: result.bookId, statusUrl: result.statusUrl },
          error_message: null,
          updated_at: new Date().toISOString(),
        })
        .eq('project_id', projectId)
        .eq('platform_id', platform.id)
        .eq('user_id', user.id);

      return NextResponse.json({
        success: true,
        platform: platform.slug,
        bookId: result.bookId,
        externalUrl,
      });
    }

    // Other Tier 2 providers land here when their adapters ship
    return NextResponse.json(
      { error: `Auto-publish for ${platform.name} is not yet implemented` },
      { status: 501 },
    );
  } catch (err) {
    const detail = err instanceof D2DError ? err.detail : undefined;
    const message = err instanceof Error ? err.message : 'Publish failed';
    console.error(`Tier 2 publish failed [${oauthProvider}]:`, message, detail);

    await supabase
      .from('project_publications')
      .update({
        status: 'failed',
        error_message: detail ? `${message}: ${detail}` : message,
        updated_at: new Date().toISOString(),
      })
      .eq('project_id', projectId)
      .eq('platform_id', platform.id)
      .eq('user_id', user.id);

    return NextResponse.json({ error: message, detail }, { status: 500 });
  }
}
