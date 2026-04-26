import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';
import {
  AttemptHistoryEntry,
  QuizPayload,
  findInflightAttempt,
  getQuizConfig,
  isLocked,
  scoreSubmission,
} from '@/lib/academy/quiz';
import { triggerActivationIfEligible } from '@/lib/academy/activation';

export const dynamic = 'force-dynamic';

const TIER_ORDER = ['apprentice', 'journeyman', 'artisan', 'master', 'fellow'] as const;

function tierRank(tier: string | null | undefined): number {
  if (!tier) return 0;
  const idx = TIER_ORDER.indexOf(tier as typeof TIER_ORDER[number]);
  return idx === -1 ? 0 : idx;
}

interface SubmittedAnswer {
  question_n: number;
  selected_index: number;
}

/**
 * POST /api/guild/academy/complete
 * Body: { module_id, answers: [{question_n, selected_index}] }
 *
 * Scores a v2 quiz submission against the served set persisted in
 * attempt_history. Increments quiz_attempts atomically and applies a 7-day
 * lockout on the third failed attempt. Returns score + attempts_remaining +
 * (when failed) the question numbers the member missed so the player can
 * highlight them on review.
 *
 * On pass: writes completed_at + quiz_passed=true to the progress row.
 * Activation flow (referral code, agent context, certificate) fires from a
 * separate endpoint when all three mandatory courses are passed (CEO-155).
 *
 * Anti-cheat: scoreSubmission rejects answers for questions that were not
 * served as part of this attempt (lookup against attempt_history.served_question_ns).
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const moduleId = body?.module_id as string | undefined;
    const answers = body?.answers as SubmittedAnswer[] | undefined;

    if (!moduleId || typeof moduleId !== 'string') {
      return NextResponse.json({ error: 'module_id is required' }, { status: 400 });
    }
    if (!Array.isArray(answers)) {
      return NextResponse.json({ error: 'answers array is required' }, { status: 400 });
    }
    for (const a of answers) {
      if (typeof a?.question_n !== 'number' || typeof a?.selected_index !== 'number') {
        return NextResponse.json({ error: 'each answer needs question_n + selected_index' }, { status: 400 });
      }
    }

    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });

    const admin = createServiceClient();

    const { data: member } = await admin
      .from('guild_members')
      .select('id, tier')
      .eq('user_id', user.id)
      .maybeSingle();
    if (!member) return NextResponse.json({ error: 'Not a Guildmember' }, { status: 403 });

    const { data: module } = await admin
      .from('guild_academy_modules')
      .select('id, slug, category, required_tier, quiz')
      .eq('id', moduleId)
      .maybeSingle();
    if (!module) return NextResponse.json({ error: 'Module not found' }, { status: 404 });

    if (module.category !== 'mandatory' && module.required_tier) {
      if (tierRank(member.tier) < tierRank(module.required_tier)) {
        return NextResponse.json({ error: 'Module locked for your tier' }, { status: 403 });
      }
    }

    const quiz = module.quiz as QuizPayload | null;
    if (!quiz || !Array.isArray(quiz.pool) || quiz.pool.length === 0) {
      return NextResponse.json({ error: 'Module has no quiz' }, { status: 400 });
    }
    const config = getQuizConfig(quiz);

    const { data: progress } = await admin
      .from('guild_academy_progress')
      .select('id, quiz_attempts, quiz_attempts_locked_until, attempt_history, quiz_passed')
      .eq('guildmember_id', member.id)
      .eq('module_id', moduleId)
      .maybeSingle();

    if (progress?.quiz_passed) {
      return NextResponse.json({
        already_passed: true,
        passed: true,
        score: progress.quiz_attempts ?? 0,
        total: config.questions_served_per_attempt,
        attempts_remaining: Math.max(0, config.max_attempts - (progress.quiz_attempts ?? 0)),
      });
    }

    if (isLocked(progress?.quiz_attempts_locked_until ?? null)) {
      return NextResponse.json({
        locked: true,
        locked_until: progress?.quiz_attempts_locked_until,
        message: 'Quiz attempts exhausted; locked.',
      }, { status: 423 });
    }

    const history: AttemptHistoryEntry[] = (progress?.attempt_history as AttemptHistoryEntry[] | undefined) ?? [];
    const inflight = findInflightAttempt(history);
    if (!inflight) {
      return NextResponse.json({
        error: 'No active attempt — call /api/guild/academy/quiz-start first',
      }, { status: 400 });
    }

    let scored: { score: number; total: number; missed: number[] };
    try {
      scored = scoreSubmission(quiz.pool, inflight.served_question_ns, answers);
    } catch (e: any) {
      return NextResponse.json({ error: e?.message ?? 'Invalid submission' }, { status: 400 });
    }

    const passThreshold = Math.ceil(scored.total * config.pass_threshold_pct);
    const passed = scored.score >= passThreshold;

    const updatedHistory = history.map((h) =>
      h === inflight
        ? {
            ...h,
            submitted_at: new Date().toISOString(),
            score: scored.score,
            total: scored.total,
            passed,
          }
        : h,
    );

    const newAttemptsUsed = (progress?.quiz_attempts ?? 0) + 1;
    const lockoutUntil = !passed && newAttemptsUsed >= config.max_attempts
      ? new Date(Date.now() + config.lockout_days * 24 * 60 * 60 * 1000).toISOString()
      : null;

    const upsertPayload: Record<string, unknown> = {
      guildmember_id: member.id,
      module_id: moduleId,
      attempt_history: updatedHistory,
      quiz_attempts: newAttemptsUsed,
      quiz_attempts_locked_until: lockoutUntil,
      quiz_score: scored.score,
    };
    if (passed) {
      upsertPayload.completed_at = new Date().toISOString();
      upsertPayload.quiz_passed = true;
    }

    const { error: upsertErr } = await admin
      .from('guild_academy_progress')
      .upsert(upsertPayload, { onConflict: 'guildmember_id,module_id' });
    if (upsertErr) {
      console.error('[academy/complete] upsert error', upsertErr);
      return NextResponse.json({ error: 'Failed to save progress' }, { status: 500 });
    }

    // Activation flow — fires when a passing submission was for a mandatory
    // course AND the member has now passed all three. Idempotent server-side
    // (academy_completed_at gate), so racing parallel submissions are safe.
    let activation: Awaited<ReturnType<typeof triggerActivationIfEligible>> | null = null;
    if (passed && module.category === 'mandatory') {
      try {
        activation = await triggerActivationIfEligible(member.id, admin);
      } catch (e) {
        console.error('[academy/complete] activation trigger error', e);
        // Don't fail the quiz submission just because activation has a
        // downstream issue — the member can retry via /api/guild/academy/activate.
      }
    }

    return NextResponse.json({
      passed,
      score: scored.score,
      total: scored.total,
      threshold: passThreshold,
      pass_threshold_pct: config.pass_threshold_pct,
      attempt_number: inflight.attempt_number,
      attempts_remaining: Math.max(0, config.max_attempts - newAttemptsUsed),
      locked_until: lockoutUntil,
      missed_question_ns: passed ? [] : scored.missed,
      activation: activation
        ? {
            activated: activation.activated,
            already_activated: activation.already_activated,
            referral_code: activation.referral_code,
            certificate_code: activation.certificate_code,
            certificate_pdf_url: activation.certificate_pdf_signed_url,
            email_sent: activation.email_sent,
          }
        : null,
    });
  } catch (e: any) {
    console.error('[academy/complete] exception', e);
    return NextResponse.json({ error: e?.message ?? 'Unknown error' }, { status: 500 });
  }
}
