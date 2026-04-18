import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { requireAdmin } from '@/lib/admin/require-admin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/admin/kb — create a new KB article.
 *
 * Validation mirrors the CHECK constraints on nora_kb_articles (per
 * pre-flight): surface_scope and role_scope must be non-empty arrays.
 * Slug must be unique (DB will enforce via unique constraint — we
 * surface 23505 as a clean 409).
 *
 * Per pre-flight D1: no save-time embedding regeneration. KB retrieval
 * upgrade is a separate phase concern.
 * Per pre-flight A11: version column defaults to 1 at insert; the
 * monotonic-counter bump happens on UPDATE only.
 */
export async function POST(request: NextRequest) {
  const gate = await requireAdmin();
  if (!gate.ok) return gate.response;

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
  const { data, error } = await admin
    .from('nora_kb_articles')
    .insert({
      slug: body.slug.trim(),
      title: body.title.trim(),
      summary: body.summary ?? null,
      content_markdown: body.content_markdown,
      surface_scope: body.surface_scope,
      role_scope: body.role_scope,
      tags: body.tags ?? [],
      published: body.published === true,
      is_internal: body.is_internal === true,
    })
    .select()
    .maybeSingle();

  if (error) {
    // 23505 = unique_violation (most likely slug collision)
    if (error.code === '23505') {
      return NextResponse.json(
        { error: 'A KB article with that slug already exists' },
        { status: 409 },
      );
    }
    // 23514 = check_violation (surface_scope/role_scope empty, etc)
    if (error.code === '23514') {
      return NextResponse.json(
        { error: `Check constraint violated: ${error.message}` },
        { status: 400 },
      );
    }
    console.error('[POST /api/admin/kb] insert error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ data }, { status: 201 });
}

export function validateArticlePayload(
  body: any,
): { ok: true } | { ok: false; error: string } {
  if (typeof body.slug !== 'string' || body.slug.trim().length === 0) {
    return { ok: false, error: 'slug is required' };
  }
  if (typeof body.title !== 'string' || body.title.trim().length === 0) {
    return { ok: false, error: 'title is required' };
  }
  if (
    typeof body.content_markdown !== 'string' ||
    body.content_markdown.trim().length === 0
  ) {
    return { ok: false, error: 'content_markdown is required' };
  }
  if (!Array.isArray(body.surface_scope) || body.surface_scope.length === 0) {
    return { ok: false, error: 'surface_scope must be a non-empty array' };
  }
  if (!Array.isArray(body.role_scope) || body.role_scope.length === 0) {
    return { ok: false, error: 'role_scope must be a non-empty array' };
  }
  if (body.tags && !Array.isArray(body.tags)) {
    return { ok: false, error: 'tags must be an array if provided' };
  }
  return { ok: true };
}
