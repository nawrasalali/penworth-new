import { redirect } from 'next/navigation';
import Link from 'next/link';
import { createClient, createAdminClient } from '@/lib/supabase/server';
import StrategistGenerate from './StrategistGenerate';
import { ProbationBanner } from '@/components/guild/ProbationBanner';
import { isSupportedLocale, type Locale } from '@/lib/i18n/strings';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Strategist — Penworth Guild' };

interface StrategistAction {
  day: 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun';
  title: string;
  description: string;
  outcome_metric: string;
  effort_minutes: number;
  category: 'content' | 'outreach' | 'follow_up' | 'learning' | 'ops';
}

interface StrategistPlan {
  generated_at: string;
  week_starting: string;
  thesis: string;
  actions: StrategistAction[];
  total_minutes: number;
  checkpoint: { by: 'wednesday' | 'friday'; question: string };
  skip_if: string | null;
}

const DAY_ORDER: StrategistAction['day'][] = [
  'mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun',
];
const DAY_LABEL: Record<StrategistAction['day'], string> = {
  mon: 'Monday',
  tue: 'Tuesday',
  wed: 'Wednesday',
  thu: 'Thursday',
  fri: 'Friday',
  sat: 'Saturday',
  sun: 'Sunday',
};
const CAT_STYLES: Record<StrategistAction['category'], string> = {
  content: 'border-blue-200 bg-blue-50 text-blue-800',
  outreach: 'border-emerald-200 bg-emerald-50 text-emerald-800',
  follow_up: 'border-amber-200 bg-amber-50 text-amber-900',
  learning: 'border-purple-200 bg-purple-50 text-purple-800',
  ops: 'border-neutral-200 bg-neutral-50 text-neutral-700',
};

export default async function StrategistPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login?redirect=/guild/dashboard/agents/strategist');

  const admin = createAdminClient();
  const { data: member } = await admin
    .from('guild_members')
    .select('id, status, primary_language')
    .eq('user_id', user.id)
    .maybeSingle();
  if (!member) redirect('/guild/dashboard');

  const rawLang = (member.primary_language || 'en').toLowerCase();
  const locale: Locale = isSupportedLocale(rawLang) ? rawLang : 'en';

  // Probation gate — takeover banner, skip plan load.
  if (member.status !== 'active') {
    const { data: balanceRaw } = await admin.rpc('guild_deferred_balance_usd', {
      p_guildmember_id: member.id,
    });
    const deferredBalance = Number(balanceRaw ?? 0);
    return (
      <div className="mx-auto max-w-3xl px-6 py-10">
        <nav className="mb-4 text-xs text-neutral-500">
          <Link href="/guild/dashboard/agents" className="hover:text-neutral-900">
            ← AI Agents
          </Link>
        </nav>
        <ProbationBanner
          deferredBalance={deferredBalance}
          variant="full"
          locale={locale}
        />
      </div>
    );
  }

  const { data: active } = await admin
    .from('guild_growth_plans')
    .select('id, plan_version, start_date, end_date, current_week, completion_pct, plan_document, created_at')
    .eq('guildmember_id', member.id)
    .eq('status', 'active')
    .order('plan_version', { ascending: false })
    .limit(1)
    .maybeSingle();

  const { data: history } = await admin
    .from('guild_growth_plans')
    .select('id, plan_version, start_date, end_date, status, created_at, plan_document')
    .eq('guildmember_id', member.id)
    .neq('status', 'active')
    .order('plan_version', { ascending: false })
    .limit(5);

  const plan = active?.plan_document as StrategistPlan | undefined;

  return (
    <div className="mx-auto max-w-3xl px-6 py-10">
      <nav className="mb-4 text-xs text-neutral-500">
        <Link href="/guild/dashboard/agents" className="hover:text-neutral-900">
          ← AI Agents
        </Link>
      </nav>

      <header className="mb-6 flex items-start justify-between">
        <div>
          <div className="mb-1 text-xs font-semibold uppercase tracking-widest text-[#c4a57a]">
            Strategist
          </div>
          <h1 className="text-2xl font-semibold tracking-tight text-neutral-900">
            Week plan
          </h1>
          <p className="mt-1 text-sm text-neutral-600">
            3–5 concrete actions for the coming week. Each has a day, a
            measurable outcome, and an effort estimate.
          </p>
        </div>
        <StrategistGenerate hasExisting={!!plan} />
      </header>

      {!plan ? (
        <div className="rounded-xl border border-dashed border-neutral-300 bg-neutral-50 px-6 py-10 text-center">
          <div className="mb-2 text-sm font-medium text-neutral-900">
            No active plan
          </div>
          <p className="mx-auto max-w-md text-sm text-neutral-600">
            Click <span className="font-medium">Generate plan</span> to build
            next week's plan. The Strategist reads your metrics, your last
            mentor action, and the latest analyst report.
          </p>
        </div>
      ) : (
        <PlanView
          plan={plan}
          planVersion={active!.plan_version}
          startDate={active!.start_date}
          endDate={active!.end_date}
        />
      )}

      {history && history.length > 0 && (
        <section className="mt-10">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-widest text-neutral-500">
            Previous plans
          </h2>
          <ul className="space-y-2">
            {history.map((h) => {
              const hPlan = h.plan_document as StrategistPlan;
              return (
                <li
                  key={h.id}
                  className="rounded-lg border border-neutral-200 bg-white px-4 py-3"
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-xs text-neutral-500">
                        v{h.plan_version} · {h.start_date} → {h.end_date}
                      </div>
                      <div className="mt-0.5 truncate text-sm text-neutral-800">
                        {hPlan?.thesis ?? '(no thesis)'}
                      </div>
                    </div>
                    <span className="shrink-0 rounded-full border border-neutral-200 bg-neutral-50 px-2 py-0.5 text-[10px] uppercase tracking-wide text-neutral-600">
                      {h.status}
                    </span>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </div>
  );
}

function PlanView({
  plan,
  planVersion,
  startDate,
  endDate,
}: {
  plan: StrategistPlan;
  planVersion: number;
  startDate: string;
  endDate: string;
}) {
  // Group actions by day, preserving day order
  const byDay = new Map<StrategistAction['day'], StrategistAction[]>();
  for (const a of plan.actions) {
    if (!byDay.has(a.day)) byDay.set(a.day, []);
    byDay.get(a.day)!.push(a);
  }
  const daysInPlan = DAY_ORDER.filter((d) => byDay.has(d));

  return (
    <div className="space-y-5">
      <div className="rounded-xl border border-neutral-200 bg-white p-6">
        <div className="mb-3 flex items-center justify-between text-xs text-neutral-500">
          <span>
            v{planVersion} · week {startDate} → {endDate}
          </span>
          <span>
            {plan.actions.length} actions · ~
            {plan.total_minutes} min total
          </span>
        </div>
        <div className="text-base leading-relaxed text-neutral-900">
          {plan.thesis}
        </div>
      </div>

      {plan.skip_if && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <div className="mb-0.5 text-xs font-semibold uppercase tracking-wide">
            Skip if
          </div>
          {plan.skip_if}
        </div>
      )}

      <div className="space-y-3">
        {daysInPlan.map((day) => (
          <div key={day}>
            <div className="mb-2 text-xs font-semibold uppercase tracking-widest text-neutral-500">
              {DAY_LABEL[day]}
            </div>
            <div className="space-y-2">
              {byDay.get(day)!.map((a, i) => (
                <div
                  key={i}
                  className="rounded-xl border border-neutral-200 bg-white p-4"
                >
                  <div className="mb-1 flex items-start justify-between gap-3">
                    <div className="text-sm font-semibold text-neutral-900">
                      {a.title}
                    </div>
                    <span
                      className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide ${CAT_STYLES[a.category]}`}
                    >
                      {a.category.replace('_', ' ')}
                    </span>
                  </div>
                  <div className="mb-2 text-sm text-neutral-700">
                    {a.description}
                  </div>
                  <div className="flex items-center justify-between text-xs text-neutral-500">
                    <span>
                      ✓ {a.outcome_metric}
                    </span>
                    <span>~{a.effort_minutes} min</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      <div className="rounded-xl border border-neutral-900 bg-neutral-900 p-5 text-white">
        <div className="mb-1 text-xs font-semibold uppercase tracking-widest text-white/70">
          Checkpoint · by {plan.checkpoint.by}
        </div>
        <div className="text-sm leading-relaxed">
          {plan.checkpoint.question}
        </div>
      </div>
    </div>
  );
}
