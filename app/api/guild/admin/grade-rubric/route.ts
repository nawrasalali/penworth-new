import { NextRequest, NextResponse } from 'next/server';
import { createClient, createAdminClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type RubricResult = 'pass' | 'fail';

interface GradeRubricPayload {
  interview_id: string;
  result: RubricResult;
  reviewer_notes?: string | null;
}

/**
 * POST /api/guild/admin/grade-rubric
 *
 * Admin-only endpoint. Grades the voice-interview rubric via the
 * guild_grade_interview_rubric RPC. This is a grading-only endpoint —
 * finalization (creating the guild_members row, revealing the referral code,
 * sending the welcome email) is a separate step invoked after grading via
 * /api/guild/admin/finalize-acceptance.
 *
 * The RPC's behavior (as defined in the production DB):
 *   - p_result = 'pass' → writes rubric_result='pass'; application stays at
 *                         interview_completed so admin can review and finalize
 *   - p_result = 'fail' → writes rubric_result='fail' AND auto-transitions
 *                         the application to 'declined' with p_reviewer_notes
 *                         stored as decision_reason
 *   - idempotent on repeat-same-result (returns already_graded: true)
 *   - changing pass ↔ fail after the fact raises check_violation
 *
 * Body: { interview_id, result: 'pass'|'fail', reviewer_notes? }
 * Returns: the RPC's jsonb on success
 *
 * Error mapping (PG → HTTP):
 *   check_violation         → 409  (invalid state transition / bad input)
 *   no_data_found           → 404  (interview not found)
 *   insufficient_privilege  → 403  (caller isn't admin — shouldn't hit this
 *                                   since we check is_admin first, but the
 *                                   RPC double-checks as defense in depth)
 */
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('is_admin')
    .eq('id', user.id)
    .single();
  if (!profile?.is_admin) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  let payload: GradeRubricPayload;
  try {
    payload = (await request.json()) as GradeRubricPayload;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  if (!payload.interview_id) {
    return NextResponse.json({ error: 'interview_id is required' }, { status: 400 });
  }
  if (payload.result !== 'pass' && payload.result !== 'fail') {
    return NextResponse.json(
      { error: "result must be 'pass' or 'fail'" },
      { status: 400 },
    );
  }

  const admin = createAdminClient();
  const { data: result, error } = await admin.rpc('guild_grade_interview_rubric', {
    p_interview_id: payload.interview_id,
    p_result: payload.result,
    p_reviewer_notes: payload.reviewer_notes ?? null,
    p_actor_id: user.id,
  });

  if (error) {
    console.error('[grade-rubric] RPC error:', error);
    const status = mapPgErrorToHttpStatus(error);
    return NextResponse.json(
      { error: error.message, code: error.code ?? undefined },
      { status },
    );
  }

  return NextResponse.json(result);
}

/**
 * Translates the documented PG error codes raised by
 * guild_grade_interview_rubric into appropriate HTTP statuses. Anything
 * unrecognised falls through to 400 so the client sees a useful body.
 */
function mapPgErrorToHttpStatus(error: { code?: string | null; message?: string }): number {
  // Supabase surfaces PG errors with a code like '23514' (check_violation) or
  // the named SQLSTATE class where PL/pgSQL raises via RAISE ... ERRCODE.
  // RAISE USING ERRCODE = 'check_violation' becomes code 23514; similarly
  // no_data_found = 'P0002' and insufficient_privilege = '42501'.
  const code = error.code || '';
  if (code === '23514' || code.toLowerCase().includes('check_violation')) return 409;
  if (code === 'P0002' || code.toLowerCase().includes('no_data_found')) return 404;
  if (code === '42501' || code.toLowerCase().includes('insufficient_privilege')) return 403;
  return 400;
}
