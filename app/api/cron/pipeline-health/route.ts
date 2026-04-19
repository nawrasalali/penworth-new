import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/service';
import { requireCronAuth } from '@/lib/cron/require-cron-auth';
import { inngest } from '@/inngest/client';

export const runtime = 'nodejs';
export const maxDuration = 60;
export const dynamic = 'force-dynamic';

/**
 * GET /api/cron/pipeline-health
 *
 * Runs every 2 minutes (see vercel.json crons). The loop:
 *
 *   1. Call pipeline_detect_stuck_sessions(). The SQL function walks
 *      every interview_sessions row with pipeline_status='active' and
 *      compares agent_heartbeat_at against per-agent thresholds
 *      (validate 3min ... writing 15min ... publishing 20min). For
 *      each stuck session it:
 *        - INSERTs a pipeline_incidents row (trigger fires
 *          alert_dispatch, pages the founder via email cron)
 *        - Flips session pipeline_status='stuck'
 *        - RETURNs a record to us here
 *
 *   2. For each newly-stuck session, call pipeline_should_auto_retry().
 *      The function returns a jsonb decision:
 *        retry:true                        → fire an Inngest event to
 *                                            resume the agent; mark
 *                                            session 'recovering'
 *        retry:false, action:'escalate_to_user'   → session is
 *                                            definitively dead; mark
 *                                            'failed' and email the
 *                                            author
 *        retry:false, action:'escalate_to_admin'  → chronic stuck
 *                                            pattern; alert already
 *                                            fired by incident trigger;
 *                                            leave session 'stuck' and
 *                                            mark the incident
 *                                            escalated
 *
 * This cron is the single authority for auto-recovery. The incident
 * trigger pages the founder for awareness; this cron does the actual
 * routing between retry / user notification / admin escalation.
 *
 * Idempotent by construction: pipeline_detect_stuck_sessions only
 * returns sessions that don't already have an unresolved stuck_agent
 * incident, so re-running this cron on the same stuck session never
 * double-fires retries.
 *
 * Query params:
 *   ?dry=1          Detect + decide but don't actually restart or email.
 *                   Useful for debugging without mutating state.
 *   ?session_id=X   Process only this one session. For manual testing.
 */
export async function GET(request: NextRequest) {
  const unauthorized = requireCronAuth(request);
  if (unauthorized) return unauthorized;

  const url = new URL(request.url);
  const dryRun = url.searchParams.get('dry') === '1';
  const onlySessionId = url.searchParams.get('session_id');

  const admin = createServiceClient();

  try {
    // ---- 1. detect ----
    // We accept the coupled side effect that pipeline_detect_stuck_sessions
    // INSERTs a pipeline_incidents row as part of returning the list. That's
    // intentional — the trigger then fires an alert within the same
    // transaction, so the founder is paged the moment we know.
    const { data: stuck, error: detectErr } = await admin
      .rpc('pipeline_detect_stuck_sessions');

    if (detectErr) {
      console.error('[pipeline-health] detect failed:', detectErr);
      return NextResponse.json(
        { error: 'detect_failed', message: detectErr.message },
        { status: 500 },
      );
    }

    const stuckSessions: Array<{
      session_id: string;
      user_id: string;
      current_agent: string;
      minutes_stale: number;
      incident_id: string;
    }> = stuck ?? [];

    const scoped = onlySessionId
      ? stuckSessions.filter((s) => s.session_id === onlySessionId)
      : stuckSessions;

    if (scoped.length === 0) {
      return NextResponse.json({
        ok: true,
        detected: stuckSessions.length,
        processed: 0,
        dry_run: dryRun,
      });
    }

    // ---- 2. decide + act per session ----
    const results: Array<Record<string, unknown>> = [];

    for (const s of scoped) {
      const { data: decision, error: decideErr } = await admin
        .rpc('pipeline_should_auto_retry', { p_session_id: s.session_id });

      if (decideErr) {
        console.error(`[pipeline-health] decide failed for ${s.session_id}:`, decideErr);
        results.push({
          session_id: s.session_id,
          outcome: 'decide_error',
          error: decideErr.message,
        });
        continue;
      }

      const d = decision as {
        retry: boolean;
        reason: string;
        action?: 'escalate_to_user' | 'escalate_to_admin';
        retry_attempt?: number;
        current_agent?: string;
        failure_count?: number;
        stuck_count?: number;
        current_status?: string;
      };

      if (dryRun) {
        results.push({
          session_id: s.session_id,
          user_id: s.user_id,
          agent: s.current_agent,
          minutes_stale: s.minutes_stale,
          decision: d,
          outcome: 'dry_run',
        });
        continue;
      }

      if (d.retry) {
        // ---- AUTO-RETRY ----
        //
        // Bump failure_count BEFORE firing the event. This is the
        // escalation clock: once failure_count reaches 3, the next
        // pipeline_should_auto_retry call returns escalate_to_user
        // instead of retry. Without this bump, a restart consumer
        // that does nothing would leave the session looping forever
        // between 'recovering' and 'stuck' with no terminal state.
        //
        // Read-modify-write is fine here: the cron is the only writer
        // of failure_count in this state (the write-book step-catch
        // path only fires when the session is 'active', not 'stuck'
        // or 'recovering').
        const { data: pre } = await admin
          .from('interview_sessions')
          .select('failure_count')
          .eq('id', s.session_id)
          .single();
        const nextCount = (pre?.failure_count ?? 0) + 1;

        await admin
          .from('interview_sessions')
          .update({
            pipeline_status: 'recovering',
            agent_heartbeat_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
            failure_count: nextCount,
            last_failure_at: new Date().toISOString(),
            last_failure_reason: `Auto-retry #${nextCount} triggered by pipeline-health cron`,
          })
          .eq('id', s.session_id);

        // Resolve the stuck_agent incident row — the session has moved
        // on; if it stays stuck, the next cron run will detect it
        // fresh.
        await admin
          .from('pipeline_incidents')
          .update({
            resolved: true,
            resolved_at: new Date().toISOString(),
            resolution_note: `Auto-retry triggered (attempt ${d.retry_attempt ?? '?'})`,
            recovery_action_taken: `inngest_event:pipeline.restart-agent agent=${s.current_agent}`,
          })
          .eq('id', s.incident_id);

        // Fire the restart event. For now we only know how to restart
        // the writing agent (the one that died in production). Other
        // agents get the event too but no consumer yet — they'll show
        // up in dashboards as 'recovering' without progressing, which
        // is fine: the stuck detector will flag them again, failure_count
        // will rise, and they'll eventually escalate_to_user.
        try {
          await inngest.send({
            name: 'pipeline.restart-agent',
            data: {
              sessionId: s.session_id,
              userId: s.user_id,
              agent: s.current_agent,
              attempt: d.retry_attempt ?? 1,
              incidentId: s.incident_id,
            },
          });
        } catch (sendErr) {
          console.error(`[pipeline-health] inngest.send failed for ${s.session_id}:`, sendErr);
          // Don't fail the cron — we've already marked 'recovering';
          // next run will re-detect and try again.
        }

        results.push({
          session_id: s.session_id,
          outcome: 'auto_retry',
          attempt: d.retry_attempt,
        });
        continue;
      }

      if (d.action === 'escalate_to_user') {
        // ---- USER-FACING FAILURE ----
        // Mark the session definitively failed so the UI switches from
        // "Nora is investigating" to the retry/resume affordance.
        await admin
          .from('interview_sessions')
          .update({
            pipeline_status: 'failed',
            agent_heartbeat_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
            user_notified_at: new Date().toISOString(),
          })
          .eq('id', s.session_id);

        // Also mark the project errored so the SSE stream closes.
        const { data: sess } = await admin
          .from('interview_sessions')
          .select('project_id')
          .eq('id', s.session_id)
          .single();
        if (sess?.project_id) {
          await admin
            .from('projects')
            .update({
              status: 'error',
              metadata: {
                errorMessage: 'Exhausted auto-retry budget',
                failedAt: new Date().toISOString(),
              },
            })
            .eq('id', sess.project_id);
        }

        // Queue the user email via alert_log. The alert_dispatch path
        // handles dedup + recipient routing for recipients_json; we
        // just feed it an entry targeting the author's own email.
        // alert_recipients routing is category-based, not per-user, so
        // for author-facing failure mail we bypass it entirely and
        // write recipients_json directly.
        //
        // Email source: profiles.email is populated on signup and
        // readable by the service role. auth.users isn't PostgREST-
        // addressable, so we don't try.
        const { data: prof } = await admin
          .from('profiles')
          .select('email, full_name')
          .eq('id', s.user_id)
          .maybeSingle();
        const authorEmail = prof?.email ?? null;
        const authorName = prof?.full_name ?? 'Author';

        if (authorEmail) {
          await admin.from('alert_log').insert({
            source_type: 'manual',
            source_id: s.session_id,
            severity: 'p2',
            category: 'user_support',
            title: 'Your document hit a problem — progress saved',
            body:
              `Hi ${authorName},\n\n` +
              `We ran into a problem writing your document and our auto-retry budget is exhausted.\n\n` +
              `Your progress so far is saved. You can pick up where we left off from your dashboard.\n\n` +
              `If this keeps happening please reply to this email and our team will look into it directly.`,
            dedup_key: `user_failure:${s.session_id}`,
            recipients_json: [{ email: authorEmail, name: authorName }],
            delivery_status: 'pending',
          });
        } else {
          console.warn(`[pipeline-health] no email for user ${s.user_id} — user notification skipped`);
        }

        // Mark the incident resolved (escalated to user is a terminal
        // state from the auto-recovery loop's perspective).
        await admin
          .from('pipeline_incidents')
          .update({
            resolved: true,
            resolved_at: new Date().toISOString(),
            resolution_note: `Escalated to user after ${d.failure_count ?? '?'} failed attempts`,
            recovery_action_taken: 'escalate_to_user',
            user_notified_at: new Date().toISOString(),
          })
          .eq('id', s.incident_id);

        results.push({
          session_id: s.session_id,
          outcome: 'escalated_to_user',
          failure_count: d.failure_count,
          notified_email: authorEmail ? 'queued' : 'missing',
        });
        continue;
      }

      if (d.action === 'escalate_to_admin') {
        // ---- CHRONIC STUCK PATTERN ----
        // Alert was already fired by the incident trigger. Just mark
        // the incident as escalated and leave the session 'stuck' —
        // the founder will resolve manually from the Command Center.
        await admin
          .from('pipeline_incidents')
          .update({
            escalated_to_admin: true,
            recovery_action_taken: 'escalate_to_admin',
          })
          .eq('id', s.incident_id);

        results.push({
          session_id: s.session_id,
          outcome: 'escalated_to_admin',
          stuck_count: d.stuck_count,
        });
        continue;
      }

      // ---- UNRECOGNISED DECISION ----
      // pipeline_should_auto_retry returned retry:false with no action.
      // That shouldn't happen in current rule set but we handle it
      // defensively: leave the session 'stuck', log the decision.
      results.push({
        session_id: s.session_id,
        outcome: 'no_action',
        decision: d,
      });
    }

    return NextResponse.json({
      ok: true,
      detected: stuckSessions.length,
      processed: results.length,
      dry_run: dryRun,
      results,
    });
  } catch (err) {
    console.error('[pipeline-health] unexpected error:', err);
    return NextResponse.json(
      { error: 'cron_failed', message: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
