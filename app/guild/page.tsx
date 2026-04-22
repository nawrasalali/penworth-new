import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';

export default async function GuildLandingPage() {
  // If the viewer is an authenticated user who's already a guild member
  // (or an admin), skip the marketing landing entirely and send them to
  // their dashboard. Otherwise, show the public apply-to-join page.
  //
  // This page is reached via the guild.penworth.ai subdomain rewrite
  // (see middleware.ts). The rewrite shares auth cookies on the parent
  // penworth.ai domain, so createClient() here sees the same session
  // the user has on new.penworth.ai.
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (user) {
    // Admins always go straight to the dashboard
    const { data: profile } = await supabase
      .from('profiles')
      .select('is_admin')
      .eq('id', user.id)
      .single();

    if (profile?.is_admin) {
      redirect('/guild/dashboard');
    }

    // Existing guild members — any status — also bypass the landing.
    // A returning member who clicks 'Guild' in the main app sidebar
    // should land on their dashboard, not be asked to apply again.
    const { data: member } = await supabase
      .from('guild_members')
      .select('user_id, status')
      .eq('user_id', user.id)
      .maybeSingle();

    if (member) {
      redirect('/guild/dashboard');
    }
  }

  return (
    <>
      <HeroSection />
      <TrustStripSection />
      <WhatSection />
      <LadderPreviewSection />
      <AgentsPreviewSection />
      <EconomicsSection />
      <ProcessSection />
      <EcosystemCrossLinkSection />
      <FinalCTASection />
    </>
  );
}

function HeroSection() {
  return (
    <section className="relative overflow-hidden border-b border-[#1e2436]">
      {/* ambient gradient */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top,_rgba(212,175,55,0.08),_transparent_60%)]"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute left-1/2 top-0 h-px w-2/3 -translate-x-1/2 bg-gradient-to-r from-transparent via-[#d4af37] to-transparent opacity-40"
      />

      <div className="relative mx-auto max-w-5xl px-6 pb-28 pt-24 text-center md:pt-36">
        <div className="mb-8 inline-flex items-center gap-3 rounded-full border border-[#d4af37]/30 bg-[#d4af37]/5 px-4 py-1.5 text-xs font-medium uppercase tracking-widest text-[#d4af37]">
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#d4af37] opacity-75" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-[#d4af37]" />
          </span>
          Applications open globally
        </div>

        <h1 className="font-serif text-5xl leading-[1.05] tracking-tight md:text-7xl">
          A craft. A career.{' '}
          <span className="italic text-[#d4af37]">A share of every book you help find its reader.</span>
        </h1>

        <p className="mx-auto mt-8 max-w-2xl text-lg leading-relaxed text-[#c9c2b0] md:text-xl">
          Some people were born to place a book in the right hand at the right moment. If that has
          always been you — at dinner tables, in messages to friends, in the comments of a book you
          loved — the Penworth Guild is where that instinct becomes a career. Bring a writer whose
          book has been waiting. Lead a reader to the book that will move them. Earn — honestly,
          transparently, for twelve months — every time you do.
        </p>

        <div className="mt-12 flex flex-col items-center justify-center gap-4 sm:flex-row">
          <Link
            href="/guild/apply"
            className="group inline-flex items-center gap-3 rounded-md bg-[#d4af37] px-8 py-4 text-base font-medium text-[#0a0e1a] transition hover:bg-[#e6c14a]"
          >
            Apply to the Guild
            <span className="transition group-hover:translate-x-1">→</span>
          </Link>
          <Link
            href="/guild/ladder"
            className="inline-flex items-center gap-2 rounded-md border border-[#2a3149] bg-[#141a2a] px-8 py-4 text-base font-medium text-[#e7e2d4] transition hover:border-[#3a4259]"
          >
            See the five tiers
          </Link>
        </div>

        <p className="mt-8 text-sm text-[#6b6452]">
          Free to apply · Open to applicants in every country · Ten-minute voice interview, by appointment
        </p>
      </div>
    </section>
  );
}

function TrustStripSection() {
  const stats = [
    { value: '20–40%', label: 'Commission per referral' },
    { value: '12 months', label: 'Earnings per referral' },
    { value: '5 tiers', label: 'Apprentice to Fellow' },
    { value: '10 langs', label: 'Native interview & support' },
  ];
  return (
    <section className="border-b border-[#1e2436] bg-[#070a12]">
      <div className="mx-auto grid max-w-6xl grid-cols-2 gap-8 px-6 py-14 md:grid-cols-4">
        {stats.map((s) => (
          <div key={s.label} className="text-center md:text-left">
            <div className="font-serif text-4xl tracking-tight text-[#d4af37]">{s.value}</div>
            <div className="mt-2 text-xs uppercase tracking-widest text-[#8a8370]">{s.label}</div>
          </div>
        ))}
      </div>
    </section>
  );
}

function WhatSection() {
  return (
    <section className="mx-auto max-w-5xl px-6 py-28">
      <div className="mb-4 text-xs font-semibold uppercase tracking-widest text-[#d4af37]">
        What the Guild is
      </div>
      <h2 className="font-serif text-4xl leading-tight tracking-tight md:text-5xl">
        Not an affiliate scheme.{' '}
        <span className="italic text-[#d4af37]">A craftsperson&apos;s guild for the literary age.</span>
      </h2>
      <div className="mt-12 grid gap-10 md:grid-cols-2">
        <div>
          <p className="text-lg leading-relaxed text-[#c9c2b0]">
            An affiliate posts a link and waits. A Guildmember has training, a ladder, a code of
            conduct, and a reputation. The voice interview. The Academy. Five tiers from
            Apprentice to Fellow. A retreat for the Masters.
          </p>
          <p className="mt-6 text-lg leading-relaxed text-[#c9c2b0]">
            A certified badge that means something, and that we will defend. You find the writer
            who has been holding a book inside them — and you find the reader who has been waiting
            for exactly that book. Two hats. One craft. One career.
          </p>
        </div>
        <div className="rounded-xl border border-[#1e2436] bg-[#0f1424] p-8">
          <div className="text-xs font-semibold uppercase tracking-widest text-[#d4af37]">
            How it&apos;s different
          </div>
          <ul className="mt-6 space-y-5 text-sm text-[#c9c2b0]">
            <DifferItem>
              <strong className="text-[#e7e2d4]">Not MLM.</strong> Flat commission on first-tier
              referrals only. No pyramid, no overrides, no downline.
            </DifferItem>
            <DifferItem>
              <strong className="text-[#e7e2d4]">Not an affiliate scheme.</strong> Real education,
              real mentorship, real tier progression that you can show on your LinkedIn.
            </DifferItem>
            <DifferItem>
              <strong className="text-[#e7e2d4]">Not a job.</strong> Work when you want. The ladder
              is there when you&apos;re ready to climb it.
            </DifferItem>
            <DifferItem>
              <strong className="text-[#e7e2d4]">Not closed.</strong> Free to apply. The gate is
              seriousness of intent, not your existing audience size.
            </DifferItem>
          </ul>
        </div>
      </div>
    </section>
  );
}

function DifferItem({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex gap-4">
      <span className="mt-1.5 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-[#d4af37]" />
      <span className="leading-relaxed">{children}</span>
    </li>
  );
}

function LadderPreviewSection() {
  const tiers = [
    { name: 'Apprentice', rate: '20%', threshold: 'Entry tier on acceptance', color: '#a8a295' },
    { name: 'Journeyman', rate: '25%', threshold: '5 retained referrals', color: '#c4a57a' },
    { name: 'Artisan', rate: '30%', threshold: '25 retained + 70% retention', color: '#d4af37' },
    { name: 'Master', rate: '35%', threshold: '100 retained + 75% retention', color: '#e6c14a' },
    { name: 'Fellow', rate: '40%', threshold: '500 retained + Council vote', color: '#f2d36e' },
  ];
  return (
    <section className="border-y border-[#1e2436] bg-[#070a12]">
      <div className="mx-auto max-w-6xl px-6 py-28">
        <div className="mb-4 text-center text-xs font-semibold uppercase tracking-widest text-[#d4af37]">
          The Ladder
        </div>
        <h2 className="text-center font-serif text-4xl leading-tight tracking-tight md:text-5xl">
          Five tiers. <span className="italic text-[#d4af37]">A career, not a side hustle.</span>
        </h2>
        <p className="mx-auto mt-6 max-w-2xl text-center text-lg leading-relaxed text-[#c9c2b0]">
          Every tier has a promotion criterion, a commission rate, and a benefits package that
          unlocks new tools and recognition. Your tier is public on your profile.
        </p>

        <div className="mt-16 space-y-4">
          {tiers.map((tier, i) => (
            <div
              key={tier.name}
              className="group grid items-center gap-4 rounded-lg border border-[#1e2436] bg-[#0f1424] p-6 transition hover:border-[#2a3149] md:grid-cols-[auto_1fr_auto_auto] md:gap-8"
            >
              <div className="flex items-center gap-4">
                <div
                  className="flex h-12 w-12 items-center justify-center rounded-full font-serif text-lg font-semibold"
                  style={{
                    background: `linear-gradient(135deg, ${tier.color}30, ${tier.color}10)`,
                    color: tier.color,
                    border: `1px solid ${tier.color}50`,
                  }}
                >
                  {i + 1}
                </div>
                <div className="font-serif text-xl tracking-tight">{tier.name}</div>
              </div>
              <div className="text-sm text-[#8a8370] md:text-base">{tier.threshold}</div>
              <div className="text-right md:text-left">
                <div
                  className="font-serif text-3xl tracking-tight"
                  style={{ color: tier.color }}
                >
                  {tier.rate}
                </div>
                <div className="text-xs uppercase tracking-widest text-[#6b6452]">commission</div>
              </div>
              <div className="hidden text-xs uppercase tracking-widest text-[#6b6452] md:block">
                12-month window
              </div>
            </div>
          ))}
        </div>

        <div className="mt-12 text-center">
          <Link
            href="/guild/ladder"
            className="inline-flex items-center gap-2 text-sm font-medium text-[#d4af37] hover:text-[#e6c14a]"
          >
            Full ladder details & benefits per tier →
          </Link>
        </div>
      </div>
    </section>
  );
}

function AgentsPreviewSection() {
  const agents = [
    { name: 'Scout', role: 'Audits your audience' },
    { name: 'Coach', role: 'Builds your growth plan' },
    { name: 'Creator', role: 'Drafts your content' },
    { name: 'Mentor', role: 'Weekly accountability' },
    { name: 'Analyst', role: 'Tracks what works' },
    { name: 'Strategist', role: 'Plans your campaigns' },
    { name: 'Advisor', role: 'Answers any question' },
  ];
  return (
    <section className="mx-auto max-w-6xl px-6 py-28">
      <div className="mb-4 text-xs font-semibold uppercase tracking-widest text-[#d4af37]">
        Your AI support team
      </div>
      <h2 className="font-serif text-4xl leading-tight tracking-tight md:text-5xl">
        Seven agents. <span className="italic text-[#d4af37]">One for every job you shouldn&apos;t have to do alone.</span>
      </h2>
      <p className="mt-8 max-w-3xl text-lg leading-relaxed text-[#c9c2b0]">
        No other partner program gives every member a full AI team from day one. Yours works in your
        language, learns your voice, and grows in capability as you climb the ladder.
      </p>

      <div className="mt-16 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {agents.map((agent, i) => (
          <div
            key={agent.name}
            className="group rounded-xl border border-[#1e2436] bg-[#0f1424] p-6 transition hover:border-[#d4af37]/40"
          >
            <div className="mb-4 flex items-center justify-between">
              <div className="text-xs uppercase tracking-widest text-[#6b6452]">
                Agent {String(i + 1).padStart(2, '0')}
              </div>
              <div className="h-2 w-2 rounded-full bg-[#d4af37]/40 group-hover:bg-[#d4af37]" />
            </div>
            <div className="font-serif text-2xl tracking-tight text-[#e7e2d4]">{agent.name}</div>
            <div className="mt-2 text-sm text-[#8a8370]">{agent.role}</div>
          </div>
        ))}
      </div>
    </section>
  );
}

function EconomicsSection() {
  return (
    <section className="border-y border-[#1e2436] bg-[#070a12]">
      <div className="mx-auto grid max-w-6xl gap-16 px-6 py-28 md:grid-cols-[1fr_1fr]">
        <div>
          <div className="mb-4 text-xs font-semibold uppercase tracking-widest text-[#d4af37]">
            The Economics
          </div>
          <h2 className="font-serif text-4xl leading-tight tracking-tight md:text-5xl">
            Transparent. <span className="italic text-[#d4af37]">Monthly.</span> Paid without friction.
          </h2>
          <div className="mt-10 space-y-8 text-base leading-relaxed text-[#c9c2b0]">
            <div>
              <div className="mb-2 font-serif text-xl text-[#e7e2d4]">Commission on every renewal</div>
              <p>
                When someone subscribes to Penworth through your link, you earn a percentage of
                their monthly subscription — for 12 consecutive months. Every month, automatically.
              </p>
            </div>
            <div>
              <div className="mb-2 font-serif text-xl text-[#e7e2d4]">Paid the last day of each month</div>
              <p>
                Adelaide time, midnight. Via Wise bank transfer or USDT stablecoin — your choice.
                $50 minimum payout, or it rolls to next month. No platform fees.
              </p>
            </div>
            <div>
              <div className="mb-2 font-serif text-xl text-[#e7e2d4]">Your rate locks at referral time</div>
              <p>
                If you refer someone as an Apprentice, you earn 20% on them for the full 12 months.
                When you&apos;re promoted, your new rate applies to every referral from that moment
                forward.
              </p>
            </div>
          </div>
        </div>

        <div className="rounded-2xl border border-[#d4af37]/20 bg-gradient-to-br from-[#0f1424] to-[#0a0e1a] p-8 md:p-10">
          <div className="text-xs font-semibold uppercase tracking-widest text-[#d4af37]">
            Earnings calculator
          </div>
          <div className="mt-4 font-serif text-2xl leading-tight tracking-tight text-[#e7e2d4]">
            What a Journeyman earns at 25%, with 10 active retained referrals on Pro ($19/mo):
          </div>
          <div className="mt-8 space-y-3">
            <CalcRow label="Per referral, per month" value="$4.75" />
            <CalcRow label="10 active referrals, per month" value="$47.50" />
            <CalcRow label="10 active referrals × 12 months" value="$570.00" highlight />
          </div>
          <div className="mt-8 rounded-md bg-[#0a0e1a] p-5 text-sm leading-relaxed text-[#8a8370]">
            At Master tier (35% on Max subscribers at $49/mo) with 100 active referrals, that
            becomes <span className="font-semibold text-[#d4af37]">$1,715/month</span>, or{' '}
            <span className="font-semibold text-[#d4af37]">$20,580/year</span>.
          </div>
        </div>
      </div>
    </section>
  );
}

function CalcRow({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div
      className={`flex items-center justify-between rounded-md px-4 py-3 ${
        highlight ? 'border border-[#d4af37]/30 bg-[#d4af37]/5' : 'bg-[#0a0e1a]'
      }`}
    >
      <span className={`text-sm ${highlight ? 'text-[#e7e2d4]' : 'text-[#c9c2b0]'}`}>{label}</span>
      <span
        className={`font-serif text-xl tracking-tight ${highlight ? 'text-[#d4af37]' : 'text-[#e7e2d4]'}`}
      >
        {value}
      </span>
    </div>
  );
}

function ProcessSection() {
  const steps = [
    {
      n: '01',
      title: 'Apply',
      body: 'A 5-minute form. Free. No fees, no commitments. We need your name, your country, one link to something you&apos;ve made public online (optional but recommended), and a few sentences about why you want to join.',
    },
    {
      n: '02',
      title: 'Automated review',
      body: 'Within 30 minutes, our system runs a preliminary check. If everything looks sound, you&apos;re invited to book your voice interview.',
    },
    {
      n: '03',
      title: '10-minute voice interview',
      body: 'A conversation with our AI interviewer, in your native language. No knowledge to study for — just a few questions about who you are, who your people are, and how you want to show up.',
    },
    {
      n: '04',
      title: 'Welcome to the Guild',
      body: 'You&apos;re an Apprentice. Three free Penworth documents to try the product yourself. Your referral code is live. Your seven AI agents begin work.',
    },
  ];
  return (
    <section className="mx-auto max-w-6xl px-6 py-28">
      <div className="mb-4 text-xs font-semibold uppercase tracking-widest text-[#d4af37]">
        How to join
      </div>
      <h2 className="font-serif text-4xl leading-tight tracking-tight md:text-5xl">
        From application to Apprentice in{' '}
        <span className="italic text-[#d4af37]">under 48 hours</span>.
      </h2>

      <div className="mt-16 grid gap-px overflow-hidden rounded-xl border border-[#1e2436] bg-[#1e2436] sm:grid-cols-2 lg:grid-cols-4">
        {steps.map((step) => (
          <div key={step.n} className="bg-[#0f1424] p-8">
            <div className="font-serif text-5xl tracking-tight text-[#d4af37]/30">{step.n}</div>
            <div className="mt-4 font-serif text-xl tracking-tight">{step.title}</div>
            <p
              className="mt-3 text-sm leading-relaxed text-[#8a8370]"
              dangerouslySetInnerHTML={{ __html: step.body }}
            />
          </div>
        ))}
      </div>
    </section>
  );
}

function EcosystemCrossLinkSection() {
  return (
    <section className="border-t border-[#1e2436] bg-[#070a12]">
      <div className="mx-auto max-w-5xl px-6 py-20">
        <p className="text-center text-xs uppercase tracking-widest text-[#8a8370] mb-6">
          Three doors. One house.
        </p>
        <p className="mx-auto mb-10 max-w-3xl text-center text-base leading-relaxed text-[#c9c2b0]">
          Penworth is a literary ecosystem. Writers bring the ideas. Readers live the experience.
          Guildmembers connect them, and earn a craftsperson&apos;s living doing it. Every book begins
          at one door and ends at the other two.
        </p>
        <div className="grid gap-6 md:grid-cols-2">
          <a
            href="https://penworth.ai"
            className="group rounded-xl border border-[#1e2436] bg-[#0f1424] p-8 transition hover:border-[#d4af37]/40"
          >
            <div className="text-xs font-semibold uppercase tracking-widest text-[#d4af37] mb-3">
              Where writers begin
            </div>
            <div className="font-serif text-2xl tracking-tight text-[#e7e2d4]">
              penworth.ai &rarr;
            </div>
            <p className="mt-3 text-sm text-[#c9c2b0]">
              The authoring platform. Every book in the Store begins here.
            </p>
          </a>
          <a
            href="https://store.penworth.ai"
            className="group rounded-xl border border-[#1e2436] bg-[#0f1424] p-8 transition hover:border-[#d4af37]/40"
          >
            <div className="text-xs font-semibold uppercase tracking-widest text-[#d4af37] mb-3">
              Where readers arrive
            </div>
            <div className="font-serif text-2xl tracking-tight text-[#e7e2d4]">
              store.penworth.ai &rarr;
            </div>
            <p className="mt-3 text-sm text-[#c9c2b0]">
              Books you will not find anywhere else. Ebook, audiobook, Cinematic Livebook.
            </p>
          </a>
        </div>
      </div>
    </section>
  );
}

function FinalCTASection() {
  return (
    <section className="mx-auto max-w-4xl px-6 py-32 text-center">
      <div className="mb-6 font-serif text-5xl leading-tight tracking-tight md:text-6xl">
        The craft advances through{' '}
        <span className="italic text-[#d4af37]">those who advance the craft</span>.
      </div>
      <p className="mx-auto mt-8 max-w-2xl text-lg leading-relaxed text-[#c9c2b0]">
        Applications are open globally. The Guild admits members in ten languages. Free to apply.
      </p>
      <div className="mt-12">
        <Link
          href="/guild/apply"
          className="inline-flex items-center gap-3 rounded-md bg-[#d4af37] px-10 py-5 text-lg font-medium text-[#0a0e1a] transition hover:bg-[#e6c14a]"
        >
          Begin Your Application
          <span>→</span>
        </Link>
      </div>
      <p className="mt-6 text-sm text-[#6b6452]">
        Takes 5 minutes · You will hear back within 30 minutes
      </p>
      <p className="mt-16 text-xs text-[#6b6452]">
        Penworth, Cinematic Livebook, and Particle Simulation — IP patents filed in Australia.
      </p>
    </section>
  );
}
