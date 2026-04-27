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

type ModuleRecord = {
  id: string;
  slug: string;
  title: string;
  subtitle: string | null;
  category: string;
  order_index: number;
  required_tier: string | null;
  estimated_minutes: number | null;
};

function tierRank(tier: string | null | undefined): number {
  if (!tier) return 0;
  const idx = TIER_ORDER.indexOf(tier as Tier);
  return idx === -1 ? 0 : idx;
}

function tierLabel(tier: string): string {
  return tier.charAt(0).toUpperCase() + tier.slice(1);
}

function formatMinutes(min: number): string {
  if (min < 60) return `${min} minutes`;
  const hours = Math.floor(min / 60);
  const remainder = min % 60;
  if (remainder === 0) return `${hours} hour${hours === 1 ? '' : 's'}`;
  return `${hours}h ${remainder}m`;
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

  // Load all published modules
  const { data: modulesRaw } = await admin
    .from('guild_academy_modules')
    .select('id, slug, title, subtitle, category, order_index, required_tier, estimated_minutes')
    .eq('published', true)
    .order('category', { ascending: true })
    .order('order_index', { ascending: true });

  const modules: ModuleRecord[] = (modulesRaw as ModuleRecord[]) || [];

  // Load completions for this member
  const { data: progress } = await admin
    .from('guild_academy_progress')
    .select('module_id, completed_at, quiz_score')
    .eq('guildmember_id', member.id);

  const completedIds = new Set((progress || []).map((p) => p.module_id));

  // Status view (authoritative counts where present)
  const { data: status } = await admin
    .from('v_guild_academy_status')
    .select('mandatory_completed, mandatory_total, electives_completed')
    .eq('guildmember_id', member.id)
    .maybeSingle();

  const mandatory = modules.filter((m) => m.category === 'mandatory');
  const electives = modules.filter((m) => m.category === 'elective');

  const mandatoryCompleted = Number(
    status?.mandatory_completed ?? mandatory.filter((m) => completedIds.has(m.id)).length,
  );
  const mandatoryTotal = Number(status?.mandatory_total ?? mandatory.length);
  const electiveCompleted = Number(
    status?.electives_completed ?? electives.filter((m) => completedIds.has(m.id)).length,
  );
  const electiveTotal = electives.length;

  const memberTierRank = tierRank(member.tier);
  const referralUnlocked = mandatoryTotal > 0 && mandatoryCompleted >= mandatoryTotal;

  const totalMandatoryMinutes = mandatory.reduce((s, m) => s + (m.estimated_minutes || 0), 0);
  const totalElectiveMinutes = electives.reduce((s, m) => s + (m.estimated_minutes || 0), 0);

  return (
    <div className="mx-auto max-w-5xl px-6 py-10">
      <NavBreadcrumbs />

      {/* Hero */}
      <div className="mt-6 mb-10">
        <div className="text-xs font-semibold uppercase tracking-widest text-[#d4af37]">
          The Academy
        </div>
        <h1 className="mt-2 font-serif text-4xl tracking-tight text-[#e7e2d4]">
          Learn the craft. Earn the link.
        </h1>
        <p className="mt-3 max-w-2xl text-sm leading-relaxed text-[#8a8370]">
          The Academy is the Guild&apos;s training program — short audio-led modules that teach
          you what Penworth is, how the seven agents work, how commission actually pays out, and
          how to represent the Guild well. Three mandatory modules unlock your referral link.
          Six electives unlock as you climb the tiers.
        </p>
      </div>

      {/* Explanatory section */}
      <section className="mb-10 rounded-2xl border border-[#1e2436] bg-[#0f1424] p-6">
        <h2 className="font-serif text-2xl tracking-tight text-[#e7e2d4]">What is the Academy?</h2>
        <p className="mt-3 text-sm leading-relaxed text-[#8a8370]">
          When you joined the Guild, you committed to representing Penworth — to your readers,
          your audience, and the writers you bring in. The Academy is how we make sure you can
          do that with confidence. It&apos;s not a course you grind through. It&apos;s the
          minimum knowledge a Guildmember needs to operate, plus deeper electives if you want
          to grow.
        </p>

        <div className="mt-6 grid gap-4 md:grid-cols-2">
          <FeatureBlock
            label="How it works"
            body="Each module is a self-contained audio lesson with checkpoints and a short quiz at the end. Listen once, pass the checkpoints, and your progress saves automatically. Pick it up wherever you left off."
          />
          <FeatureBlock
            label="Why it's gated"
            body="Your referral link doesn't activate until you finish the three mandatory modules. This protects you, the writers you refer, and the Guild's reputation. Nothing prevents doing all three in one sitting."
          />
          <FeatureBlock
            label="Time commitment"
            body={`About ${formatMinutes(totalMandatoryMinutes)} for all mandatory modules. Another ${formatMinutes(totalElectiveMinutes)} across the six electives. Most members finish mandatory in one evening.`}
          />
          <FeatureBlock
            label="Tier unlocks"
            body="Three electives are open from the day you join. The remaining electives unlock as you progress: the Artisan Playbook at Journeyman, Master Discipline at Artisan, the Fellow Path at Master. Anything you've already unlocked stays unlocked."
          />
        </div>

        {/* Referral status card */}
        <div
          className={`mt-6 flex items-start gap-4 rounded-xl border p-5 ${
            referralUnlocked
              ? 'border-[#d4af37]/40 bg-[#d4af37]/5'
              : 'border-[#2a3149] bg-[#0a0e1a]'
          }`}
        >
          <div
            className={`mt-0.5 flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full ${
              referralUnlocked ? 'bg-[#d4af37]' : 'border border-[#2a3149] bg-[#0f1424]'
            }`}
          >
            {referralUnlocked ? (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                <path
                  d="M5 13l4 4L19 7"
                  stroke="#0a0e1a"
                  strokeWidth="3"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            ) : (
              <span className="text-xs font-semibold text-[#d4af37]">
                {mandatoryCompleted}/{mandatoryTotal}
              </span>
            )}
          </div>
          <div className="min-w-0 flex-1">
            <div className="font-serif text-base text-[#e7e2d4]">
              {referralUnlocked
                ? 'Your referral link is active.'
                : 'Referral link unlocks after mandatory modules.'}
            </div>
            <p className="mt-1 text-sm leading-relaxed text-[#8a8370]">
              {referralUnlocked
                ? "You've completed all mandatory training. Your referral code appears on the dashboard."
                : `Finish ${Math.max(mandatoryTotal - mandatoryCompleted, 0)} more mandatory module${
                    mandatoryTotal - mandatoryCompleted === 1 ? '' : 's'
                  } and your unique referral link goes live automatically.`}
            </p>
          </div>
        </div>
      </section>

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
        <h2 className="mb-1 text-xs font-semibold uppercase tracking-widest text-[#d4af37]">
          Mandatory — unlocks your referral link
        </h2>
        <p className="mb-4 text-xs text-[#8a8370]">
          Complete all three to activate your referral code.
        </p>
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
        <h2 className="mb-1 text-xs font-semibold uppercase tracking-widest text-[#d4af37]">
          Electives
        </h2>
        <p className="mb-4 text-xs text-[#8a8370]">
          Optional deep-dives. New ones unlock as you climb tiers.
        </p>
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

function FeatureBlock({ label, body }: { label: string; body: string }) {
  return (
    <div className="rounded-xl border border-[#1e2436] bg-[#0a0e1a] p-4">
      <div className="text-xs font-semibold uppercase tracking-widest text-[#d4af37]">
        {label}
      </div>
      <p className="mt-2 text-sm leading-relaxed text-[#8a8370]">{body}</p>
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
  module: ModuleRecord;
  completed: boolean;
  locked: boolean;
  lockReason: string | null;
}) {
  const minutesLabel =
    module.estimated_minutes && module.estimated_minutes > 0
      ? `${module.estimated_minutes} min`
      : null;

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
          <div className="flex flex-shrink-0 items-center gap-2">
            {minutesLabel && !lockReason && !completed && (
              <span className="rounded-full border border-[#2a3149] px-3 py-0.5 text-xs text-[#8a8370]">
                {minutesLabel}
              </span>
            )}
            {lockReason && (
              <span className="rounded-full border border-[#2a3149] px-3 py-0.5 text-xs text-[#8a8370]">
                {lockReason}
              </span>
            )}
            {completed && !lockReason && (
              <span className="rounded-full bg-[#d4af37]/10 px-3 py-0.5 text-xs text-[#d4af37]">
                Complete
              </span>
            )}
          </div>
        </div>
        {module.subtitle && (
          <p className="mt-1 text-sm leading-relaxed text-[#8a8370]">{module.subtitle}</p>
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
