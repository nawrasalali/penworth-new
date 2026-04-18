import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createClient, createAdminClient } from '@/lib/supabase/server';
import { ProbationBanner } from '@/components/guild/ProbationBanner';
import { isSupportedLocale, type Locale } from '@/lib/i18n/strings';

export const dynamic = 'force-dynamic';
export const metadata = {
  title: 'Your Dashboard',
};

export default async function GuildDashboardPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect('/login?redirect=/guild/dashboard');
  }

  const admin = createAdminClient();

  // Look up Guildmember record
  const { data: member } = await admin
    .from('guild_members')
    .select('*')
    .eq('user_id', user.id)
    .maybeSingle();

  if (!member) {
    // Not yet a Guildmember — show application status check
    return <NotYetMember email={user.email} />;
  }

  // Load counts and earnings
  const { count: referralsCount } = await admin
    .from('guild_referrals')
    .select('*', { count: 'exact', head: true })
    .eq('guildmember_id', member.id);

  const { count: retainedCount } = await admin
    .from('guild_referrals')
    .select('*', { count: 'exact', head: true })
    .eq('guildmember_id', member.id)
    .in('status', ['retention_qualified', 'active_paid']);

  const currentMonth = new Date().toISOString().slice(0, 7); // YYYY-MM

  const { data: monthCommissions } = await admin
    .from('guild_commissions')
    .select('commission_amount_usd')
    .eq('guildmember_id', member.id)
    .eq('commission_month', currentMonth);

  const { data: lifetimeCommissions } = await admin
    .from('guild_commissions')
    .select('commission_amount_usd, status');

  const monthTotal = (monthCommissions || []).reduce(
    (sum, c) => sum + Number(c.commission_amount_usd || 0),
    0,
  );
  const lifetimeTotal = (lifetimeCommissions || [])
    .filter((c) => c.status !== 'clawed_back')
    .reduce((sum, c) => sum + Number(c.commission_amount_usd || 0), 0);

  // Academy mandatory gate
  const { data: academyStatus } = await admin
    .from('v_guild_academy_status')
    .select('mandatory_completed, mandatory_total')
    .eq('guildmember_id', member.id)
    .maybeSingle();

  const mandatoryCompleted = academyStatus?.mandatory_completed ?? 0;
  const mandatoryTotal = academyStatus?.mandatory_total ?? 0;
  const referralUnlocked = mandatoryTotal > 0 && mandatoryCompleted >= mandatoryTotal;

  // Resolve locale + deferred balance for the probation banner. Only fetch
  // the balance when the member is actually on probation — it's an extra
  // RPC call we don't need to make for active members.
  const rawLang = (member.primary_language || 'en').toLowerCase();
  const locale: Locale = isSupportedLocale(rawLang) ? rawLang : 'en';
  let deferredBalance = 0;
  if (member.status === 'probation') {
    const { data: balanceRaw } = await admin.rpc('guild_deferred_balance_usd', {
      p_guildmember_id: member.id,
    });
    deferredBalance = Number(balanceRaw ?? 0);
  }

  return (
    <div className="mx-auto max-w-7xl px-6 py-10">
      {member.status === 'probation' && (
        <ProbationBanner
          deferredBalance={deferredBalance}
          variant="inline"
          locale={locale}
        />
      )}
      <DashboardHeader member={member} referralUnlocked={referralUnlocked} />

      <div className="mt-12 grid gap-6 lg:grid-cols-[200px_1fr_300px]">
        {/* Column 2: Ladder progress */}
        <TierProgressPanel member={member} retainedCount={retainedCount || 0} />

        {/* Column 3: Main content */}
        <MainWorkArea
          member={member}
          referralUnlocked={referralUnlocked}
          mandatoryCompleted={mandatoryCompleted}
          mandatoryTotal={mandatoryTotal}
        />

        {/* Column 4: Live stats */}
        <LiveStatsPanel
          referralsCount={referralsCount || 0}
          retainedCount={retainedCount || 0}
          monthTotal={monthTotal}
          lifetimeTotal={lifetimeTotal}
          member={member}
        />
      </div>
    </div>
  );
}

function DashboardHeader({
  member,
  referralUnlocked,
}: {
  member: any;
  referralUnlocked: boolean;
}) {
  const firstName = member.display_name.split(' ')[0];
  const tierLabel = member.tier.charAt(0).toUpperCase() + member.tier.slice(1);
  return (
    <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
      <div>
        <div className="mb-2 text-xs font-semibold uppercase tracking-widest text-[#d4af37]">
          {tierLabel} · Guild of Penworth
        </div>
        <h1 className="font-serif text-4xl leading-tight tracking-tight md:text-5xl">
          Welcome back, <span className="italic text-[#d4af37]">{firstName}</span>.
        </h1>
      </div>
      <div className="flex gap-4 text-right">
        {referralUnlocked ? (
          <ShareReferralButton referralCode={member.referral_code} />
        ) : (
          <ReferralLockedBadge />
        )}
      </div>
    </div>
  );
}

function ReferralLockedBadge() {
  return (
    <Link
      href="/guild/dashboard/academy"
      className="group block rounded-lg border border-[#2a3149] bg-[#141a2a] p-4 hover:border-[#d4af37]/40"
    >
      <div className="text-xs uppercase tracking-widest text-[#8a8370]">Referral link</div>
      <div className="mt-1 font-serif text-sm tracking-wide text-[#c9c2b0]">
        Complete 3 mandatory Academy modules
      </div>
      <div className="mt-1 text-xs text-[#d4af37] group-hover:underline">Go to Academy →</div>
    </Link>
  );
}

function ShareReferralButton({ referralCode }: { referralCode: string }) {
  return (
    <div className="rounded-lg border border-[#d4af37]/30 bg-[#d4af37]/5 p-4">
      <div className="text-xs uppercase tracking-widest text-[#8a8370]">Your code</div>
      <div className="mt-1 font-serif text-xl tracking-wide text-[#d4af37]">{referralCode}</div>
    </div>
  );
}

function TierProgressPanel({ member, retainedCount }: { member: any; retainedCount: number }) {
  const TIER_THRESHOLDS: Record<string, { next: string; target: number; rate: string }> = {
    apprentice: { next: 'Journeyman', target: 5, rate: '20%' },
    journeyman: { next: 'Artisan', target: 25, rate: '25%' },
    artisan: { next: 'Master', target: 100, rate: '30%' },
    master: { next: 'Fellow', target: 500, rate: '35%' },
    fellow: { next: 'Fellow', target: 500, rate: '40%' },
  };

  const info = TIER_THRESHOLDS[member.tier] || TIER_THRESHOLDS.apprentice;
  const progress = Math.min(100, (retainedCount / info.target) * 100);
  const remaining = Math.max(0, info.target - retainedCount);

  return (
    <aside className="space-y-4">
      <div className="rounded-xl border border-[#1e2436] bg-[#0f1424] p-5">
        <div className="mb-3 text-xs font-semibold uppercase tracking-widest text-[#d4af37]">
          Your Tier
        </div>
        <div className="font-serif text-2xl tracking-tight">
          {member.tier.charAt(0).toUpperCase() + member.tier.slice(1)}
        </div>
        <div className="mt-1 text-sm text-[#8a8370]">Commission: {info.rate}</div>

        <div className="mt-6 h-2 overflow-hidden rounded-full bg-[#1e2436]">
          <div
            className="h-full bg-gradient-to-r from-[#d4af37] to-[#e6c14a] transition-all"
            style={{ width: `${progress}%` }}
          />
        </div>
        <div className="mt-3 text-xs text-[#8a8370]">
          {member.tier === 'fellow' ? (
            <>You&apos;ve reached the top of the ladder.</>
          ) : (
            <>
              <strong className="text-[#e7e2d4]">{remaining}</strong> retained referrals to{' '}
              {info.next}
            </>
          )}
        </div>
      </div>

      <nav className="space-y-1 rounded-xl border border-[#1e2436] bg-[#0f1424] p-2">
        <NavItem href="/guild/dashboard" active>
          Dashboard
        </NavItem>
        <NavItem href="/guild/dashboard/referrals">My Referrals</NavItem>
        <NavItem href="/guild/dashboard/agents">AI Agents</NavItem>
        <NavItem href="/guild/dashboard/academy">Academy</NavItem>
        <NavItem href="/guild/dashboard/community">Community</NavItem>
        <NavItem href="/guild/dashboard/financials">Financials</NavItem>
        <NavItem href="/guild/dashboard/assets">Assets</NavItem>
        <NavItem href="/guild/dashboard/settings">Settings</NavItem>
      </nav>
    </aside>
  );
}

function NavItem({
  href,
  children,
  active,
}: {
  href: string;
  children: React.ReactNode;
  active?: boolean;
}) {
  return (
    <Link
      href={href}
      className={`block rounded-md px-3 py-2 text-sm transition ${
        active
          ? 'bg-[#d4af37]/10 text-[#d4af37]'
          : 'text-[#c9c2b0] hover:bg-[#1e2436] hover:text-[#e7e2d4]'
      }`}
    >
      {children}
    </Link>
  );
}

function MainWorkArea({
  member,
  referralUnlocked,
  mandatoryCompleted,
  mandatoryTotal,
}: {
  member: any;
  referralUnlocked: boolean;
  mandatoryCompleted: number;
  mandatoryTotal: number;
}) {
  return (
    <div className="space-y-6">
      {/* Onboarding checklist for new members */}
      <OnboardingCard member={member} />

      {/* Academy gate banner — shown prominently until mandatory modules are done */}
      {!referralUnlocked && (
        <div className="rounded-xl border border-[#d4af37]/30 bg-gradient-to-br from-[#d4af37]/10 to-transparent p-6">
          <div className="mb-2 text-xs font-semibold uppercase tracking-widest text-[#d4af37]">
            Unlock your referral link
          </div>
          <h2 className="font-serif text-2xl tracking-tight">
            Complete 3 mandatory Academy modules to activate your referral link.
          </h2>
          <p className="mt-3 text-sm leading-relaxed text-[#c9c2b0]">
            You&apos;ve completed {mandatoryCompleted} of {mandatoryTotal || 3}. These teach you how
            Penworth works, how the Guild works, and how to find your first 5 referrals.
          </p>
          <Link
            href="/guild/dashboard/academy"
            className="mt-5 inline-flex items-center gap-2 rounded-md bg-[#d4af37] px-5 py-2.5 text-sm font-medium text-[#0a0e1a] hover:bg-[#e6c14a]"
          >
            Go to Academy →
          </Link>
        </div>
      )}

      {/* Weekly plan card */}
      <div className="rounded-xl border border-[#1e2436] bg-[#0f1424] p-6">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <div className="text-xs font-semibold uppercase tracking-widest text-[#d4af37]">
              Coach Agent · This Week
            </div>
            <div className="mt-1 font-serif text-xl tracking-tight">Your growth plan is loading…</div>
          </div>
          <div className="rounded-full bg-[#d4af37]/10 px-3 py-1 text-xs text-[#d4af37]">
            Week 1
          </div>
        </div>
        <p className="text-sm leading-relaxed text-[#8a8370]">
          Your personalised growth plan will appear here once the Scout agent completes its audit
          of your audience. This typically happens within 24 hours of joining.
        </p>
        {referralUnlocked ? (
          <div className="mt-4 rounded-md bg-[#0a0e1a] p-4 text-sm text-[#c9c2b0]">
            While you wait, start by sharing your referral code{' '}
            <code className="rounded bg-[#1e2436] px-2 py-0.5 font-mono text-[#d4af37]">
              {member.referral_code}
            </code>{' '}
            with someone you know who has a book in them.
          </div>
        ) : (
          <div className="mt-4 rounded-md bg-[#0a0e1a] p-4 text-sm text-[#8a8370]">
            Your referral code appears here once you&apos;ve finished the 3 mandatory Academy modules.
          </div>
        )}
      </div>

      {/* Recent activity */}
      <div className="rounded-xl border border-[#1e2436] bg-[#0f1424] p-6">
        <div className="mb-4 text-xs font-semibold uppercase tracking-widest text-[#d4af37]">
          Recent Activity
        </div>
        <div className="py-12 text-center text-sm text-[#8a8370]">
          No activity yet. Your first referral will appear here.
        </div>
      </div>
    </div>
  );
}

function OnboardingCard({ member }: { member: any }) {
  // Show the onboarding card only for recently joined members
  const joinedAt = new Date(member.joined_at);
  const daysSince = (Date.now() - joinedAt.getTime()) / (1000 * 60 * 60 * 24);
  if (daysSince > 14) return null;

  return (
    <div className="rounded-xl border border-[#d4af37]/30 bg-gradient-to-br from-[#d4af37]/10 to-transparent p-6">
      <div className="mb-4 text-xs font-semibold uppercase tracking-widest text-[#d4af37]">
        Your First Steps
      </div>
      <h2 className="font-serif text-2xl tracking-tight">Begin your climb</h2>
      <p className="mt-2 text-sm text-[#c9c2b0]">
        Your first 14 days are designed to make sure you have what you need to succeed.
      </p>
      <ul className="mt-6 space-y-3">
        <Task done={member.payout_method !== 'pending'}>
          Set up your payout method (Wise or USDT)
        </Task>
        <Task>Write your first Penworth document (3 free, one per category)</Task>
        <Task>Complete Module 1: How Penworth Works</Task>
        <Task>Complete Module 2: How the Guild Works</Task>
        <Task>Complete Module 3: Finding Your First 5</Task>
      </ul>
    </div>
  );
}

function Task({ children, done }: { children: React.ReactNode; done?: boolean }) {
  return (
    <li className="flex items-start gap-3 text-sm">
      <div
        className={`mt-0.5 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full border ${
          done ? 'border-[#d4af37] bg-[#d4af37]' : 'border-[#2a3149]'
        }`}
      >
        {done && (
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none">
            <path
              d="M5 13l4 4L19 7"
              stroke="#0a0e1a"
              strokeWidth="3"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        )}
      </div>
      <span className={done ? 'text-[#8a8370] line-through' : 'text-[#c9c2b0]'}>{children}</span>
    </li>
  );
}

function LiveStatsPanel({
  referralsCount,
  retainedCount,
  monthTotal,
  lifetimeTotal,
  member,
}: {
  referralsCount: number;
  retainedCount: number;
  monthTotal: number;
  lifetimeTotal: number;
  member: any;
}) {
  return (
    <aside className="space-y-4">
      <div className="rounded-xl border border-[#1e2436] bg-[#0f1424] p-5">
        <div className="mb-4 text-xs font-semibold uppercase tracking-widest text-[#d4af37]">
          Live Stats
        </div>
        <StatRow label="This month" value={formatUSD(monthTotal)} large />
        <StatRow label="Lifetime earnings" value={formatUSD(lifetimeTotal)} />
        <div className="my-4 border-t border-[#1e2436]" />
        <StatRow label="Total referrals" value={String(referralsCount)} />
        <StatRow label="Retained (60d+)" value={String(retainedCount)} />
      </div>

      <div className="rounded-xl border border-[#1e2436] bg-[#0f1424] p-5">
        <div className="mb-3 text-xs font-semibold uppercase tracking-widest text-[#d4af37]">
          Next payout
        </div>
        <div className="font-serif text-xl tracking-tight text-[#e7e2d4]">
          {getNextPayoutDate()}
        </div>
        <div className="mt-1 text-xs text-[#8a8370]">Last business day of this month</div>
        <div className="mt-4 text-xs text-[#8a8370]">
          {member.payout_method === 'pending' ? (
            <Link
              href="/guild/dashboard/settings"
              className="inline-flex items-center gap-1 text-[#d4af37] hover:underline"
            >
              ⚠ Set up your payout method →
            </Link>
          ) : (
            `via ${member.payout_method === 'wise' ? 'Wise' : 'USDT'}`
          )}
        </div>
      </div>
    </aside>
  );
}

function StatRow({
  label,
  value,
  large,
}: {
  label: string;
  value: string;
  large?: boolean;
}) {
  return (
    <div className="mb-3 flex items-baseline justify-between">
      <span className="text-xs text-[#8a8370]">{label}</span>
      <span
        className={`font-serif tracking-tight ${
          large ? 'text-3xl text-[#d4af37]' : 'text-lg text-[#e7e2d4]'
        }`}
      >
        {value}
      </span>
    </div>
  );
}

function formatUSD(amount: number): string {
  return `$${amount.toFixed(2)}`;
}

function getNextPayoutDate(): string {
  const now = new Date();
  const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  return lastDay.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

// ---------------------------------------------------------------------------
// Non-member view
// ---------------------------------------------------------------------------

function NotYetMember({ email }: { email: string | undefined }) {
  return (
    <div className="mx-auto max-w-2xl px-6 py-24 text-center">
      <h1 className="font-serif text-4xl leading-tight tracking-tight md:text-5xl">
        You&apos;re not yet a Guildmember.
      </h1>
      <p className="mx-auto mt-8 max-w-lg text-lg leading-relaxed text-[#c9c2b0]">
        This dashboard is for accepted Guildmembers. If you&apos;ve applied, you&apos;ll receive an
        email with next steps when your application is reviewed.
      </p>
      <div className="mt-12 flex flex-col items-center justify-center gap-4 sm:flex-row">
        <Link
          href="/guild/apply"
          className="inline-flex items-center gap-2 rounded-md bg-[#d4af37] px-6 py-3 text-sm font-medium text-[#0a0e1a] hover:bg-[#e6c14a]"
        >
          Apply to Join
        </Link>
        <Link
          href={`/guild/status${email ? `?email=${encodeURIComponent(email)}` : ''}`}
          className="inline-flex items-center gap-2 rounded-md border border-[#2a3149] bg-[#141a2a] px-6 py-3 text-sm text-[#e7e2d4] hover:border-[#3a4259]"
        >
          Check Application Status
        </Link>
      </div>
    </div>
  );
}
