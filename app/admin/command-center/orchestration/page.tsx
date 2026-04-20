import { requireAdminRole } from '@/lib/admin/require-admin-role';
import { createServiceClient } from '@/lib/supabase/service';
import { ListTodo, Clock, AlertTriangle, CheckCircle2, Ban, Pause, Hourglass, Hammer } from 'lucide-react';
import Link from 'next/link';
import { formatDistanceToNow } from 'date-fns';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

/**
 * /admin/command-center/orchestration
 *
 * Founder's live view of the CEO Claude's task queue. This is what
 * the Founder sees to know what is being worked on, what is stuck,
 * and what is waiting on their decision — at any moment, no lag.
 *
 * Data source: ceo_orchestration_tasks table. The CEO Claude session
 * writes to this table; every row is the source of truth for one unit
 * of work. Read-only here; editing flows through the CEO conversation.
 *
 * Super-admin only. Every other admin role is redirected by
 * requireAdminRole below.
 */
type Task = {
  id: string;
  task_code: string;
  title: string;
  description: string;
  category: string;
  priority: 'p0' | 'p1' | 'p2' | 'p3';
  status: 'open' | 'in_progress' | 'blocked' | 'awaiting_founder' | 'done' | 'cancelled';
  owner: 'ceo' | 'claude_code' | 'founder' | 'external';
  blocker: string | null;
  brief_path: string | null;
  acceptance_test: string | null;
  origin_handover: string | null;
  created_at: string;
  updated_at: string;
  started_at: string | null;
  completed_at: string | null;
  last_update_note: string | null;
};

export default async function OrchestrationPage() {
  const session = await requireAdminRole('super_admin');

  const admin = createServiceClient();
  const { data: tasks, error } = await admin
    .from('ceo_orchestration_tasks')
    .select('*')
    .order('priority', { ascending: true })
    .order('created_at', { ascending: true })
    .returns<Task[]>();

  if (error) {
    console.error('[orchestration] query failed:', error);
  }

  const rows = tasks ?? [];
  const active = rows.filter(t => t.status !== 'done' && t.status !== 'cancelled');
  const done = rows.filter(t => t.status === 'done');

  // Status-by-category and status-by-owner breakdowns for the header cards.
  const byStatus = rows.reduce<Record<string, number>>((acc, t) => {
    acc[t.status] = (acc[t.status] ?? 0) + 1;
    return acc;
  }, {});
  const byOwner = active.reduce<Record<string, number>>((acc, t) => {
    acc[t.owner] = (acc[t.owner] ?? 0) + 1;
    return acc;
  }, {});

  // Group active tasks by category for display
  const grouped = active.reduce<Record<string, Task[]>>((acc, t) => {
    (acc[t.category] ??= []).push(t);
    return acc;
  }, {});
  const categoryOrder: string[] = [
    'pipeline', 'command-center', 'guild', 'store', 'writing',
    'compliance', 'security', 'ai-cost', 'infra', 'marketing',
    'legal-ip', 'investor', 'orchestration', 'misc',
  ].filter(c => grouped[c]?.length);

  return (
    <div className="p-6 md:p-8 max-w-7xl mx-auto">
      {/* Header */}
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <ListTodo className="h-5 w-5 text-primary" />
            <span className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">
              Orchestration queue
            </span>
            <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-primary/10 text-primary">
              super admin
            </span>
          </div>
          <h1 className="text-3xl font-bold tracking-tight">
            Everything the CEO is orchestrating
          </h1>
          <p className="text-muted-foreground mt-1 text-sm">
            Live from <code className="text-xs">ceo_orchestration_tasks</code>. Read-only. The CEO Claude session writes to this table.
          </p>
        </div>
        <Link
          href="/admin/command-center"
          className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border hover:bg-muted text-sm font-semibold"
        >
          ← Command Center
        </Link>
      </div>

      {/* Status summary strip */}
      <div className="grid grid-cols-2 md:grid-cols-6 gap-3 mb-8">
        <StatusStat label="Open" count={byStatus.open ?? 0} icon={ListTodo} tone="default" />
        <StatusStat label="In progress" count={byStatus.in_progress ?? 0} icon={Hammer} tone="info" />
        <StatusStat label="Awaiting you" count={byStatus.awaiting_founder ?? 0} icon={Hourglass} tone="warn" />
        <StatusStat label="Blocked" count={byStatus.blocked ?? 0} icon={Pause} tone="warn" />
        <StatusStat label="Cancelled" count={byStatus.cancelled ?? 0} icon={Ban} tone="muted" />
        <StatusStat label="Done" count={byStatus.done ?? 0} icon={CheckCircle2} tone="success" />
      </div>

      {/* Owner summary row */}
      <div className="mb-8 rounded-xl border bg-muted/30 p-4">
        <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-3">
          Active tasks by owner
        </h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
          <OwnerRow label="CEO (me)" count={byOwner.ceo ?? 0} hint="I ship these myself" />
          <OwnerRow label="Claude Code" count={byOwner.claude_code ?? 0} hint="Dispatched via brief" />
          <OwnerRow label="You (founder)" count={byOwner.founder ?? 0} hint="Needs your decision or action" />
          <OwnerRow label="External" count={byOwner.external ?? 0} hint="Vendor, lawyer, pen-test firm" />
        </div>
      </div>

      {/* Active tasks by category */}
      {categoryOrder.length === 0 ? (
        <div className="rounded-xl border p-8 text-center text-muted-foreground">
          No active tasks. Queue is clear.
        </div>
      ) : (
        <div className="space-y-8">
          {categoryOrder.map(cat => (
            <CategorySection key={cat} category={cat} tasks={grouped[cat]} />
          ))}
        </div>
      )}

      {/* Done section (collapsed by default via details tag) */}
      {done.length > 0 && (
        <details className="mt-10">
          <summary className="cursor-pointer text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-3 hover:text-foreground">
            Completed ({done.length})
          </summary>
          <div className="mt-4 space-y-2">
            {done
              .sort((a, b) => (b.completed_at ?? '').localeCompare(a.completed_at ?? ''))
              .slice(0, 20)
              .map(t => (
                <DoneRow key={t.id} task={t} />
              ))}
          </div>
        </details>
      )}

      {/* Footer hint */}
      <div className="mt-12 text-xs text-muted-foreground">
        Tasks refresh on page reload. The CEO Claude updates these rows during every session.
        To see the full log (including what the CEO said in `last_update_note`), run:
        <code className="block mt-2 px-2 py-1 rounded bg-muted text-foreground">
          SELECT * FROM ceo_orchestration_tasks ORDER BY priority, updated_at DESC;
        </code>
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Subcomponents
// ──────────────────────────────────────────────────────────────────────────

function StatusStat({
  label, count, icon: Icon, tone,
}: {
  label: string; count: number; icon: typeof ListTodo;
  tone: 'default' | 'info' | 'warn' | 'muted' | 'success';
}) {
  const toneClasses: Record<typeof tone, string> = {
    default: 'bg-background border',
    info: 'bg-blue-50 dark:bg-blue-950/30 border-blue-200 dark:border-blue-900',
    warn: 'bg-amber-50 dark:bg-amber-950/30 border-amber-200 dark:border-amber-900',
    muted: 'bg-muted border',
    success: 'bg-green-50 dark:bg-green-950/30 border-green-200 dark:border-green-900',
  };
  return (
    <div className={`rounded-xl p-4 ${toneClasses[tone]}`}>
      <div className="flex items-center gap-2 mb-1">
        <Icon className="h-4 w-4 text-muted-foreground" />
        <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          {label}
        </span>
      </div>
      <div className="text-2xl font-bold tabular-nums">{count}</div>
    </div>
  );
}

function OwnerRow({ label, count, hint }: { label: string; count: number; hint: string }) {
  return (
    <div>
      <div className="flex items-baseline gap-2">
        <span className="text-2xl font-bold tabular-nums">{count}</span>
        <span className="text-sm font-semibold">{label}</span>
      </div>
      <div className="text-xs text-muted-foreground mt-0.5">{hint}</div>
    </div>
  );
}

function CategorySection({ category, tasks }: { category: string; tasks: Task[] }) {
  return (
    <section>
      <h2 className="text-xs uppercase tracking-wider font-semibold text-muted-foreground mb-3">
        {category.replace('-', ' ')} <span className="text-foreground">({tasks.length})</span>
      </h2>
      <div className="space-y-2">
        {tasks.map(t => (
          <TaskCard key={t.id} task={t} />
        ))}
      </div>
    </section>
  );
}

function TaskCard({ task }: { task: Task }) {
  const priorityTone = {
    p0: 'border-red-400 dark:border-red-900 bg-red-50/50 dark:bg-red-950/20',
    p1: 'border-orange-300 dark:border-orange-900 bg-orange-50/40 dark:bg-orange-950/20',
    p2: 'border-amber-200 dark:border-amber-900/50 bg-background',
    p3: 'border bg-background',
  }[task.priority];

  const statusBadge = statusBadgeFor(task.status);
  const ownerBadge = ownerBadgeFor(task.owner);
  const prioBadge = priorityBadgeFor(task.priority);

  const age = formatDistanceToNow(new Date(task.updated_at), { addSuffix: true });

  return (
    <div className={`rounded-lg border-l-4 ${priorityTone} p-4`}>
      <div className="flex items-start justify-between gap-4 mb-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <span className="text-xs font-mono font-semibold text-muted-foreground">
              {task.task_code}
            </span>
            {prioBadge}
            {statusBadge}
            {ownerBadge}
          </div>
          <h3 className="font-semibold text-base leading-snug">{task.title}</h3>
        </div>
        <div className="text-xs text-muted-foreground whitespace-nowrap pt-1">
          {age}
        </div>
      </div>
      <p className="text-sm text-muted-foreground mb-3 leading-relaxed">
        {task.description}
      </p>
      {task.blocker && (
        <div className="rounded-md bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900/50 p-2 mb-2">
          <div className="flex gap-2 text-xs">
            <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
            <div>
              <span className="font-semibold text-amber-900 dark:text-amber-200">Blocker: </span>
              <span className="text-amber-900 dark:text-amber-200">{task.blocker}</span>
            </div>
          </div>
        </div>
      )}
      {task.last_update_note && (
        <div className="text-xs text-muted-foreground italic border-l-2 border-muted pl-2">
          Last update: {task.last_update_note}
        </div>
      )}
      {task.acceptance_test && (
        <details className="mt-2 text-xs">
          <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
            Acceptance test
          </summary>
          <p className="mt-1 text-muted-foreground pl-2 border-l-2 border-muted">
            {task.acceptance_test}
          </p>
        </details>
      )}
    </div>
  );
}

function DoneRow({ task }: { task: Task }) {
  return (
    <div className="flex items-center gap-3 py-2 border-b last:border-0 text-sm">
      <CheckCircle2 className="h-4 w-4 text-green-600 shrink-0" />
      <span className="text-xs font-mono text-muted-foreground">{task.task_code}</span>
      <span className="flex-1 truncate">{task.title}</span>
      {task.completed_at && (
        <span className="text-xs text-muted-foreground whitespace-nowrap">
          {formatDistanceToNow(new Date(task.completed_at), { addSuffix: true })}
        </span>
      )}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Badge helpers
// ──────────────────────────────────────────────────────────────────────────
function statusBadgeFor(status: Task['status']) {
  const map: Record<Task['status'], { label: string; cls: string }> = {
    open: { label: 'Open', cls: 'bg-muted text-foreground' },
    in_progress: { label: 'In progress', cls: 'bg-blue-100 text-blue-900 dark:bg-blue-900/40 dark:text-blue-200' },
    blocked: { label: 'Blocked', cls: 'bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-200' },
    awaiting_founder: { label: 'Awaiting you', cls: 'bg-purple-100 text-purple-900 dark:bg-purple-900/40 dark:text-purple-200' },
    done: { label: 'Done', cls: 'bg-green-100 text-green-900 dark:bg-green-900/40 dark:text-green-200' },
    cancelled: { label: 'Cancelled', cls: 'bg-muted text-muted-foreground line-through' },
  };
  const { label, cls } = map[status];
  return (
    <span className={`text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded font-semibold ${cls}`}>
      {label}
    </span>
  );
}

function ownerBadgeFor(owner: Task['owner']) {
  const map: Record<Task['owner'], { label: string; cls: string }> = {
    ceo: { label: 'CEO', cls: 'bg-primary/10 text-primary' },
    claude_code: { label: 'Claude Code', cls: 'bg-indigo-100 text-indigo-900 dark:bg-indigo-900/40 dark:text-indigo-200' },
    founder: { label: 'Founder', cls: 'bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-200' },
    external: { label: 'External', cls: 'bg-slate-200 text-slate-800 dark:bg-slate-800 dark:text-slate-200' },
  };
  const { label, cls } = map[owner];
  return (
    <span className={`text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded font-semibold ${cls}`}>
      {label}
    </span>
  );
}

function priorityBadgeFor(priority: Task['priority']) {
  const map: Record<Task['priority'], { label: string; cls: string }> = {
    p0: { label: 'P0', cls: 'bg-red-600 text-white' },
    p1: { label: 'P1', cls: 'bg-orange-500 text-white' },
    p2: { label: 'P2', cls: 'bg-amber-400 text-amber-950' },
    p3: { label: 'P3', cls: 'bg-muted text-foreground' },
  };
  const { label, cls } = map[priority];
  return (
    <span className={`text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded font-bold ${cls}`}>
      {label}
    </span>
  );
}
