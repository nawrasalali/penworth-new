import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { createClient, createAdminClient } from '@/lib/supabase/server';
import ModuleContent from './ModuleContent';

export const dynamic = 'force-dynamic';

const TIER_ORDER = ['apprentice', 'journeyman', 'artisan', 'master', 'fellow'] as const;
type Tier = (typeof TIER_ORDER)[number];

function tierRank(tier: string | null | undefined): number {
  if (!tier) return 0;
  const idx = TIER_ORDER.indexOf(tier as Tier);
  return idx === -1 ? 0 : idx;
}

function tierLabel(tier: string): string {
  return tier.charAt(0).toUpperCase() + tier.slice(1);
}

export async function generateMetadata({ params }: { params: { slug: string } }) {
  const admin = createAdminClient();
  const { data } = await admin
    .from('guild_academy_modules')
    .select('title')
    .eq('slug', params.slug)
    .maybeSingle();
  return { title: data?.title ?? 'Academy Module' };
}

export default async function AcademyModulePage({ params }: { params: { slug: string } }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(`/guild/login?redirect=/guild/dashboard/academy/${params.slug}`);

  const admin = createAdminClient();

  const { data: member } = await admin
    .from('guild_members')
    .select('*')
    .eq('user_id', user.id)
    .maybeSingle();
  if (!member) redirect('/guild/dashboard');

  const { data: module } = await admin
    .from('guild_academy_modules')
    .select(
      'id, slug, title, description, order_index, is_mandatory, required_tier, content_markdown, quiz',
    )
    .eq('slug', params.slug)
    .maybeSingle();

  if (!module) notFound();

  // Gate by tier if elective
  if (!module.is_mandatory && module.required_tier) {
    if (tierRank(member.tier) < tierRank(module.required_tier)) {
      return <LockedView requiredTier={module.required_tier} memberTier={member.tier} />;
    }
  }

  const { data: existingProgress } = await admin
    .from('guild_academy_progress')
    .select('completed_at, quiz_score')
    .eq('guildmember_id', member.id)
    .eq('module_id', module.id)
    .maybeSingle();

  const alreadyCompleted = !!existingProgress?.completed_at;

  return (
    <div className="mx-auto max-w-3xl px-6 py-10">
      <NavBreadcrumbs title={module.title} />

      <div className="mt-6 mb-8">
        <div className="flex items-center gap-3">
          <span className="text-xs font-semibold uppercase tracking-widest text-[#d4af37]">
            {module.is_mandatory ? 'Mandatory' : 'Elective'} · Module {module.order_index}
          </span>
          {alreadyCompleted && (
            <span className="rounded-full bg-[#d4af37]/10 px-3 py-0.5 text-xs text-[#d4af37]">
              Complete
            </span>
          )}
        </div>
        <h1 className="mt-3 font-serif text-4xl leading-tight tracking-tight">{module.title}</h1>
        {module.description && (
          <p className="mt-3 text-base leading-relaxed text-[#c9c2b0]">{module.description}</p>
        )}
      </div>

      <ModuleContent
        moduleId={module.id}
        moduleSlug={module.slug}
        contentMarkdown={module.content_markdown || ''}
        quiz={module.quiz ?? null}
        alreadyCompleted={alreadyCompleted}
      />
    </div>
  );
}

function NavBreadcrumbs({ title }: { title: string }) {
  return (
    <nav className="text-xs text-[#8a8370]">
      <Link href="/guild/dashboard" className="hover:text-[#e7e2d4]">
        Dashboard
      </Link>
      <span className="mx-2">/</span>
      <Link href="/guild/dashboard/academy" className="hover:text-[#e7e2d4]">
        Academy
      </Link>
      <span className="mx-2">/</span>
      <span className="text-[#e7e2d4]">{title}</span>
    </nav>
  );
}

function LockedView({ requiredTier, memberTier }: { requiredTier: string; memberTier: string }) {
  return (
    <div className="mx-auto max-w-2xl px-6 py-24 text-center">
      <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-full border border-[#2a3149] bg-[#0f1424]">
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none">
          <path
            d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
            stroke="#8a8370"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </div>
      <h1 className="font-serif text-3xl tracking-tight">This module is locked.</h1>
      <p className="mx-auto mt-6 max-w-md text-sm leading-relaxed text-[#c9c2b0]">
        It unlocks when you reach <strong className="text-[#d4af37]">{tierLabel(requiredTier)}</strong>.
        You&apos;re currently <strong className="text-[#e7e2d4]">{tierLabel(memberTier)}</strong>.
      </p>
      <Link
        href="/guild/dashboard/academy"
        className="mt-10 inline-flex items-center gap-2 rounded-md border border-[#2a3149] bg-[#141a2a] px-6 py-3 text-sm text-[#e7e2d4] hover:border-[#3a4259]"
      >
        ← Back to Academy
      </Link>
    </div>
  );
}
