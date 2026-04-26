import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { debitPublishingCredits } from '@/lib/publishing/credits';
import { PUBLISHING_CREDIT_COSTS, getRerunCost } from '@/lib/plans';
import { inngest } from '@/inngest/client';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const VALID_AGENTS = [
  'validate',
  'interview',
  'research',
  'outline',
  'writing',
  'qa',
  'cover',
  'publishing',
] as const;
type AgentName = typeof VALID_AGENTS[number];

/**
 * POST /api/projects/[id]/rerun-stage
 *
 * CEO-108: re-run a specific pipeline stage (typically as part of a
 * backward jump from a later stage). Charges the writer per the
 * `rerun_*` ladder in PUBLISHING_CREDIT_COSTS, then performs the same
 * sticky jump as POST /api/interview-session action='jump' and fires
 * an Inngest `pipeline.restart-agent` event so the stage actually
 * recomputes.
 *
 * The 'jump' action alone only changes current_agent — it doesn't
 * recompute anything. This route is the paid path: spend credits to
 * actually do work over again.
 *
 * Behaviour rules:
 *   - The target agent must be a recognised AgentName.
 *   - The target must be 'completed' or 'active' in the session's
 *     agent_status — forward jumps to 'waiting' stages are still
 *     blocked here, exactly like the unpaid 'jump' action.
 *   - We debit BEFORE flipping state. If the debit fails (insufficient
 *     credits, profile missing) we return 402 / 4xx and leave the
 *     session untouched. If the debit succeeds and a later step fails,
 *     we call the returned refund() to restore the credits — same
 *     pattern as the publishing routes.
 *   - Admin and showcase-grant projects bypass the debit per the
 *     existing debitPublishingCredits semantics.
 *
 * Request body:
 *   { agent: AgentName, force?: boolean }
 *
 * The optional `force` flag is reserved for future use (e.g. allow re-
 * running a stage even when its status is 'waiting'). Currently
 * ignored — the status guard always applies.
 *
 * Response:
 *   200 { ok: true, session: <updated row>, debited: number, isAdmin: boolean }
 *   400 { error: '...' }    — bad input
 *   402 { error, code: 'INSUFFICIENT_CREDITS', required, available }
 *   404 { error: '...' }    — project / session not found
 *   500 { error: '...' }    — internal failure
 */
export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id: projectId } = await context.params;
    const supabase = await createClient();

    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json().catch(() => ({}));
    const agent = body?.agent as AgentName | undefined;
    if (!agent || !VALID_AGENTS.includes(agent)) {
      return NextResponse.json(
        { error: `Invalid agent. Must be one of: ${VALID_AGENTS.join(', ')}` },
        { status: 400 },
      );
    }

    const cost = getRerunCost(agent);
    if (cost <= 0) {
      // Unreachable for valid AgentName values, but defensive: refuse
      // to fire restart events with no cost — it's almost certainly a
      // mis-named agent.
      return NextResponse.json(
        { error: `No rerun cost configured for agent '${agent}'` },
        { status: 400 },
      );
    }

    // Confirm project ownership
    const { data: project, error: projErr } = await supabase
      .from('projects')
      .select('id, user_id')
      .eq('id', projectId)
      .single();
    if (projErr || !project || project.user_id !== user.id) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    }

    // Pull the session for this project
    const { data: session, error: sessErr } = await supabase
      .from('interview_sessions')
      .select('id, current_agent, agent_status')
      .eq('project_id', projectId)
      .eq('user_id', user.id)
      .maybeSingle();
    if (sessErr || !session) {
      return NextResponse.json({ error: 'Session not found for this project' }, { status: 404 });
    }

    // Status guard: target must already have been reached.
    const status = (session.agent_status as Record<string, string> | null)?.[agent];
    if (status !== 'completed' && status !== 'active') {
      return NextResponse.json(
        { error: `Cannot re-run stage '${agent}' — it has not been reached yet.` },
        { status: 400 },
      );
    }

    // Debit BEFORE we touch session state. If this fails, nothing changes.
    const debit = await debitPublishingCredits({
      supabase,
      userId: user.id,
      amount: cost,
      reason: `Re-run pipeline stage: ${agent} (CEO-108)`,
      projectId,
    });
    if (!debit.ok) {
      return NextResponse.json(
        {
          error: debit.error,
          code: debit.code,
          required: debit.required,
          available: debit.available,
        },
        { status: debit.status },
      );
    }

    // Flip session: same sticky-jump rule as action='jump'. Demote any
    // currently-active stage to 'completed' so the UI doesn't show two
    // active indicators, then mark target as active.
    const newStatus: Record<string, string> = { ...(session.agent_status as object || {}) };
    if (session.current_agent && newStatus[session.current_agent] === 'active') {
      newStatus[session.current_agent] = 'completed';
    }
    newStatus[agent] = 'active';

    const { data: updatedSession, error: updErr } = await supabase
      .from('interview_sessions')
      .update({
        current_agent: agent,
        agent_status: newStatus,
        updated_at: new Date().toISOString(),
        agent_heartbeat_at: new Date().toISOString(),
        agent_started_at: new Date().toISOString(),
        pipeline_status: 'active',
        failure_count: 0,
        last_failure_reason: null,
        last_failure_at: null,
      })
      .eq('id', session.id)
      .select()
      .single();

    if (updErr || !updatedSession) {
      console.error('[rerun-stage] session update failed, refunding:', updErr);
      await debit.refund();
      return NextResponse.json(
        { error: 'Failed to flip session state — credits refunded.' },
        { status: 500 },
      );
    }

    // Fire the Inngest restart event. Same shape as admin force-retry
    // and pipeline-health cron — any consumer that handles those will
    // handle this identically. We don't refund on Inngest send failure
    // because the session is already marked active and a manual
    // refire / cron sweep can pick it up.
    try {
      await inngest.send({
        name: 'pipeline.restart-agent',
        data: {
          sessionId: session.id,
          userId: user.id,
          agent,
          attempt: -1,
          source: 'user_rerun_stage',
        },
      });
    } catch (sendErr) {
      console.error('[rerun-stage] inngest.send failed (non-fatal):', sendErr);
      return NextResponse.json(
        {
          ok: true,
          warning: 'event_send_failed',
          message: 'Stage flipped + credits debited, but the run dispatch failed. The next cron cycle will re-detect.',
          session: updatedSession,
          debited: debit.isAdmin ? 0 : cost,
          isAdmin: debit.isAdmin,
        },
        { status: 207 },
      );
    }

    return NextResponse.json({
      ok: true,
      session: updatedSession,
      debited: debit.isAdmin ? 0 : cost,
      isAdmin: debit.isAdmin,
    });
  } catch (err: any) {
    console.error('[rerun-stage] unexpected error:', err);
    return NextResponse.json(
      { error: `Internal server error: ${err?.message ?? 'unknown'}` },
      { status: 500 },
    );
  }
}
