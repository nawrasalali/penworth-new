import Link from 'next/link';

export const metadata = {
  title: 'The Ladder — Apprentice to Fellow',
};

const TIERS = [
  {
    n: 1,
    name: 'Apprentice',
    color: '#a8a295',
    rate: '20%',
    entry: 'Accepted after application and voice interview',
    advance: '5 active retained referrals',
    benefits: [
      'Full Guildmember dashboard',
      'Three free Penworth documents (one per category)',
      'All seven AI support agents at Apprentice configuration',
      'Guild Academy core curriculum (three mandatory modules)',
      'Unique referral code and personalised link',
      'Co-branded social share assets',
      'Monthly Guild seminar attendance',
      'Weekly Guild Digest email',
    ],
  },
  {
    n: 2,
    name: 'Journeyman',
    color: '#c4a57a',
    rate: '25%',
    entry: '5 retained referrals as Apprentice',
    advance: '25 retained referrals with 70% retention rate',
    benefits: [
      'Everything at Apprentice',
      'Custom vanity referral link (guild.penworth.ai/m/yourname)',
      'Coach agent builds 90-day plans (was 30)',
      'Creator agent unlocks video script generation',
      'Journeyman-only educational electives (6 courses)',
      'Early beta access to new Penworth features',
      'Quarterly review with a dedicated Success Manager',
    ],
  },
  {
    n: 3,
    name: 'Artisan',
    color: '#d4af37',
    rate: '30%',
    entry: '25 retained + 70% retention',
    advance: '100 retained + 75% retention + 6-month consistency',
    benefits: [
      'Everything at Journeyman',
      'Co-branded micro-landing page (/partner/yourname)',
      'Strategist agent unlocks multi-campaign planning',
      'Analyst agent unlocks cohort analytics',
      'Automatic inclusion in monthly Top 10 spotlight (if qualifying)',
      'Private Artisan Slack channel with founding team access',
      'Annual slot in Penworth paid ad creative (with bonus)',
    ],
  },
  {
    n: 4,
    name: 'Master',
    color: '#e6c14a',
    rate: '35%',
    entry: '100 retained + 75% retention + 6-month consistency',
    advance: '500 retained + 80% retention + 12-month consistency + Fellow sponsorship',
    benefits: [
      'Everything at Artisan',
      'Monthly 1:1 video call with Nawras or founding team',
      'Vote on the Penworth product roadmap (top 3 per quarter committed)',
      'Custom campaign support from a Success Manager',
      'Private monthly Master Sessions (20-person cohort)',
      'Travel stipend for in-person Penworth events',
      'Quarterly performance bonus (5% on quarters above $25K in commissions)',
    ],
  },
  {
    n: 5,
    name: 'Fellow',
    color: '#f2d36e',
    rate: '40%',
    entry: '500 retained + 80% retention + 12-month consistency + sponsorship by 3 existing Fellows',
    advance: 'Fellowship is a lifetime honour',
    benefits: [
      'Everything at Master',
      'Seat on the Guild Council',
      'Revenue share on major Penworth product launches (e.g., 2% of Penworth Computer year one)',
      'Public Fellow profile page on penworth.ai',
      'Custom title (e.g., "Fellow of the Guild, Southeast Asia")',
      'Annual Guild Retreat — flights and accommodation paid',
      'Annual performance bonus (10% on yearly commissions above $50K)',
      'Mentorship bonus ($1,000 when a mentee reaches Master)',
    ],
  },
];

export default function LadderPage() {
  return (
    <>
      <section className="border-b border-[#1e2436]">
        <div className="mx-auto max-w-5xl px-6 py-20 text-center">
          <div className="mb-4 text-xs font-semibold uppercase tracking-widest text-[#d4af37]">
            The Ladder
          </div>
          <h1 className="font-serif text-5xl leading-tight tracking-tight md:text-6xl">
            Five tiers. <span className="italic text-[#d4af37]">Every rung is a real step.</span>
          </h1>
          <p className="mx-auto mt-8 max-w-2xl text-lg leading-relaxed text-[#c9c2b0]">
            Your tier is based on <strong>active retained referrals</strong> — people you brought in
            who stayed subscribed for at least 60 days. We don&apos;t reward volume without
            retention. We reward introducing the right people.
          </p>
        </div>
      </section>

      <section className="mx-auto max-w-5xl px-6 py-20">
        <div className="space-y-16">
          {TIERS.map((tier) => (
            <div key={tier.n} className="grid gap-10 md:grid-cols-[200px_1fr]">
              <div>
                <div
                  className="flex h-16 w-16 items-center justify-center rounded-full font-serif text-2xl"
                  style={{
                    background: `linear-gradient(135deg, ${tier.color}30, ${tier.color}10)`,
                    color: tier.color,
                    border: `1px solid ${tier.color}50`,
                  }}
                >
                  {tier.n}
                </div>
                <div className="mt-6 font-serif text-3xl tracking-tight">{tier.name}</div>
                <div
                  className="mt-3 font-serif text-5xl tracking-tight"
                  style={{ color: tier.color }}
                >
                  {tier.rate}
                </div>
                <div className="mt-1 text-xs uppercase tracking-widest text-[#6b6452]">
                  commission · 12 months
                </div>
              </div>

              <div className="rounded-xl border border-[#1e2436] bg-[#0f1424] p-8">
                <div className="mb-6 grid gap-6 sm:grid-cols-2">
                  <div>
                    <div className="text-xs font-semibold uppercase tracking-widest text-[#d4af37]">
                      Entry
                    </div>
                    <div className="mt-2 text-sm leading-relaxed text-[#c9c2b0]">{tier.entry}</div>
                  </div>
                  <div>
                    <div className="text-xs font-semibold uppercase tracking-widest text-[#d4af37]">
                      To advance
                    </div>
                    <div className="mt-2 text-sm leading-relaxed text-[#c9c2b0]">{tier.advance}</div>
                  </div>
                </div>

                <div className="mb-3 text-xs font-semibold uppercase tracking-widest text-[#d4af37]">
                  What unlocks
                </div>
                <ul className="space-y-2">
                  {tier.benefits.map((b) => (
                    <li key={b} className="flex gap-3 text-sm leading-relaxed text-[#c9c2b0]">
                      <span
                        className="mt-1.5 h-1.5 w-1.5 flex-shrink-0 rounded-full"
                        style={{ background: tier.color }}
                      />
                      <span>{b}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="border-t border-[#1e2436] bg-[#070a12]">
        <div className="mx-auto max-w-4xl px-6 py-20">
          <h2 className="mb-8 font-serif text-3xl leading-tight tracking-tight md:text-4xl">
            How commission works
          </h2>
          <div className="space-y-6 text-base leading-relaxed text-[#c9c2b0]">
            <Rule
              title="First-tier only"
              body="You earn commission on the first level of referrals — people who subscribe through your code. No pyramid, no overrides, no downline."
            />
            <Rule
              title="Twelve months per referral"
              body="Each referral earns you commission for 12 consecutive months from their first paid month. Month 13 onward, they keep using Penworth, but the commission window closes."
            />
            <Rule
              title="Your rate locks at referral time"
              body="If you're an Apprentice when you refer someone, they earn you 20% for the full 12 months — even if you're promoted to Artisan tomorrow. Promotions apply to new referrals only."
            />
            <Rule
              title="Retention matters for advancement"
              body="A referral must stay subscribed for 60 days before counting toward tier promotion. This protects the integrity of the ladder — volume without retention doesn't advance you."
            />
            <Rule
              title="No commission on upgrades or credit packs"
              body="Commission is calculated on the plan the user originally subscribed to. If they upgrade from Pro to Max, you keep earning your Pro-based commission. Credit pack purchases generate no commission."
            />
            <Rule
              title="Paid monthly"
              body="Last business day of each month, midnight Adelaide time. Via Wise or USDT — your choice. $50 minimum; balances under roll to next month with no fees."
            />
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-4xl px-6 py-24 text-center">
        <h2 className="font-serif text-4xl leading-tight tracking-tight md:text-5xl">
          Ready to begin your climb?
        </h2>
        <div className="mt-10">
          <Link
            href="/guild/apply"
            className="inline-flex items-center gap-3 rounded-md bg-[#d4af37] px-8 py-4 text-base font-medium text-[#0a0e1a] transition hover:bg-[#e6c14a]"
          >
            Apply to Join the Guild →
          </Link>
        </div>
      </section>
    </>
  );
}

function Rule({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-lg border border-[#1e2436] bg-[#0f1424] p-6">
      <div className="mb-2 font-serif text-lg tracking-tight text-[#e7e2d4]">{title}</div>
      <div className="text-sm leading-relaxed text-[#8a8370]">{body}</div>
    </div>
  );
}
