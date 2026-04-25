import { createClient } from '@/lib/supabase/server';
import Link from 'next/link';
import { formatDistanceToNow } from 'date-fns';
import {
  Users,
  DollarSign,
  FileText,
  Coins,
  Cpu,
  Send,
  TrendingUp,
  ShieldCheck,
  BookOpen,
  AlertTriangle,
  Scale,
  ExternalLink,
} from 'lucide-react';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

// Penworth v2 plan prices (USD/month) — used for MRR estimate.
const PLAN_PRICE_USD: Record<string, number> = {
  pro: 19,
  max: 49,
};

export default async function AdminPage() {
  const supabase = await createClient();

  // ---------- USERS ----------
  const { count: totalUsers } = await supabase
    .from('profiles')
    .select('*', { count: 'exact', head: true });

  const { data: plansRaw } = await supabase
    .from('profiles')
    .select('plan');

  const plans = plansRaw ?? [];
  const planCounts: Record<string, number> = {};
  for (const p of plans) {
    const key = (p.plan || 'free') as string;
    planCounts[key] = (planCounts[key] || 0) + 1;
  }
  const paidUsers = (planCounts.pro || 0) + (planCounts.max || 0);
  const mrrEstimate =
    (planCounts.pro || 0) * PLAN_PRICE_USD.pro +
    (planCounts.max || 0) * PLAN_PRICE_USD.max;

  // ---------- PROJECTS ----------
  const { count: totalProjects } = await supabase
    .from('projects')
    .select('*', { count: 'exact', head: true });

  const startOfMonth = new Date();
  startOfMonth.setDate(1);
  startOfMonth.setHours(0, 0, 0, 0);

  const { count: projectsThisMonth } = await supabase
    .from('projects')
    .select('*', { count: 'exact', head: true })
    .gte('created_at', startOfMonth.toISOString());

  const { count: completedProjects } = await supabase
    .from('projects')
    .select('*', { count: 'exact', head: true })
    .eq('status', 'published');

  // ---------- CHAPTERS & WORDS ----------
  const { count: totalChapters } = await supabase
    .from('chapters')
    .select('*', { count: 'exact', head: true })
    .eq('status', 'complete');

  const { data: chapterWords } = await supabase
    .from('chapters')
    .select('word_count')
    .eq('status', 'complete');

  const totalWords = (chapterWords ?? []).reduce(
    (s, ch) => s + (ch.word_count || 0),
    0,
  );

  // ---------- CREDIT ECONOMY ----------
  const { data: creditRows } = await supabase
    .from('credit_transactions')
    .select('amount, transaction_type');

  let creditsIssued = 0;
  let creditsConsumed = 0;
  for (const row of creditRows ?? []) {
    const amt = row.amount || 0;
    if (amt > 0) creditsIssued += amt;
    else creditsConsumed += Math.abs(amt);
  }

  // ---------- AI USAGE ----------
  const { data: usageRows } = await supabase
    .from('usage')
    .select('action_type, model, cost_usd, tokens_input, tokens_output, created_at')
    .gte('created_at', startOfMonth.toISOString());

  const aiCostThisMonth = (usageRows ?? []).reduce(
    (s, u) => s + Number(u.cost_usd || 0),
    0,
  );
  const modelCost: Record<string, number> = {};
  for (const u of usageRows ?? []) {
    const m = u.model || 'unknown';
    modelCost[m] = (modelCost[m] || 0) + Number(u.cost_usd || 0);
  }
  const topModels = Object.entries(modelCost)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4);

  // ---------- RECENT USER SIGNUPS ----------
  const { data: recentUsers } = await supabase
    .from('profiles')
    .select('id, email, full_name, plan, credits_balance, credits_purchased, created_at, is_admin')
    .order('created_at', { ascending: false })
    .limit(10);

  // ---------- RECENT PROJECTS ----------
  const { data: recentProjects } = await supabase
    .from('projects')
    .select('id, title, content_type, status, created_at, user_id')
    .order('created_at', { ascending: false })
    .limit(10);

  // ---------- COMPLIANCE SIGNAL ----------
  // Pull just the statutory deadlines of pending deletion + export
  // requests. We don't need the full rows — only enough to count
  // breached + approaching (<=5 day) items for the alert banner.
  // Scoped to pending statuses because terminal requests can't breach
  // any further.
  const { data: pendingDeletionDeadlines } = await supabase
    .from('data_deletion_requests')
    .select('statutory_deadline')
    .in('status', ['received', 'processing']);

  const { data: pendingExportDeadlines } = await supabase
    .from('data_exports')
    .select('statutory_deadline')
    .in('status', ['received', 'processing']);

  const complianceNow = Date.now();
  const fiveDaysMs = 5 * 24 * 60 * 60 * 1000;

  const breachedDeletions = (pendingDeletionDeadlines ?? []).filter(
    (r) => new Date(r.statutory_deadline).getTime() < complianceNow,
  ).length;
  const breachedExports = (pendingExportDeadlines ?? []).filter(
    (r) => new Date(r.statutory_deadline).getTime() < complianceNow,
  ).length;
  const approachingDeletions = (pendingDeletionDeadlines ?? []).filter((r) => {
    const delta = new Date(r.statutory_deadline).getTime() - complianceNow;
    return delta >= 0 && delta <= fiveDaysMs;
  }).length;
  const approachingExports = (pendingExportDeadlines ?? []).filter((r) => {
    const delta = new Date(r.statutory_deadline).getTime() - complianceNow;
    return delta >= 0 && delta <= fiveDaysMs;
  }).length;

  const breachedTotal = breachedDeletions + breachedExports;
  const approachingTotal = approachingDeletions + approachingExports;
  const pendingTotal =
    (pendingDeletionDeadlines ?? []).length + (pendingExportDeadlines ?? []).length;

  // ---------- RENDER ----------
  return (
    <div className="p-6 md:p-8 max-w-7xl mx-auto">
      {/* Header
          On mobile/tablet the title column and the four nav buttons
          previously shared a single flex row which crammed everything.
          We stack vertically below `md` and let the action row wrap so
          no button gets clipped off the right edge on narrow viewports. */}
      <div className="mb-8 flex flex-col md:flex-row md:items-start md:justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <ShieldCheck className="h-5 w-5 text-primary" />
            <span className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">
              Command Center
            </span>
          </div>
          <h1 className="text-3xl font-bold tracking-tight">Founder View</h1>
          <p className="text-muted-foreground mt-1">
            Live business snapshot. Numbers are direct reads from production.
          </p>
        </div>
        <div className="flex flex-col items-start md:items-end gap-2 md:shrink-0">
          <div className="flex flex-wrap items-center gap-2">
            <Link
              href="/admin/guild"
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-semibold border hover:bg-muted whitespace-nowrap"
            >
              <ShieldCheck className="h-3.5 w-3.5" /> Guild review
            </Link>
            <Link
              href="/admin/guild/payouts"
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-semibold border hover:bg-muted whitespace-nowrap"
            >
              <DollarSign className="h-3.5 w-3.5" /> Guild payouts
            </Link>
            <Link
              href="/admin/command-center/grants"
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-semibold border hover:bg-muted whitespace-nowrap"
            >
              <Send className="h-3.5 w-3.5" /> Send credits
            </Link>
            <a
              href="https://store.penworth.ai/admin"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-semibold border hover:bg-muted whitespace-nowrap"
            >
              <ExternalLink className="h-3.5 w-3.5" /> Store Admin
            </a>
            <Link
              href="/admin/compliance"
              className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-semibold border hover:bg-muted whitespace-nowrap ${
                breachedTotal > 0
                  ? 'border-red-500/60 bg-red-50 text-red-700 hover:bg-red-100 dark:bg-red-950/30 dark:text-red-300'
                  : approachingTotal > 0
                  ? 'border-amber-500/60 bg-amber-50 text-amber-700 hover:bg-amber-100 dark:bg-amber-950/30 dark:text-amber-300'
                  : ''
              }`}
            >
              <Scale className="h-3.5 w-3.5" /> Compliance
              {breachedTotal > 0 && (
                <span className="ml-1 inline-flex items-center justify-center min-w-5 h-5 px-1.5 rounded-full bg-red-600 text-white text-[10px] font-bold">
                  {breachedTotal}
                </span>
              )}
              {breachedTotal === 0 && approachingTotal > 0 && (
                <span className="ml-1 inline-flex items-center justify-center min-w-5 h-5 px-1.5 rounded-full bg-amber-600 text-white text-[10px] font-bold">
                  {approachingTotal}
                </span>
              )}
            </Link>
          </div>
          <div className="text-xs text-muted-foreground">
            Last refreshed {new Date().toLocaleTimeString()}
          </div>
        </div>
      </div>

      {/* Compliance alert — only renders when breached or approaching deadlines exist */}
      {(breachedTotal > 0 || approachingTotal > 0) && (
        <Link
          href="/admin/compliance"
          className={`block mb-6 rounded-xl border p-4 transition-colors ${
            breachedTotal > 0
              ? 'border-red-500/60 bg-red-50 hover:bg-red-100 dark:bg-red-950/30 dark:hover:bg-red-950/50'
              : 'border-amber-500/60 bg-amber-50 hover:bg-amber-100 dark:bg-amber-950/30 dark:hover:bg-amber-950/50'
          }`}
        >
          <div className="flex items-start gap-3">
            <AlertTriangle
              className={`h-5 w-5 shrink-0 mt-0.5 ${
                breachedTotal > 0 ? 'text-red-600' : 'text-amber-600'
              }`}
            />
            <div className="flex-1 min-w-0">
              <div
                className={`font-semibold text-sm ${
                  breachedTotal > 0
                    ? 'text-red-900 dark:text-red-200'
                    : 'text-amber-900 dark:text-amber-200'
                }`}
              >
                {breachedTotal > 0
                  ? `${breachedTotal} compliance request${breachedTotal === 1 ? '' : 's'} past statutory deadline`
                  : `${approachingTotal} compliance request${approachingTotal === 1 ? '' : 's'} approaching deadline (≤5 days)`}
              </div>
              <div
                className={`text-xs mt-0.5 ${
                  breachedTotal > 0
                    ? 'text-red-700 dark:text-red-300'
                    : 'text-amber-700 dark:text-amber-300'
                }`}
              >
                {breachedTotal > 0
                  ? 'Legal breach. Fulfil immediately.'
                  : 'Prioritise these before they breach.'}
                {breachedTotal > 0 && approachingTotal > 0 && (
                  <> &middot; {approachingTotal} more approaching.</>
                )}
                {' '}Click to open the compliance dashboard &rarr;
              </div>
            </div>
            <div
              className={`text-xs tabular-nums shrink-0 ${
                breachedTotal > 0
                  ? 'text-red-700 dark:text-red-300'
                  : 'text-amber-700 dark:text-amber-300'
              }`}
            >
              {pendingTotal} pending
            </div>
          </div>
        </Link>
      )}

      {/* Top metric cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <MetricCard
          label="Total users"
          value={(totalUsers || 0).toLocaleString()}
          sub={`${paidUsers.toLocaleString()} paid · ${(planCounts.free || 0).toLocaleString()} free`}
          icon={Users}
          accent="text-blue-600"
        />
        <MetricCard
          label="MRR estimate"
          value={`$${mrrEstimate.toLocaleString()}`}
          sub={`${planCounts.pro || 0} Pro · ${planCounts.max || 0} Max`}
          icon={DollarSign}
          accent="text-emerald-600"
        />
        <MetricCard
          label="Projects"
          value={(totalProjects || 0).toLocaleString()}
          sub={`${(projectsThisMonth || 0).toLocaleString()} this month · ${(completedProjects || 0).toLocaleString()} published`}
          icon={FileText}
          accent="text-violet-600"
        />
        <MetricCard
          label="AI cost (MTD)"
          value={`$${aiCostThisMonth.toFixed(2)}`}
          sub={`${(usageRows ?? []).length.toLocaleString()} calls`}
          icon={Cpu}
          accent="text-amber-600"
        />
      </div>

      {/* Second row — content + credit economy */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <MetricCard
          label="Chapters written"
          value={(totalChapters || 0).toLocaleString()}
          sub={`${(totalWords / 1000).toFixed(0)}k total words`}
          icon={BookOpen}
          accent="text-sky-600"
        />
        <MetricCard
          label="Credits issued"
          value={creditsIssued.toLocaleString()}
          sub="All-time monthly grants + purchases + bonuses"
          icon={Coins}
          accent="text-emerald-600"
        />
        <MetricCard
          label="Credits consumed"
          value={creditsConsumed.toLocaleString()}
          sub="All-time generations + regenerations"
          icon={TrendingUp}
          accent="text-rose-600"
        />
        <MetricCard
          label="Burn ratio"
          value={
            creditsIssued > 0
              ? `${((creditsConsumed / creditsIssued) * 100).toFixed(0)}%`
              : '—'
          }
          sub="Consumed ÷ issued"
          icon={Coins}
          accent="text-amber-600"
        />
      </div>

      {/* AI model cost breakdown */}
      {topModels.length > 0 && (
        <div className="rounded-xl border bg-card p-5 mb-6">
          <h2 className="font-semibold mb-4 flex items-center gap-2">
            <Cpu className="h-4 w-4" /> AI spend by model (this month)
          </h2>
          <div className="space-y-2">
            {topModels.map(([model, cost]) => {
              const pct = aiCostThisMonth > 0 ? (cost / aiCostThisMonth) * 100 : 0;
              return (
                <div key={model}>
                  <div className="flex items-center justify-between text-sm mb-1">
                    <span className="font-mono">{model}</span>
                    <span className="tabular-nums">${cost.toFixed(2)} ({pct.toFixed(0)}%)</span>
                  </div>
                  <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                    <div
                      className="h-full bg-primary"
                      style={{ width: `${Math.min(100, pct)}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Two-column: users + projects */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Recent signups */}
        <div className="rounded-xl border bg-card p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold flex items-center gap-2">
              <Users className="h-4 w-4" /> Recent signups
            </h2>
            <span className="text-xs text-muted-foreground">Last 10</span>
          </div>
          <div className="space-y-2">
            {(recentUsers ?? []).map((u) => {
              const total = (u.credits_balance || 0) + (u.credits_purchased || 0);
              return (
                <div
                  key={u.id}
                  className="flex items-center justify-between gap-3 rounded-lg border bg-background px-3 py-2"
                >
                  <div className="min-w-0">
                    <div className="text-sm font-medium truncate">
                      {u.full_name || u.email || u.id.slice(0, 8)}
                      {u.is_admin && (
                        <span className="ml-2 text-[10px] uppercase tracking-wider bg-primary/10 text-primary px-1.5 py-0.5 rounded">
                          Admin
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground truncate">
                      {u.email}
                    </div>
                  </div>
                  <div className="flex flex-col items-end shrink-0">
                    <span
                      className={`text-[10px] uppercase tracking-wider font-semibold ${
                        u.plan === 'max'
                          ? 'text-emerald-600'
                          : u.plan === 'pro'
                          ? 'text-blue-600'
                          : 'text-muted-foreground'
                      }`}
                    >
                      {u.plan || 'free'}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {total.toLocaleString()} cr
                    </span>
                  </div>
                </div>
              );
            })}
            {(recentUsers ?? []).length === 0 && (
              <div className="text-sm text-muted-foreground text-center py-4">
                No users yet
              </div>
            )}
          </div>
        </div>

        {/* Recent projects */}
        <div className="rounded-xl border bg-card p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold flex items-center gap-2">
              <FileText className="h-4 w-4" /> Recent projects
            </h2>
            <span className="text-xs text-muted-foreground">Last 10</span>
          </div>
          <div className="space-y-2">
            {(recentProjects ?? []).map((p) => (
              <Link
                key={p.id}
                href={`/projects/${p.id}/editor`}
                className="flex items-center justify-between gap-3 rounded-lg border bg-background px-3 py-2 hover:border-primary transition-colors"
              >
                <div className="min-w-0">
                  <div className="text-sm font-medium truncate">
                    {p.title || 'Untitled'}
                  </div>
                  <div className="text-xs text-muted-foreground truncate">
                    {p.content_type} · {formatDistanceToNow(new Date(p.created_at), { addSuffix: false })} ago
                  </div>
                </div>
                <StatusBadge status={p.status} />
              </Link>
            ))}
            {(recentProjects ?? []).length === 0 && (
              <div className="text-sm text-muted-foreground text-center py-4">
                No projects yet
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// =============================================================================
// HELPERS
// =============================================================================

function MetricCard({
  label,
  value,
  sub,
  icon: Icon,
  accent,
}: {
  label: string;
  value: string;
  sub?: string;
  icon: React.ComponentType<{ className?: string }>;
  accent: string;
}) {
  return (
    <div className="rounded-xl border bg-card p-5">
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">
          {label}
        </span>
        <Icon className={`h-4 w-4 ${accent}`} />
      </div>
      <div className="text-2xl font-bold tabular-nums">{value}</div>
      {sub && <div className="text-xs text-muted-foreground mt-1">{sub}</div>}
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    draft: 'bg-muted text-muted-foreground',
    in_progress: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
    writing: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
    complete: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
    published: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
    review: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
  };
  const cls = colors[status] || colors.draft;
  return (
    <span className={`text-[10px] uppercase tracking-wider font-semibold px-2 py-0.5 rounded shrink-0 ${cls}`}>
      {status.replace('_', ' ')}
    </span>
  );
}
