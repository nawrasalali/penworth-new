import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { requireAdmin } from '@/lib/admin/require-admin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * PUT /api/admin/kb/[id]/translations/[language]
 * Body: { title, summary?, content_markdown, translator?, reviewed_by_human? }
 *
 * UPSERTs the translation row. Uses the composite unique key
 * (article_id, language) which per pre-flight is confirmed on
 * nora_kb_article_translations.
 *
 * Validates language is one of the supported codes matching the app's
 * i18n locale bundles. Rejects attempts to create a translation for an
 * article that doesn't exist with a clean 404.
 */

const SUPPORTED_LANGUAGES = new Set([
  'en', 'ar', 'es', 'fr', 'pt', 'ru', 'zh', 'bn', 'hi', 'id', 'vi',
]);

export async function PUT(
  request: NextRequest,
  ctx: { params: Promise<{ id: string; language: string }> },
) {
  const gate = await requireAdmin();
  if (!gate.ok) return gate.response;

  const { id: articleId, language } = await ctx.params;

  if (!SUPPORTED_LANGUAGES.has(language)) {
    return NextResponse.json(
      {
        error: `language must be one of: ${Array.from(SUPPORTED_LANGUAGES).join(', ')}`,
      },
      { status: 400 },
    );
  }

  let body: any;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  if (typeof body.title !== 'string' || body.title.trim().length === 0) {
    return NextResponse.json({ error: 'title is required' }, { status: 400 });
  }
  if (
    typeof body.content_markdown !== 'string' ||
    body.content_markdown.trim().length === 0
  ) {
    return NextResponse.json(
      { error: 'content_markdown is required' },
      { status: 400 },
    );
  }

  const admin = createAdminClient();

  // 404 guard — avoid FK error noise.
  const { data: article } = await admin
    .from('nora_kb_articles')
    .select('id')
    .eq('id', articleId)
    .maybeSingle();
  if (!article) {
    return NextResponse.json({ error: 'Article not found' }, { status: 404 });
  }

  // Upsert on (article_id, language). onConflict per PostgREST uses a
  // comma-separated list of column names.
  const { data, error } = await admin
    .from('nora_kb_article_translations')
    .upsert(
      {
        article_id: articleId,
        language,
        title: body.title.trim(),
        summary: body.summary ?? null,
        content_markdown: body.content_markdown,
        translator: body.translator ?? null,
        reviewed_by_human: body.reviewed_by_human === true,
      },
      { onConflict: 'article_id,language' },
    )
    .select()
    .maybeSingle();

  if (error) {
    console.error('[PUT /api/admin/kb/:id/translations/:lang] upsert error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ data });
}
