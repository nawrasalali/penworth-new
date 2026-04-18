import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { ArticleEditor } from '../ArticleEditor';

export const dynamic = 'force-dynamic';

/**
 * Task 2.4 — /admin/kb/new.
 *
 * Empty-form variant of the article editor. On submit, ArticleEditor
 * POSTs to /api/admin/kb which creates the article and returns its id;
 * the component then router.pushes to /admin/kb/[id] to continue
 * editing (or navigates back to the list, configurable via onSaved).
 *
 * We don't pre-generate an ID here — the create endpoint is the single
 * source of truth for id assignment.
 */
export default function AdminKBNewArticlePage() {
  return (
    <div className="p-8">
      <Link
        href="/admin/kb"
        className="mb-4 inline-flex items-center text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="mr-2 h-4 w-4" />
        Back to Knowledge Base
      </Link>
      <h1 className="mb-6 text-2xl font-bold tracking-tight">New article</h1>
      <ArticleEditor mode="create" />
    </div>
  );
}
