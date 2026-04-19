import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/service';
import {
  scoreInterview,
  type InterviewState,
} from '@/lib/ai/guild-interviewer';

export const runtime = 'nodejs';
export const maxDuration = 60;
export const dynamic = 'force-dynamic';

/**
 * POST /api/guild/interview/complete
 *
 * Finalizes the interview: builds a transcript, runs the rubric evaluation,
 * stores scores, and sets the application status to interview_completed
 * so the Guild Council can review.
 *
 * Body: { application_id }
 */
export async function POST(request: NextRequest) {
  try {
    const { application_id } = await request.json();
    if (!application_id) {
      return NextResponse.json({ error: 'application_id is required' }, { status: 400 });
    }

    const admin = createServiceClient();

    const { data: app } = await admin
      .from('guild_applications')
      .select('id, full_name, primary_language, application_interview_id, application_status')
      .eq('id', application_id)
      .single();

    if (!app || !app.application_interview_id) {
      return NextResponse.json({ error: 'Interview not found' }, { status: 404 });
    }

    const { data: interview } = await admin
      .from('guild_application_interviews')
      .select('*')
      .eq('id', app.application_interview_id)
      .single();

    if (!interview) {
      return NextResponse.json({ error: 'Interview not found' }, { status: 404 });
    }

    if (interview.rubric_result === 'pass' || interview.rubric_result === 'fail') {
      return NextResponse.json(
        { error: 'Interview already scored', rubric_result: interview.rubric_result },
        { status: 400 },
      );
    }

    // Parse state
    let state: InterviewState;
    try {
      state = JSON.parse(interview.transcript) as InterviewState;
    } catch {
      return NextResponse.json({ error: 'Invalid interview state' }, { status: 500 });
    }

    if (state.turns.length < 2) {
      return NextResponse.json(
        { error: 'Interview has too few turns to score' },
        { status: 400 },
      );
    }

    // Build readable transcript
    const readable = buildReadableTranscript(state, app.full_name);

    // Score via the rubric
    const result = await scoreInterview({
      applicantName: app.full_name,
      language: app.primary_language,
      transcript: readable,
    });

    // Persist scores and summary
    await admin
      .from('guild_application_interviews')
      .update({
        scores: result.scores,
        summary: result.summary,
        rubric_result: result.rubric_result,
        transcript: readable,  // replace state blob with readable transcript for later reference
      })
      .eq('id', interview.id);

    // Advance application to interview_completed
    await admin
      .from('guild_applications')
      .update({
        application_status: 'interview_completed',
      })
      .eq('id', application_id);

    return NextResponse.json({
      ok: true,
      rubric_result: result.rubric_result,
      scores: result.scores,
      summary: result.summary,
      fail_reasons: result.fail_reasons,
    });
  } catch (err: any) {
    console.error('[interview/complete] Error:', err);
    return NextResponse.json(
      { error: err?.message || 'Failed to complete interview' },
      { status: 500 },
    );
  }
}

function buildReadableTranscript(state: InterviewState, applicantName: string): string {
  const lines: string[] = [];
  lines.push(`INTERVIEW TRANSCRIPT`);
  lines.push(`Applicant: ${applicantName}`);
  lines.push(`Topics covered: ${state.topics_covered.join(', ') || state.current_topic}`);
  lines.push(
    `Duration: ~${Math.round(((state.turns[state.turns.length - 1]?.timestamp || Date.now()) - state.started_at) / 60000)} minutes`,
  );
  lines.push(`End reason: ${state.end_reason || 'completed'}`);
  lines.push('');
  lines.push('---');
  lines.push('');

  for (const turn of state.turns) {
    const speaker = turn.role === 'interviewer' ? 'INTERVIEWER' : 'APPLICANT';
    const topic = turn.topic_at_turn ? ` [topic: ${turn.topic_at_turn}]` : '';
    lines.push(`${speaker}${topic}:`);
    lines.push(turn.text);
    lines.push('');
  }

  return lines.join('\n');
}
