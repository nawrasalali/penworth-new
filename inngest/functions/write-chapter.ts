import { inngest } from '../client';
import type {
  ChapterWriteEventData,
  ChapterCompletedEventData,
} from '../client';
import {
  pulseHeartbeat,
  logIncident,
  bumpFailureCount,
} from '@/lib/pipeline/heartbeat';
import { writeSection, classifyError } from './write-book';

/**
 * Per-chapter writer (CEO-051 fan-out worker).
 *
 * Consumes a single `chapter/write` event and produces:
 *   1. One row in `chapters` (idempotent via writeSection's existing
 *      project_id+order_index uniqueness — migration 023).
 *   2. One `chapter/completed` event the orchestrator (writeBook) waits
 *      for via step.waitForEvent.
 *
 * Why a dedicated function?
 *   The write-book orchestrator runs all body sections sequentially in
 *   one Inngest function lifetime, so a slow or failing chapter blocks
 *   every later chapter. By spawning one function instance per chapter,
 *   each gets its own retry lane (retries: 3), its own timeout, and its
 *   own failure scope. Wall-clock for an N-chapter book drops from
 *   sum-of-chapters to ~slowest-chapter time once the orchestrator's
 *   CHAPTER_FANOUT_ENABLED flag is on.
 *
 * Idempotency:
 *   The DB unique constraint chapters(project_id, order_index)
 *   from migration 023 is the hard guarantee. writeSection's
 *   pre-flight existence check is the cost optimisation. Multiple
 *   parallel invocations of the same (projectId, orderIndex) — for
 *   example because Inngest retries the worker — are safe by
 *   construction; the loser short-circuits and returns the winner's
 *   row.
 *
 * Heartbeat:
 *   writeSection wraps the long Anthropic call with
 *   withHeartbeatKeepalive, and we also pulseHeartbeat at step entry.
 *   While any chapter worker is in flight, agent_heartbeat_at stays
 *   fresh for the session, so the stuck-agent reaper does not trip on
 *   a healthy in-flight book run.
 *
 * Feature flag:
 *   The flag CHAPTER_FANOUT_ENABLED is checked in the orchestrator
 *   only. This consumer is always registered; if the flag is off, the
 *   orchestrator simply never emits chapter/write events and this
 *   function never runs.
 */
export const writeChapter = inngest.createFunction(
  {
    id: 'write-chapter',
    name: 'Write Single Chapter (fan-out worker)',
    retries: 3,
    triggers: [{ event: 'chapter/write' }],
  },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async ({ event, step }: any) => {
    const data = event.data as ChapterWriteEventData;
    const {
      projectId,
      userId,
      sessionId,
      orderIndex,
      bodyNumber,
      title,
    } = data;

    const stepName = `write-chapter-${orderIndex}`;
    const result = await step.run(stepName, async () => {
      await pulseHeartbeat(sessionId, { agent: 'writing' });
      try {
        return await writeSection({
          kind: 'body',
          title: data.title,
          description: data.description,
          keyPoints: data.keyPoints,
          targetWords: data.targetWords,
          bodyNumber: data.bodyNumber,
          projectId: data.projectId,
          userId: data.userId,
          docTitle: data.docTitle,
          orderIndex: data.orderIndex,
          meta: data.meta,
          voiceProfile: data.voiceProfile,
          projectCtx: data.projectCtx,
          prior: data.prior,
          industry: data.industry,
          sessionId: data.sessionId,
        });
      } catch (err) {
        // Mirror the sequential body-loop's incident handling: log a p3
        // for audit, bump failure_count, then rethrow so Inngest can
        // retry per the function's retries:3. If every retry fails the
        // chapter, the orchestrator's step.waitForEvent times out at
        // 15m and surfaces the failure to the operator.
        await logIncident({
          sessionId,
          userId,
          agent: 'writing',
          incidentType: classifyError(err),
          severity: 'p3',
          details: {
            step: stepName,
            sectionTitle: title,
            bodyNumber,
            orderIndex,
            message: err instanceof Error ? err.message : String(err),
            stack: err instanceof Error ? err.stack?.slice(0, 2000) : undefined,
            source: 'fanout_chapter',
          },
        });
        await bumpFailureCount(
          sessionId,
          `${stepName}: ${err instanceof Error ? err.message : String(err)}`,
        );
        throw err;
      }
    });

    // Signal the orchestrator. step.sendEvent (rather than a bare
    // inngest.send) makes the dispatch durable: if the worker process
    // crashes between writeSection success and the dispatch, Inngest
    // will retry the whole step run from the previous checkpoint and
    // re-emit the completion. Combined with chapter idempotency, the
    // worst case is the same chapter/completed event being delivered
    // more than once — the orchestrator's step.waitForEvent only acts
    // on the first matching delivery.
    const completionData: ChapterCompletedEventData = {
      projectId,
      sessionId,
      orderIndex,
      chapterId: result.chapterId,
      wordCount: result.wordCount,
    };
    await step.sendEvent('signal-completed', {
      name: 'chapter/completed',
      data: completionData,
    });

    return {
      chapterId: result.chapterId,
      orderIndex,
      wordCount: result.wordCount,
    };
  },
);

export default writeChapter;
