import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';
import {
  AttemptHistoryEntry,
  QuizPayload,
  findInflightAttempt,
  getQuizConfig,
  isLocked,
  pickRandomQuestions,
  sanitiseForClient,
} from '@/lib/academy/quiz';

export const dynamic = 'force-dynamic';

const TIER_ORDER = ['apprentice', 'journeyman', 'artisan', 'master', 'fellow'] as const;

function tierRank(tier: string | null | undefined): number {
  if (!tier) return 0;
  const idx = TIER_ORDER.indexOf(tier as typeof TIER_ORDER[number]);
  return idx === -1 ? 0 : idx;
}

/**
 * POST /api/guild/academy/quiz-start
 * Body: { module_id }
 *
 * Idempotent within a single attempt — repeated calls return the same served
 * question set (read from attempt_history.served_question_ns) until the
 * attempt is submitted via /api/guild/academy/complete.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const moduleId = body?.module_id;
    if (!moduleId || typeof moduleId !== 'string') {
      return NextResponse.json({ error: 'module_id is required' }, { status: 400 });
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

    // Tier gate for electives (mandatory courses are always accessible)
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

    // Load or initialise progress row
    const { data: existingProgress } = await admin
      .from('guild_academy_progress')
      .select('id, quiz_attempts, quiz_attempts_locked_until, attempt_history, quiz_passed')
      .eq('guildmember_id', member.id)
      .eq('module_id', moduleId)
      .maybeSingle();

    // Already passed — short-circuit
    if (existingProgress?.quiz_passed) {
      return NextResponse.json({
        already_passed: true,
        attempt_number: existingProgress.quiz_attempts ?? 0,
        attempts_remaining: Math.max(0, config.max_attempts - (existingProgress.quiz_attempts ?? 0)),
        locked_until: null,
        pass_threshold_pct: config.pass_threshold_pct,
        questions_served: [],
      });
    }

    // Lockout check
    const lockedUntil = existingProgress?.quiz_attempts_locked_until ?? null;
    if (isLocked(lockedUntil)) {
      return NextResponse.json({
        locked: true,
        locked_until: lockedUntil,
        attempts_used: existingProgress?.quiz_attempts ?? 0,
        message: 'Quiz attempts exhausted; locked until ' + lockedUntil,
      }, { status: 423 });
    }

    // Auto-clear stale lockout that has already passed (so the next attempt resets cleanly)
    const history: AttemptHistoryEntry[] = (existingProgress?.attempt_history as AttemptHistoryEntry[] | undefined) ?? [];
    const attemptsUsed = existingProgress?.quiz_attempts ?? 0;

    let resetAttempts = false;
    if (lockedUntil && !isLocked(lockedUntil)) {
      // Lockout window expired — reset for fresh run
      resetAttempts = true;
    }

    // If there's an in-flight attempt, return its served set
    const inflight = !resetAttempts ? findInflightAttempt(history) : null;
    if (inflight) {
      const served = inflight.served_question_ns
        .map(n => quiz.pool.find(q => q.n === n))
        .filter((q): q is NonNullable<typeof q> => Boolean(q))
        .map(sanitiseForClient);
      return NextResponse.json({
        attempt_number: inflight.attempt_number,
        attempts_remaining: Math.max(0, config.max_attempts - attemptsUsed),
        locked_until: null,
        pass_threshold_pct: config.pass_threshold_pct,
        questions_served: served,
      });
    }

    // Block if attempts exhausted (defence-in-depth — lockout check above usually catches this)
    const effectiveAttemptsUsed = resetAttempts ? 0 : attemptsUsed;
    if (effectiveAttemptsUsed >= config.max_attempts) {
      return NextResponse.json({
        locked: true,
        locked_until: lockedUntil,
        attempts_used: effectiveAttemptsUsed,
        message: 'No attempts remaining',
      }, { status: 423 });
    }

    // Start a new attempt — pick questions, persist served set
    const newAttemptNumber = effectiveAttemptsUsed + 1;
    const picked = pickRandomQuestions(quiz.pool, config.questions_served_per_attempt);
    const newEntry: AttemptHistoryEntry = {
      attempt_number: newAttemptNumber,
      served_question_ns: picked.map(q => q.n),
      started_at: new Date().toISOString(),
      submitted_at: null,
      score: null,
      total: null,
      passed: null,
    };
    const newHistory = resetAttempts ? [newEntry] : [...history, newEntry];

    const { error: upsertErr } = await admin
      .from('guild_academy_progress')
      .upsert({
        guildmember_id: member.id,
        module_id: moduleId,
        started_at: existingProgress?.id ? undefined : new Date().toISOString(),
        attempt_history: newHistory,
        quiz_attempts_locked_until: resetAttempts ? null : lockedUntil,
        // quiz_attempts is incremented on submit, not on start
      }, { onConflict: 'guildmember_id,module_id' });
    if (upsertErr) {
      console.error('[academy/quiz-start] upsert error', upsertErr);
      return NextResponse.json({ error: 'Failed to start quiz' }, { status: 500 });
    }

    return NextResponse.json({
      attempt_number: newAttemptNumber,
      attempts_remaining: Math.max(0, config.max_attempts - effectiveAttemptsUsed),
      locked_until: null,
      pass_threshold_pct: config.pass_threshold_pct,
      questions_served: picked.map(sanitiseForClient),
    });
  } catch (e: any) {
    console.error('[academy/quiz-start] exception', e);
    return NextResponse.json({ error: e?.message ?? 'Unknown error' }, { status: 500 });
  }
}
