import { createServiceClient } from '@/lib/supabase/service';

/**
 * Pipeline heartbeat + incident helpers.
 *
 * The pipeline-health cron (see /api/cron/pipeline-health) watches
 * `interview_sessions.agent_heartbeat_at` and fires a stuck_agent incident
 * when the value goes stale past a per-agent threshold. For that safety
 * net to work, every long-running surface that operates on behalf of a
 * session MUST pulse this column as it progresses.
 *
 * These helpers exist so:
 *
 *   - No caller has to re-derive the right field set every time. Pulse
 *     shape is consistent across Inngest steps, API routes, and crons.
 *   - A failure to pulse never blocks the pipeline — every helper
 *     absorbs its own errors. If Supabase is unreachable we'd rather the
 *     writer keep running than die because a liveness-tracking side
 *     effect threw. The stuck detector catches that case too: a
 *     pipeline that's running but can't write heartbeats will be
 *     flagged exactly the same as one that's hung.
 *
 * HARD RULES
 *   - Never throw from these helpers — they're instrumentation.
 *   - Never use the user-scoped Supabase client here. These are called
 *     from server-side code that has already authenticated upstream;
 *     they must be able to write regardless of RLS.
 */

const DEFAULT_AGENT_ORDER = [
  'validate',
  'interview',
  'research',
  'outline',
  'writing',
  'qa',
  'cover',
  'publishing',
] as const;

export type AgentName = (typeof DEFAULT_AGENT_ORDER)[number];

export type AgentStatusValue = 'waiting' | 'active' | 'completed';
export type AgentStatusMap = Record<AgentName, AgentStatusValue>;

const ALLOWED_SEVERITIES = ['p0', 'p1', 'p2', 'p3'] as const;
type Severity = (typeof ALLOWED_SEVERITIES)[number];

const ALLOWED_INCIDENT_TYPES = [
  'stuck_agent',
  'api_rate_limit',
  'api_error',
  'token_budget_exhausted',
  'validation_failed',
  'user_abandoned',
  'infrastructure_error',
  'unknown',
] as const;
type IncidentType = (typeof ALLOWED_INCIDENT_TYPES)[number];

export interface PulseOptions {
  /** When true, also sets agent_started_at = now(). Use on agent entry. */
  markStart?: boolean;
  /** When set, writes current_agent and flips that agent to 'active' in agent_status. */
  agent?: AgentName;
  /** Overrides pipeline_status. Default behaviour: leaves as-is. */
  pipelineStatus?:
    | 'active'
    | 'stuck'
    | 'recovering'
    | 'failed'
    | 'completed'
    | 'user_abandoned';
}

/**
 * Pulse the agent heartbeat for a session. Call this:
 *   - On entry to any pipeline step (markStart=true, agent=<name>)
 *   - Periodically during long operations (no options; just bump heartbeat)
 *   - On successful step completion (no options)
 *   - On final completion (pipelineStatus='completed')
 */
export async function pulseHeartbeat(
  sessionId: string | null | undefined,
  options: PulseOptions = {},
): Promise<void> {
  if (!sessionId) return;

  try {
    const supabase = createServiceClient();
    const now = new Date().toISOString();

    // Build the update. We only touch the fields the caller named so we
    // don't accidentally clobber concurrent writes to other agent_status
    // entries (e.g. frontend save() on a different agent key).
    const update: Record<string, unknown> = {
      agent_heartbeat_at: now,
      updated_at: now,
    };

    if (options.markStart) update.agent_started_at = now;
    if (options.pipelineStatus) update.pipeline_status = options.pipelineStatus;

    if (options.agent) {
      update.current_agent = options.agent;

      // Merge agent_status: flip the named agent to 'active' and mark
      // earlier agents as 'completed' unless already 'completed'. We
      // read-modify-write to avoid losing concurrent status writes.
      const { data: existing } = await supabase
        .from('interview_sessions')
        .select('agent_status')
        .eq('id', sessionId)
        .maybeSingle();

      const current = (existing?.agent_status as AgentStatusMap | undefined) ?? {
        validate: 'waiting',
        interview: 'waiting',
        research: 'waiting',
        outline: 'waiting',
        writing: 'waiting',
        qa: 'waiting',
        cover: 'waiting',
        publishing: 'waiting',
      };

      const targetIdx = DEFAULT_AGENT_ORDER.indexOf(options.agent);
      const next: AgentStatusMap = { ...current };
      for (let i = 0; i < DEFAULT_AGENT_ORDER.length; i++) {
        const name = DEFAULT_AGENT_ORDER[i];
        if (i < targetIdx) {
          // earlier agents become completed (don't demote a 'completed' back)
          next[name] = next[name] === 'waiting' ? 'completed' : next[name];
        } else if (i === targetIdx) {
          next[name] = 'active';
        }
        // later agents: leave as-is ('waiting' by default)
      }
      update.agent_status = next;
    }

    await supabase.from('interview_sessions').update(update).eq('id', sessionId);
  } catch (err) {
    // Instrumentation failure — log but never throw.
    console.error('[pulseHeartbeat] non-fatal:', err);
  }
}

/**
 * Mark an agent as 'completed' in agent_status and pulse heartbeat.
 */
export async function markAgentCompleted(
  sessionId: string | null | undefined,
  agent: AgentName,
): Promise<void> {
  if (!sessionId) return;

  try {
    const supabase = createServiceClient();
    const now = new Date().toISOString();

    const { data: existing } = await supabase
      .from('interview_sessions')
      .select('agent_status')
      .eq('id', sessionId)
      .maybeSingle();

    const current = (existing?.agent_status as AgentStatusMap | undefined) ?? {
      validate: 'waiting',
      interview: 'waiting',
      research: 'waiting',
      outline: 'waiting',
      writing: 'waiting',
      qa: 'waiting',
      cover: 'waiting',
      publishing: 'waiting',
    };
    const next: AgentStatusMap = { ...current, [agent]: 'completed' };

    await supabase
      .from('interview_sessions')
      .update({
        agent_status: next,
        agent_heartbeat_at: now,
        updated_at: now,
      })
      .eq('id', sessionId);
  } catch (err) {
    console.error('[markAgentCompleted] non-fatal:', err);
  }
}

export interface LogIncidentInput {
  sessionId: string | null | undefined;
  userId: string | null | undefined;
  agent: AgentName | null;
  incidentType?: IncidentType;
  severity?: Severity;
  /** Free-form context. Goes into error_details jsonb. */
  details?: Record<string, unknown>;
}

/**
 * Insert a pipeline_incidents row. The `trg_pipeline_incidents_auto_alert`
 * trigger fires an alert_dispatch from the DB, so there's nothing else
 * to do here — we just write the row.
 *
 * Severity guidance:
 *   p3 — step exception during Inngest retry. Audit only; no page.
 *   p2 — agent stalled 10-30 min. Normally set by stuck detector.
 *   p1 — agent stalled 30-60 min, or known structural failure.
 *   p0 — agent stalled >60 min, or function-level exhausted-all-retries.
 *
 * P0/P1/P2 all page the founder under current alert_recipients seed.
 * Use p3 for noise-level logging.
 */
export async function logIncident(
  input: LogIncidentInput,
): Promise<{ incidentId: string | null }> {
  try {
    const supabase = createServiceClient();
    const { data, error } = await supabase
      .from('pipeline_incidents')
      .insert({
        session_id: input.sessionId ?? null,
        user_id: input.userId ?? null,
        incident_type: input.incidentType ?? 'unknown',
        agent: input.agent ?? null,
        severity: input.severity ?? 'p2',
        detected_by: 'agent_catch',
        error_details: input.details ?? null,
      })
      .select('id')
      .single();

    if (error) {
      console.error('[logIncident] insert failed:', error);
      return { incidentId: null };
    }
    return { incidentId: data?.id ?? null };
  } catch (err) {
    console.error('[logIncident] non-fatal:', err);
    return { incidentId: null };
  }
}

/**
 * Atomically bump failure_count and record the reason. Used alongside
 * logIncident() when a step throws — the incident row gives us the full
 * error context, this gives the retry decider a simple counter to gate
 * on (see pipeline_should_auto_retry).
 */
export async function bumpFailureCount(
  sessionId: string | null | undefined,
  reason: string,
): Promise<void> {
  if (!sessionId) return;

  try {
    const supabase = createServiceClient();
    // Read-modify-write. Not a true atomic increment, but failure_count
    // is only written from this code path and from the stuck detector's
    // UPDATE — concurrent writers are rare and the downside of a race
    // is that we undercount failures by one, which just delays the
    // max-retries escalation by one cycle.
    const { data: current } = await supabase
      .from('interview_sessions')
      .select('failure_count')
      .eq('id', sessionId)
      .maybeSingle();

    const next = (current?.failure_count ?? 0) + 1;

    await supabase
      .from('interview_sessions')
      .update({
        failure_count: next,
        last_failure_at: new Date().toISOString(),
        last_failure_reason: reason.slice(0, 500),
      })
      .eq('id', sessionId);
  } catch (err) {
    console.error('[bumpFailureCount] non-fatal:', err);
  }
}

/**
 * Look up the interview_sessions row for a project. Used by code paths
 * that only have projectId/userId (the Inngest writing function, for
 * instance). Returns null if not found — callers should handle that
 * gracefully; absence of a session is a data integrity issue but not
 * worth failing the pipeline over.
 */
export async function findSessionIdForProject(
  projectId: string,
  userId: string,
): Promise<string | null> {
  try {
    const supabase = createServiceClient();
    const { data } = await supabase
      .from('interview_sessions')
      .select('id')
      .eq('project_id', projectId)
      .eq('user_id', userId)
      .maybeSingle();
    return data?.id ?? null;
  } catch (err) {
    console.error('[findSessionIdForProject] non-fatal:', err);
    return null;
  }
}
