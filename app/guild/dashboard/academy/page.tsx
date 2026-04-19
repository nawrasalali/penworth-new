import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';

export const dynamic = 'force-dynamic';
export const metadata = {
  title: 'Academy',
};

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

export default async function AcademyIndexPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/guild/login?redirect=/guild/dashboard/academy');

  const admin = createServiceClient();

  const { data: member } = await admin
    .from('guild_members')
    .select('*')
    .eq('user_id', user.id)
    .maybeSingle();
  if (!member) redirect('/guild/dashboard');

  // Load all modules
  const { data: modules } = await admin
    .from('guild_academy_modules')
    .select('id, slug, title, description, order_index, is_mandatory, required_tier')
    .order('is_mandatory', { ascending: false })
    .order('order_index', { ascending: true });

  // Load completions
  const { data: progress } = await admin
    .from('guild_academy_progress')
    .select('module_id, completed_at, quiz_score')
    .eq('guildmember_id', member.id);

  const completedIds = new Set((progress || []).map((p) => p.module_id));

  // Load status view (for accurate mandatory counts if present)
  const { data: status } = await admin
    .from('v_guild_academy_status')
    .select('*')
    .eq('guildmember_id', member.id)
    .maybeSingle();

  const mandatory = (modules || []).filter((m) => m.is_mandatory);
  const electives = (modules || []).filter((m) => !m.is_mandatory);

  const mandatoryCompleted =
    status?.mandatory_completed ?? mandatory.filter((m) => completedIds.has(m.id)).length;
  const mandatoryTotal = status?.mandatory_total ?? mandatory.length;
  const electiveCompleted =
    status?.elective_completed ?? electives.filter((m) => completedIds.has(m.id)).length;
  const electiveTotal = status?.elective_total ?? electives.length;

  const memberTierRank = tierRank(member.tier);

  return (
    <div className="mx-auto max-w-5xl px-6 py-10">
      <NavBreadcrumbs />

      <div className="mt-6 mb-10">
        <div className="text-xs font-semibold uppercase tracking-widest text-[#d4af37]">
          The Academy
        </div>
        <h1 className="mt-2 font-serif text-4xl tracking-tight">Learn the craft.</h1>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-[#8a8370]">
          Three mandatory modules unlock your referral link. Six electives unlock as you climb the
          tiers. Complete at your own pace — progress is saved.
        </p>
      </div>

      {/* Progress summary */}
      <div className="mb-8 grid gap-4 md:grid-cols-2">
        <ProgressCard
          label="Mandatory"
          completed={mandatoryCompleted}
          total={mandatoryTotal}
          accent
        />
        <ProgressCard label="Electives" completed={electiveCompleted} total={electiveTotal} />
      </div>

      {/* Mandatory modules */}
      <section className="mb-12">
        <h2 className="mb-4 text-xs font-semibold uppercase tracking-widest text-[#d4af37]">
          Mandatory — unlocks your referral link
        </h2>
        <div className="space-y-3">
          {mandatory.map((mod) => (
            <ModuleRow
              key={mod.id}
              module={mod}
              completed={completedIds.has(mod.id)}
              locked={false}
              lockReason={null}
            />
          ))}
        </div>
      </section>

      {/* Electives */}
      <section>
        <h2 className="mb-4 text-xs font-semibold uppercase tracking-widest text-[#d4af37]">
          Electives
        </h2>
        <div className="space-y-3">
          {electives.map((mod) => {
            const requiredRank = tierRank(mod.required_tier);
            const locked = requiredRank > memberTierRank;
            const lockReason = locked
              ? `Unlocks at ${tierLabel(mod.required_tier as string)}`
              : null;
            return (
              <ModuleRow
                key={mod.id}
                module={mod}
                completed={completedIds.has(mod.id)}
                locked={locked}
                lockReason={lockReason}
              />
            );
          })}
        </div>
      </section>
    </div>
  );
}

function ProgressCard({
  label,
  completed,
  total,
  accent,
}: {
  label: string;
  completed: number;
  total: number;
  accent?: boolean;
}) {
  const pct = total > 0 ? Math.round((completed / total) * 100) : 0;
  return (
    <div
      className={`rounded-xl border p-5 ${
        accent ? 'border-[#d4af37]/30 bg-[#d4af37]/5' : 'border-[#1e2436] bg-[#0f1424]'
      }`}
    >
      <div className="flex items-baseline justify-between">
        <div className="text-xs font-semibold uppercase tracking-widest text-[#d4af37]">
          {label}
        </div>
        <div className="font-serif text-2xl tracking-tight text-[#e7e2d4]">
          {completed}
          <span className="text-sm text-[#8a8370]"> / {total}</span>
        </div>
      </div>
      <div className="mt-4 h-2 overflow-hidden rounded-full bg-[#1e2436]">
        <div
          className="h-full bg-gradient-to-r from-[#d4af37] to-[#e6c14a] transition-all"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

function ModuleRow({
  module,
  completed,
  locked,
  lockReason,
}: {
  module: {
    id: string;
    slug: string;
    title: string;
    description: string | null;
    order_index: number;
    is_mandatory: boolean;
    required_tier: string | null;
  };
  completed: boolean;
  locked: boolean;
  lockReason: string | null;
}) {
  const content = (
    <div
      className={`flex items-start gap-4 rounded-xl border p-5 transition ${
        completed
          ? 'border-[#d4af37]/30 bg-[#d4af37]/5'
          : locked
            ? 'border-[#1e2436] bg-[#0f1424] opacity-60'
            : 'border-[#1e2436] bg-[#0f1424] hover:border-[#2a3149]'
      }`}
    >
      {/* Status icon */}
      <div
        className={`mt-1 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full border ${
          completed
            ? 'border-[#d4af37] bg-[#d4af37]'
            : locked
              ? 'border-[#2a3149] bg-[#0a0e1a]'
              : 'border-[#2a3149] bg-[#0a0e1a]'
        }`}
      >
        {completed ? (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
            <path
              d="M5 13l4 4L19 7"
              stroke="#0a0e1a"
              strokeWidth="3"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        ) : locked ? (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
            <path
              d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
              stroke="#8a8370"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        ) : (
          <span className="font-serif text-sm text-[#8a8370]">{module.order_index}</span>
        )}
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-3">
          <h3 className="font-serif text-lg tracking-tight text-[#e7e2d4]">{module.title}</h3>
          {lockReason && (
            <span className="flex-shrink-0 rounded-full border border-[#2a3149] px-3 py-0.5 text-xs text-[#8a8370]">
              {lockReason}
            </span>
          )}
          {completed && !lockReason && (
            <span className="flex-shrink-0 rounded-full bg-[#d4af37]/10 px-3 py-0.5 text-xs text-[#d4af37]">
              Complete
            </span>
          )}
        </div>
        {module.description && (
          <p className="mt-1 text-sm leading-relaxed text-[#8a8370]">{module.description}</p>
        )}
      </div>
    </div>
  );

  if (locked) {
    return <div>{content}</div>;
  }

  return (
    <Link href={`/guild/dashboard/academy/${module.slug}`} className="block">
      {content}
    </Link>
  );
}

function NavBreadcrumbs() {
  return (
    <nav className="text-xs text-[#8a8370]">
      <Link href="/guild/dashboard" className="hover:text-[#e7e2d4]">
        Dashboard
      </Link>
      <span className="mx-2">/</span>
      <span className="text-[#e7e2d4]">Academy</span>
    </nav>
  );
}
