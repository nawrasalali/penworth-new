/**
 * Generate ElevenLabs audio + SRT timing files for the Penworth Guild Academy
 * Foundations course track. Reads canonical scripts from guild_academy_modules,
 * narrates each segment + checkpoint with the assigned voice, and uploads
 * mp3 + json (alignment) + srt to Supabase Storage at
 *   guild-academy/audio/{slug}/seg-{n}.{mp3,json,srt}
 *   guild-academy/audio/{slug}/checkpoint-{a|b}-prompt.{mp3,json,srt}
 *   guild-academy/audio/{slug}/checkpoint-{a|b}-wrong.{mp3,json,srt}
 *
 * USAGE
 *   pnpm tsx scripts/generate-academy-audio.ts <slug>
 *   pnpm tsx scripts/generate-academy-audio.ts --all
 *
 * REQUIRED ENV
 *   ELEVENLABS_API_KEY
 *   NEXT_PUBLIC_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *
 * COST
 *   Approx $13 USD per course (~50,000 chars at ElevenLabs Creator pricing).
 *   Three courses ≈ $40 USD one-time. Re-running re-bills; the script
 *   skips files that already exist in Storage unless --force is passed.
 *
 * NETWORK
 *   The Anthropic sandbox blocks ElevenLabs (returns 18-byte stub).
 *   Run this locally, in a Vercel cron, or in a Supabase edge function.
 */

import { createClient } from '@supabase/supabase-js';

// ---- Config ---------------------------------------------------------------

const ELEVENLABS_API = 'https://api.elevenlabs.io/v1';
const ELEVENLABS_MODEL = 'eleven_multilingual_v2';
const STORAGE_BUCKET = 'guild-academy';

const VOICES = {
  brian: 'nPczCjzI2devNBz1zQrb', // V1, M, US — calm narrator
  charlotte: 'XB0fDUnXU5powFXDhCwa', // V2, F, UK — warm
  daniel: 'onwK4e9ZLuTAKqWW03F9', // V3, M, UK — Daniel (Steady Broadcaster, premade)
  rachel: '21m00Tcm4TlvDq8ikWAM', // V4, F, US — clear (already used elsewhere in the codebase)
} as const;
type VoiceKey = keyof typeof VOICES;

const VOICE_SETTINGS = {
  stability: 0.5,
  similarity_boost: 0.75,
  style: 0.0,
  use_speaker_boost: true,
};

// Segment-level voice rotation. Keyed by segment index (1-based) for segments,
// and 'cp-a-*' / 'cp-b-*' for the two checkpoints' prompt + wrong-answer clips.
const VOICE_ROTATION: Record<string, VoiceKey> = {
  'seg-1': 'brian',
  'seg-2': 'brian',
  'seg-3': 'charlotte',
  'cp-a-prompt': 'charlotte',
  'cp-a-wrong': 'charlotte',
  'seg-4': 'daniel',
  'seg-5': 'daniel',
  'cp-b-prompt': 'rachel',
  'cp-b-wrong': 'rachel',
  'seg-6': 'rachel',
};

const SLUGS = ['welcome-to-the-guild', 'commission-mechanics', 'representing-penworth-well'] as const;

// ---- Markdown → narration extraction --------------------------------------

interface Segment {
  key: string; // 'seg-1', 'seg-2', ...
  index: number;
  title: string;
  voice: VoiceKey;
  text: string; // the narration body, with metadata stripped
}

interface CheckpointAudio {
  key: string; // 'cp-a-prompt', 'cp-a-wrong', etc.
  voice: VoiceKey;
  text: string;
}

/**
 * Strip markdown markup and headings to produce clean prose for TTS.
 * Bold/italic markers go away, but the underlying text and punctuation stay.
 * Bullets/numbered lists get prefixed punctuation so the narrator pauses.
 */
function stripMarkdown(input: string): string {
  return input
    .replace(/^#{1,6}\s+.*$/gm, '') // drop heading lines
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/\*(.+?)\*/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/^\s*[-*]\s+/gm, '— ')
    .replace(/^\s*\d+\.\s+/gm, '')
    .replace(/\s*---\s*/g, '\n\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function extractSegments(markdown: string): Segment[] {
  const segments: Segment[] = [];
  // Match "## Segment N — Title" then everything until the next "## " (case sensitive)
  const re = /## Segment (\d+) — ([^\n]+)\n([\s\S]*?)(?=\n## |\Z)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(markdown)) !== null) {
    const index = Number(m[1]);
    const title = m[2].trim();
    let body = m[3];
    // Drop the "**Voice:** ..." and "**Word count:** ..." metadata block at the top
    body = body.replace(/\*\*Voice:\*\*[^\n]*\n/g, '');
    body = body.replace(/\*\*Word count:\*\*[^\n]*\n/g, '');
    const text = stripMarkdown(body);
    const key = `seg-${index}`;
    const voice = VOICE_ROTATION[key];
    if (!voice) throw new Error(`No voice mapping for ${key}`);
    segments.push({ key, index, title, voice, text });
  }
  return segments.sort((a, b) => a.index - b.index);
}

function extractCheckpoints(markdown: string): CheckpointAudio[] {
  const out: CheckpointAudio[] = [];
  // Match each "## Checkpoint A|B" block
  const cpRe = /## Checkpoint ([AB])\n([\s\S]*?)(?=\n## |\Z)/g;
  let m: RegExpExecArray | null;
  while ((m = cpRe.exec(markdown)) !== null) {
    const letter = m[1].toLowerCase();
    const body = m[2];

    // Question prompt — narrator reads the question and instructs to select an option
    const qMatch = body.match(/\*\*Question:\*\*\s+([\s\S]+?)(?=\n\n- A\))/);
    const question = qMatch ? qMatch[1].trim() : '';
    const promptText = `${question} Select the answer you believe is correct.`;

    // Wrong-answer explanation — the blockquoted explanation
    const expMatch = body.match(/\*\*Voice explanation if wrong[^\)]*\)\:\*\*\s*\n>\s*([\s\S]+?)(?=\n\n---|\n\n##|\Z)/);
    const explanation = expMatch ? expMatch[1].split('\n').map(l => l.replace(/^>\s?/, '').trim()).join(' ').trim() : '';

    const promptKey = `cp-${letter}-prompt`;
    const wrongKey = `cp-${letter}-wrong`;
    const promptVoice = VOICE_ROTATION[promptKey];
    const wrongVoice = VOICE_ROTATION[wrongKey];
    if (!promptVoice || !wrongVoice) throw new Error(`No voice for checkpoint ${letter}`);

    if (question) out.push({ key: promptKey, voice: promptVoice, text: stripMarkdown(promptText) });
    if (explanation) out.push({ key: wrongKey, voice: wrongVoice, text: stripMarkdown(explanation) });
  }
  return out;
}

// ---- ElevenLabs TTS with timestamps ---------------------------------------

interface AlignmentEntry {
  characters: string[];
  character_start_times_seconds: number[];
  character_end_times_seconds: number[];
}

interface TtsResult {
  audio: Buffer;
  alignment: AlignmentEntry;
  normalized_alignment: AlignmentEntry;
}

async function ttsWithTimestamps(text: string, voiceId: string): Promise<TtsResult> {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) throw new Error('ELEVENLABS_API_KEY not set');

  const url = `${ELEVENLABS_API}/text-to-speech/${voiceId}/with-timestamps?output_format=mp3_44100_128`;
  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      'xi-api-key': apiKey,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    },
    body: JSON.stringify({
      text,
      model_id: ELEVENLABS_MODEL,
      voice_settings: VOICE_SETTINGS,
    }),
  });

  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`ElevenLabs TTS ${resp.status}: ${errText.slice(0, 400)}`);
  }

  const data = await resp.json() as { audio_base64: string; alignment: AlignmentEntry; normalized_alignment: AlignmentEntry };
  return {
    audio: Buffer.from(data.audio_base64, 'base64'),
    alignment: data.alignment,
    normalized_alignment: data.normalized_alignment,
  };
}

// ---- Alignment → SRT (line-by-line, ~10 words per cue) --------------------

function alignmentToSRT(alignment: AlignmentEntry, wordsPerCue = 10): string {
  // Reconstruct words from per-character alignment, then group into cues.
  const words: { text: string; start: number; end: number }[] = [];
  let cur = '';
  let curStart = 0;
  for (let i = 0; i < alignment.characters.length; i++) {
    const ch = alignment.characters[i];
    if (cur === '') curStart = alignment.character_start_times_seconds[i];
    if (/\s/.test(ch)) {
      if (cur.length > 0) {
        words.push({ text: cur, start: curStart, end: alignment.character_end_times_seconds[i - 1] ?? curStart });
        cur = '';
      }
    } else {
      cur += ch;
    }
  }
  if (cur.length > 0) {
    words.push({ text: cur, start: curStart, end: alignment.character_end_times_seconds[alignment.character_end_times_seconds.length - 1] });
  }

  const cues: string[] = [];
  for (let i = 0; i < words.length; i += wordsPerCue) {
    const group = words.slice(i, i + wordsPerCue);
    if (group.length === 0) continue;
    const start = group[0].start;
    const end = group[group.length - 1].end;
    const text = group.map(w => w.text).join(' ');
    cues.push(`${cues.length + 1}\n${formatSrtTime(start)} --> ${formatSrtTime(end)}\n${text}\n`);
  }
  return cues.join('\n');
}

function formatSrtTime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const ms = Math.round((seconds - Math.floor(seconds)) * 1000);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')},${String(ms).padStart(3, '0')}`;
}

// ---- Storage upload + DB metadata write -----------------------------------

async function uploadToStorage(supabase: any, slug: string, key: string, mp3: Buffer, alignment: AlignmentEntry, srt: string, force: boolean) {
  const base = `audio/${slug}/${key}`;
  const items: Array<[string, Buffer | string, string]> = [
    [`${base}.mp3`, mp3, 'audio/mpeg'],
    [`${base}.json`, JSON.stringify(alignment), 'application/json'],
    [`${base}.srt`, srt, 'application/x-subrip'],
  ];

  for (const [path, body, contentType] of items) {
    if (!force) {
      const { data: existing } = await supabase.storage.from(STORAGE_BUCKET).list(`audio/${slug}`, { limit: 100 });
      const present = existing?.some((f: any) => f.name === path.split('/').pop());
      if (present) {
        console.log(`  skip (exists): ${path}`);
        continue;
      }
    }
    const buf = typeof body === 'string' ? Buffer.from(body, 'utf-8') : body;
    const { error } = await supabase.storage.from(STORAGE_BUCKET).upload(path, buf, {
      contentType,
      upsert: force,
    });
    if (error) throw new Error(`Upload ${path}: ${error.message}`);
    console.log(`  uploaded: ${path} (${buf.length} bytes)`);
  }
}

// ---- Main pipeline --------------------------------------------------------

async function generateForCourse(supabase: any, slug: string, force: boolean) {
  console.log(`\n=== ${slug} ===`);
  const { data: module, error } = await supabase
    .from('guild_academy_modules')
    .select('id, slug, title, content_markdown, quiz')
    .eq('slug', slug)
    .single();
  if (error) throw new Error(`Load module ${slug}: ${error.message}`);
  if (!module?.content_markdown) throw new Error(`Module ${slug} has no content_markdown`);

  const segments = extractSegments(module.content_markdown);
  const checkpoints = extractCheckpoints(module.content_markdown);

  console.log(`  ${segments.length} segments, ${checkpoints.length} checkpoint clips`);
  if (segments.length !== 6) console.warn(`  WARN: expected 6 segments, got ${segments.length}`);
  if (checkpoints.length !== 4) console.warn(`  WARN: expected 4 checkpoint clips, got ${checkpoints.length}`);

  const manifest: Record<string, { voice: VoiceKey; bytes: number; chars: number }> = {};

  for (const seg of segments) {
    console.log(`  segment ${seg.index} (${seg.voice}, ${seg.text.length} chars): generating...`);
    const result = await ttsWithTimestamps(seg.text, VOICES[seg.voice]);
    const srt = alignmentToSRT(result.normalized_alignment);
    await uploadToStorage(supabase, slug, seg.key, result.audio, result.alignment, srt, force);
    manifest[seg.key] = { voice: seg.voice, bytes: result.audio.length, chars: seg.text.length };
  }

  for (const cp of checkpoints) {
    console.log(`  checkpoint ${cp.key} (${cp.voice}, ${cp.text.length} chars): generating...`);
    const result = await ttsWithTimestamps(cp.text, VOICES[cp.voice]);
    const srt = alignmentToSRT(result.normalized_alignment);
    await uploadToStorage(supabase, slug, cp.key, result.audio, result.alignment, srt, force);
    manifest[cp.key] = { voice: cp.voice, bytes: result.audio.length, chars: cp.text.length };
  }

  // Persist manifest to module metadata for the player to discover
  const metadataPatch = { audio_manifest: { generated_at: new Date().toISOString(), bucket: STORAGE_BUCKET, slug, model: ELEVENLABS_MODEL, voices: VOICES, items: manifest } };
  const { error: updErr } = await supabase
    .from('guild_academy_modules')
    .update({ metadata: metadataPatch, updated_at: new Date().toISOString() })
    .eq('slug', slug);
  if (updErr) console.warn(`  metadata update failed: ${updErr.message}`);
  else console.log(`  manifest persisted to module.metadata`);
}

async function main() {
  const args = process.argv.slice(2);
  const force = args.includes('--force');
  const all = args.includes('--all');
  const explicitSlug = args.find(a => !a.startsWith('--'));

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) {
    throw new Error('NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY required');
  }
  const supabase = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

  const targets: string[] = all ? [...SLUGS] : explicitSlug ? [explicitSlug] : [];
  if (targets.length === 0) {
    console.error('Usage: tsx scripts/generate-academy-audio.ts <slug> [--force]');
    console.error('       tsx scripts/generate-academy-audio.ts --all [--force]');
    console.error(`Slugs: ${SLUGS.join(', ')}`);
    process.exit(1);
  }

  for (const slug of targets) {
    await generateForCourse(supabase, slug, force);
  }
  console.log('\nDone.');
}

main().catch(err => {
  console.error('FATAL:', err);
  process.exit(1);
});
