import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export const maxDuration = 300; // Vercel pro: up to 5 minutes per invocation

/**
 * Per-chapter ElevenLabs narration for Penworth Store listings.
 *
 * Flow:
 *   1. Caller POSTs { projectId } after publishing a book to Penworth Store
 *   2. We fetch the project's completed chapters in order
 *   3. For each chapter:
 *      a. Upsert an audiobook_chapters row in 'generating' state
 *      b. Stream text to ElevenLabs /v1/text-to-speech/{voiceId}
 *      c. Upload the returned MP3 bytes to Supabase Storage
 *      d. Update the row to 'complete' with the public URL + duration estimate
 *   4. Return the full manifest
 *
 * Voice selection: we pick a default multilingual voice per language. The
 * author can change this later via /settings (not in this PR).
 *
 * This endpoint is synchronous and can run up to 5 minutes. For books with
 * many chapters we recommend chunking — the author can re-call the endpoint
 * and we only generate chapters that are still 'pending'/'failed'.
 */

const ELEVENLABS_API = 'https://api.elevenlabs.io/v1';
const ELEVENLABS_MODEL = 'eleven_multilingual_v2';

/**
 * ElevenLabs voice IDs chosen for each Penworth language.
 * These are stable public voices from the ElevenLabs library. When you change
 * one, update the DEFAULT_VOICE comment in both this file and the spec.
 */
const VOICE_BY_LANGUAGE: Record<string, string> = {
  en: '21m00Tcm4TlvDq8ikWAM', // Rachel (neutral female American English)
  ar: 'pNInz6obpgDQGcFmaJgB', // Adam (male, multilingual supports Arabic)
  es: 'pNInz6obpgDQGcFmaJgB', // Adam (multilingual)
  pt: 'pNInz6obpgDQGcFmaJgB',
  fr: 'pNInz6obpgDQGcFmaJgB',
  ru: 'pNInz6obpgDQGcFmaJgB',
  zh: 'pNInz6obpgDQGcFmaJgB',
  bn: 'pNInz6obpgDQGcFmaJgB',
  hi: 'pNInz6obpgDQGcFmaJgB',
  id: 'pNInz6obpgDQGcFmaJgB',
  vi: 'pNInz6obpgDQGcFmaJgB',
};

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (!process.env.ELEVENLABS_API_KEY) {
    return NextResponse.json(
      { error: 'Audio narration is not yet configured on this server. Contact support.' },
      { status: 503 },
    );
  }

  // ROLLOUT GATE: narration is admin-only until the cost model is tuned.
  // ElevenLabs costs ~$2-5 per book; letting every free user trigger it
  // would be burn-rate-catastrophic. Later we'll switch this to a credit
  // deduction (e.g. 500 credits/chapter mirroring regenerate-chapter).
  const { data: adminProfile } = await supabase
    .from('profiles')
    .select('is_admin')
    .eq('id', user.id)
    .single();
  if (!adminProfile?.is_admin) {
    return NextResponse.json(
      { error: 'Audio narration is in limited preview. Contact support for early access.' },
      { status: 402 },
    );
  }

  const { projectId, voiceId: customVoiceId } = await request.json();
  if (!projectId) {
    return NextResponse.json({ error: 'projectId required' }, { status: 400 });
  }

  // Verify ownership + load chapters
  const { data: project, error: projErr } = await supabase
    .from('projects')
    .select('id, user_id, title')
    .eq('id', projectId)
    .eq('user_id', user.id)
    .single();

  if (projErr || !project) {
    return NextResponse.json({ error: 'Project not found' }, { status: 404 });
  }

  const { data: chapters } = await supabase
    .from('chapters')
    .select('id, title, content, order_index, word_count')
    .eq('project_id', projectId)
    .eq('status', 'complete')
    .order('order_index');

  if (!chapters || chapters.length === 0) {
    return NextResponse.json({ error: 'No completed chapters to narrate' }, { status: 400 });
  }

  // Resolve voice based on author's preferred_language
  const { data: profile } = await supabase
    .from('profiles')
    .select('preferred_language')
    .eq('id', user.id)
    .single();
  const lang = (profile?.preferred_language || 'en').toLowerCase();
  const voiceId = customVoiceId || VOICE_BY_LANGUAGE[lang] || VOICE_BY_LANGUAGE.en;

  // Load any existing narration rows to skip already-complete chapters
  const { data: existing } = await supabase
    .from('audiobook_chapters')
    .select('chapter_id, status')
    .eq('project_id', projectId);
  const completedChapterIds = new Set(
    (existing || []).filter((r: any) => r.status === 'complete').map((r: any) => r.chapter_id),
  );

  const results: Array<{
    chapter_id: string;
    status: string;
    audio_url?: string;
    error?: string;
  }> = [];

  for (const ch of chapters) {
    if (completedChapterIds.has(ch.id)) {
      // Already narrated; skip
      results.push({ chapter_id: ch.id, status: 'complete' });
      continue;
    }

    // Mark as generating
    const nowIso = new Date().toISOString();
    await supabase
      .from('audiobook_chapters')
      .upsert(
        {
          project_id: projectId,
          chapter_id: ch.id,
          user_id: user.id,
          order_index: ch.order_index,
          voice_id: voiceId,
          status: 'generating',
          updated_at: nowIso,
        },
        { onConflict: 'chapter_id' },
      );

    try {
      // Compose narration text: chapter title + body
      const narrationText = `${ch.title}.\n\n${ch.content || ''}`.trim();
      if (!narrationText) throw new Error('Empty chapter content');

      // Call ElevenLabs TTS (MP3 output)
      const ttsResp = await fetch(
        `${ELEVENLABS_API}/text-to-speech/${voiceId}?output_format=mp3_44100_128`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'xi-api-key': process.env.ELEVENLABS_API_KEY!,
          },
          body: JSON.stringify({
            text: narrationText,
            model_id: ELEVENLABS_MODEL,
            voice_settings: {
              stability: 0.5,
              similarity_boost: 0.75,
              style: 0,
              use_speaker_boost: true,
            },
          }),
        },
      );

      if (!ttsResp.ok) {
        const errText = await ttsResp.text();
        throw new Error(`ElevenLabs ${ttsResp.status}: ${errText.slice(0, 200)}`);
      }

      const audioBuffer = await ttsResp.arrayBuffer();
      const audioBytes = new Uint8Array(audioBuffer);

      // Upload to storage: {user_id}/{project_id}/{chapter_id}.mp3
      const storagePath = `${user.id}/${projectId}/${ch.id}.mp3`;
      const { error: uploadErr } = await supabase.storage
        .from('audiobooks')
        .upload(storagePath, audioBytes, {
          contentType: 'audio/mpeg',
          upsert: true,
        });

      if (uploadErr) throw new Error(`Storage upload failed: ${uploadErr.message}`);

      // Build public URL
      const { data: pub } = supabase.storage.from('audiobooks').getPublicUrl(storagePath);
      const audioUrl = pub?.publicUrl;
      if (!audioUrl) throw new Error('Could not resolve audio URL');

      // Estimate duration: ~150 words per minute narration (rough but fine for UI)
      const durationSeconds = Math.round(((ch.word_count || 0) / 150) * 60);

      // ElevenLabs cost: $0.30 per 1k characters (approx, credit-pool dependent)
      const costUsd = (narrationText.length / 1000) * 0.30;

      await supabase
        .from('audiobook_chapters')
        .update({
          audio_url: audioUrl,
          duration_s: durationSeconds,
          size_bytes: audioBytes.length,
          status: 'complete',
          cost_usd: costUsd,
          error: null,
          updated_at: new Date().toISOString(),
        })
        .eq('chapter_id', ch.id);

      results.push({ chapter_id: ch.id, status: 'complete', audio_url: audioUrl });
    } catch (err: any) {
      console.error('Narration failed for chapter', ch.id, err);
      await supabase
        .from('audiobook_chapters')
        .update({
          status: 'failed',
          error: String(err.message || err).slice(0, 500),
          updated_at: new Date().toISOString(),
        })
        .eq('chapter_id', ch.id);
      results.push({ chapter_id: ch.id, status: 'failed', error: String(err.message || err) });
    }
  }

  const successful = results.filter((r) => r.status === 'complete').length;
  const failed = results.filter((r) => r.status === 'failed').length;

  return NextResponse.json({
    success: failed === 0,
    projectId,
    voiceId,
    language: lang,
    totalChapters: chapters.length,
    successful,
    failed,
    results,
  });
}

/**
 * GET /api/publishing/penworth-store/narrate?projectId=xyz
 * Returns the narration status + manifest for a project so the marketplace
 * player can render a progress bar or a list of chapter tracks.
 */
export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const projectId = new URL(request.url).searchParams.get('projectId');
  if (!projectId) return NextResponse.json({ error: 'projectId required' }, { status: 400 });

  const { data: rows, error } = await supabase
    .from('audiobook_chapters')
    .select('chapter_id, order_index, status, audio_url, duration_s, error')
    .eq('project_id', projectId)
    .order('order_index');

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const complete = (rows || []).filter((r) => r.status === 'complete');
  const totalDuration = complete.reduce((s, r) => s + (r.duration_s || 0), 0);

  return NextResponse.json({
    chapters: rows || [],
    completeCount: complete.length,
    totalCount: (rows || []).length,
    totalDurationSeconds: totalDuration,
    hasAudio: complete.length > 0,
  });
}
