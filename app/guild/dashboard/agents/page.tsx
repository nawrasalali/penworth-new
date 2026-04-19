import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'AI Agents — Penworth Guild' };

export default async function GuildAgentsIndexPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login?redirect=/guild/dashboard/agents');

  const admin = createServiceClient();
  const { data: member } = await admin
    .from('guild_members')
    .select('id')
    .eq('user_id', user.id)
    .maybeSingle();
  if (!member) redirect('/guild/dashboard');

  // Pull quick status markers for each agent
  const weekOf = currentWeekOfUtc();

  const [{ data: thisWeekCheckin }, { data: analystCtx }, { data: activePlan }] =
    await Promise.all([
      admin
        .from('guild_weekly_checkins')
        .select('id, mentor_journal_entry, escalated_to_human')
        .eq('guildmember_id', member.id)
        .eq('week_of', weekOf)
        .maybeSingle(),
      admin
        .from('guild_agent_context')
        .select('context, last_updated_at')
        .eq('guildmember_id', member.id)
        .eq('agent_name', 'analyst')
        .maybeSingle(),
      admin
        .from('guild_growth_plans')
        .select('id, start_date, end_date, plan_version')
        .eq('guildmember_id', member.id)
        .eq('status', 'active')
        .order('plan_version', { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);

  const today = new Date().toISOString().slice(0, 10);
  const analystReports = (analystCtx?.context as any)?.reports ?? {};
  const latestAnalystDate = Object.keys(analystReports).sort().pop() ?? null;
  const analystIsFresh = latestAnalystDate === today;

  return (
    <div className="mx-auto max-w-5xl px-6 py-10">
      <header className="mb-8">
        <div className="mb-2 text-xs font-semibold uppercase tracking-widest text-[#d4af37]">
          Guild AI
        </div>
        <h1 className="text-2xl font-semibold tracking-tight text-neutral-900">
          Your AI support team
        </h1>
        <p className="mt-1 text-sm text-neutral-600">
          Three agents that read your real numbers and help you move. The
          Mentor talks with you; the Analyst shows you what's happening; the
          Strategist tells you what to do next.
        </p>
      </header>

      <div className="grid gap-4 md:grid-cols-3">
        <AgentCard
          href="/guild/dashboard/agents/mentor"
          accent="#d4af37"
          title="Mentor"
          tagline="Weekly check-in"
          description="A 5-10 minute conversation about your week, grounded in your actual numbers. Ends with one concrete next action."
          statusLabel={thisWeekCheckin?.mentor_journal_entry ? 'Done for this week' : 'Check in now'}
          statusTone={thisWeekCheckin?.mentor_journal_entry ? 'success' : 'attention'}
          cta={thisWeekCheckin?.mentor_journal_entry ? 'View this week' : 'Start check-in →'}
        />

        <AgentCard
          href="/guild/dashboard/agents/analyst"
          accent="#a8c4e0"
          title="Analyst"
          tagline="Performance read"
          description="What's working, what's not, what to watch. Not advice — observation. Refreshes once a day."
          statusLabel={
            analystIsFresh
              ? 'Today\'s report ready'
              : latestAnalystDate
                ? `Last: ${latestAnalystDate}`
                : 'No report yet'
          }
          statusTone={analystIsFresh ? 'success' : 'neutral'}
          cta="View report →"
        />

        <AgentCard
          href="/guild/dashboard/agents/strategist"
          accent="#c4a57a"
          title="Strategist"
          tagline="Week plan"
          description="3-5 concrete actions for the coming week, each with a day, a measurable outcome, and an effort estimate."
          statusLabel={
            activePlan
              ? `Active plan · v${activePlan.plan_version}`
              : 'No active plan'
          }
          statusTone={activePlan ? 'success' : 'attention'}
          cta={activePlan ? 'View plan →' : 'Generate plan →'}
        />
      </div>

      <section className="mt-10 rounded-xl border border-neutral-200 bg-white p-6">
        <h2 className="mb-3 text-base font-semibold text-neutral-900">
          How they work together
        </h2>
        <ol className="list-decimal space-y-2 pl-5 text-sm text-neutral-700">
          <li>
            <span className="font-medium">Mentor</span> helps you close the
            week with one action named and agreed.
          </li>
          <li>
            <span className="font-medium">Analyst</span> looks at the same data
            more coldly and tells you what the numbers actually say — no
            encouragement, no advice.
          </li>
          <li>
            <span className="font-medium">Strategist</span> reads both and
            builds next week's plan: specific, measurable, bounded.
          </li>
        </ol>
        <p className="mt-3 text-xs text-neutral-500">
          None of the three invent numbers. Every output is grounded in your
          referral and commission data from the Guild database.
        </p>
      </section>
    </div>
  );
}

function currentWeekOfUtc(): string {
  const d = new Date();
  const day = d.getUTCDay();
  const offset = day === 0 ? -6 : 1 - day;
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString().slice(0, 10);
}

function AgentCard({
  href,
  accent,
  title,
  tagline,
  description,
  statusLabel,
  statusTone,
  cta,
}: {
  href: string;
  accent: string;
  title: string;
  tagline: string;
  description: string;
  statusLabel: string;
  statusTone: 'success' | 'attention' | 'neutral';
  cta: string;
}) {
  const toneClass =
    statusTone === 'success'
      ? 'text-emerald-700'
      : statusTone === 'attention'
        ? 'text-amber-700'
        : 'text-neutral-500';
  return (
    <Link
      href={href}
      className="group flex flex-col rounded-xl border border-neutral-200 bg-white p-5 transition hover:-translate-y-0.5 hover:shadow-md"
    >
      <div
        className="mb-2 text-xs font-semibold uppercase tracking-widest"
        style={{ color: accent }}
      >
        {tagline}
      </div>
      <div className="mb-2 text-lg font-semibold text-neutral-900">{title}</div>
      <p className="mb-4 flex-1 text-sm text-neutral-600">{description}</p>
      <div className={`mb-2 text-xs font-medium ${toneClass}`}>{statusLabel}</div>
      <div className="text-sm font-medium text-neutral-900 group-hover:underline">
        {cta}
      </div>
    </Link>
  );
}
