import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';
import { extractSegments, parseSrt, type SegmentInfo, type SrtCue } from '@/lib/academy/segments';
import ModuleContent, { type AttemptHistoryClient } from './ModuleContent';

export const dynamic = 'force-dynamic';

const TIER_ORDER = ['apprentice', 'journeyman', 'artisan', 'master', 'fellow'] as const;
type Tier = (typeof TIER_ORDER)[number];
const STORAGE_BUCKET = 'guild-academy';
const SIGNED_URL_TTL = 60 * 60 * 4; // 4 hours per page session

function tierRank(tier: string | null | undefined): number {
  if (!tier) return 0;
  const idx = TIER_ORDER.indexOf(tier as Tier);
  return idx === -1 ? 0 : idx;
}

function tierLabel(tier: string): string {
  return tier.charAt(0).toUpperCase() + tier.slice(1);
}

export async function generateMetadata(props: { params: Promise<{ slug: string }> }) {
  const params = await props.params;
  const admin = createServiceClient();
  const { data } = await admin
    .from('guild_academy_modules')
    .select('title')
    .eq('slug', params.slug)
    .maybeSingle();
  return { title: data?.title ?? 'Academy Module' };
}

export interface SegmentClientPayload extends SegmentInfo {
  audioUrl: string | null;
  srtCues: SrtCue[] | null;
}

export interface CheckpointClientPayload {
  key: 'cp-a' | 'cp-b';
  afterSegment: number;
  letter: 'A' | 'B';
  promptAudioUrl: string | null;
  wrongAudioUrl: string | null;
}

export default async function AcademyModulePage(props: { params: Promise<{ slug: string }> }) {
  const params = await props.params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect(`/guild/login?redirect=/guild/dashboard/academy/${params.slug}`);

  const admin = createServiceClient();

  const { data: member } = await admin
    .from('guild_members')
    .select('id, tier, status, display_name, referral_code, academy_completed_at')
    .eq('user_id', user.id)
    .maybeSingle();
  if (!member) redirect('/guild/dashboard');

  const { data: module } = await admin
    .from('guild_academy_modules')
    .select('id, slug, title, subtitle, category, order_index, required_tier, content_markdown, quiz, estimated_minutes')
    .eq('slug', params.slug)
    .maybeSingle();

  if (!module) notFound();

  const isMandatory = module.category === 'mandatory';

  if (!isMandatory && module.required_tier) {
    if (tierRank(member.tier) < tierRank(module.required_tier)) {
      return <LockedView requiredTier={module.required_tier} memberTier={member.tier} />;
    }
  }

  const { data: progress } = await admin
    .from('guild_academy_progress')
    .select('completed_at, quiz_score, quiz_passed, quiz_attempts, quiz_attempts_locked_until, attempt_history')
    .eq('guildmember_id', member.id)
    .eq('module_id', module.id)
    .maybeSingle();

  const alreadyCompleted = !!progress?.completed_at;
  const segments = extractSegments(module.content_markdown ?? '');

  const segmentPayloads: SegmentClientPayload[] = await Promise.all(
    segments.map(async (seg) => {
      const audioPath = `audio/${module.slug}/${seg.key}.mp3`;
      const srtPath = `audio/${module.slug}/${seg.key}.srt`;
      const [audioUrl, srtCues] = await Promise.all([
        signUrl(admin, audioPath),
        loadSrt(admin, srtPath),
      ]);
      return { ...seg, audioUrl, srtCues };
    }),
  );

  const checkpointPayloads: CheckpointClientPayload[] = await Promise.all(
    (['cp-a', 'cp-b'] as const).map(async (cp) => {
      const after = cp === 'cp-a' ? 3 : 5;
      const letter = (cp === 'cp-a' ? 'A' : 'B') as 'A' | 'B';
      const [promptAudioUrl, wrongAudioUrl] = await Promise.all([
        signUrl(admin, `audio/${module.slug}/${cp}-prompt.mp3`),
        signUrl(admin, `audio/${module.slug}/${cp}-wrong.mp3`),
      ]);
      return { key: cp, afterSegment: after, letter, promptAudioUrl, wrongAudioUrl };
    }),
  );

  return (
    <div className="mx-auto max-w-5xl px-4 sm:px-6 py-8">
      <NavBreadcrumbs title={module.title} />

      <div className="mt-6 mb-8">
        <div className="flex items-center gap-3 flex-wrap">
          <span className="text-xs font-semibold uppercase tracking-widest text-[#d4af37]">
            {isMandatory ? 'Mandatory' : 'Elective'} · Module {module.order_index}
          </span>
          {alreadyCompleted && (
            <span className="rounded-full bg-[#d4af37]/10 px-3 py-0.5 text-xs text-[#d4af37]">
              Complete
            </span>
          )}
          <span className="text-xs text-[#8a8370]">~{module.estimated_minutes ?? 60} min</span>
        </div>
        <h1 className="mt-3 font-serif text-3xl sm:text-4xl leading-tight tracking-tight">{module.title}</h1>
        {module.subtitle && (
          <p className="mt-3 text-base leading-relaxed text-[#c9c2b0]">{module.subtitle}</p>
        )}
      </div>

      <ModuleContent
        moduleId={module.id}
        moduleSlug={module.slug}
        moduleTitle={module.title}
        category={module.category}
        segments={segmentPayloads}
        checkpoints={checkpointPayloads}
        quiz={module.quiz}
        progress={{
          alreadyCompleted,
          quizPassed: !!progress?.quiz_passed,
          quizScore: progress?.quiz_score ?? null,
          quizAttempts: progress?.quiz_attempts ?? 0,
          quizAttemptsLockedUntil: progress?.quiz_attempts_locked_until ?? null,
          attemptHistory: (progress?.attempt_history as AttemptHistoryClient[] | undefined) ?? [],
        }}
        memberDisplayName={member.display_name ?? 'Guildmember'}
        academyAlreadyComplete={!!member.academy_completed_at}
      />
    </div>
  );
}

async function signUrl(admin: ReturnType<typeof createServiceClient>, path: string): Promise<string | null> {
  try {
    const { data } = await admin.storage.from(STORAGE_BUCKET).createSignedUrl(path, SIGNED_URL_TTL);
    return data?.signedUrl ?? null;
  } catch {
    return null;
  }
}

async function loadSrt(admin: ReturnType<typeof createServiceClient>, path: string): Promise<SrtCue[] | null> {
  try {
    const { data } = await admin.storage.from(STORAGE_BUCKET).download(path);
    if (!data) return null;
    const text = await data.text();
    return parseSrt(text);
  } catch {
    return null;
  }
}

function NavBreadcrumbs({ title }: { title: string }) {
  return (
    <nav className="text-xs text-[#8a8370]">
      <Link href="/guild/dashboard" className="hover:text-[#e7e2d4]">Dashboard</Link>
      <span className="mx-2">/</span>
      <Link href="/guild/dashboard/academy" className="hover:text-[#e7e2d4]">Academy</Link>
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
          <path d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" stroke="#8a8370" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      </div>
      <h1 className="font-serif text-3xl tracking-tight">This module is locked.</h1>
      <p className="mx-auto mt-6 max-w-md text-sm leading-relaxed text-[#c9c2b0]">
        It unlocks when you reach <strong className="text-[#d4af37]">{tierLabel(requiredTier)}</strong>. You&apos;re currently <strong className="text-[#e7e2d4]">{tierLabel(memberTier)}</strong>.
      </p>
      <Link href="/guild/dashboard/academy" className="mt-10 inline-flex items-center gap-2 rounded-md border border-[#2a3149] bg-[#141a2a] px-6 py-3 text-sm text-[#e7e2d4] hover:border-[#3a4259]">
        ← Back to Academy
      </Link>
    </div>
  );
}
