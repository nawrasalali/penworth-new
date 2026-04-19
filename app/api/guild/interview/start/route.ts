import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/service';
import {
  generateNextMessage,
  synthesizeSpeech,
  INTERVIEW_TOPICS,
  type InterviewState,
} from '@/lib/ai/guild-interviewer';

export const runtime = 'nodejs';
export const maxDuration = 60;
export const dynamic = 'force-dynamic';

/**
 * POST /api/guild/interview/start
 *
 * Starts a voice interview. Creates the guild_application_interviews row if one
 * does not exist, generates the interviewer's opening message, returns the
 * text and an MP3 base64-encoded for the browser to play.
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

    // Load application
    const { data: app, error: appError } = await admin
      .from('guild_applications')
      .select('*')
      .eq('id', application_id)
      .single();

    if (appError || !app) {
      return NextResponse.json({ error: 'Application not found' }, { status: 404 });
    }

    if (app.application_status !== 'invited_to_interview' && app.application_status !== 'interview_scheduled') {
      return NextResponse.json(
        { error: `Cannot start interview in status "${app.application_status}"` },
        { status: 400 },
      );
    }

    // Check if interview record already exists
    let { data: interview } = await admin
      .from('guild_application_interviews')
      .select('*')
      .eq('application_id', application_id)
      .maybeSingle();

    if (!interview) {
      // Create the interview record
      const { data: created, error: createError } = await admin
        .from('guild_application_interviews')
        .insert({
          application_id,
          language: app.primary_language,
          scheduled_at: new Date().toISOString(),
          conducted_at: new Date().toISOString(),
          rubric_result: 'pending',
          transcript: JSON.stringify({ turns: [] }),
        })
        .select('*')
        .single();

      if (createError || !created) {
        console.error('[interview/start] Create error:', createError);
        return NextResponse.json({ error: 'Failed to create interview record' }, { status: 500 });
      }
      interview = created;

      // Link the interview back to the application and update status
      await admin
        .from('guild_applications')
        .update({
          application_interview_id: created.id,
          application_status: 'interview_scheduled',
        })
        .eq('id', application_id);
    }

    // If already conducted, block a fresh start
    if (interview.rubric_result === 'pass' || interview.rubric_result === 'fail') {
      return NextResponse.json(
        { error: 'This interview has already been conducted.' },
        { status: 400 },
      );
    }

    // Build initial state
    const state: InterviewState = {
      turns: [],
      current_topic: INTERVIEW_TOPICS[0],
      topics_covered: [],
      started_at: Date.now(),
      ended: false,
    };

    // Generate first message
    const result = await generateNextMessage({
      applicantName: app.full_name,
      language: app.primary_language,
      state,
    });

    // Record the interviewer turn
    const firstTurn = {
      role: 'interviewer' as const,
      text: result.message,
      timestamp: Date.now(),
      topic_at_turn: result.next_topic,
    };
    state.turns.push(firstTurn);
    state.current_topic = result.next_topic;

    // Synthesize TTS
    const audioBuffer = await synthesizeSpeech(result.message, app.primary_language);
    const audioBase64 = audioBuffer.toString('base64');

    // Persist state to the interview record
    await admin
      .from('guild_application_interviews')
      .update({
        transcript: JSON.stringify(state),
        conducted_at: new Date(state.started_at).toISOString(),
      })
      .eq('id', interview.id);

    return NextResponse.json({
      ok: true,
      interview_id: interview.id,
      interviewer_message: result.message,
      audio_base64: audioBase64,
      topic: result.next_topic,
      should_end: false,
    });
  } catch (err: any) {
    console.error('[interview/start] Error:', err);
    return NextResponse.json(
      { error: err?.message || 'Failed to start interview' },
      { status: 500 },
    );
  }
}
