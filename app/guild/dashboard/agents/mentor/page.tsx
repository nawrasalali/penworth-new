import { redirect } from 'next/navigation';
import Link from 'next/link';
import { createClient, createAdminClient } from '@/lib/supabase/server';
import MentorChat from './MentorChat';
import { ProbationBanner } from '@/components/guild/ProbationBanner';
import { isSupportedLocale, type Locale } from '@/lib/i18n/strings';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Mentor — Penworth Guild' };

export default async function MentorPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login?redirect=/guild/dashboard/agents/mentor');

  const admin = createAdminClient();
  const { data: member } = await admin
    .from('guild_members')
    .select('id, display_name, status, primary_language')
    .eq('user_id', user.id)
    .maybeSingle();
  if (!member) redirect('/guild/dashboard');

  // Resolve locale for the banner — read from the member's language preference
  // so the probation message appears in the member's tongue.
  const rawLang = (member.primary_language || 'en').toLowerCase();
  const locale: Locale = isSupportedLocale(rawLang) ? rawLang : 'en';

  // Probation gate — if the member is not active, show the takeover banner
  // and skip loading any mentor data. This matches the API-level gate.
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

  const weekOf = currentWeekOf();

  const { data: checkin } = await admin
    .from('guild_weekly_checkins')
    .select(
      'id, mentor_journal_entry, completion_data, escalated_to_human, escalation_reason, created_at',
    )
    .eq('guildmember_id', member.id)
    .eq('week_of', weekOf)
    .maybeSingle();

  const { data: history } = await admin
    .from('guild_weekly_checkins')
    .select('id, week_of, mentor_journal_entry')
    .eq('guildmember_id', member.id)
    .not('mentor_journal_entry', 'is', null)
    .order('week_of', { ascending: false })
    .limit(6);

  return (
    <div className="mx-auto max-w-3xl px-6 py-10">
      <nav className="mb-4 text-xs text-neutral-500">
        <Link href="/guild/dashboard/agents" className="hover:text-neutral-900">
          ← AI Agents
        </Link>
      </nav>

      <header className="mb-6">
        <div className="mb-1 text-xs font-semibold uppercase tracking-widest text-[#d4af37]">
          Mentor
        </div>
        <h1 className="text-2xl font-semibold tracking-tight text-neutral-900">
          Weekly check-in
        </h1>
        <p className="mt-1 text-sm text-neutral-600">
          Week of {weekOf}. One conversation per week, closes with one
          concrete action for next week.
        </p>
      </header>

      {checkin?.mentor_journal_entry ? (
        <CompletedCheckin
          weekOf={weekOf}
          journal={checkin.mentor_journal_entry}
          completion={checkin.completion_data}
          escalated={checkin.escalated_to_human}
          createdAt={checkin.created_at}
        />
      ) : (
        <MentorChat memberName={member.display_name} memberStatus={member.status} />
      )}

      {history && history.length > 0 && (
        <section className="mt-10">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-widest text-neutral-500">
            Previous check-ins
          </h2>
          <ul className="space-y-3">
            {history
              .filter((h) => h.week_of !== weekOf)
              .map((h) => {
                const journal = h.mentor_journal_entry ?? '';
                const headline =
                  journal.split('\n\n')[0]?.replace(/^Headline:\s*/, '') ??
                  '(no headline)';
                return (
                  <li
                    key={h.id}
                    className="rounded-lg border border-neutral-200 bg-white px-4 py-3"
                  >
                    <div className="text-xs font-mono text-neutral-500">
                      {h.week_of}
                    </div>
                    <div className="mt-1 text-sm text-neutral-800">
                      {headline}
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

function currentWeekOf(): string {
  const d = new Date();
  const day = d.getUTCDay();
  const offset = day === 0 ? -6 : 1 - day;
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString().slice(0, 10);
}

function CompletedCheckin({
  weekOf,
  journal,
  completion,
  escalated,
  createdAt,
}: {
  weekOf: string;
  journal: string;
  completion: any;
  escalated: boolean;
  createdAt: string;
}) {
  const nextAction = completion?.next_action as
    | { description: string; by_date: string; measurable: boolean }
    | undefined;

  return (
    <div className="rounded-xl border border-emerald-200 bg-emerald-50/40 p-6">
      <div className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-emerald-700">
        <svg viewBox="0 0 20 20" className="h-4 w-4 fill-current">
          <path d="M16.7 5.3a1 1 0 010 1.4l-7 7a1 1 0 01-1.4 0l-4-4a1 1 0 111.4-1.4L9 11.6l6.3-6.3a1 1 0 011.4 0z" />
        </svg>
        Check-in complete · {new Date(createdAt).toLocaleDateString()}
      </div>

      <pre className="mb-4 whitespace-pre-wrap font-sans text-sm text-neutral-800">
        {journal}
      </pre>

      {nextAction && (
        <div className="rounded-lg border border-neutral-200 bg-white p-4">
          <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-neutral-500">
            Next action
          </div>
          <div className="text-sm font-medium text-neutral-900">
            {nextAction.description}
          </div>
          <div className="mt-1 text-xs text-neutral-600">
            By {nextAction.by_date}
          </div>
        </div>
      )}

      {escalated && (
        <div className="mt-4 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          This check-in was flagged for Guild Council review. A human will
          reach out separately.
        </div>
      )}

      <p className="mt-5 text-xs text-neutral-500">
        Next check-in unlocks Monday of next week.
      </p>
    </div>
  );
}
