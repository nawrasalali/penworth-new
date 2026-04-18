/**
 * Server-side helper for writing to the append-only audit_log table
 * (migration 015).
 *
 * Every financial transaction, admin action, attribution decision, and
 * data-state change that could be relevant to an investor, regulator,
 * or auditor goes through logAudit(). Consumers of the output:
 *
 *   - Command Center activity feed (real-time)
 *   - Monthly Investor Update (aggregate financials)
 *   - Quarterly Board Report (full activity log)
 *   - Due Diligence Data Room Export (7-year window)
 *
 * DESIGN CHOICES
 * --------------
 *
 * 1. BEST-EFFORT LOGGING. logAudit() never throws — it catches and logs
 *    to console.error so a failed audit write cannot break the action
 *    it was auditing. If the audit row fails, the action still succeeds.
 *    The trade-off: we tolerate rare missed rows in exchange for never
 *    taking down a Stripe webhook because Postgres hiccupped. A missed
 *    row is visible in ai_usage_log / stripe_webhook_events reconcile
 *    crons anyway.
 *
 * 2. SERVICE_ROLE WRITES. audit_log has RLS enabled and no INSERT policy
 *    for authenticated users. Writes go through the service-role client,
 *    which bypasses RLS. This means every call site must be server-side
 *    (API route, server component, Inngest handler, cron).
 *
 * 3. APPEND-ONLY AT THE DB LEVEL. Triggers in migration 015 reject
 *    UPDATE, DELETE, and TRUNCATE with the Australian Corporations Act
 *    s286/s290 error message. Even if a future contributor grants the
 *    wrong permissions, the triggers hold.
 *
 * 4. CANONICAL ACTION NAMES. Use dot-notation '<domain>.<verb>'. These
 *    names are stable keys used for report aggregation. Adding new
 *    actions is fine; renaming breaks historical reports. Current set:
 *
 *    PROJECTS:   project.create | project.delete | project.publish
 *    CREDITS:    credit.grant | credit.spend | credit.refund
 *    STRIPE:     subscription.activate | subscription.cancel
 *                | credit_pack.purchase | refund.issue
 *    GUILD:      guild.apply | guild.accept | guild.decline
 *                | guild.tier_promote | guild.probation_start
 *                | guild.probation_lift | guild.terminate
 *    ADMIN:      admin.impersonate | admin.override | admin.credit_adjust
 *    COMPUTER:   computer.session_start | computer.session_end
 *                | computer.platform_publish
 *
 * 5. SEVERITY. Default 'info'. Use 'warning' for deviations worth a
 *    human glance (failed Stripe reconciliation, >3 admin overrides in
 *    a day, etc). Use 'critical' only for events that should light up
 *    the Command Center alert lane: credit fraud flags, unauthorized
 *    admin attempt, Stripe webhook signature failure.
 *
 * NOT IN SCOPE FOR AUDIT_LOG
 * --------------------------
 * - User-facing product analytics (page views, feature clicks) → that's
 *   what analytics endpoints in app/api/track/ are for.
 * - Stripe webhook raw payloads → stripe_webhook_events has its own
 *   idempotency-tracking table.
 * - AI model usage per-request → ai_usage_log tracks tokens/cost.
 *
 * audit_log is the business/compliance layer, not the observability
 * layer.
 */

import { createServiceClient } from '@/lib/supabase/service';

// ----------------------------------------------------------------------------
// Canonical action names as a string-literal union type. New actions go
// here. Report aggregators key off this enum.
// ----------------------------------------------------------------------------

export type AuditAction =
  // Projects
  | 'project.create'
  | 'project.delete'
  | 'project.publish'
  // Credits
  | 'credit.grant'
  | 'credit.spend'
  | 'credit.refund'
  // Stripe
  | 'subscription.activate'
  | 'subscription.cancel'
  | 'credit_pack.purchase'
  | 'refund.issue'
  // Guild
  | 'guild.apply'
  | 'guild.accept'
  | 'guild.decline'
  | 'guild.tier_promote'
  | 'guild.probation_start'
  | 'guild.probation_lift'
  | 'guild.terminate'
  // Admin
  | 'admin.impersonate'
  | 'admin.override'
  | 'admin.credit_adjust'
  // Computer
  | 'computer.session_start'
  | 'computer.session_end'
  | 'computer.platform_publish';

export type AuditActorType =
  | 'user'
  | 'system'
  | 'stripe_webhook'
  | 'inngest'
  | 'cron'
  | 'admin';

export type AuditSeverity = 'info' | 'warning' | 'critical';

export interface AuditEvent {
  /** Who triggered this. 'user' / 'admin' require actorUserId; others don't. */
  actorType: AuditActorType;
  /** auth.users.id of the acting user (when applicable) */
  actorUserId?: string | null;
  /** Canonical dot-notation action name — see AuditAction union above */
  action: AuditAction;
  /**
   * The table or entity category the action targets. Typically lowercase
   * singular — 'project', 'subscription', 'credit_transaction',
   * 'guild_application', 'user'.
   */
  entityType: string;
  /**
   * The ID of the entity. UUID as string for most tables. Optional
   * because some system-level events (e.g. 'cron.run') affect no single
   * row.
   */
  entityId?: string | null;
  /**
   * State snapshot BEFORE the action. null for CREATE actions. For
   * UPDATE actions, include only the fields that changed (not the
   * whole row) to keep the audit log compact.
   */
  before?: Record<string, unknown> | null;
  /**
   * State snapshot AFTER the action. null for DELETE actions. Same
   * "changed fields only" rule as `before`.
   */
  after?: Record<string, unknown> | null;
  /**
   * Action-specific context: Stripe event ID, Inngest run ID, reason
   * codes, admin override justification, etc. Structured JSON rather
   * than free-form string so aggregators can query on it.
   */
  metadata?: Record<string, unknown>;
  /** Default 'info'. See file header for when to use warning/critical. */
  severity?: AuditSeverity;
  /** Request IP (from x-forwarded-for or equivalent). Optional. */
  ipAddress?: string | null;
  /** Request user-agent string. Optional. */
  userAgent?: string | null;
}

/**
 * Writes a single audit_log row via the service-role client.
 *
 * NEVER AWAITS IN THE CALLER'S CRITICAL PATH. If you can, fire-and-
 * forget with `void logAudit(...)`. If you do await it, wrap in a
 * try/catch that treats a logAudit failure as non-fatal.
 *
 * Returns { ok: boolean, id?: string, error?: string } for the rare
 * caller that needs to know whether the log actually landed (e.g. test
 * assertions, admin UI that shows "audit logged" confirmation).
 */
export async function logAudit(
  event: AuditEvent
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  try {
    const supabase = createServiceClient();

    const row = {
      actor_type: event.actorType,
      actor_user_id: event.actorUserId ?? null,
      action: event.action,
      entity_type: event.entityType,
      entity_id: event.entityId ?? null,
      before: event.before ?? null,
      after: event.after ?? null,
      metadata: event.metadata ?? {},
      severity: event.severity ?? 'info',
      ip_address: event.ipAddress ?? null,
      user_agent: event.userAgent ?? null,
    };

    const { data, error } = await supabase
      .from('audit_log')
      .insert(row)
      .select('id')
      .single();

    if (error) {
      // Never throw. Log to console so the event shows up in Vercel
      // runtime logs, but don't let this failure propagate.
      console.error('[audit] insert failed', {
        action: event.action,
        entity: `${event.entityType}/${event.entityId ?? '—'}`,
        error: error.message,
      });
      return { ok: false, error: error.message };
    }

    return { ok: true, id: data.id };
  } catch (err) {
    // Defensive: if the service client can't even be constructed (env
    // misconfig), we absolutely do not want to crash the caller.
    console.error('[audit] catastrophic failure', {
      action: event.action,
      err: err instanceof Error ? err.message : String(err),
    });
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'unknown audit error',
    };
  }
}

/**
 * Convenience wrapper for Next.js request handlers: extracts IP and
 * user-agent from a Request object and merges them into the event.
 *
 *   export async function POST(req: Request) {
 *     ...
 *     void logAuditFromRequest(req, {
 *       actorType: 'user',
 *       actorUserId: user.id,
 *       action: 'project.create',
 *       entityType: 'project',
 *       entityId: project.id,
 *       after: { title: project.title },
 *     });
 *   }
 */
export async function logAuditFromRequest(
  req: Request,
  event: Omit<AuditEvent, 'ipAddress' | 'userAgent'>
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const headers = req.headers;
  // x-forwarded-for is "client, proxy1, proxy2"; the first entry is
  // the real client. x-real-ip is set by some proxies too.
  const xff = headers.get('x-forwarded-for') ?? '';
  const clientIp =
    xff.split(',')[0].trim() ||
    headers.get('x-real-ip') ||
    null;

  return logAudit({
    ...event,
    ipAddress: clientIp,
    userAgent: headers.get('user-agent') ?? null,
  });
}
