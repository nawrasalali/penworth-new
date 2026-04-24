import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';
export const maxDuration = 30;
export const dynamic = 'force-dynamic';

const MAX_BYTES = 5 * 1024 * 1024; // 5 MB
const ALLOWED_MIME = ['image/jpeg', 'image/png', 'image/webp'];

/**
 * POST /api/author/photo
 *
 * Uploads an author headshot for a given project/session. The photo
 * lands in the public `covers` bucket under `author-photos/{userId}/`
 * and its URL is written to `interview_sessions.author_photo_url`
 * so the Cover step can display it and Publishing can embed it in
 * the generated PDF/EPUB.
 *
 * Request is multipart/form-data:
 *   - projectId: string
 *   - file: File (jpeg/png/webp, <=5MB)
 *
 * Returns: { publicUrl: string }
 */
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();

    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const formData = await request.formData();
    const projectId = formData.get('projectId') as string | null;
    const file = formData.get('file') as File | null;

    if (!projectId || !file) {
      return NextResponse.json(
        { error: 'projectId and file are required' },
        { status: 400 },
      );
    }
    if (!ALLOWED_MIME.includes(file.type)) {
      return NextResponse.json(
        { error: `Unsupported file type ${file.type}. Use JPEG, PNG, or WebP.` },
        { status: 415 },
      );
    }
    if (file.size > MAX_BYTES) {
      return NextResponse.json(
        { error: `File too large (${(file.size / 1024 / 1024).toFixed(1)} MB). Max 5 MB.` },
        { status: 413 },
      );
    }

    // Confirm the user actually owns this project before we let them
    // associate a photo with its session. We trust supabase.auth.getUser()
    // — the cookie-based check in createClient() — so an RLS-filtered
    // read here is sufficient authorization.
    const { data: project, error: projErr } = await supabase
      .from('projects')
      .select('id, user_id')
      .eq('id', projectId)
      .single();

    if (projErr || !project || project.user_id !== user.id) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    }

    const { data: session } = await supabase
      .from('interview_sessions')
      .select('id')
      .eq('project_id', projectId)
      .eq('user_id', user.id)
      .maybeSingle();

    if (!session) {
      return NextResponse.json({ error: 'Session not found for this project' }, { status: 404 });
    }

    const ext = (file.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '');
    // Deterministic path per session so re-uploads overwrite cleanly and
    // we never accumulate orphaned headshots for the same author.
    //
    // IMPORTANT: userId must be the first folder segment. The `covers`
    // bucket's RLS policy (publish_own_covers_insert) requires
    // `(storage.foldername(name))[1] = auth.uid()::text` on INSERT. An
    // `author-photos/{userId}/...` layout would be rejected; we put
    // userId first and use `author-photos` as a subfolder instead.
    const storagePath = `${user.id}/author-photos/${session.id}.${ext || 'jpg'}`;

    const arrayBuffer = await file.arrayBuffer();
    const { error: uploadErr } = await supabase
      .storage
      .from('covers')
      .upload(storagePath, arrayBuffer, {
        contentType: file.type,
        upsert: true,
        cacheControl: '3600',
      });

    if (uploadErr) {
      console.error('[author/photo] storage upload failed:', uploadErr);
      return NextResponse.json(
        { error: 'Upload failed. Please try again.' },
        { status: 500 },
      );
    }

    const { data: { publicUrl } } = supabase
      .storage
      .from('covers')
      .getPublicUrl(storagePath);

    // Append a cache-buster so the UI sees the new image immediately even
    // though the storage path stays the same across re-uploads.
    const publicUrlWithBust = `${publicUrl}?v=${Date.now()}`;

    const { error: updateErr } = await supabase
      .from('interview_sessions')
      .update({ author_photo_url: publicUrlWithBust })
      .eq('id', session.id);

    if (updateErr) {
      console.error('[author/photo] session update failed:', updateErr);
      return NextResponse.json(
        { error: 'Upload succeeded but session update failed.' },
        { status: 500 },
      );
    }

    return NextResponse.json({ publicUrl: publicUrlWithBust });
  } catch (err) {
    console.error('[author/photo] unexpected error:', err);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 },
    );
  }
}
