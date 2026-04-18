import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createClient, createAdminClient } from '@/lib/supabase/server';
import ReviewButton from './ReviewButton';
import GradingQueue, { type GradingQueueRow } from './GradingQueue';

export const dynamic = 'force-dynamic';

interface ApplicationRow {
  id: string;
  email: string;
  full_name: string;
  country: string;
  primary_language: string;
  reason: string;
  reason_other: string | null;
  social_links: string[];
  motivation_statement: string;
  referred_by_code: string | null;
  application_status: string;
  auto_review_score: number | null;
  auto_review_flags: string[];
  decision_reason: string | null;
  created_at: string;
  decided_at: string | null;
}

export default async function GuildAdminPage({
  searchParams,
}: {
  searchParams: { status?: string };
}) {
  // Verify admin (layout already does this, but we re-check for safety)
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');
  const { data: profile } = await supabase
    .from('profiles')
    .select('is_admin')
    .eq('id', user.id)
    .single();
  if (!profile?.is_admin) redirect('/dashboard');

  // Use admin client to bypass RLS and read all applications
  const admin = createAdminClient();
  const filter = searchParams.status || 'pending_review';

  let query = admin
    .from('guild_applications')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(100);

  if (filter !== 'all') {
    query = query.eq('application_status', filter);
  }

  const { data: applications } = await query;

  // Status counts for the filter pills
  const { data: counts } = await admin
    .from('guild_applications')
    .select('application_status');

  const statusCounts: Record<string, number> = {};
  (counts || []).forEach((row: any) => {
    statusCounts[row.application_status] = (statusCounts[row.application_status] || 0) + 1;
  });
  statusCounts.all = counts?.length || 0;

  // Interview grading queue: single view query returning both "to grade" and
  // "ready to accept" rows. Split in-memory to avoid two round trips.
  const { data: gradingRowsRaw } = await admin
    .from('v_guild_interview_grading_queue')
    .select('*')
    .or('ready_to_grade.eq.true,ready_to_accept.eq.true')
    .order('conducted_at', { ascending: true, nullsFirst: false });

  const gradingRows = (gradingRowsRaw || []) as GradingQueueRow[];
  const toGrade = gradingRows.filter((r) => r.ready_to_grade);
  const readyToAccept = gradingRows.filter((r) => r.ready_to_accept);

  const filters = [
    { key: 'pending_review', label: 'Pending Review' },
    { key: 'invited_to_interview', label: 'Interview Invited' },
    { key: 'interview_completed', label: 'Interview Done' },
    { key: 'accepted', label: 'Accepted' },
    { key: 'declined', label: 'Declined' },
    { key: 'auto_declined', label: 'Auto-Declined' },
    { key: 'all', label: 'All' },
  ];

  return (
    <div className="p-8">
      <div className="mb-10 flex items-end justify-between">
        <div>
          <div className="mb-2 text-xs font-semibold uppercase tracking-widest text-[#d4af37]">
            Guild Council Review
          </div>
          <h1 className="font-serif text-4xl tracking-tight">Applications</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Review and decide on Penworth Guild applications.
          </p>
          <div className="mt-3 flex gap-4 text-sm">
            <Link href="/admin/guild/payouts" className="text-[#d4af37] hover:underline">
              Payouts queue →
            </Link>
          </div>
        </div>
        <div className="text-right text-sm text-muted-foreground">
          <div className="font-serif text-3xl text-foreground">{statusCounts.all}</div>
          <div>total applications</div>
        </div>
      </div>

      {/* Interview Grading Queue — rows needing Council action on rubric / finalization */}
      <GradingQueue toGrade={toGrade} readyToAccept={readyToAccept} />

      {/* Filter pills */}
      <div className="mb-8 flex flex-wrap gap-2">
        {filters.map((f) => {
          const active = filter === f.key;
          const count = statusCounts[f.key] || 0;
          return (
            <Link
              key={f.key}
              href={`/admin/guild?status=${f.key}`}
              className={`flex items-center gap-2 rounded-md border px-4 py-2 text-sm transition ${
                active
                  ? 'border-primary bg-primary text-primary-foreground'
                  : 'border-border bg-card hover:bg-accent'
              }`}
            >
              {f.label}
              <span
                className={`rounded-full px-2 py-0.5 text-xs ${
                  active ? 'bg-primary-foreground/20' : 'bg-muted text-muted-foreground'
                }`}
              >
                {count}
              </span>
            </Link>
          );
        })}
      </div>

      {/* Applications table */}
      <div className="space-y-3">
        {!applications || applications.length === 0 ? (
          <div className="rounded-lg border border-border bg-card p-16 text-center text-muted-foreground">
            No applications in this category.
          </div>
        ) : (
          applications.map((app: ApplicationRow) => <ApplicationCard key={app.id} app={app} />)
        )}
      </div>
    </div>
  );
}

function ApplicationCard({ app }: { app: ApplicationRow }) {
  const submittedAgo = timeAgo(new Date(app.created_at));
  const score = app.auto_review_score ?? 0;
  const scoreColor =
    score >= 70 ? 'text-green-500' : score >= 50 ? 'text-yellow-500' : 'text-red-500';

  return (
    <details className="group rounded-lg border border-border bg-card transition hover:border-border/80">
      <summary className="flex cursor-pointer items-center gap-4 p-5">
        <div className="flex-shrink-0">
          <div className={`font-serif text-2xl ${scoreColor}`}>{score}</div>
          <div className="text-xs uppercase tracking-widest text-muted-foreground">score</div>
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-3">
            <span className="truncate font-medium">{app.full_name}</span>
            <StatusBadge status={app.application_status} />
          </div>
          <div className="mt-1 flex items-center gap-3 text-sm text-muted-foreground">
            <span className="truncate">{app.email}</span>
            <span>·</span>
            <span>{app.country}</span>
            <span>·</span>
            <span className="uppercase">{app.primary_language}</span>
          </div>
        </div>

        <div className="flex-shrink-0 text-right">
          <div className="text-sm">{submittedAgo}</div>
          {app.auto_review_flags?.length > 0 && (
            <div className="mt-1 text-xs text-yellow-500">
              {app.auto_review_flags.length} flag{app.auto_review_flags.length === 1 ? '' : 's'}
            </div>
          )}
        </div>

        <svg
          className="flex-shrink-0 transition group-open:rotate-180"
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
        >
          <path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
      </summary>

      <div className="border-t border-border p-6">
        <div className="grid gap-6 md:grid-cols-2">
          <div>
            <div className="mb-1 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
              Motivation
            </div>
            <p className="whitespace-pre-wrap text-sm leading-relaxed">
              {app.motivation_statement}
            </p>
          </div>
          <div>
            <div className="mb-1 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
              Reason
            </div>
            <p className="text-sm">
              {app.reason}
              {app.reason_other ? ` — ${app.reason_other}` : ''}
            </p>

            {app.social_links?.length > 0 && (
              <>
                <div className="mb-1 mt-4 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                  Links
                </div>
                <ul className="space-y-1 text-sm">
                  {app.social_links.map((link, i) => (
                    <li key={i}>
                      <a
                        href={link}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-primary hover:underline"
                      >
                        {link}
                      </a>
                    </li>
                  ))}
                </ul>
              </>
            )}

            {app.auto_review_flags?.length > 0 && (
              <>
                <div className="mb-1 mt-4 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                  Auto-review flags
                </div>
                <div className="flex flex-wrap gap-1">
                  {app.auto_review_flags.map((f) => (
                    <span
                      key={f}
                      className="rounded-full bg-yellow-500/10 px-2 py-0.5 text-xs text-yellow-500"
                    >
                      {f}
                    </span>
                  ))}
                </div>
              </>
            )}

            {app.referred_by_code && (
              <>
                <div className="mb-1 mt-4 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                  Referred by code
                </div>
                <div className="font-mono text-sm text-primary">{app.referred_by_code}</div>
              </>
            )}
          </div>
        </div>

        {/* Actions */}
        {['pending_review'].includes(app.application_status) && (
          <div className="mt-6 flex flex-wrap gap-3 border-t border-border pt-6">
            <ReviewButton applicationId={app.id} action="accept" label="Accept → Invite to Interview" variant="success" />
            <ReviewButton applicationId={app.id} action="decline" label="Decline" variant="destructive" />
          </div>
        )}
        {['invited_to_interview', 'interview_scheduled'].includes(app.application_status) && (
          <div className="mt-6 rounded-md border border-border bg-background p-4 text-xs text-muted-foreground">
            Awaiting voice interview. Post-interview grading is done via the rubric endpoint.
          </div>
        )}
        {app.application_status === 'interview_completed' && (
          <div className="mt-6 rounded-md border border-border bg-background p-4 text-xs text-muted-foreground">
            Interview complete. Grade via the <strong>Interview Grading Queue</strong> at the top of this page.
          </div>
        )}
        {app.decision_reason && (
          <div className="mt-6 rounded-md border border-border bg-background p-4">
            <div className="mb-1 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
              Decision reason
            </div>
            <div className="text-sm">{app.decision_reason}</div>
          </div>
        )}
      </div>
    </details>
  );
}

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    pending_review: 'bg-yellow-500/10 text-yellow-500',
    invited_to_interview: 'bg-blue-500/10 text-blue-500',
    interview_scheduled: 'bg-blue-500/10 text-blue-500',
    interview_completed: 'bg-purple-500/10 text-purple-500',
    accepted: 'bg-green-500/10 text-green-500',
    declined: 'bg-red-500/10 text-red-500',
    auto_declined: 'bg-red-500/10 text-red-500',
    withdrawn: 'bg-gray-500/10 text-gray-500',
  };
  return (
    <span
      className={`rounded-full px-2 py-0.5 text-xs ${styles[status] || 'bg-gray-500/10 text-gray-500'}`}
    >
      {status.replace(/_/g, ' ')}
    </span>
  );
}

function timeAgo(d: Date): string {
  const seconds = Math.floor((Date.now() - d.getTime()) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  return `${months}mo ago`;
}
