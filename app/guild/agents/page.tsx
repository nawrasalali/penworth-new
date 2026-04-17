import Link from 'next/link';

export const metadata = {
  title: 'Your AI Support Team — Seven Agents',
};

const AGENTS = [
  {
    name: 'Scout',
    tagline: 'Audits your audience',
    color: '#a8c4e0',
    does: [
      'Analyses your social presence at the links you shared with us',
      'Identifies your follower count, engagement rate, top-performing content',
      'Detects your niche, tone, posting cadence, and content pillars',
      'Monitors peer accounts and competitors in your space',
      'Updates monthly (full audit) and weekly (incremental)',
    ],
    output:
      'A living "Audience Profile" document in your dashboard, updated continuously — the foundation for everything the other agents do.',
  },
  {
    name: 'Coach',
    tagline: 'Builds your growth plan',
    color: '#c4a57a',
    does: [
      'Reads your Audience Profile from Scout',
      'Knows your current tier, commission, recent referrals, and stated goals',
      'Produces a personalised 30-day plan (Apprentice) or 90-day plan (higher tiers)',
      'Structured as weekly milestones with rated effort and impact',
      'Adapts every week based on what actually happened',
    ],
    output:
      'A weekly operating plan on your dashboard home. Check-boxes for completion. Plans that respond to your reality, not a generic template.',
  },
  {
    name: 'Creator',
    tagline: 'Drafts your content',
    color: '#d4af37',
    does: [
      'Takes the week\'s plan from Coach',
      'Drafts video scripts, social captions, emails, LinkedIn posts, blog drafts',
      'Draws on the Guild\'s pre-approved template library',
      'Writes in your voice — learned from Scout\'s audit of your existing content',
      'Works in all ten Guild languages',
    ],
    output:
      'Content drafts ready for your review. One-click editable. You approve, edit, and post. Never posts autonomously on your behalf.',
  },
  {
    name: 'Mentor',
    tagline: 'Weekly accountability',
    color: '#e6c14a',
    does: [
      'Runs a Monday morning check-in conversation (5-10 minutes)',
      'Reviews what worked, what didn\'t, what felt hard',
      'Sets intention for the coming week',
      'Celebrates wins — a referral, a promotion, a milestone',
      'Escalates to a human Success Manager if it detects struggle',
    ],
    output:
      'A weekly journal entry. Your story over time. The agent that notices when you\'re drifting before you notice yourself.',
  },
  {
    name: 'Analyst',
    tagline: 'Tracks what works',
    color: '#8fbc8f',
    does: [
      'Ingests every referral, conversion, retention, and commission event',
      'Segments by content piece, channel, campaign, audience segment',
      'Identifies what works and what doesn\'t with specificity',
      'Surfaces non-obvious patterns (e.g., conversion by day of week)',
      'Updates daily',
    ],
    output:
      'A data panel with charts and narrative insights. Not dashboards of vanity metrics — actionable observations you can use next week.',
  },
  {
    name: 'Strategist',
    tagline: 'Plans your campaigns',
    color: '#c19ace',
    does: [
      'Available at Journeyman tier and above',
      'You propose a campaign idea; Strategist designs it end-to-end',
      'Plans timing, content cadence, asset list, expected conversion range',
      'Defines success metrics before the campaign starts',
      'Runs post-mortems after campaigns complete',
    ],
    output:
      'Campaign plan documents. Honest retrospectives. The agent that helps you think in quarters, not just weeks.',
  },
  {
    name: 'Advisor',
    tagline: 'Answers any question',
    color: '#f0a070',
    does: [
      'On-demand product expert, available 24/7 via chat',
      'Answers questions about Penworth\'s product, pricing, features, roadmap',
      'Coaches you on handling objections',
      'Trained on Penworth\'s full documentation and thousands of objection-response pairs',
      'Never fabricates — says "I don\'t know" when it doesn\'t',
    ],
    output:
      'Conversational answers. Example scripts. Objection-handling cards you can save. The agent that lets you always sound like you know what you\'re talking about, because you do.',
  },
];

export default function AgentsPage() {
  return (
    <>
      <section className="border-b border-[#1e2436]">
        <div className="mx-auto max-w-4xl px-6 py-20 text-center">
          <div className="mb-4 text-xs font-semibold uppercase tracking-widest text-[#d4af37]">
            Your AI Support Team
          </div>
          <h1 className="font-serif text-5xl leading-tight tracking-tight md:text-6xl">
            Seven agents. <span className="italic text-[#d4af37]">Built for you.</span>
          </h1>
          <p className="mx-auto mt-8 max-w-2xl text-lg leading-relaxed text-[#c9c2b0]">
            Every Guildmember gets a full AI team from day one. They collaborate with each other —
            context shared, decisions coordinated — so it doesn&apos;t feel like seven chatbots.
            It feels like a team.
          </p>
        </div>
      </section>

      <section className="mx-auto max-w-5xl px-6 py-20">
        <div className="space-y-20">
          {AGENTS.map((agent, i) => (
            <div key={agent.name} className="grid gap-8 md:grid-cols-[240px_1fr]">
              <div>
                <div
                  className="flex h-20 w-20 items-center justify-center rounded-xl font-serif text-3xl"
                  style={{
                    background: `linear-gradient(135deg, ${agent.color}30, ${agent.color}10)`,
                    color: agent.color,
                    border: `1px solid ${agent.color}50`,
                  }}
                >
                  {String(i + 1).padStart(2, '0')}
                </div>
                <div className="mt-6 font-serif text-3xl tracking-tight">{agent.name}</div>
                <div className="mt-2 text-sm uppercase tracking-widest text-[#8a8370]">
                  {agent.tagline}
                </div>
              </div>

              <div className="rounded-xl border border-[#1e2436] bg-[#0f1424] p-8">
                <div className="text-xs font-semibold uppercase tracking-widest text-[#d4af37]">
                  What it does
                </div>
                <ul className="mt-4 space-y-2">
                  {agent.does.map((d) => (
                    <li key={d} className="flex gap-3 text-sm leading-relaxed text-[#c9c2b0]">
                      <span
                        className="mt-1.5 h-1.5 w-1.5 flex-shrink-0 rounded-full"
                        style={{ background: agent.color }}
                      />
                      <span>{d}</span>
                    </li>
                  ))}
                </ul>
                <div className="mt-6 rounded-md border border-[#1e2436] bg-[#0a0e1a] p-5">
                  <div className="mb-2 text-xs font-semibold uppercase tracking-widest text-[#8a8370]">
                    Output
                  </div>
                  <div className="text-sm leading-relaxed text-[#e7e2d4]">{agent.output}</div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="border-t border-[#1e2436] bg-[#070a12]">
        <div className="mx-auto max-w-4xl px-6 py-20">
          <h2 className="mb-10 font-serif text-3xl leading-tight tracking-tight md:text-4xl">
            How the agents collaborate
          </h2>
          <p className="text-lg leading-relaxed text-[#c9c2b0]">
            The seven agents share a common context — your full profile, audit data, goals, history.
            When you tell Mentor you feel stuck on TikTok, Scout re-audits your TikTok with more
            depth, Coach adjusts next week&apos;s plan, Creator prepares three alternative TikTok
            angles for testing, and Analyst starts watching TikTok-specific metrics more closely.
          </p>
          <p className="mt-6 text-lg leading-relaxed text-[#c9c2b0]">
            This collaboration is what makes the system feel like a team, not a collection of tools.
          </p>
        </div>
      </section>

      <section className="mx-auto max-w-4xl px-6 py-24 text-center">
        <h2 className="font-serif text-4xl leading-tight tracking-tight md:text-5xl">
          Your team is waiting.
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
