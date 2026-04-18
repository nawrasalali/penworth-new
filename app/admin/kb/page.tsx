import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { formatDistanceToNow } from 'date-fns';
import { Plus } from 'lucide-react';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

/**
 * Task 2.4 — /admin/kb list view.
 *
 * Columns:
 *   slug, title, surface_scope[], role_scope[], version, published,
 *   is_internal, translation count, last_updated_at
 *
 * Translation count comes from a left-join against
 * nora_kb_article_translations. We do this with a separate query and
 * stitch in-memory rather than a SQL join because Supabase client
 * doesn't naturally expose count-aggregates via the PostgREST JSON API.
 *
 * Per Phase 2 pre-flight D1: retrieval mechanism is TBD (no pgvector,
 * no tsvector, no embedding column in repo). KB editor works fully
 * without any save-time embedding regeneration. Ship as-is; a later
 * phase can add an external vector-store refresh call if a retrieval
 * upgrade happens.
 */
export default async function AdminKBPage() {
  const supabase = await createClient();

  const { data: articles, error } = await supabase
    .from('nora_kb_articles')
    .select(
      'id, slug, title, summary, surface_scope, role_scope, version, published, is_internal, tags, updated_at',
    )
    .order('updated_at', { ascending: false });

  if (error) {
    console.error('[admin/kb] fetch error:', error);
  }

  // Translation counts per article_id. Single batched query.
  const articleIds = (articles || []).map((a) => a.id);
  const translationCounts = new Map<string, number>();
  if (articleIds.length > 0) {
    const { data: translations } = await supabase
      .from('nora_kb_article_translations')
      .select('article_id')
      .in('article_id', articleIds);

    for (const t of translations || []) {
      const prev = translationCounts.get(t.article_id) || 0;
      translationCounts.set(t.article_id, prev + 1);
    }
  }

  return (
    <div className="p-8">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Knowledge Base</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {(articles || []).length} article{(articles || []).length === 1 ? '' : 's'}
          </p>
        </div>
        <Link
          href="/admin/kb/new"
          className="inline-flex items-center rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground hover:opacity-90"
        >
          <Plus className="mr-2 h-4 w-4" />
          New article
        </Link>
      </div>

      <div className="overflow-hidden rounded-lg border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-xs uppercase tracking-widest text-muted-foreground">
            <tr>
              <th className="px-4 py-3 text-left font-medium">Title</th>
              <th className="px-4 py-3 text-left font-medium">Slug</th>
              <th className="px-4 py-3 text-left font-medium">Surfaces</th>
              <th className="px-4 py-3 text-left font-medium">Roles</th>
              <th className="px-4 py-3 text-right font-medium">Version</th>
              <th className="px-4 py-3 text-right font-medium">Translations</th>
              <th className="px-4 py-3 text-right font-medium">State</th>
              <th className="px-4 py-3 text-right font-medium">Updated</th>
            </tr>
          </thead>
          <tbody>
            {!articles || articles.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-4 py-12 text-center text-muted-foreground">
                  No articles yet.
                </td>
              </tr>
            ) : (
              articles.map((a) => (
                <tr key={a.id} className="border-t hover:bg-muted/30">
                  <td className="max-w-md truncate px-4 py-3">
                    <Link
                      href={`/admin/kb/${a.id}`}
                      className="font-medium text-primary hover:underline"
                    >
                      {a.title}
                    </Link>
                    {a.summary && (
                      <div className="mt-0.5 truncate text-xs text-muted-foreground">
                        {a.summary}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs">{a.slug}</td>
                  <td className="px-4 py-3 text-xs">
                    {Array.isArray(a.surface_scope) ? a.surface_scope.join(', ') : '—'}
                  </td>
                  <td className="px-4 py-3 text-xs">
                    {Array.isArray(a.role_scope) ? a.role_scope.join(', ') : '—'}
                  </td>
                  <td className="px-4 py-3 text-right font-mono text-xs">v{a.version}</td>
                  <td className="px-4 py-3 text-right text-xs">
                    {translationCounts.get(a.id) ?? 0}
                  </td>
                  <td className="px-4 py-3 text-right text-xs">
                    {a.is_internal ? (
                      <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-amber-600">
                        internal
                      </span>
                    ) : a.published ? (
                      <span className="rounded-full bg-green-500/15 px-2 py-0.5 text-green-600">
                        published
                      </span>
                    ) : (
                      <span className="rounded-full bg-gray-500/15 px-2 py-0.5 text-gray-500">
                        draft
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right text-xs text-muted-foreground">
                    {formatDistanceToNow(new Date(a.updated_at), { addSuffix: true })}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
