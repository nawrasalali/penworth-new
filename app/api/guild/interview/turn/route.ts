import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import {
  generateNextMessage,
  transcribeAudio,
  synthesizeSpeech,
  INTERVIEW_TOPICS,
  type InterviewState,
  type InterviewTopic,
} from '@/lib/ai/guild-interviewer';

export const runtime = 'nodejs';
export const maxDuration = 60;
export const dynamic = 'force-dynamic';

const MAX_INTERVIEW_MS = 12 * 60 * 1000; // 12 minutes hard cap (soft target 10)

/**
 * POST /api/guild/interview/turn
 *
 * Processes one turn: applicant audio in → transcript → next interviewer
 * message → TTS audio out.
 *
 * Request is multipart/form-data:
 *   - application_id: string
 *   - audio: Blob (webm/mp3/m4a/wav)
 */
export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const applicationId = formData.get('application_id') as string | null;
    const audioFile = formData.get('audio') as File | null;

    if (!applicationId || !audioFile) {
      return NextResponse.json(
        { error: 'application_id and audio are required' },
        { status: 400 },
      );
    }

    const admin = createAdminClient();

    // Load application + interview state
    const { data: app } = await admin
      .from('guild_applications')
      .select('id, full_name, primary_language, voice_interview_id, application_status')
      .eq('id', applicationId)
      .single();

    if (!app || !app.voice_interview_id) {
      return NextResponse.json({ error: 'Interview not found' }, { status: 404 });
    }

    const { data: interview } = await admin
      .from('guild_voice_interviews')
      .select('*')
      .eq('id', app.voice_interview_id)
      .single();

    if (!interview) {
      return NextResponse.json({ error: 'Interview not found' }, { status: 404 });
    }

    // Parse stored state
    const state: InterviewState = safeParseState(interview.transcript);

    if (state.ended) {
      return NextResponse.json({ error: 'Interview already ended' }, { status: 400 });
    }

    // Transcribe the applicant audio
    const audioBuffer = Buffer.from(await audioFile.arrayBuffer());
    const filename = audioFile.name || 'audio.webm';
    const { text: applicantText, duration_s } = await transcribeAudio(
      audioBuffer,
      filename,
      app.primary_language,
    );

    if (!applicantText || applicantText.trim().length < 1) {
      return NextResponse.json(
        { error: 'Could not transcribe your response. Please try again.' },
        { status: 400 },
      );
    }

    // Append applicant turn
    state.turns.push({
      role: 'applicant',
      text: applicantText,
      timestamp: Date.now(),
      topic_at_turn: state.current_topic,
      audio_duration_s: duration_s ?? undefined,
    });

    // Check time cap
    const elapsedMs = Date.now() - state.started_at;
    const timeExhausted = elapsedMs >= MAX_INTERVIEW_MS;

    // Generate next interviewer message (unless time is up)
    let result;
    if (timeExhausted) {
      result = {
        message: getClosingMessage(app.primary_language, app.full_name),
        next_topic: 'close' as InterviewTopic,
        move_to_next_topic: false,
        should_end: true,
        end_reason: 'time_limit',
      };
    } else {
      result = await generateNextMessage({
        applicantName: app.full_name,
        language: app.primary_language,
        state,
      });
    }

    // Update state
    if (result.move_to_next_topic) {
      if (!state.topics_covered.includes(state.current_topic)) {
        state.topics_covered.push(state.current_topic);
      }
    }
    state.current_topic = result.next_topic;

    if (result.should_end) {
      state.ended = true;
      state.end_reason = (result.end_reason as any) || 'topics_complete';
    }

    // Append interviewer turn
    state.turns.push({
      role: 'interviewer',
      text: result.message,
      timestamp: Date.now(),
      topic_at_turn: result.next_topic,
    });

    // Synthesize audio
    const audio = await synthesizeSpeech(result.message, app.primary_language);
    const audioBase64 = audio.toString('base64');

    // Persist
    await admin
      .from('guild_voice_interviews')
      .update({
        transcript: JSON.stringify(state),
        duration_seconds: Math.round(elapsedMs / 1000),
      })
      .eq('id', interview.id);

    return NextResponse.json({
      ok: true,
      applicant_transcript: applicantText,
      interviewer_message: result.message,
      audio_base64: audioBase64,
      topic: result.next_topic,
      should_end: result.should_end,
      topics_covered: state.topics_covered,
      elapsed_seconds: Math.round(elapsedMs / 1000),
    });
  } catch (err: any) {
    console.error('[interview/turn] Error:', err);
    return NextResponse.json(
      { error: err?.message || 'Turn processing failed' },
      { status: 500 },
    );
  }
}

// ---------------------------------------------------------------------------

function safeParseState(raw: string | null): InterviewState {
  if (!raw) {
    return {
      turns: [],
      current_topic: INTERVIEW_TOPICS[0],
      topics_covered: [],
      started_at: Date.now(),
      ended: false,
    };
  }
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed.turns)) {
      return parsed as InterviewState;
    }
  } catch {}
  return {
    turns: [],
    current_topic: INTERVIEW_TOPICS[0],
    topics_covered: [],
    started_at: Date.now(),
    ended: false,
  };
}

const CLOSING_MESSAGES: Record<string, string> = {
  en: 'Thank you so much for taking the time. The Guild Council will review our conversation and you\'ll hear from us within 48 hours. Best of luck.',
  es: 'Muchas gracias por tu tiempo. El Consejo del Gremio revisará nuestra conversación y tendrás noticias dentro de 48 horas. Mucha suerte.',
  ar: 'شكرًا جزيلاً على وقتك. سيراجع مجلس النقابة محادثتنا، وستتلقى ردًا خلال 48 ساعة. بالتوفيق.',
  pt: 'Muito obrigado pelo seu tempo. O Conselho da Guilda revisará nossa conversa e você receberá notícias em até 48 horas. Boa sorte.',
  fr: 'Merci beaucoup pour votre temps. Le Conseil de la Guilde examinera notre conversation et vous aurez de nos nouvelles sous 48 heures. Bonne chance.',
  hi: 'अपना समय देने के लिए बहुत धन्यवाद। गिल्ड काउंसिल हमारी बातचीत की समीक्षा करेगी और आपको 48 घंटों में जवाब मिलेगा। शुभकामनाएं।',
  id: 'Terima kasih banyak atas waktunya. Dewan Guild akan meninjau percakapan kita dan Anda akan mendengar kabar dalam 48 jam. Semoga berhasil.',
  vi: 'Cảm ơn bạn rất nhiều vì đã dành thời gian. Hội đồng Guild sẽ xem lại cuộc trò chuyện và bạn sẽ nhận được phản hồi trong vòng 48 giờ. Chúc bạn may mắn.',
  bn: 'আপনার সময় দেওয়ার জন্য অনেক ধন্যবাদ। গিল্ড কাউন্সিল আমাদের কথোপকথন পর্যালোচনা করবে এবং আপনি ৪৮ ঘন্টার মধ্যে খবর পাবেন। শুভকামনা।',
  ru: 'Большое спасибо за ваше время. Совет Гильдии рассмотрит наш разговор, и вы получите ответ в течение 48 часов. Удачи.',
  zh: '非常感谢您抽出时间。行会理事会将审阅我们的对话，您将在48小时内收到回复。祝您好运。',
};

function getClosingMessage(language: string, fullName: string): string {
  const template = CLOSING_MESSAGES[language] || CLOSING_MESSAGES.en;
  return template;
}
