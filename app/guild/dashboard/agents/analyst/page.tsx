import { redirect } from 'next/navigation';
import Link from 'next/link';
import { createClient, createAdminClient } from '@/lib/supabase/server';
import AnalystRefresh from './AnalystRefresh';
import { ProbationBanner } from '@/components/guild/ProbationBanner';
import { isSupportedLocale, type Locale } from '@/lib/i18n/strings';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Analyst — Penworth Guild' };

interface AnalystReport {
  generated_at: string;
  period: { start: string; end: string };
  headline: string;
  momentum: 'accelerating' | 'steady' | 'slowing' | 'stalled';
  what_is_working: string[];
  what_is_not: string[];
  watch_next: string[];
  confidence: 'high' | 'medium' | 'low';
  confidence_reason: string;
  data_quality_notes: string[];
}

export default async function AnalystPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login?redirect=/guild/dashboard/agents/analyst');

  const admin = createAdminClient();
  const { data: member } = await admin
    .from('guild_members')
    .select('id, status, primary_language')
    .eq('user_id', user.id)
    .maybeSingle();
  if (!member) redirect('/guild/dashboard');

  const rawLang = (member.primary_language || 'en').toLowerCase();
  const locale: Locale = isSupportedLocale(rawLang) ? rawLang : 'en';

  // Probation gate — takeover banner, skip report load.
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

  const { data: ctxRow } = await admin
    .from('guild_agent_context')
    .select('context, last_updated_at')
    .eq('guildmember_id', member.id)
    .eq('agent_name', 'analyst')
    .maybeSingle();

  const reports = (ctxRow?.context as any)?.reports as
    | Record<string, AnalystReport>
    | undefined;
  const reportDates = reports ? Object.keys(reports).sort().reverse() : [];
  const today = new Date().toISOString().slice(0, 10);
  const latestDate = reportDates[0] ?? null;
  const latest = latestDate ? reports![latestDate] : null;
  const isFresh = latestDate === today;

  return (
    <div className="mx-auto max-w-3xl px-6 py-10">
      <nav className="mb-4 text-xs text-neutral-500">
        <Link href="/guild/dashboard/agents" className="hover:text-neutral-900">
          ← AI Agents
        </Link>
      </nav>

      <header className="mb-6 flex items-start justify-between">
        <div>
          <div className="mb-1 text-xs font-semibold uppercase tracking-widest text-[#a8c4e0]">
            Analyst
          </div>
          <h1 className="text-2xl font-semibold tracking-tight text-neutral-900">
            Performance read
          </h1>
          <p className="mt-1 text-sm text-neutral-600">
            What the numbers actually say. No advice — that's the strategist's
            job.
          </p>
        </div>
        <AnalystRefresh hasExisting={!!latest} isFresh={isFresh} />
      </header>

      {!latest ? (
        <div className="rounded-xl border border-dashed border-neutral-300 bg-neutral-50 px-6 py-10 text-center">
          <div className="mb-2 text-sm font-medium text-neutral-900">
            No report yet
          </div>
          <p className="mx-auto max-w-md text-sm text-neutral-600">
            Click <span className="font-medium">Run analysis</span> to generate
            your first report. The Analyst reads your referral and commission
            data from the last 12 weeks.
          </p>
        </div>
      ) : (
        <ReportView
          report={latest}
          date={latestDate!}
          isFresh={isFresh}
        />
      )}

      {reportDates.length > 1 && (
        <section className="mt-10">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-widest text-neutral-500">
            Previous reports
          </h2>
          <ul className="space-y-2">
            {reportDates.slice(1, 8).map((d) => (
              <li
                key={d}
                className="rounded-lg border border-neutral-200 bg-white px-4 py-3"
              >
                <div className="flex items-center justify-between">
                  <div className="font-mono text-xs text-neutral-500">{d}</div>
                  <MomentumBadge momentum={reports![d].momentum} />
                </div>
                <div className="mt-1 text-sm text-neutral-800">
                  {reports![d].headline}
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function ReportView({
  report,
  date,
  isFresh,
}: {
  report: AnalystReport;
  date: string;
  isFresh: boolean;
}) {
  return (
    <div className="space-y-5">
      <div className="rounded-xl border border-neutral-200 bg-white p-6">
        <div className="mb-3 flex items-center justify-between text-xs text-neutral-500">
          <span>
            Generated {date} {isFresh ? '· fresh' : '· cached'}
          </span>
          <span>
            Period {report.period.start} → {report.period.end}
          </span>
        </div>
        <div className="mb-4 flex items-start justify-between gap-4">
          <div className="text-lg font-medium leading-snug text-neutral-900">
            {report.headline}
          </div>
          <MomentumBadge momentum={report.momentum} />
        </div>

        <div className="flex gap-2 text-xs">
          <ConfidencePill confidence={report.confidence} />
          <span className="text-neutral-500">{report.confidence_reason}</span>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <ReportList
          title="What's working"
          items={report.what_is_working}
          accentClass="border-emerald-200 bg-emerald-50/40"
          bulletClass="bg-emerald-500"
        />
        <ReportList
          title="What's not"
          items={report.what_is_not}
          accentClass="border-amber-200 bg-amber-50/40"
          bulletClass="bg-amber-500"
        />
      </div>

      <ReportList
        title="Watch next week"
        items={report.watch_next}
        accentClass="border-neutral-200 bg-white"
        bulletClass="bg-neutral-500"
      />

      {report.data_quality_notes.length > 0 && (
        <div className="rounded-lg border border-dashed border-neutral-300 bg-neutral-50 px-4 py-3 text-xs text-neutral-600">
          <div className="mb-1 font-medium uppercase tracking-wide text-neutral-500">
            Data quality notes
          </div>
          <ul className="list-disc space-y-0.5 pl-4">
            {report.data_quality_notes.map((n, i) => (
              <li key={i}>{n}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function ReportList({
  title,
  items,
  accentClass,
  bulletClass,
}: {
  title: string;
  items: string[];
  accentClass: string;
  bulletClass: string;
}) {
  return (
    <div className={`rounded-xl border p-5 ${accentClass}`}>
      <div className="mb-3 text-xs font-semibold uppercase tracking-widest text-neutral-700">
        {title}
      </div>
      {items.length === 0 ? (
        <div className="text-sm italic text-neutral-500">Nothing flagged.</div>
      ) : (
        <ul className="space-y-2">
          {items.map((item, i) => (
            <li key={i} className="flex gap-2.5 text-sm text-neutral-800">
              <span
                className={`mt-1.5 h-1.5 w-1.5 flex-shrink-0 rounded-full ${bulletClass}`}
              />
              <span>{item}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function MomentumBadge({
  momentum,
}: {
  momentum: AnalystReport['momentum'];
}) {
  const map: Record<
    AnalystReport['momentum'],
    { label: string; className: string; icon: string }
  > = {
    accelerating: {
      label: 'Accelerating',
      className: 'border-emerald-600 bg-emerald-600 text-white',
      icon: '↗',
    },
    steady: {
      label: 'Steady',
      className: 'border-blue-200 bg-blue-50 text-blue-800',
      icon: '→',
    },
    slowing: {
      label: 'Slowing',
      className: 'border-amber-200 bg-amber-50 text-amber-900',
      icon: '↘',
    },
    stalled: {
      label: 'Stalled',
      className: 'border-red-200 bg-red-50 text-red-800',
      icon: '·',
    },
  };
  const conf = map[momentum];
  return (
    <span
      className={`inline-flex flex-shrink-0 items-center gap-1 whitespace-nowrap rounded-full border px-3 py-1 text-xs font-medium ${conf.className}`}
    >
      <span>{conf.icon}</span>
      {conf.label}
    </span>
  );
}

function ConfidencePill({
  confidence,
}: {
  confidence: AnalystReport['confidence'];
}) {
  const map = {
    high: 'border-neutral-900 bg-neutral-900 text-white',
    medium: 'border-neutral-300 bg-white text-neutral-800',
    low: 'border-neutral-200 bg-neutral-50 text-neutral-600',
  };
  return (
    <span
      className={`rounded-full border px-2 py-0.5 text-xs font-medium uppercase tracking-wide ${map[confidence]}`}
    >
      {confidence} confidence
    </span>
  );
}
