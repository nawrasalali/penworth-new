import { inngest } from '../client';
import { createClient } from '@supabase/supabase-js';
import { pulseHeartbeat, logIncident } from '@/lib/pipeline/heartbeat';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

/**
 * Consumer for `pipeline.restart-agent` events.
 *
 * Fired by two places:
 *   1. /api/cron/pipeline-health — auto-retry path. Bumps failure_count
 *      before firing. Carries `attempt: 1..5` and terminates via the
 *      escalate_to_admin branch once failure_count hits the cap
 *      (CEO-031: retry ceiling=5, authors never emailed on stuck agents).
 *   2. /api/admin/incidents/[id]/force-retry — super-admin override.
 *      Carries `attempt: -1` sentinel. No cap — a human is watching.
 *
 * Scope:
 *   Today only `agent: 'writing'` is handled. The other agents
 *   (validate/interview/research/outline/qa/publishing) don't run
 *   through Inngest — they're synchronous API routes — so there's
 *   nothing Inngest-side to restart. The consumer acknowledges those
 *   events with a structured no-op rather than throwing, so the
 *   event doesn't dead-letter and the admin UI still shows a clean
 *   resolution.
 *
 * Safety:
 *   The consumer re-fires `book/write` with a FRESH event id (not the
 *   original). That means Inngest's step memoization doesn't skip
 *   anything — every step runs fresh. Chapter idempotency (migration
 *   023 + writeSection existence check) is what prevents duplicate
 *   work and duplicate rows. Do not change to re-use the original
 *   event id without understanding this coupling.
 */
export const restartAgent = inngest.createFunction(
  {
    id: 'pipeline-restart-agent',
    name: 'Restart a stuck pipeline agent',
    // Small retry count — if the consumer itself fails, the next
    // pipeline-health cron run will detect the stuck session again
    // and re-fire. We don't need a long retry loop here; it would
    // just delay failure visibility.
    retries: 2,
    triggers: [{ event: 'pipeline.restart-agent' }],
  },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async ({ event, step }: any) => {
    const {
      sessionId,
      userId,
      agent,
      attempt,
      incidentId,
      source,
    } = event.data as {
      sessionId: string;
      userId: string;
      agent: string;
      attempt: number;
      incidentId?: string;
      source?: string;
    };

    // Guard: only writing is restartable today.
    if (agent !== 'writing') {
      return {
        skipped: true,
        reason: `agent '${agent}' is not handled by the restart consumer (only 'writing' today)`,
        sessionId,
        incidentId,
      };
    }

    // ---------------------------------------------------------------
    // Step 1 — Load the session + project + outline. All in one
    // durable step so Inngest can retry the whole lookup cleanly.
    //
    // Shape notes (these are NOT obvious from the code that fires
    // `book/write` — confirmed against schema 2026-04-20):
    //   - `outline` is stored on interview_sessions.outline_data (jsonb),
    //     NOT on projects. Projects has no outline column.
    //   - `title` — prefer interview_sessions.book_title (the author's
    //     current working title) with projects.title as a fallback for
    //     any legacy session that didn't populate book_title.
    //   - `industry` — comes from organizations.industry via the
    //     projects.org_id join. Projects itself has no industry column.
    //     Organizations may be nullable (solo accounts), in which case
    //     we fall back to 'general' — same default as the original
    //     /api/books/generate path.
    //   - `voiceProfile` — loaded from interview_sessions.voice_profile
    //     (migration 024). Persisted at book/write time by
    //     /api/books/generate. Legacy sessions created before migration
    //     024 have voice_profile=NULL and will restart with the default
    //     voice — writeBook treats voiceProfile as optional, so NULL is
    //     safe. New sessions preserve voice consistency across retries.
    // ---------------------------------------------------------------
    const loaded = await step.run('load-session-context', async () => {
      const { data: session, error: sessionErr } = await supabase
        .from('interview_sessions')
        .select('id, project_id, user_id, book_title, outline_data, pipeline_status, voice_profile')
        .eq('id', sessionId)
        .maybeSingle();

      if (sessionErr || !session) {
        return { ok: false as const, reason: 'session_not_found' };
      }

      if (session.user_id !== userId) {
        // Payload tampering or a stale event from a deleted/reassigned
        // session. Do not act on it.
        return { ok: false as const, reason: 'user_mismatch' };
      }

      if (!session.outline_data) {
        return { ok: false as const, reason: 'outline_missing' };
      }

      const { data: project, error: projectErr } = await supabase
        .from('projects')
        .select('id, title, status, organizations ( industry )')
        .eq('id', session.project_id)
        .maybeSingle();

      if (projectErr || !project) {
        return { ok: false as const, reason: 'project_not_found' };
      }

      // organizations may come back as either an object or null (solo
      // account with no org). Supabase's PostgREST returns the joined
      // row shape the same way /api/books/generate reads it.
      const orgs = (project as any).organizations;
      const industry: string = orgs?.industry ?? 'general';

      return {
        ok: true as const,
        projectId: project.id,
        title: (session.book_title as string | null) ?? project.title,
        industry,
        outline: session.outline_data,
        voiceProfile: (session.voice_profile as unknown) ?? null,
      };
    });

    if (!loaded.ok) {
      // No session/project/outline — we can't restart anything.
      // Log a p2 warning incident so the admin sees it, but don't
      // throw (that would just cause Inngest to retry a hopeless
      // case). incident_type is constrained to an enum — we use
      // 'infrastructure_error' because missing state IS infrastructure
      // class; the original failure reason is preserved in details.
      await logIncident({
        sessionId,
        userId,
        agent: 'writing',
        incidentType: 'infrastructure_error',
        severity: 'p2',
        details: {
          source: 'pipeline-restart-agent',
          reason: loaded.reason,
          origin: source ?? 'unknown',
          originalIncidentId: incidentId,
        },
      });
      return {
        skipped: true,
        reason: loaded.reason,
        sessionId,
        incidentId,
      };
    }

    // ---------------------------------------------------------------
    // Step 2 — Pulse heartbeat so the UI shows "recovering" while
    // the new book/write run spins up. The auto-retry cron already
    // set pipeline_status='recovering' before firing this event;
    // force-retry did the same. Pulsing here is defence-in-depth for
    // any future caller that forgets.
    // ---------------------------------------------------------------
    await step.run('pulse-heartbeat', async () => {
      await pulseHeartbeat(sessionId, {
        agent: 'writing',
        pipelineStatus: 'recovering',
      });
    });

    // ---------------------------------------------------------------
    // Step 3 — Re-fire book/write with a fresh event id. Inngest
    // starts a brand new function run; no step memoization from
    // prior runs. The writeSection existence check + chapters
    // uniqueness constraint ensure already-written chapters are
    // skipped without spending tokens or writing duplicate rows.
    //
    // voiceProfile is now loaded from interview_sessions.voice_profile
    // (migration 024). Sessions created before that migration have
    // NULL and degrade gracefully — writeBook treats voiceProfile as
    // optional, so default voice is used. New sessions preserve voice
    // consistency across retries.
    // ---------------------------------------------------------------
    const sent = await step.run('refire-book-write', async () => {
      const result = await inngest.send({
        name: 'book/write',
        data: {
          projectId: loaded.projectId,
          userId,
          title: loaded.title,
          outline: loaded.outline,
          industry: loaded.industry,
          voiceProfile: loaded.voiceProfile ?? undefined,
        },
      });
      // result is { ids: [eventId1, ...] } from the Inngest SDK
      return { eventIds: result.ids };
    });

    return {
      ok: true,
      sessionId,
      projectId: loaded.projectId,
      attempt,
      source: source ?? 'unknown',
      dispatched_event_ids: sent.eventIds,
    };
  },
);
