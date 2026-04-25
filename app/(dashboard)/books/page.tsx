import { createClient } from '@/lib/supabase/server';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Plus } from 'lucide-react';
import { CONTENT_TYPE_LABELS } from '@/lib/utils';
import { MyBooksClient, type BookRow } from '@/components/books/MyBooksClient';
import { t, isSupportedLocale, type Locale } from '@/lib/i18n/strings';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

/**
 * /books — the writer's primary surface. Renamed from /projects on 2026-04-25
 * (CEO-084). Replaces the old flat-list-of-projects view with a focused
 * two-card layout per Founder directive: drafts at-a-glance with one-click
 * publish, and published books with View on Store / Manage CTAs.
 *
 * The classification is driven by the live `store_listings` table — a project
 * with any row in store_listings (status live or pending_review) belongs in
 * Published; everything else is a Draft. CEO-077 fixed the publish path to
 * write to store_listings (not marketplace_listings) so this is the source of
 * truth.
 */
export default async function BooksPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return (
      <div className="p-8">
        <p className="text-muted-foreground">Please log in to view your books.</p>
      </div>
    );
  }

  // Locale resolution — same source the dashboard layout uses
  const { data: profile } = await supabase
    .from('profiles')
    .select('preferred_language, full_name')
    .eq('id', user.id)
    .single();
  const rawLang = (profile?.preferred_language || 'en').toLowerCase();
  const locale: Locale = isSupportedLocale(rawLang) ? rawLang : 'en';

  // 1. All non-trashed projects, newest first
  const { data: projects, error: projectsErr } = await supabase
    .from('projects')
    .select(
      'id, title, content_type, status, updated_at, created_at, ' +
      'interview_sessions(front_cover_url)'
    )
    .eq('user_id', user.id)
    .is('deleted_at', null)
    .order('updated_at', { ascending: false });

  if (projectsErr) {
    console.error('books page: projects query error', projectsErr);
    return (
      <div className="p-8">
        <p className="text-red-600">Failed to load books. Please try again.</p>
      </div>
    );
  }

  // 2. store_listings — drives the Drafting vs Published classification.
  //    A project is "published" if it has any live or pending_review listing.
  const ids = ((projects || []) as any[]).map((p) => p.id);
  let listingByProject = new Map<string, { status: string; slug: string | null }>();
  if (ids.length > 0) {
    const { data: listings, error: listErr } = await supabase
      .from('store_listings')
      .select('project_id, status, slug')
      .in('project_id', ids)
      .in('status', ['live', 'pending_review']);
    if (listErr) {
      // Non-fatal — render everything as draft if we cannot fetch listings
      console.error('books page: store_listings query error', listErr);
    } else {
      listingByProject = new Map(
        (listings || []).map((l: any) => [l.project_id, { status: l.status, slug: l.slug }])
      );
    }
  }

  // 3. Bucket
  const drafts: BookRow[] = [];
  const published: BookRow[] = [];
  // Supabase's typed select with a relation join returns a discriminated union
  // (Row[] | GenericStringError); the original projects/page narrowed via
  // `.map((p: any) => …)`. Cast at the iterator boundary for the same effect.
  for (const p of (projects || []) as any[]) {
    const cover = (p as any).interview_sessions?.[0]?.front_cover_url || null;
    const row: BookRow = {
      id: p.id,
      title: (p.title || '').trim() || t('projects.untitled', locale),
      contentTypeLabel: CONTENT_TYPE_LABELS[p.content_type] || p.content_type,
      coverUrl: cover,
      updatedAt: p.updated_at,
      status: p.status,
    };
    const listing = listingByProject.get(p.id);
    if (listing) {
      row.listingStatus = listing.status;
      row.listingSlug = listing.slug;
      published.push(row);
    } else {
      drafts.push(row);
    }
  }

  const hasNothing = drafts.length === 0 && published.length === 0;

  return (
    <div className="p-6 md:p-8 max-w-5xl mx-auto">
      <div className="flex items-start justify-between mb-6 gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">{t('books.title', locale)}</h1>
          <p className="text-muted-foreground mt-1">{t('books.subtitle', locale)}</p>
        </div>
        <Link href="/books/new">
          <Button>
            <Plus className="mr-2 h-4 w-4" />
            {t('books.newBookCta', locale)}
          </Button>
        </Link>
      </div>

      {hasNothing ? (
        <div className="rounded-xl border bg-card py-16 flex flex-col items-center justify-center">
          <p className="text-muted-foreground text-center max-w-sm px-4 mb-6">
            {t('books.allEmpty', locale)}
          </p>
          <Link href="/books/new">
            <Button>
              <Plus className="mr-2 h-4 w-4" />
              {t('books.newBookCta', locale)}
            </Button>
          </Link>
        </div>
      ) : (
        <MyBooksClient
          drafts={drafts}
          published={published}
          locale={locale}
          defaultAuthorName={profile?.full_name || null}
        />
      )}
    </div>
  );
}
