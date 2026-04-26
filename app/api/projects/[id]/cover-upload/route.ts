import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';

export const runtime = 'nodejs';
export const maxDuration = 30;
export const dynamic = 'force-dynamic';

const MAX_BYTES = 8 * 1024 * 1024; // 8 MB — slightly larger than headshots; covers can be 2k×3k.
const ALLOWED_MIME = ['image/jpeg', 'image/png', 'image/webp'];

/**
 * POST /api/projects/[id]/cover-upload
 *
 * Lets the writer upload their own front-cover artwork instead of (or in
 * addition to) using the AI-generated one. The file lands in the public
 * `covers` bucket under
 *   `{userId}/uploaded-covers/{sessionId}.{ext}`
 * (userId first to satisfy the bucket's RLS path-prefix policy) and:
 *   - `interview_sessions.front_cover_url` is set to the public URL
 *   - `interview_sessions.front_cover_source` is set to 'uploaded'
 *   - `interview_sessions.front_cover_has_typography` is set from the
 *     `hasTypography` form field — when true, downstream renderers (PDF
 *     export + Visual Audiobook + Cinematic Livebook) skip the title /
 *     author overlay because the uploaded artwork already includes it.
 *
 * Mirrors `/api/author/photo` for storage + auth pattern.
 *
 * Request is multipart/form-data:
 *   - file: File (jpeg/png/webp, <= 8MB)
 *   - hasTypography: 'true' | 'false' (default 'false')
 *
 * Returns: { publicUrl: string, hasTypography: boolean }
 */
export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id: projectId } = await context.params;
    const supabase = await createClient();

    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const formData = await request.formData();
    const file = formData.get('file') as File | null;
    const hasTypographyRaw = formData.get('hasTypography');
    const hasTypography = hasTypographyRaw === 'true';

    if (!projectId || !file) {
      return NextResponse.json(
        { error: 'projectId path param and file are required' },
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
        { error: `File too large (${(file.size / 1024 / 1024).toFixed(1)} MB). Max ${MAX_BYTES / 1024 / 1024} MB.` },
        { status: 413 },
      );
    }

    // Confirm ownership before associating the file with the session.
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
    const storagePath = `${user.id}/uploaded-covers/${session.id}.${ext || 'jpg'}`;

    const arrayBuffer = await file.arrayBuffer();
    // Same service-client workaround as /api/author/photo: cookie-based JWT
    // is not consistently forwarded to storage on App Router server runs,
    // and we already authorised the caller via the project + session
    // ownership checks above.
    const admin = createServiceClient();
    const { error: uploadErr } = await admin
      .storage
      .from('covers')
      .upload(storagePath, arrayBuffer, {
        contentType: file.type,
        upsert: true,
        cacheControl: '3600',
      });

    if (uploadErr) {
      console.error('[cover-upload] storage upload failed:', uploadErr);
      return NextResponse.json(
        { error: `Upload failed: ${uploadErr.message}` },
        { status: 500 },
      );
    }

    const { data: { publicUrl } } = admin
      .storage
      .from('covers')
      .getPublicUrl(storagePath);

    const publicUrlWithBust = `${publicUrl}?v=${Date.now()}`;

    const { error: updateErr } = await supabase
      .from('interview_sessions')
      .update({
        front_cover_url: publicUrlWithBust,
        front_cover_source: 'uploaded',
        front_cover_has_typography: hasTypography,
      })
      .eq('id', session.id);

    if (updateErr) {
      console.error('[cover-upload] session update failed:', updateErr);
      return NextResponse.json(
        { error: `Upload succeeded but session update failed: ${updateErr.message}` },
        { status: 500 },
      );
    }

    return NextResponse.json({ publicUrl: publicUrlWithBust, hasTypography });
  } catch (err: any) {
    console.error('[cover-upload] unexpected error:', err);
    return NextResponse.json(
      { error: `Internal server error: ${err?.message ?? 'unknown'}` },
      { status: 500 },
    );
  }
}
