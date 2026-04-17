import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';
import { Bot, ArrowRight } from 'lucide-react';

export const dynamic = 'force-dynamic';

/**
 * /admin/computer — list of every Penworth Computer session across all
 * users. Admin-only (layout enforces it). Gives the operator a single
 * pane to see what the robot is doing right now and post-mortem any
 * session that failed.
 */
export default async function AdminComputerPage() {
  const supabase = await createClient();
  const service = createServiceClient();

  const { data: sessions } = await service
    .from('computer_use_sessions')
    .select('id, user_id, project_id, platform_slug, status, turns_count, last_action, started_at, ended_at, error_message, result_url')
    .order('started_at', { ascending: false })
    .limit(100);

  // Hydrate display info — user emails + project titles
  const userIds = Array.from(new Set((sessions || []).map((s) => s.user_id)));
  const projectIds = Array.from(new Set((sessions || []).map((s) => s.project_id)));

  const [usersRes, projectsRes] = await Promise.all([
    userIds.length
      ? service.from('profiles').select('id, email, full_name').in('id', userIds)
      : Promise.resolve({ data: [] }),
    projectIds.length
      ? service.from('projects').select('id, title').in('id', projectIds)
      : Promise.resolve({ data: [] }),
  ]);

  const userMap = new Map((usersRes.data || []).map((u) => [u.id, u]));
  const projectMap = new Map((projectsRes.data || []).map((p) => [p.id, p]));

  // Session counts by status for the summary bar
  const active = (sessions || []).filter((s) =>
    ['queued', 'starting', 'running', 'awaiting_2fa', 'paused'].includes(s.status),
  ).length;
  const succeeded = (sessions || []).filter((s) => s.status === 'succeeded').length;
  const failed = (sessions || []).filter((s) => s.status === 'failed').length;

  return (
    <div className="max-w-7xl mx-auto px-6 py-8 space-y-6">
      <div>
        <div className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">
          Admin · Penworth Computer
        </div>
        <h1 className="text-3xl font-bold tracking-tight mt-1">Automation sessions</h1>
        <p className="text-muted-foreground mt-1">
          Every browser session the agent has opened on behalf of an author.
        </p>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-3 gap-3">
        <Stat label="Live now" count={active} tone="sky" />
        <Stat label="Succeeded" count={succeeded} tone="emerald" />
        <Stat label="Failed" count={failed} tone="red" />
      </div>

      {/* Table */}
      <div className="rounded-xl border overflow-hidden">
        <div className="grid grid-cols-[minmax(0,2fr)_minmax(0,2fr)_100px_90px_80px_100px_40px] gap-3 px-4 py-2.5 bg-muted/50 text-xs uppercase tracking-wider font-semibold text-muted-foreground">
          <div>Project</div>
          <div>Author</div>
          <div>Platform</div>
          <div>Status</div>
          <div>Turns</div>
          <div>Started</div>
          <div></div>
        </div>
        {(sessions || []).length === 0 && (
          <div className="px-4 py-12 text-center text-sm text-muted-foreground">
            <Bot className="h-8 w-8 mx-auto mb-2 opacity-40" />
            No automation sessions yet.
          </div>
        )}
        {(sessions || []).map((s) => {
          const u = userMap.get(s.user_id);
          const p = projectMap.get(s.project_id);
          return (
            <Link
              key={s.id}
              href={`/admin/computer/${s.id}`}
              className="grid grid-cols-[minmax(0,2fr)_minmax(0,2fr)_100px_90px_80px_100px_40px] gap-3 px-4 py-3 items-center border-t hover:bg-muted/30 transition text-sm"
            >
              <div className="min-w-0 truncate font-medium">{p?.title || 'Untitled'}</div>
              <div className="min-w-0 truncate text-muted-foreground">
                {u?.full_name || u?.email || s.user_id.slice(0, 8)}
              </div>
              <div className="text-xs font-medium">{s.platform_slug}</div>
              <div>
                <StatusChip status={s.status} />
              </div>
              <div className="tabular-nums text-xs text-muted-foreground">
                {s.turns_count || 0}
              </div>
              <div className="text-xs text-muted-foreground">
                {relativeTime(s.started_at)}
              </div>
              <ArrowRight className="h-4 w-4 text-muted-foreground" />
            </Link>
          );
        })}
      </div>
    </div>
  );
}

function Stat({ label, count, tone }: { label: string; count: number; tone: 'sky' | 'emerald' | 'red' }) {
  const tones = {
    sky: 'from-sky-500/10 border-sky-500/30',
    emerald: 'from-emerald-500/10 border-emerald-500/30',
    red: 'from-red-500/10 border-red-500/30',
  };
  return (
    <div className={`rounded-xl border bg-gradient-to-br to-transparent p-4 ${tones[tone]}`}>
      <div className="text-3xl font-bold tabular-nums">{count}</div>
      <div className="text-xs uppercase tracking-wider font-semibold text-muted-foreground mt-1">
        {label}
      </div>
    </div>
  );
}

function StatusChip({ status }: { status: string }) {
  const map: Record<string, { label: string; tone: string }> = {
    queued: { label: 'Queued', tone: 'bg-muted text-muted-foreground' },
    starting: { label: 'Starting', tone: 'bg-sky-500/15 text-sky-700 dark:text-sky-400' },
    running: { label: 'Running', tone: 'bg-sky-500/15 text-sky-700 dark:text-sky-400' },
    awaiting_2fa: { label: '2FA wait', tone: 'bg-amber-500/15 text-amber-700 dark:text-amber-500' },
    paused: { label: 'Paused', tone: 'bg-amber-500/15 text-amber-700 dark:text-amber-500' },
    succeeded: { label: 'Done', tone: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400' },
    failed: { label: 'Failed', tone: 'bg-red-500/15 text-red-700 dark:text-red-400' },
    cancelled: { label: 'Cancelled', tone: 'bg-muted text-muted-foreground' },
    timeout: { label: 'Timeout', tone: 'bg-red-500/15 text-red-700 dark:text-red-400' },
  };
  const cfg = map[status] || { label: status, tone: 'bg-muted text-muted-foreground' };
  return (
    <span className={`inline-flex px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider rounded-full ${cfg.tone}`}>
      {cfg.label}
    </span>
  );
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const s = Math.floor(diff / 1000);
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(iso).toLocaleDateString();
}
