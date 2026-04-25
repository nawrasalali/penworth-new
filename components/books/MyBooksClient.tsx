'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { ExternalLink, Edit2, Rocket, Settings2, BookOpen, BookMarked } from 'lucide-react';
import { PublishToStoreModal, type PublishSuccessPayload } from '@/components/publish/PublishToStoreModal';
import { t, type Locale } from '@/lib/i18n/strings';

export interface BookRow {
  id: string;
  title: string;
  contentTypeLabel: string;
  coverUrl: string | null;
  updatedAt: string;
  status: string;
  listingStatus?: string;
  listingSlug?: string | null;
}

interface MyBooksClientProps {
  drafts: BookRow[];
  published: BookRow[];
  locale: Locale;
  defaultAuthorName?: string | null;
}

/**
 * Two-card My Books surface (CEO-084).
 *
 *   Drafting Books — every project not yet on the store. Per-row primary CTA
 *                    is Publish, which opens <PublishToStoreModal> directly
 *                    (no intermediate /publish page; that route was retired
 *                    in this PR). Secondary CTA is Edit, which lands in the
 *                    project editor.
 *
 *   Published Books — every project with a live or pending_review row in
 *                     store_listings. Primary CTA is View on Store, secondary
 *                     is Manage (project metadata page).
 *
 * After a successful publish the page is refreshed via router.refresh() so
 * the just-published draft moves from the Drafting card to the Published
 * card without a hard reload.
 */
export function MyBooksClient({ drafts, published, locale, defaultAuthorName }: MyBooksClientProps) {
  const router = useRouter();
  const [publishingProject, setPublishingProject] = useState<BookRow | null>(null);
  const [modalOpen, setModalOpen] = useState(false);

  const openPublishModal = (book: BookRow) => {
    setPublishingProject(book);
    setModalOpen(true);
  };

  const onPublishSuccess = (_payload: PublishSuccessPayload) => {
    setModalOpen(false);
    setPublishingProject(null);
    // Server component re-fetches; the just-published book moves cards
    router.refresh();
  };

  return (
    <>
      <div className="space-y-6">
        {/* DRAFTING BOOKS */}
        <section className="rounded-xl border bg-card">
          <header className="flex items-center justify-between px-5 py-4 border-b">
            <div className="flex items-center gap-2">
              <Edit2 className="h-4 w-4 text-muted-foreground" />
              <h2 className="font-semibold text-base">
                {t('books.draftingHeader', locale)}
              </h2>
              <span className="text-sm text-muted-foreground">({drafts.length})</span>
            </div>
          </header>
          {drafts.length === 0 ? (
            <p className="px-5 py-6 text-sm text-muted-foreground">
              {t('books.draftingEmpty', locale)}
            </p>
          ) : (
            <ul className="divide-y">
              {drafts.map((book) => (
                <li key={book.id} className="px-5 py-4 flex items-center gap-4">
                  <BookCover url={book.coverUrl} fallback="draft" />
                  <div className="flex-1 min-w-0">
                    <Link
                      href={`/books/${book.id}/editor`}
                      className="font-medium truncate hover:underline block"
                    >
                      {book.title}
                    </Link>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {book.contentTypeLabel}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Link href={`/books/${book.id}/editor`}>
                      <Button variant="ghost" size="sm">
                        <Edit2 className="h-3.5 w-3.5 mr-1.5" />
                        {t('books.editCta', locale)}
                      </Button>
                    </Link>
                    <Button size="sm" onClick={() => openPublishModal(book)}>
                      <Rocket className="h-3.5 w-3.5 mr-1.5" />
                      {t('books.publishCta', locale)}
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* PUBLISHED BOOKS */}
        <section className="rounded-xl border bg-card">
          <header className="flex items-center justify-between px-5 py-4 border-b">
            <div className="flex items-center gap-2">
              <BookMarked className="h-4 w-4 text-muted-foreground" />
              <h2 className="font-semibold text-base">
                {t('books.publishedHeader', locale)}
              </h2>
              <span className="text-sm text-muted-foreground">({published.length})</span>
            </div>
          </header>
          {published.length === 0 ? (
            <p className="px-5 py-6 text-sm text-muted-foreground">
              {t('books.publishedEmpty', locale)}
            </p>
          ) : (
            <ul className="divide-y">
              {published.map((book) => {
                const storeUrl = book.listingSlug
                  ? `https://store.penworth.ai/${book.listingSlug}`
                  : 'https://store.penworth.ai';
                return (
                  <li key={book.id} className="px-5 py-4 flex items-center gap-4">
                    <BookCover url={book.coverUrl} fallback="published" />
                    <div className="flex-1 min-w-0">
                      <p className="font-medium truncate">{book.title}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {book.contentTypeLabel}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <Link href={`/books/${book.id}`}>
                        <Button variant="ghost" size="sm">
                          <Settings2 className="h-3.5 w-3.5 mr-1.5" />
                          {t('books.manageCta', locale)}
                        </Button>
                      </Link>
                      <a href={storeUrl} target="_blank" rel="noopener noreferrer">
                        <Button size="sm" variant="outline">
                          <ExternalLink className="h-3.5 w-3.5 mr-1.5" />
                          {t('books.viewOnStoreCta', locale)}
                        </Button>
                      </a>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>

      {publishingProject && (
        <PublishToStoreModal
          open={modalOpen}
          onOpenChange={(open) => {
            setModalOpen(open);
            if (!open) setPublishingProject(null);
          }}
          projectId={publishingProject.id}
          defaultTitle={publishingProject.title}
          defaultAuthorName={defaultAuthorName ?? null}
          onSuccess={onPublishSuccess}
        />
      )}
    </>
  );
}

/**
 * Tiny cover thumbnail (40×56 — book proportions). Falls back to a tinted
 * tile with a BookOpen icon when no cover URL is set yet (drafts before the
 * cover-generation step) or for the published case where the listing has its
 * own cover that the store renders.
 */
function BookCover({ url, fallback }: { url: string | null; fallback: 'draft' | 'published' }) {
  if (url) {
    return (
      <img
        src={url}
        alt=""
        className="h-14 w-10 rounded object-cover bg-muted shrink-0"
        loading="lazy"
      />
    );
  }
  return (
    <div
      className={
        'h-14 w-10 rounded shrink-0 flex items-center justify-center ' +
        (fallback === 'published'
          ? 'bg-primary/10 text-primary'
          : 'bg-muted text-muted-foreground')
      }
    >
      <BookOpen className="h-5 w-5" />
    </div>
  );
}
