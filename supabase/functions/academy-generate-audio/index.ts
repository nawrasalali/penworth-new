// academy-generate-audio
// JWT-bypass admin endpoint that runs ElevenLabs with-timestamps TTS for a
// single segment or checkpoint clip of a Guild Academy course module, then
// uploads the mp3 + alignment.json + .srt files to Supabase Storage at
//   guild-academy/audio/{slug}/{target}.{mp3,json,srt}
//
// Authoritative source for narration is guild_academy_modules.content_markdown.
// Parser logic mirrors scripts/generate-academy-audio.ts (the locally runnable
// equivalent) so the player UI's lib/academy/segments.ts surfaces exactly the
// same six segments and four checkpoint clips this function emits.
//
// REQUEST
//   POST /functions/v1/academy-generate-audio
//   Header: x-admin-secret: <ADMIN_SECRET>
//   Body:   { slug: string, target: string, force?: boolean }
//   target ∈ { seg-1 … seg-6, cp-a-prompt, cp-a-wrong, cp-b-prompt, cp-b-wrong }
//
// RESPONSE
//   { ok, slug, target, voice, audio_bytes, char_count, alignment_chars, srt_cues, skipped? }
//
// SECRETS (set via Supabase project secrets)
//   ELEVENLABS_API_KEY  (xi-api-key for ElevenLabs)
//   ADMIN_SECRET        (shared bearer for x-admin-secret header)
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are auto-injected.
//
// COST
//   Approx $0.30–$1.50 per invocation depending on segment length.
//   Full course = 10 calls × 3 courses ≈ $40 one-time.
//
// CEO-151 — author: CEO Claude session 2026-04-27.

import { createClient } from "jsr:@supabase/supabase-js@2";
import { decodeBase64 } from "jsr:@std/encoding@1/base64";

const ELEVENLABS_API_KEY = Deno.env.get("ELEVENLABS_API_KEY");
const ADMIN_SECRET = Deno.env.get("ADMIN_SECRET");
const ELEVENLABS_API = "https://api.elevenlabs.io/v1";
const ELEVENLABS_MODEL = "eleven_multilingual_v2";
const STORAGE_BUCKET = "guild-academy";

// Voice library — IDs from ElevenLabs public catalogue, names mirror
// scripts/generate-academy-audio.ts and lib/academy/segments.ts.
const VOICES = {
  brian: "nPczCjzI2devNBz1zQrb",
  charlotte: "XB0fDUnXU5powFXDhCwa",
  daniel: "onwK4e9ZLuTAKqWW03F9",
  rachel: "21m00Tcm4TlvDq8ikWAM",
} as const;
type VoiceKey = keyof typeof VOICES;

const VOICE_SETTINGS = {
  stability: 0.5,
  similarity_boost: 0.75,
  style: 0.0,
  use_speaker_boost: true,
};

// Per-target voice rotation.
const VOICE_ROTATION: Record<string, VoiceKey> = {
  "seg-1": "brian",
  "seg-2": "brian",
  "seg-3": "charlotte",
  "cp-a-prompt": "charlotte",
  "cp-a-wrong": "charlotte",
  "seg-4": "daniel",
  "seg-5": "daniel",
  "cp-b-prompt": "rachel",
  "cp-b-wrong": "rachel",
  "seg-6": "rachel",
};

const VALID_TARGETS = Object.keys(VOICE_ROTATION);

// ---- Markdown → narration extraction (mirrors local script) ---------------

function stripMarkdown(input: string): string {
  return input
    .replace(/^#{1,6}\s+.*$/gm, "")
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/\*(.+?)\*/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/^\s*[-*]\s+/gm, "— ")
    .replace(/^\s*\d+\.\s+/gm, "")
    .replace(/\s*---\s*/g, "\n\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function extractSegmentText(markdown: string, segIndex: number): string | null {
  const re = /## Segment (\d+) — ([^\n]+)\n([\s\S]*?)(?=\n## |$)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(markdown)) !== null) {
    if (Number(m[1]) === segIndex) {
      let body = m[3];
      body = body.replace(/\*\*Voice:\*\*[^\n]*\n/g, "");
      body = body.replace(/\*\*Word count:\*\*[^\n]*\n/g, "");
      return stripMarkdown(body);
    }
  }
  return null;
}

function extractCheckpointText(markdown: string, letter: "a" | "b", part: "prompt" | "wrong"): string | null {
  const cpRe = /## Checkpoint ([AB])\n([\s\S]*?)(?=\n## |$)/g;
  let m: RegExpExecArray | null;
  while ((m = cpRe.exec(markdown)) !== null) {
    if (m[1].toLowerCase() !== letter) continue;
    const body = m[2];
    if (part === "prompt") {
      const qMatch = body.match(/\*\*Question:\*\*\s+([\s\S]+?)(?=\n\n- A\))/);
      if (!qMatch) return null;
      return stripMarkdown(`${qMatch[1].trim()} Select the answer you believe is correct.`);
    } else {
      const expMatch = body.match(/\*\*Voice explanation if wrong[^\)]*\)\:\*\*\s*\n>\s*([\s\S]+?)(?=\n\n---|\n\n##|$)/);
      if (!expMatch) return null;
      const explanation = expMatch[1].split("\n").map((l) => l.replace(/^>\s?/, "").trim()).join(" ").trim();
      return stripMarkdown(explanation);
    }
  }
  return null;
}

function textForTarget(markdown: string, target: string): string | null {
  if (target.startsWith("seg-")) {
    const idx = Number(target.slice(4));
    return extractSegmentText(markdown, idx);
  }
  if (target.startsWith("cp-")) {
    const letter = target[3] as "a" | "b";
    const part = target.endsWith("-prompt") ? "prompt" : target.endsWith("-wrong") ? "wrong" : null;
    if (!part) return null;
    return extractCheckpointText(markdown, letter, part);
  }
  return null;
}

// ---- ElevenLabs with-timestamps TTS ---------------------------------------

interface AlignmentEntry {
  characters: string[];
  character_start_times_seconds: number[];
  character_end_times_seconds: number[];
}

interface TtsResult {
  audio: Uint8Array;
  alignment: AlignmentEntry;
  normalized_alignment: AlignmentEntry;
}

async function ttsWithTimestamps(text: string, voiceId: string, attempt = 1): Promise<TtsResult> {
  const url = `${ELEVENLABS_API}/text-to-speech/${voiceId}/with-timestamps?output_format=mp3_44100_128`;
  const r = await fetch(url, {
    method: "POST",
    headers: {
      "xi-api-key": ELEVENLABS_API_KEY!,
      "Content-Type": "application/json",
      "Accept": "application/json",
    },
    body: JSON.stringify({ text, model_id: ELEVENLABS_MODEL, voice_settings: VOICE_SETTINGS }),
  });

  // Mirror retry policy from admin-generate-livebook: 429 + 408 retried with
  // linear backoff, capped at 10 attempts.
  if ((r.status === 429 || r.status === 408) && attempt <= 10) {
    await new Promise((res) => setTimeout(res, 2000 * attempt));
    return ttsWithTimestamps(text, voiceId, attempt + 1);
  }
  if (!r.ok) {
    const errText = await r.text();
    throw new Error(`elevenlabs ${r.status}: ${errText.slice(0, 400)}`);
  }
  const data = (await r.json()) as { audio_base64: string; alignment: AlignmentEntry; normalized_alignment: AlignmentEntry };
  return {
    audio: decodeBase64(data.audio_base64),
    alignment: data.alignment,
    normalized_alignment: data.normalized_alignment,
  };
}

// ---- Alignment → SRT ------------------------------------------------------

function formatSrtTime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const ms = Math.round((seconds - Math.floor(seconds)) * 1000);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")},${String(ms).padStart(3, "0")}`;
}

function alignmentToSRT(alignment: AlignmentEntry, wordsPerCue = 10): string {
  const words: { text: string; start: number; end: number }[] = [];
  let cur = "";
  let curStart = 0;
  for (let i = 0; i < alignment.characters.length; i++) {
    const ch = alignment.characters[i];
    if (cur === "") curStart = alignment.character_start_times_seconds[i];
    if (/\s/.test(ch)) {
      if (cur.length > 0) {
        words.push({
          text: cur,
          start: curStart,
          end: alignment.character_end_times_seconds[i - 1] ?? curStart,
        });
        cur = "";
      }
    } else {
      cur += ch;
    }
  }
  if (cur.length > 0) {
    words.push({
      text: cur,
      start: curStart,
      end: alignment.character_end_times_seconds[alignment.character_end_times_seconds.length - 1],
    });
  }
  const cues: string[] = [];
  for (let i = 0; i < words.length; i += wordsPerCue) {
    const group = words.slice(i, i + wordsPerCue);
    if (group.length === 0) continue;
    const start = group[0].start;
    const end = group[group.length - 1].end;
    const text = group.map((w) => w.text).join(" ");
    cues.push(`${cues.length + 1}\n${formatSrtTime(start)} --> ${formatSrtTime(end)}\n${text}\n`);
  }
  return cues.join("\n");
}

// ---- HTTP entry point -----------------------------------------------------

Deno.serve(async (req: Request) => {
  try {
    if (!ELEVENLABS_API_KEY || !ADMIN_SECRET) {
      return new Response(
        JSON.stringify({ error: "server misconfigured: ELEVENLABS_API_KEY/ADMIN_SECRET missing from Edge Function secrets" }),
        { status: 500, headers: { "Content-Type": "application/json" } },
      );
    }
    if (req.headers.get("x-admin-secret") !== ADMIN_SECRET) {
      return new Response("forbidden", { status: 403 });
    }

    const body = await req.json().catch(() => ({}));
    const { slug, target, force = false } = body as { slug?: string; target?: string; force?: boolean };
    if (!slug || !target) {
      return new Response(JSON.stringify({ error: "slug and target required" }), { status: 400, headers: { "Content-Type": "application/json" } });
    }
    if (!VALID_TARGETS.includes(target)) {
      return new Response(JSON.stringify({ error: `invalid target — must be one of ${VALID_TARGETS.join(", ")}` }), { status: 400, headers: { "Content-Type": "application/json" } });
    }

    const voiceKey = VOICE_ROTATION[target];
    const voiceId = VOICES[voiceKey];

    const supa = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    const { data: module, error: modErr } = await supa
      .from("guild_academy_modules")
      .select("slug, content_markdown")
      .eq("slug", slug)
      .maybeSingle();
    if (modErr) return new Response(JSON.stringify({ error: `load module: ${modErr.message}` }), { status: 500, headers: { "Content-Type": "application/json" } });
    if (!module?.content_markdown) {
      return new Response(JSON.stringify({ error: `module ${slug} has no content_markdown` }), { status: 404, headers: { "Content-Type": "application/json" } });
    }

    const text = textForTarget(module.content_markdown, target);
    if (!text || text.length < 5) {
      return new Response(JSON.stringify({ error: `could not extract narration text for target ${target}` }), { status: 422, headers: { "Content-Type": "application/json" } });
    }

    // Skip if any of the three artefacts already exist, unless force=true.
    if (!force) {
      const { data: existing, error: listErr } = await supa.storage.from(STORAGE_BUCKET).list(`audio/${slug}`, { limit: 100 });
      if (listErr) return new Response(JSON.stringify({ error: `list bucket: ${listErr.message}` }), { status: 500, headers: { "Content-Type": "application/json" } });
      const present = new Set((existing ?? []).map((f) => f.name));
      const allThreeExist = present.has(`${target}.mp3`) && present.has(`${target}.json`) && present.has(`${target}.srt`);
      if (allThreeExist) {
        return new Response(JSON.stringify({ ok: true, slug, target, voice: voiceKey, skipped: true, reason: "all artefacts already present (pass force=true to regenerate)" }), { headers: { "Content-Type": "application/json" } });
      }
    }

    const t0 = Date.now();
    const result = await ttsWithTimestamps(text, voiceId);
    const srt = alignmentToSRT(result.normalized_alignment);

    const base = `audio/${slug}/${target}`;
    const items: Array<[string, Uint8Array, string]> = [
      [`${base}.mp3`, result.audio, "audio/mpeg"],
      [`${base}.json`, new TextEncoder().encode(JSON.stringify(result.alignment)), "application/json"],
      [`${base}.srt`, new TextEncoder().encode(srt), "application/x-subrip"],
    ];
    for (const [path, buf, contentType] of items) {
      const { error: upErr } = await supa.storage.from(STORAGE_BUCKET).upload(path, buf, { contentType, upsert: force });
      if (upErr && !upErr.message.includes("already exists")) {
        return new Response(JSON.stringify({ error: `upload ${path}: ${upErr.message}` }), { status: 500, headers: { "Content-Type": "application/json" } });
      }
    }

    const elapsed = Math.round((Date.now() - t0) / 1000);
    return new Response(
      JSON.stringify({
        ok: true,
        slug,
        target,
        voice: voiceKey,
        char_count: text.length,
        audio_bytes: result.audio.length,
        alignment_chars: result.alignment.characters.length,
        srt_cues: srt.split(/\n\s*\n/).filter(Boolean).length,
        elapsed_sec: elapsed,
      }),
      { headers: { "Content-Type": "application/json" } },
    );
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
});
