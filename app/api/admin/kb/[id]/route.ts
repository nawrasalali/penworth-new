import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { requireAdmin } from '@/lib/admin/require-admin';
import { validateArticlePayload } from '@/lib/admin/validators';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * PATCH /api/admin/kb/[id] — update a KB article.
 *
 * Per pre-flight A11: version bumps monotonically on save. We read the
 * current version (SELECT ... FOR UPDATE is not available via PostgREST,
 * so we accept a small race: two simultaneous saves could both read
 * version=3 and both write version=4. Acceptable for an admin tool
 * where concurrent edits to the same article are exceedingly rare and
 * the table is append-to-latest anyway).
 *
 * If concurrent-edit protection becomes important, add an optimistic-
 * lock check via `WHERE version = :expected_version` and surface a
 * 409 Conflict on mismatch. Not doing that now to keep the admin UX
 * simple — the article list shows last-updated-at so an admin can see
 * when a peer has touched the file.
 *
 * Slug is treated as immutable after create — the DB constraint plus
 * the form disabling slug input in edit mode means we don't accept
 * slug changes here.
 */
export async function PATCH(
  request: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const gate = await requireAdmin();
  if (!gate.ok) return gate.response;

  const { id } = await ctx.params;

  let body: any;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const validation = validateArticlePayload(body);
  if (!validation.ok) {
    return NextResponse.json({ error: validation.error }, { status: 400 });
  }

  const admin = createAdminClient();

  // Read current version to bump monotonically.
  const { data: current, error: readErr } = await admin
    .from('nora_kb_articles')
    .select('version')
    .eq('id', id)
    .maybeSingle();

  if (readErr) {
    console.error('[PATCH /api/admin/kb/:id] read error:', readErr);
    return NextResponse.json({ error: readErr.message }, { status: 500 });
  }
  if (!current) {
    return NextResponse.json({ error: 'Article not found' }, { status: 404 });
  }

  const nextVersion = (current.version ?? 1) + 1;

  // Update everything except slug (immutable post-create).
  const { data, error } = await admin
    .from('nora_kb_articles')
    .update({
      title: body.title.trim(),
      summary: body.summary ?? null,
      content_markdown: body.content_markdown,
      surface_scope: body.surface_scope,
      role_scope: body.role_scope,
      tags: body.tags ?? [],
      published: body.published === true,
      is_internal: body.is_internal === true,
      version: nextVersion,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
    .select()
    .maybeSingle();

  if (error) {
    if (error.code === '23514') {
      return NextResponse.json(
        { error: `Check constraint violated: ${error.message}` },
        { status: 400 },
      );
    }
    console.error('[PATCH /api/admin/kb/:id] update error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ data });
}
