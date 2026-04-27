import Link from 'next/link';

export const metadata = {
  title: 'The Community — More than a Referral Program',
  description:
    "The peer layer of the Penworth Guild: member directory, threaded discussions, town halls, referral showcase, the Guild Council, and the conduct standard that's in force from day one.",
};

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
    body: "Find other Guildmembers by tier, language, and how they reach their audience. Useful for cross-promotion, asking how someone solved something, and seeing who's around.",
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
    body: 'A live wall of books published by writers your fellow Guildmembers brought into Penworth. Real proof of what the program produces. Filter by member, language, genre.',
    status: 'soon',
  },
  {
    label: 'Council',
    title: 'The Guild Council',
    body: 'Fellow-tier governance: termination appeal panels, tier advancement votes, and policy input on changes that affect Guildmembers. Visible to all; participation is Fellow-only.',
    status: 'soon',
  },
  {
    label: 'Guidelines',
    title: 'Community Guidelines',
    body: 'The living code of how Guildmembers conduct themselves. In force from the day you join — not when the forums turn on.',
    status: 'live',
  },
];

export default async function CommunityMarketingPage() {
  return (
    <div className="mx-auto max-w-5xl px-6 py-16">
      {/* Hero */}
      <div className="mb-12 text-center">
        <div className="text-xs font-semibold uppercase tracking-widest text-[#d4af37]">
          The Community
        </div>
        <h1 className="mt-4 font-serif text-5xl tracking-tight text-[#e7e2d4] md:text-6xl">
          The Guild is more than a referral program.
        </h1>
        <p className="mx-auto mt-5 max-w-2xl text-base leading-relaxed text-[#8a8370]">
          Community is the peer layer — the part that turns a referral program into a craft
          guild. Directory. Discussions. Events. Showcase. Council. Conduct. We&apos;re
          building it deliberately, not from day one. Here&apos;s what it will be, and where
          we are right now.
        </p>

        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          <Link
            href="/guild/apply"
            className="rounded-lg border border-[#d4af37] bg-[#d4af37] px-6 py-3 text-sm font-semibold text-[#0a0e1a] transition hover:bg-[#e6c14a]"
          >
            Apply to the Guild
          </Link>
          <Link
            href="/guild/login"
            className="rounded-lg border border-[#2a3149] bg-transparent px-6 py-3 text-sm font-semibold text-[#e7e2d4] transition hover:border-[#d4af37]"
          >
            Member sign in
          </Link>
        </div>
      </div>

      {/* Why not yet */}
      <section className="mb-14 rounded-2xl border border-[#1e2436] bg-[#0f1424] p-8">
        <div className="text-xs font-semibold uppercase tracking-widest text-[#d4af37]">
          The honest answer
        </div>
        <h2 className="mt-2 font-serif text-3xl tracking-tight text-[#e7e2d4]">
          Why the Community isn&apos;t live yet.
        </h2>
        <p className="mt-4 max-w-3xl text-sm leading-relaxed text-[#8a8370]">
          A community of one is a chat with the Founder. A community of three is a group
          text. A real community needs enough Guildmembers that meeting someone new in here
          is normal, that threads get answered without us prompting them, and that town halls
          feel like rooms instead of one-on-ones. We&apos;re intentionally holding the launch
          until the Guild is large enough for that to be true. The pillars below are what
          goes live when it is.
        </p>
      </section>

      {/* The six pillars */}
      <section className="mb-14">
        <div className="mb-1 text-xs font-semibold uppercase tracking-widest text-[#d4af37]">
          What Community will be
        </div>
        <h2 className="mb-2 font-serif text-3xl tracking-tight text-[#e7e2d4]">
          Six pillars, one space.
        </h2>
        <p className="mb-8 max-w-2xl text-sm leading-relaxed text-[#8a8370]">
          Each pillar ships when there&apos;s a real reason for it to exist. Guidelines are
          already live because the conduct standard applies from the day a Guildmember joins.
        </p>

        <div className="grid gap-4 md:grid-cols-2">
          {PILLARS.map((p) => (
            <PillarCard key={p.label} pillar={p} />
          ))}
        </div>
      </section>

      {/* Conduct standard */}
      <section className="mb-14 rounded-2xl border border-[#d4af37]/30 bg-[#d4af37]/5 p-8">
        <div className="text-xs font-semibold uppercase tracking-widest text-[#d4af37]">
          Already in force
        </div>
        <h2 className="mt-2 font-serif text-3xl tracking-tight text-[#e7e2d4]">
          The Community Guidelines.
        </h2>
        <p className="mt-4 max-w-3xl text-sm leading-relaxed text-[#8a8370]">
          The conduct standard is in force from the moment a Guildmember joins — not when the
          forums turn on. Six commitments: represent Penworth honestly, disclose
          Guildmember status when recommending, no spam or unsolicited bulk outreach, respect
          the privacy of referred users, use only approved brand marks, and never impersonate
          Penworth staff or Guild Council. Three documented violations in 12 months is
          grounds for termination.
        </p>
        <Link
          href="/guild/terms#community-guidelines"
          className="mt-5 inline-flex items-center gap-2 rounded-lg border border-[#d4af37] bg-[#d4af37] px-5 py-2.5 text-sm font-semibold text-[#0a0e1a] transition hover:bg-[#e6c14a]"
        >
          Read the full Guidelines
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

      {/* Closing CTA */}
      <section className="rounded-2xl border border-[#1e2436] bg-[#0f1424] p-8 text-center">
        <h2 className="font-serif text-3xl tracking-tight text-[#e7e2d4]">
          The Community grows one Guildmember at a time.
        </h2>
        <p className="mx-auto mt-3 max-w-2xl text-sm leading-relaxed text-[#8a8370]">
          Every Guildmember is admitted through application and voice interview. There&apos;s
          no shortcut — and that&apos;s the point. When the Community opens, you&apos;ll be in
          a room with people who chose to be there with intent.
        </p>
        <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
          <Link
            href="/guild/apply"
            className="rounded-lg border border-[#d4af37] bg-[#d4af37] px-6 py-3 text-sm font-semibold text-[#0a0e1a] transition hover:bg-[#e6c14a]"
          >
            Start your application
          </Link>
          <Link
            href="/guild/ladder"
            className="rounded-lg border border-[#2a3149] bg-transparent px-6 py-3 text-sm font-semibold text-[#e7e2d4] transition hover:border-[#d4af37]"
          >
            See the five tiers
          </Link>
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
        isLive ? 'border-[#d4af37]/30 bg-[#d4af37]/5' : 'border-[#1e2436] bg-[#0f1424]'
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
