import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { ensurePublishingMetadata, loadPublishingMetadata } from '@/lib/publishing/metadata';

/**
 * GET /api/publishing/metadata?projectId=<uuid>
 *   Returns (and seeds if missing) the canonical publishing metadata record.
 *
 * PUT /api/publishing/metadata
 *   body: { projectId, ...fields }
 *   Updates the record. All fields optional; only provided fields are updated.
 */

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const projectId = new URL(request.url).searchParams.get('projectId');
  if (!projectId) return NextResponse.json({ error: 'projectId required' }, { status: 400 });

  const meta = await ensurePublishingMetadata(supabase, projectId, user.id);
  if (!meta) return NextResponse.json({ error: 'Project not found' }, { status: 404 });
  return NextResponse.json({ metadata: meta });
}

const ALLOWED_FIELDS = [
  'title', 'subtitle', 'author_name', 'author_bio',
  'short_description', 'long_description', 'keywords', 'bisac_codes',
  'price_usd', 'currency', 'is_free', 'territories', 'custom_territories',
  'language', 'publication_date', 'edition', 'series_name', 'series_number',
  'audience', 'contains_explicit',
] as const;

export async function PUT(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json();
  const { projectId, ...updates } = body;
  if (!projectId) return NextResponse.json({ error: 'projectId required' }, { status: 400 });

  // Ensure record exists
  await ensurePublishingMetadata(supabase, projectId, user.id);

  const clean: Record<string, unknown> = {};
  for (const key of ALLOWED_FIELDS) {
    if (key in updates) clean[key] = updates[key];
  }
  clean.updated_at = new Date().toISOString();

  const { data, error } = await supabase
    .from('publishing_metadata')
    .update(clean)
    .eq('project_id', projectId)
    .eq('user_id', user.id)
    .select('*')
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ metadata: data });
}
