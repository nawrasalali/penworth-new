import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { PublishClient } from '@/components/publish/PublishClient';
import { isSupportedLocale, type Locale } from '@/lib/i18n/strings';

/**
 * /publish — the second flagship. Author picks a completed document and
 * publishes it:
 *   - Tier 1: Penworth Store (1-click, coming soon)
 *   - Tier 2: API auto-publish (OAuth + Penworth Computer)
 *   - Tier 3: Guided publish kits (we generate files + step-by-step walkthrough)
 *
 * Server component fetches the author's completed projects so the document
 * selector has something to offer. Everything else is client-driven.
 */
export default async function PublishPage({
  searchParams,
}: {
  searchParams: Promise<{ project?: string }>;
}) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  // Only completed projects can be published
  const { data: projects } = await supabase
    .from('projects')
    .select('id, title, status, content_type, updated_at')
    .eq('user_id', user.id)
    .is('deleted_at', null)
    .eq('status', 'complete')
    .order('updated_at', { ascending: false });

  // Resolve the user's language so the empty-state marketing showcase and
  // chrome render in their locale, not English.
  const { data: profile } = await supabase
    .from('profiles')
    .select('preferred_language')
    .eq('id', user.id)
    .single();
  const rawLang = (profile?.preferred_language || 'en').toLowerCase();
  const locale: Locale = isSupportedLocale(rawLang) ? rawLang : 'en';

  const params = await searchParams;

  // Cover thumbnail lookup from interview_sessions
  const ids = (projects || []).map((p) => p.id);
  let covers = new Map<string, string | null>();
  if (ids.length > 0) {
    const { data: sessions } = await supabase
      .from('interview_sessions')
      .select('project_id, front_cover_url')
      .in('project_id', ids);
    covers = new Map((sessions || []).map((s) => [s.project_id, s.front_cover_url]));
  }

  const projectsWithCovers = (projects || []).map((p) => ({
    ...p,
    cover_url: covers.get(p.id) || null,
  }));

  return (
    <PublishClient
      projects={projectsWithCovers}
      initialProjectId={params.project || projectsWithCovers[0]?.id || null}
      locale={locale}
    />
  );
}
