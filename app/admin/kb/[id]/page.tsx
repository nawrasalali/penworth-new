import Link from 'next/link';
import { notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { ArrowLeft } from 'lucide-react';
import { ArticleEditor } from '../ArticleEditor';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

/**
 * Task 2.4 — /admin/kb/[id] edit view.
 *
 * Loads the article + its existing translations and hands them to the
 * ArticleEditor client component. Server-side data fetch keeps the
 * editor component stateless on mount.
 */
export default async function AdminKBEditArticlePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: article, error } = await supabase
    .from('nora_kb_articles')
    .select('*')
    .eq('id', id)
    .maybeSingle();

  if (error) {
    console.error('[admin/kb/:id] article fetch error:', error);
    notFound();
  }
  if (!article) notFound();

  const { data: translations } = await supabase
    .from('nora_kb_article_translations')
    .select('*')
    .eq('article_id', id)
    .order('language');

  return (
    <div className="p-8">
      <Link
        href="/admin/kb"
        className="mb-4 inline-flex items-center text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="mr-2 h-4 w-4" />
        Back to Knowledge Base
      </Link>
      <h1 className="mb-6 text-2xl font-bold tracking-tight">{article.title}</h1>
      <ArticleEditor
        mode="edit"
        article={article}
        translations={translations || []}
      />
    </div>
  );
}
