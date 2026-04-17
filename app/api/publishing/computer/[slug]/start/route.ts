import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';
import { ensurePublishingMetadata, validateForPublishing } from '@/lib/publishing/metadata';
import { loadActiveCredential } from '@/lib/publishing/load-credential';
import { buildRecipe } from '@/lib/publishing/computer-recipes';

export const runtime = 'nodejs';
export const maxDuration = 300;

/**
 * POST /api/publishing/computer/[slug]/start
 * body: { projectId }
 *
 * Creates a computer_use_sessions row in 'queued' state and returns its id.
 * The heavy lifting (browser launch + agent loop) happens in the stream
 * endpoint; splitting it this way means the client can subscribe to the
 * event stream via a standard GET request without the POST timing out.
 *
 * All security gates live here: auth, admin, metadata validation, credential
 * presence. Stream endpoint trusts the session row and picks up from there.
 */
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
      { error: 'Penworth Computer is in limited preview. Contact support for early access.' },
      { status: 402 },
    );
  }

  const { projectId } = await request.json();
  if (!projectId) return NextResponse.json({ error: 'projectId required' }, { status: 400 });

  // Recipe must exist for this platform
  const { data: platform } = await supabase
    .from('publishing_platforms')
    .select('id, name, slug')
    .eq('slug', slug)
    .single();
  if (!platform) return NextResponse.json({ error: 'Platform not found' }, { status: 404 });

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

  // Credentials — stored with auth_type='computer_use' (email+password)
  const credential = await loadActiveCredential(supabase, user.id, slug);
  if (!credential) {
    return NextResponse.json(
      {
        error: `Connect your ${platform.name} account first`,
        code: 'not_connected',
      },
      { status: 428 },
    );
  }

  // Recipe must have a builder
  const tokenShape = credential.token as unknown as Record<string, unknown>;
  const email = tokenShape.email as string | undefined;
  const password = tokenShape.password as string | undefined;
  if (!email || !password) {
    return NextResponse.json(
      { error: `No login credentials stored for ${platform.name}` },
      { status: 428 },
    );
  }

  const recipe = buildRecipe(slug, {
    metadata,
    credentials: { email, password },
    attachmentBasename: 'manuscript',
  });
  if (!recipe) {
    return NextResponse.json(
      { error: `No computer-use recipe for ${platform.name} yet` },
      { status: 501 },
    );
  }

  // Use service client for session row creation so we bypass RLS on write;
  // RLS still protects reads at the user layer.
  const service = createServiceClient();

  const { data: session, error } = await service
    .from('computer_use_sessions')
    .insert({
      user_id: user.id,
      project_id: projectId,
      platform_id: platform.id,
      platform_slug: slug,
      status: 'queued',
      runtime: process.env.BROWSERBASE_API_KEY ? 'browserbase' : 'local',
    })
    .select()
    .single();

  if (error || !session) {
    return NextResponse.json({ error: error?.message || 'Failed to create session' }, { status: 500 });
  }

  return NextResponse.json({ sessionId: session.id, status: session.status });
}
