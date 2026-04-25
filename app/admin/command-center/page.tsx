import { requireAdminRole, type AdminRole } from '@/lib/admin/require-admin-role';
import { createServiceClient } from '@/lib/supabase/service';
import {
  AlertTriangle,
  Activity,
  Coins,
  DollarSign,
  LifeBuoy,
  ShieldCheck,
  Bell,
  Cpu,
  Users,
  ListTodo,
  Settings,
  ExternalLink,
} from 'lucide-react';
import Link from 'next/link';
import { formatDistanceToNow } from 'date-fns';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

/**
 * /admin/command-center
 *
 * Founder's instrument panel. Per-role visibility:
 *
 *   super_admin    — every panel (system capacity, pipeline, agent load,
 *                    incidents, alerts, financial, CS)
 *   ops_admin      — pipeline + agent load + incidents + CS ticket counts
 *   finance_admin  — MRR / webhook health / commission / AI cost panels
 *   cs_admin       — open tickets + stuck sessions + probation members
 *
 * Hydration is a single query against the role-specific view
 * (v_command_center_{super_admin,ops,finance,cs}). Each view has a
 * has_admin_role() WHERE clause so a non-scoped admin who somehow
 * reached this route would get an empty result rather than data
 * leakage — though they shouldn't reach it, because the layout +
 * requireAdminRole gate them first.
 *
 * Alerts UI (notification bell, ack/resolve buttons) comes in a
 * follow-up commit — this page is the first cut.
 */
export default async function CommandCenterPage() {
  // Any admin role can land here; scoping happens per-panel below.
  const session = await requireAdminRole();

  const admin = createServiceClient();
  // We fetch the super_admin view unconditionally for super_admins;
  // for scoped admins we fetch their specific view. The super_admin
  // view composes the ops/finance/cs panels already, so super_admins
  // need only one round-trip.
  const view = roleToView(session.adminRole);
  const { data: dashData, error: dashErr } = await admin
    .from(view)
    .select('*')
    .maybeSingle();

  if (dashErr) {
    console.error(`[command-center] ${view} query failed:`, dashErr);
  }

  // Pending alerts count (for the notification bell). This is a
  // separate query because it's per-admin-view (unacknowledged across
  // the whole system) not scoped to a role.
  const { count: unackCount } = await admin
    .from('alert_log')
    .select('*', { count: 'exact', head: true })
    .is('acknowledged_at', null)
    .in('delivery_status', ['sent', 'pending']);

  return (
    <div className="p-6 md:p-8 max-w-7xl mx-auto">
      {/* ---- header ----
          Stack vertically on mobile/tablet; action buttons wrap so
          Orchestration/Settings/Alerts don't overflow the right edge. */}
      <div className="mb-6 flex flex-col md:flex-row md:items-start md:justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <ShieldCheck className="h-5 w-5 text-primary" />
            <span className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">
              Command Center
            </span>
            <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-primary/10 text-primary">
              {session.adminRole.replace('_', ' ')}
            </span>
          </div>
          <h1 className="text-3xl font-bold tracking-tight">
            {session.adminRole === 'super_admin' ? 'Founder view' : dashboardLabel(session.adminRole)}
          </h1>
          <p className="text-muted-foreground mt-1 text-sm">
            Live reads from production. No estimates.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 md:shrink-0">
          {session.adminRole === 'super_admin' && (
            <Link
              href="/admin/command-center/orchestration"
              className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border hover:bg-muted whitespace-nowrap"
            >
              <ListTodo className="h-4 w-4" />
              <span className="text-sm font-semibold">Orchestration</span>
            </Link>
          )}
          {session.adminRole === 'super_admin' && (
            <Link
              href="/admin/command-center/settings/recipients"
              className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border hover:bg-muted whitespace-nowrap"
            >
              <Settings className="h-4 w-4" />
              <span className="text-sm font-semibold">Settings</span>
            </Link>
          )}
          {session.adminRole === 'super_admin' && (
            <Link
              href="/admin/command-center/grants"
              className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border hover:bg-muted whitespace-nowrap"
            >
              <Coins className="h-4 w-4" />
              <span className="text-sm font-semibold">Grant credits</span>
            </Link>
          )}
          {session.adminRole === 'super_admin' && (
            <a
              href="https://store.penworth.ai/admin"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border hover:bg-muted whitespace-nowrap"
            >
              <ExternalLink className="h-4 w-4" />
              <span className="text-sm font-semibold">Store Admin</span>
            </a>
          )}
          <Link
            href="/admin/command-center/alerts"
            className="relative inline-flex items-center gap-2 px-3 py-2 rounded-lg border hover:bg-muted whitespace-nowrap"
          >
            <Bell className="h-4 w-4" />
            <span className="text-sm font-semibold">Alerts</span>
            {typeof unackCount === 'number' && unackCount > 0 && (
              <span className="absolute -top-1 -right-1 inline-flex items-center justify-center h-5 min-w-[20px] px-1 rounded-full bg-red-500 text-white text-[10px] font-bold">
                {unackCount > 99 ? '99+' : unackCount}
              </span>
            )}
          </Link>
        </div>
      </div>

      {/* ---- NOW strip (always-visible live counters) ---- */}
      {(session.adminRole === 'super_admin' || session.adminRole === 'ops_admin' || session.adminRole === 'cs_admin') && (
        <NowStrip data={dashData} adminRole={session.adminRole} />
      )}

      {/* ---- super_admin-only: system capacity ---- */}
      {session.adminRole === 'super_admin' && dashData?.system_capacity && (
        <SystemCapacityPanel data={dashData.system_capacity} />
      )}

      {/* ---- pipeline incidents (ops + super) ---- */}
      {(session.adminRole === 'super_admin' || session.adminRole === 'ops_admin') && (
        <IncidentsPanel incidents={(dashData?.recent_incidents as any[]) ?? []} />
      )}

      {/* ---- agent load (ops + super) ---- */}
      {(session.adminRole === 'super_admin' || session.adminRole === 'ops_admin') && (
        <AgentLoadPanel data={(dashData?.agent_load as any[]) ?? []} />
      )}

      {/* ---- financial (finance + super) ---- */}
      {(session.adminRole === 'super_admin' || session.adminRole === 'finance_admin') && (
        <FinancePanel data={dashData} />
      )}

      {/* ---- support (cs + super) ---- */}
      {(session.adminRole === 'super_admin' || session.adminRole === 'cs_admin') && (
        <SupportPanel data={dashData} adminRole={session.adminRole} />
      )}

      {/* ---- recent alerts (super only) ---- */}
      {session.adminRole === 'super_admin' && Array.isArray(dashData?.recent_alerts) && (
        <RecentAlertsPanel alerts={dashData.recent_alerts as any[]} />
      )}
    </div>
  );
}

// ===========================================================================
// HELPERS
// ===========================================================================

function roleToView(role: AdminRole): string {
  switch (role) {
    case 'super_admin':   return 'v_command_center_super_admin';
    case 'ops_admin':     return 'v_command_center_ops';
    case 'finance_admin': return 'v_command_center_finance';
    case 'cs_admin':      return 'v_command_center_cs';
  }
}

function dashboardLabel(role: AdminRole): string {
  switch (role) {
    case 'ops_admin':     return 'Ops dashboard';
    case 'finance_admin': return 'Finance dashboard';
    case 'cs_admin':      return 'Support dashboard';
    default:              return 'Dashboard';
  }
}

// ===========================================================================
// PANELS
// ===========================================================================

function NowStrip({ data, adminRole }: { data: any; adminRole: AdminRole }) {
  const pipeline = adminRole === 'super_admin' ? data?.pipeline_health : data?.pipeline_health ?? {};
  const capacity = adminRole === 'super_admin' ? data?.system_capacity : null;

  const pipelinesRunning =
    capacity?.pipelines_running_now ?? pipeline?.sessions_active ?? '—';
  const noraActive = capacity?.nora_active_now ?? '—';
  const stuckNow = pipeline?.sessions_stuck ?? 0;
  const successRate = pipeline?.success_rate_24h_pct;

  const stuckColor = Number(stuckNow) > 0 ? 'text-red-500' : 'text-emerald-500';

  return (
    <div className="mb-6 grid grid-cols-2 md:grid-cols-4 gap-3">
      <NowCell icon={Activity} label="Pipelines running" value={pipelinesRunning} accent="text-sky-500" />
      <NowCell icon={Users} label="Nora chats (live)" value={noraActive} accent="text-violet-500" />
      <NowCell icon={AlertTriangle} label="Sessions stuck" value={stuckNow} accent={stuckColor} />
      <NowCell
        icon={Activity}
        label="24h success"
        value={successRate != null ? `${Number(successRate).toFixed(0)}%` : '—'}
        accent="text-emerald-500"
      />
    </div>
  );
}

function NowCell({
  icon: Icon,
  label,
  value,
  accent,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string | number | null | undefined;
  accent: string;
}) {
  return (
    <div className="rounded-xl border bg-card p-4">
      <div className="flex items-center justify-between mb-2">
        <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
          {label}
        </span>
        <Icon className={`h-4 w-4 ${accent}`} />
      </div>
      <div className={`text-2xl font-bold tabular-nums ${accent}`}>
        {value ?? '—'}
      </div>
    </div>
  );
}

function SystemCapacityPanel({ data }: { data: any }) {
  return (
    <div className="rounded-xl border bg-card p-5 mb-6">
      <h2 className="font-semibold flex items-center gap-2 mb-4">
        <Activity className="h-4 w-4 text-sky-500" /> System capacity
      </h2>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
        <CapacityStat label="Authors total" value={data?.total_authors} />
        <CapacityStat label="Paid authors" value={data?.paid_authors} />
        <CapacityStat label="Active 24h" value={data?.active_authors_24h} />
        <CapacityStat label="Guild active" value={data?.active_guildmembers} />
        <CapacityStat label="Guild probation" value={data?.probation_guildmembers} />
        <CapacityStat label="Readers total" value={data?.total_readers} />
        <CapacityStat label="Readers active 24h" value={data?.active_readers_24h} />
        <CapacityStat label="Tokens (last hr)" value={Number(data?.tokens_last_hour ?? 0).toLocaleString()} />
      </div>
    </div>
  );
}

function CapacityStat({ label, value }: { label: string; value: string | number | null | undefined }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
        {label}
      </div>
      <div className="text-lg font-bold tabular-nums">
        {value == null ? '—' : Number(value).toLocaleString()}
      </div>
    </div>
  );
}

function IncidentsPanel({ incidents }: { incidents: any[] }) {
  const open = incidents.filter((i) => i.resolved === false);

  return (
    <div className="rounded-xl border bg-card p-5 mb-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="font-semibold flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 text-amber-500" />
          Pipeline incidents
        </h2>
        <span className="text-xs text-muted-foreground">
          {open.length} open · {incidents.length} recent
        </span>
      </div>
      {incidents.length === 0 ? (
        <p className="text-sm text-muted-foreground py-4 text-center">
          No recent incidents.
        </p>
      ) : (
        <div className="space-y-2">
          {incidents.slice(0, 10).map((inc) => (
            <div
              key={inc.id}
              className={`flex items-center justify-between gap-3 rounded-lg border px-3 py-2 ${
                inc.resolved
                  ? 'bg-background'
                  : 'bg-red-500/5 border-red-500/30'
              }`}
            >
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium flex items-center gap-2">
                  <SeverityBadge severity={inc.severity} />
                  <span className="truncate">
                    {inc.incident_type.replace('_', ' ')} · {inc.agent ?? '—'}
                  </span>
                </div>
                <div className="text-xs text-muted-foreground mt-0.5">
                  {formatDistanceToNow(new Date(inc.detected_at), {
                    addSuffix: true,
                  })}
                  {' · session '}
                  <code className="font-mono">{String(inc.session_id).slice(0, 8)}</code>
                </div>
              </div>
              <Link
                href={`/admin/command-center/incidents/${inc.id}`}
                className="text-xs font-semibold text-primary hover:underline shrink-0"
              >
                {inc.resolved ? 'View' : 'Resolve →'}
              </Link>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function AgentLoadPanel({ data }: { data: any[] }) {
  if (!Array.isArray(data) || data.length === 0) return null;

  return (
    <div className="rounded-xl border bg-card p-5 mb-6">
      <h2 className="font-semibold flex items-center gap-2 mb-4">
        <Activity className="h-4 w-4 text-violet-500" />
        Agent load
      </h2>
      <div className="space-y-2">
        {data.map((row: any) => (
          <div key={row.current_agent} className="flex items-center gap-3">
            <div className="w-24 text-xs font-mono text-muted-foreground">
              {row.current_agent}
            </div>
            <div className="flex-1 flex items-center gap-4 text-xs">
              <LoadStat label="Running" value={row.truly_running_now} accent="text-sky-500" />
              <LoadStat label="Active" value={row.marked_active} accent="text-muted-foreground" />
              <LoadStat label="Stuck" value={row.stuck} accent="text-red-500" />
              <LoadStat label="Done 1h" value={row.completed_last_hour} accent="text-emerald-500" />
              <LoadStat label="Fail 1h" value={row.failed_last_hour} accent="text-red-400" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function LoadStat({ label, value, accent }: { label: string; value: string | number | null | undefined; accent: string }) {
  return (
    <div className="flex items-baseline gap-1">
      <span className={`font-bold tabular-nums ${accent}`}>{value ?? 0}</span>
      <span className="text-muted-foreground">{label}</span>
    </div>
  );
}

function FinancePanel({ data }: { data: any }) {
  // For super_admin, financial fields sit at the top-level of the view.
  // For finance_admin, the whole row IS the finance view. Shape is the
  // same either way.
  return (
    <div className="rounded-xl border bg-card p-5 mb-6">
      <h2 className="font-semibold flex items-center gap-2 mb-4">
        <DollarSign className="h-4 w-4 text-emerald-500" />
        Financial
      </h2>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
        <FinStat label="Stripe webhooks failed" value={data?.stripe_failures ?? data?.stripe_webhook_failures} accent={Number(data?.stripe_failures ?? 0) > 0 ? 'text-red-500' : undefined} />
        <FinStat
          label="Mins since last webhook"
          value={
            data?.minutes_since_last_webhook != null
              ? Number(data.minutes_since_last_webhook).toFixed(0)
              : '—'
          }
          accent={Number(data?.minutes_since_last_webhook ?? 0) > 360 ? 'text-red-500' : undefined}
        />
        <FinStat label="AI cost 1h" value={data?.ai_cost_1h != null ? `$${Number(data.ai_cost_1h).toFixed(2)}` : '—'} />
        <FinStat label="AI cost 24h" value={data?.ai_cost_24h != null ? `$${Number(data.ai_cost_24h).toFixed(2)}` : '—'} />
        {data?.ai_cost_mtd != null && (
          <FinStat label="AI cost MTD" value={`$${Number(data.ai_cost_mtd).toFixed(2)}`} />
        )}
        {data?.pending_commissions != null && (
          <FinStat label="Commissions pending" value={data.pending_commissions} />
        )}
        {data?.pending_commission_usd != null && (
          <FinStat label="Commissions $ pending" value={`$${Number(data.pending_commission_usd).toFixed(2)}`} />
        )}
        {data?.queued_payouts != null && (
          <FinStat label="Payouts queued" value={data.queued_payouts} />
        )}
      </div>
    </div>
  );
}

function FinStat({
  label,
  value,
  accent,
}: {
  label: string;
  value: string | number | null | undefined;
  accent?: string;
}) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
        {label}
      </div>
      <div className={`text-lg font-bold tabular-nums ${accent ?? ''}`}>
        {value as any}
      </div>
    </div>
  );
}

function SupportPanel({ data, adminRole }: { data: any; adminRole: AdminRole }) {
  const openTickets = adminRole === 'super_admin' ? data?.tickets_open : data?.tickets_open_count;
  const noraConvos = adminRole === 'super_admin' ? data?.nora_active_1h : data?.nora_conversations_24h;
  const fraud = data?.open_fraud_flags;
  const probation = adminRole === 'super_admin' ? data?.members_probation : data?.members_on_probation;
  const failures = adminRole === 'cs_admin' ? data?.authors_with_failures_24h : undefined;

  return (
    <div className="rounded-xl border bg-card p-5 mb-6">
      <h2 className="font-semibold flex items-center gap-2 mb-4">
        <LifeBuoy className="h-4 w-4 text-sky-500" />
        Support
      </h2>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
        <FinStat label="Tickets open" value={openTickets ?? '—'} />
        <FinStat
          label={adminRole === 'super_admin' ? 'Nora active (1h)' : 'Nora open convos 24h'}
          value={noraConvos ?? '—'}
        />
        <FinStat label="Members probation" value={probation ?? '—'} />
        <FinStat label="Fraud flags open" value={fraud ?? '—'} />
        {failures != null && (
          <FinStat
            label="Authors failed 24h"
            value={failures}
            accent={Number(failures) > 0 ? 'text-amber-500' : undefined}
          />
        )}
      </div>
    </div>
  );
}

function RecentAlertsPanel({ alerts }: { alerts: any[] }) {
  if (alerts.length === 0) return null;

  return (
    <div className="rounded-xl border bg-card p-5 mb-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="font-semibold flex items-center gap-2">
          <Bell className="h-4 w-4 text-primary" />
          Recent alerts
        </h2>
        <Link href="/admin/command-center/alerts" className="text-xs font-semibold text-primary hover:underline">
          View all →
        </Link>
      </div>
      <div className="space-y-2">
        {alerts.slice(0, 8).map((a) => (
          <div
            key={a.id}
            className="flex items-center justify-between gap-3 rounded-lg border bg-background px-3 py-2"
          >
            <div className="min-w-0 flex-1">
              <div className="text-sm flex items-center gap-2">
                <SeverityBadge severity={a.severity} />
                <span className="truncate">{a.title}</span>
              </div>
              <div className="text-xs text-muted-foreground mt-0.5">
                {formatDistanceToNow(new Date(a.sent_at), { addSuffix: true })} · {a.category} · {a.delivery_status}
              </div>
            </div>
            {!a.acknowledged_at && (
              <Link
                href={`/admin/command-center/alerts/${a.id}`}
                className="text-xs font-semibold text-primary hover:underline shrink-0"
              >
                Ack →
              </Link>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function SeverityBadge({ severity }: { severity: string }) {
  const map: Record<string, string> = {
    p0: 'bg-red-500 text-white',
    p1: 'bg-orange-500 text-white',
    p2: 'bg-amber-500 text-black',
    p3: 'bg-muted text-muted-foreground',
  };
  return (
    <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${map[severity] ?? map.p3}`}>
      {severity}
    </span>
  );
}
