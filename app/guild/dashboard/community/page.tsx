import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';

export const dynamic = 'force-dynamic';
export const metadata = {
  title: 'Community',
};

const UNLOCK_THRESHOLD = 10; // active or probation Guildmembers

type Pillar = {
  label: string;
  title: string;
  body: string;
  status: 'live' | 'soon';
};

const PILLARS: Pillar[] = [
  {
    label: 'Directory',
    title: 'Member Directory',
    body: "Find other Guildmembers by tier, language, and how they reach their audience. Useful for cross-promotion, asking how someone solved a thing, and seeing who's around.",
    status: 'soon',
  },
  {
    label: 'Discussions',
    title: 'Threaded Discussions',
    body: 'Long-form questions, wins, and asks — not a chat firehose. Apprentice and Journeyman threads stay open; Artisan+ threads include private subforums for higher-tier strategy.',
    status: 'soon',
  },
  {
    label: 'Events',
    title: 'Calls & Town Halls',
    body: 'Monthly Founder town hall, Fellow office hours for any Guildmember, and tier-specific cohort calls (Apprentice onboarding, Journeyman intensive, Master discipline).',
    status: 'soon',
  },
  {
    label: 'Showcase',
    title: 'Referral Showcase',
    body: "A live wall of books published by writers your fellow Guildmembers brought into Penworth. Real-world proof of what the program produces. Filter by member, language, genre.",
    status: 'soon',
  },
  {
    label: 'Council',
    title: 'The Guild Council',
    body: 'Fellow-tier governance: termination appeal panels, tier advancement votes, and policy input on changes that affect Guildmembers. Visible to all Guildmembers; participation is Fellow-only.',
    status: 'soon',
  },
  {
    label: 'Guidelines',
    title: 'Community Guidelines',
    body: 'The living code of how we conduct ourselves: representing Penworth honestly, disclosing Guildmember status, respecting referred users, and the conduct that gets Guildmembers terminated. Already in force — read these now.',
    status: 'live',
  },
];

export default async function CommunityIndexPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/guild/login?redirect=/guild/dashboard/community');

  const admin = createServiceClient();

  const { data: member } = await admin
    .from('guild_members')
    .select('id, display_name, tier, status, joined_at')
    .eq('user_id', user.id)
    .maybeSingle();
  if (!member) redirect('/guild/dashboard');

  // Live progress toward unlock — count active + probation members
  const { count: activeMembers } = await admin
    .from('guild_members')
    .select('*', { count: 'exact', head: true })
    .in('status', ['active', 'probation']);

  const memberCount = activeMembers ?? 0;
  const remaining = Math.max(UNLOCK_THRESHOLD - memberCount, 0);
  const pct = Math.min(Math.round((memberCount / UNLOCK_THRESHOLD) * 100), 100);
  const unlocked = memberCount >= UNLOCK_THRESHOLD;

  return (
    <div className="mx-auto max-w-5xl px-6 py-10">
      <NavBreadcrumbs />

      {/* Hero */}
      <div className="mt-6 mb-10">
        <div className="text-xs font-semibold uppercase tracking-widest text-[#d4af37]">
          The Community
        </div>
        <h1 className="mt-2 font-serif text-4xl tracking-tight text-[#e7e2d4]">
          The Guild is more than a referral program.
        </h1>
        <p className="mt-3 max-w-2xl text-sm leading-relaxed text-[#8a8370]">
          Community is the peer layer — directory, discussions, events, showcase, and Council.
          It&apos;s how Guildmembers actually know each other, learn from each other, and govern
          together. We&apos;re building it deliberately, not from day one. Here&apos;s what it
          will be, and where we are right now.
        </p>
      </div>

      {/* Where we are right now */}
      <section className="mb-10 rounded-2xl border border-[#1e2436] bg-[#0f1424] p-6">
        <h2 className="font-serif text-2xl tracking-tight text-[#e7e2d4]">
          Why the Community isn&apos;t live yet
        </h2>
        <p className="mt-3 text-sm leading-relaxed text-[#8a8370]">
          A community of one is a chat with the Founder. A community of three is a group text. A
          real community needs enough Guildmembers that meeting someone new in here is normal.
          We&apos;re intentionally holding the launch until the Guild reaches{' '}
          <span className="text-[#e7e2d4]">{UNLOCK_THRESHOLD} active members</span> — that&apos;s
          the threshold where the directory has signal, threads get answered, and town halls feel
          like rooms instead of one-on-ones.
        </p>

        {/* Progress card */}
        <div
          className={`mt-6 rounded-xl border p-5 ${
            unlocked ? 'border-[#d4af37]/40 bg-[#d4af37]/5' : 'border-[#2a3149] bg-[#0a0e1a]'
          }`}
        >
          <div className="flex items-baseline justify-between">
            <div className="text-xs font-semibold uppercase tracking-widest text-[#d4af37]">
              Progress to launch
            </div>
            <div className="font-serif text-2xl tracking-tight text-[#e7e2d4]">
              {memberCount}
              <span className="text-sm text-[#8a8370]"> / {UNLOCK_THRESHOLD} members</span>
            </div>
          </div>
          <div className="mt-4 h-2 overflow-hidden rounded-full bg-[#1e2436]">
            <div
              className="h-full bg-gradient-to-r from-[#d4af37] to-[#e6c14a] transition-all"
              style={{ width: `${pct}%` }}
            />
          </div>
          <p className="mt-4 text-sm leading-relaxed text-[#8a8370]">
            {unlocked
              ? 'Threshold reached. Community features are unlocking now.'
              : `${remaining} more active member${remaining === 1 ? '' : 's'} needed. Every Guildmember you bring in shortens that timeline — your referrals count toward your commission, but Guild applications you encourage from people you trust count toward the Community unlocking for everyone.`}
          </p>
        </div>
      </section>

      {/* What Community will be — the six pillars */}
      <section className="mb-10">
        <div className="mb-1 text-xs font-semibold uppercase tracking-widest text-[#d4af37]">
          What Community will be
        </div>
        <h2 className="mb-2 font-serif text-2xl tracking-tight text-[#e7e2d4]">
          Six pillars, one space.
        </h2>
        <p className="mb-6 max-w-2xl text-sm leading-relaxed text-[#8a8370]">
          Each pillar ships when there&apos;s a real reason for it to exist. Guidelines are
          already live because the conduct standard applies from day one.
        </p>

        <div className="grid gap-4 md:grid-cols-2">
          {PILLARS.map((p) => (
            <PillarCard key={p.label} pillar={p} />
          ))}
        </div>
      </section>

      {/* Read the guidelines now */}
      <section className="mb-12 rounded-2xl border border-[#d4af37]/30 bg-[#d4af37]/5 p-6">
        <h2 className="font-serif text-2xl tracking-tight text-[#e7e2d4]">
          Read the Community Guidelines now.
        </h2>
        <p className="mt-3 max-w-2xl text-sm leading-relaxed text-[#8a8370]">
          The conduct standard is in force from the moment you joined the Guild — not when the
          forums turn on. Three documented violations in a 12-month window is grounds for
          termination, so it&apos;s worth knowing exactly what counts.
        </p>
        <Link
          href="/guild/terms#community-guidelines"
          className="mt-5 inline-flex items-center gap-2 rounded-lg border border-[#d4af37] bg-[#d4af37] px-5 py-2.5 text-sm font-semibold text-[#0a0e1a] transition hover:bg-[#e6c14a]"
        >
          Open the Guidelines
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
            <path
              d="M5 12h14M13 6l6 6-6 6"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </Link>
      </section>

      {/* What you can do today */}
      <section className="mb-4">
        <div className="mb-1 text-xs font-semibold uppercase tracking-widest text-[#d4af37]">
          While you wait
        </div>
        <h2 className="mb-2 font-serif text-2xl tracking-tight text-[#e7e2d4]">
          Three things that matter today.
        </h2>
        <div className="mt-6 grid gap-3 md:grid-cols-3">
          <ActionCard
            label="Finish the Academy"
            body="Complete the three mandatory modules so your referral link is live the day the Community opens."
            href="/guild/dashboard/academy"
            cta="Open Academy"
          />
          <ActionCard
            label="Refer thoughtfully"
            body="Each writer you bring in earns commission and pulls the unlock threshold closer for everyone."
            href="/guild/dashboard/referrals"
            cta="My Referrals"
          />
          <ActionCard
            label="Talk to Nora"
            body="Anything you'd ask a community of peers right now — strategy, scripts, scenarios — Nora has the same context as your future Council."
            href="#"
            cta="Open Nora widget"
            disabled
          />
        </div>
      </section>
    </div>
  );
}

function PillarCard({ pillar }: { pillar: Pillar }) {
  const isLive = pillar.status === 'live';
  return (
    <div
      className={`rounded-xl border p-5 ${
        isLive
          ? 'border-[#d4af37]/30 bg-[#d4af37]/5'
          : 'border-[#1e2436] bg-[#0f1424]'
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="text-xs font-semibold uppercase tracking-widest text-[#d4af37]">
          {pillar.label}
        </div>
        <span
          className={`flex-shrink-0 rounded-full px-3 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${
            isLive
              ? 'bg-[#d4af37]/20 text-[#d4af37]'
              : 'border border-[#2a3149] text-[#8a8370]'
          }`}
        >
          {isLive ? 'Live' : 'Coming soon'}
        </span>
      </div>
      <h3 className="mt-2 font-serif text-lg tracking-tight text-[#e7e2d4]">{pillar.title}</h3>
      <p className="mt-2 text-sm leading-relaxed text-[#8a8370]">{pillar.body}</p>
    </div>
  );
}

function ActionCard({
  label,
  body,
  href,
  cta,
  disabled,
}: {
  label: string;
  body: string;
  href: string;
  cta: string;
  disabled?: boolean;
}) {
  const inner = (
    <div
      className={`flex h-full flex-col rounded-xl border p-5 transition ${
        disabled
          ? 'border-[#1e2436] bg-[#0f1424] opacity-70'
          : 'border-[#1e2436] bg-[#0f1424] hover:border-[#2a3149]'
      }`}
    >
      <div className="text-xs font-semibold uppercase tracking-widest text-[#d4af37]">
        {label}
      </div>
      <p className="mt-2 flex-1 text-sm leading-relaxed text-[#8a8370]">{body}</p>
      <div className="mt-4 text-xs font-semibold text-[#d4af37]">
        {disabled ? 'Bottom-right of any page' : `${cta} →`}
      </div>
    </div>
  );

  if (disabled) return inner;

  return (
    <Link href={href} className="block h-full">
      {inner}
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
      <span className="text-[#e7e2d4]">Community</span>
    </nav>
  );
}
