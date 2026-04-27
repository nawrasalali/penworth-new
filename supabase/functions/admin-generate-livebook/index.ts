// admin-generate-livebook
// JWT-bypass admin endpoint that runs ElevenLabs TTS livebook generation
// for a given store_listings row. Same pipeline as generate-livebook but
// uses a shared secret in the x-admin-secret header so the founder (or
// the auto-trigger from the writer publish route) can kick off
// generation for any listing without needing the author's session token.
//
// Secrets are read from Edge Function env (Supabase project secrets):
//   - ELEVENLABS_API_KEY  (ElevenLabs TTS API key)
//   - ADMIN_SECRET        (shared secret for x-admin-secret header)
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are auto-injected by the runtime.
//
// Provider history:
//   - Original: Cartesia Sonic-2 (CARTESIA_KEY env)
//   - CEO-105 (2026-04-25): moved CARTESIA_KEY + ADMIN_SECRET out of inline
//     constants into Deno.env so the source could live in the public repo.
//   - CEO-134 (2026-04-26): killed Cartesia after credit cap was exhausted
//     in production. Voice provider swapped to ElevenLabs
//     eleven_multilingual_v2; CARTESIA_KEY env var retired entirely.
//   - CEO-171 (2026-04-27): generator was substituting __AUDIO_MAP__ /
//     __UTTERANCES__ but the production livebook-template.html (consumed
//     by livebook-manifest + the new player.html) expects __PARAGRAPHS__
//     / __AMBIENT_URL__. As a result every generated livebook.html
//     contained a literal `const PARAGRAPHS = __PARAGRAPHS__;`, the
//     manifest returned `paragraphs: []`, and the player stuck on
//     "No content available". This rewrite:
//       1. Chunks chapter content by *paragraph* (blank-line splits)
//          rather than sentence, so paragraph indexes line up with
//          chapter_assets.paragraph_start_idx and the manifest can map
//          assets onto paragraphs.
//       2. Builds a PARAGRAPHS array of
//          { id, text, gap_ms, audio, word_timings } — the schema
//          consumed by livebook-manifest's regex parser and player.html.
//       3. Substitutes __PARAGRAPHS__, __AMBIENT_URL__, __DURATION_SEC__,
//          __DURATION__, etc., matching the current template contract.
//       4. Writes the audio source HTML to livebook_audio_source_path;
//          leaves livebook_asset_path untouched if the install-livebook-player
//          function has already pointed it at the v7 player UI. Legacy
//          listings whose livebook_asset_path is still null on first
//          regen will be backfilled here.
//
// REQUEST
//   POST /functions/v1/admin-generate-livebook
//   Headers: x-admin-secret: <ADMIN_SECRET>
//   Body: { listing_id: uuid, voice_kind?: "default_male" | "default_female" }
//
// RESPONSE
//   200: { ok, paragraphs, duration_sec, elapsed_sec, html_kb, url }
//   4xx/5xx: { error: string }

import { createClient } from "jsr:@supabase/supabase-js@2";
import { encodeBase64 } from "jsr:@std/encoding@1/base64";

const ELEVENLABS_API_KEY = Deno.env.get("ELEVENLABS_API_KEY");
const ADMIN_SECRET = Deno.env.get("ADMIN_SECRET");
const ELEVENLABS_API = "https://api.elevenlabs.io/v1";
const ELEVENLABS_MODEL = "eleven_multilingual_v2";
const TEMPLATE_URL = "https://store.penworth.ai/livebook-template.html";

// Voice IDs are stable public ElevenLabs library voices.
const VOICES: Record<string, { id: string; name: string }> = {
  default_male:   { id: "pNInz6obpgDQGcFmaJgB", name: "Adam" },
  default_female: { id: "21m00Tcm4TlvDq8ikWAM", name: "Rachel" },
};

// Total word budget across all paragraphs for the first-pass livebook.
// Caps cost on a fresh generation; full-chapter rendering is a future
// premium tier flag.
const MAX_WORDS = 1800;
// ElevenLabs eleven_multilingual_v2 hard-caps a single TTS request at
// roughly 5000 characters. Long paragraphs are split by sentence
// boundary into multiple TTS calls and concatenated as a single audio
// data URL. 4500 leaves headroom for the model's own internal padding.
const TTS_CHAR_LIMIT = 4500;
// Default trailing pause after a paragraph so the player has space to
// breathe before the next visual cue. Player honours `gap_ms` per
// paragraph; this is the floor.
const DEFAULT_GAP_MS = 600;
// Bump pause slightly when a paragraph ends on terminal punctuation
// followed by a quote or close bracket (likely end of dialogue/scene).
const TERMINAL_GAP_MS = 900;

// ---- Markdown → paragraph splitter --------------------------------------

function splitParagraphs(markdown: string): string[] {
  // Mirror admin-match-livebook-images.splitParagraphs so the indexes
  // produced here line up with the embeddings/asset matching pipeline.
  // chapter_assets.paragraph_start_idx is computed against this exact
  // chunking, so any divergence breaks asset-to-paragraph alignment.
  const cleaned = markdown
    .replace(/^#+\s+/gm, "")
    .replace(/\r/g, "")
    .replace(/[ \t]+$/gm, "");
  const blocks = cleaned.split(/\n\s*\n+/);
  const out: string[] = [];
  for (const b of blocks) {
    const t = b.replace(/\s+/g, " ").trim();
    if (t.length > 0) out.push(t);
  }
  return out;
}

// Trim the paragraph list to fit within MAX_WORDS, keeping whole
// paragraphs (never mid-paragraph cut-offs).
function trimParagraphsToBudget(paragraphs: string[], maxWords: number): string[] {
  const out: string[] = [];
  let total = 0;
  for (const p of paragraphs) {
    const w = p.split(/\s+/).length;
    if (total + w > maxWords && out.length > 0) break;
    out.push(p);
    total += w;
  }
  return out;
}

// Split a paragraph into TTS-sized chunks at sentence boundaries.
// Used only when a single paragraph exceeds TTS_CHAR_LIMIT — we still
// preserve the paragraph as one PARAGRAPHS entry by concatenating
// audio from the sub-chunks.
function chunkForTts(paragraph: string, charLimit: number): string[] {
  if (paragraph.length <= charLimit) return [paragraph];
  const sentences = paragraph.split(/(?<=[.!?])\s+(?=[A-Z"'\(\[])/);
  const chunks: string[] = [];
  let buf = "";
  for (const s of sentences) {
    if (!s) continue;
    if (buf.length + s.length + 1 > charLimit && buf.length > 0) {
      chunks.push(buf);
      buf = s;
    } else {
      buf = buf.length === 0 ? s : buf + " " + s;
    }
  }
  if (buf.length > 0) chunks.push(buf);
  // Last-resort: a sentence longer than the limit. Hard split on words.
  const final: string[] = [];
  for (const c of chunks) {
    if (c.length <= charLimit) {
      final.push(c);
      continue;
    }
    const words = c.split(/\s+/);
    let wbuf = "";
    for (const w of words) {
      if (wbuf.length + w.length + 1 > charLimit && wbuf.length > 0) {
        final.push(wbuf);
        wbuf = w;
      } else {
        wbuf = wbuf.length === 0 ? w : wbuf + " " + w;
      }
    }
    if (wbuf.length > 0) final.push(wbuf);
  }
  return final;
}

// ---- ElevenLabs TTS ------------------------------------------------------

async function tts(text: string, voiceId: string, attempt = 1): Promise<ArrayBuffer> {
  const r = await fetch(
    `${ELEVENLABS_API}/text-to-speech/${voiceId}?output_format=mp3_44100_128`,
    {
      method: "POST",
      headers: {
        "xi-api-key": ELEVENLABS_API_KEY!,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        text,
        model_id: ELEVENLABS_MODEL,
      }),
    },
  );
  // ElevenLabs uses 429 + Retry-After for rate limits and 408 for queue
  // timeouts. Retry on either, exponential backoff capped at 10 attempts.
  if ((r.status === 429 || r.status === 408) && attempt <= 10) {
    await new Promise((res) => setTimeout(res, 2000 * attempt));
    return tts(text, voiceId, attempt + 1);
  }
  if (!r.ok) {
    throw new Error(`elevenlabs ${r.status}: ${(await r.text()).slice(0, 200)}`);
  }
  return await r.arrayBuffer();
}

// Concatenate raw mp3 byte buffers. mp3 frames are self-delimiting so
// raw concatenation produces a valid playable stream — this is how the
// previous sentence-by-sentence audio_map worked. We rely on the same
// property here for paragraphs that exceed TTS_CHAR_LIMIT.
function concatBuffers(parts: ArrayBuffer[]): Uint8Array {
  let total = 0;
  for (const p of parts) total += p.byteLength;
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    out.set(new Uint8Array(p), off);
    off += p.byteLength;
  }
  return out;
}

// ---- Helpers -------------------------------------------------------------

function esc(s: string) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function mmss(s: number) {
  const m = Math.floor(s / 60);
  const x = Math.floor(s % 60);
  return `${m}:${x.toString().padStart(2, "0")}`;
}

function gapForParagraph(text: string): number {
  return /[.!?]["')\]]+\s*$/.test(text.trim()) ? TERMINAL_GAP_MS : DEFAULT_GAP_MS;
}

// ---- Main handler --------------------------------------------------------

Deno.serve(async (req: Request) => {
  try {
    if (!ELEVENLABS_API_KEY || !ADMIN_SECRET) {
      return new Response(
        JSON.stringify({
          error:
            "server misconfigured: ELEVENLABS_API_KEY/ADMIN_SECRET missing from Edge Function secrets",
        }),
        { status: 500, headers: { "Content-Type": "application/json" } },
      );
    }
    if (req.headers.get("x-admin-secret") !== ADMIN_SECRET) {
      return new Response("forbidden", { status: 403 });
    }
    const body = await req.json();
    const { listing_id, voice_kind = "default_male" } = body as {
      listing_id?: string;
      voice_kind?: string;
    };
    if (!listing_id) {
      return new Response(JSON.stringify({ error: "listing_id required" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }
    const voice = VOICES[voice_kind];
    if (!voice) {
      return new Response(JSON.stringify({ error: "unknown voice_kind" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    const supa = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: listing } = await supa
      .from("store_listings")
      .select("id, listing_slug, title, author_id, cover_image_url, livebook_asset_path")
      .eq("id", listing_id)
      .maybeSingle();
    if (!listing) {
      return new Response(JSON.stringify({ error: "listing not found" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    }

    const { data: chapter } = await supa
      .from("store_chapters")
      .select("title, content_markdown")
      .eq("listing_id", listing_id)
      .order("chapter_index", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (!chapter?.content_markdown) {
      return new Response(JSON.stringify({ error: "no chapter" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    const { data: authorProfile } = await supa
      .from("store_author_profiles")
      .select("display_name")
      .eq("user_id", listing.author_id)
      .maybeSingle();

    const allParagraphs = splitParagraphs(chapter.content_markdown);
    const sample = trimParagraphsToBudget(allParagraphs, MAX_WORDS);
    if (sample.length === 0) {
      return new Response(JSON.stringify({ error: "no paragraphs after splitting" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    // PARAGRAPHS schema (consumed verbatim by livebook-manifest's regex
    // parser + player.html's run loop):
    //   { id: "p<idx>"; text: string; gap_ms: number; audio: string;
    //     word_timings: unknown[] }
    // - audio is a `data:audio/mpeg;base64,...` URL
    // - word_timings is left empty for now (player tolerates [] and
    //   falls back to whole-paragraph caption fade)
    type ParagraphRow = {
      id: string;
      text: string;
      gap_ms: number;
      audio: string;
      word_timings: unknown[];
    };

    const paragraphs: ParagraphRow[] = [];
    let totalAudioBytes = 0;
    const t0 = Date.now();

    for (let i = 0; i < sample.length; i++) {
      const text = sample[i];
      const ttsChunks = chunkForTts(text, TTS_CHAR_LIMIT);
      const audioBufs: ArrayBuffer[] = [];
      for (const c of ttsChunks) {
        audioBufs.push(await tts(c, voice.id));
      }
      const merged = concatBuffers(audioBufs);
      totalAudioBytes += merged.byteLength;
      paragraphs.push({
        id: `p${i}`,
        text,
        gap_ms: gapForParagraph(text),
        audio: `data:audio/mpeg;base64,${encodeBase64(merged)}`,
        word_timings: [],
      });
    }

    // 16 kB/s ~= 128 kbps mp3, matches the output_format we requested.
    const durationSec = Math.max(1, Math.round(totalAudioBytes / 16000));

    const tpl = await (await fetch(TEMPLATE_URL)).text();
    const html = tpl
      .replace(/__TITLE__/g, esc(listing.title))
      .replace(/__AUTHOR__/g, esc(authorProfile?.display_name || "Unknown author"))
      .replace(/__COVER__/g, listing.cover_image_url || "")
      .replace(/__VOICE_NAME__/g, esc(voice.name))
      .replace(/__CHAPTER_LABEL__/g, esc(chapter.title || "Chapter 1"))
      .replace(/__DURATION__/g, mmss(durationSec))
      .replace(/__DURATION_SEC__/g, String(durationSec))
      .replace(/__BOOK_URL__/g, `/book/${listing.listing_slug}`)
      .replace(/__AMBIENT_URL__/g, "")
      // __PARAGRAPHS__ is used as a JS array literal in the template:
      //   const PARAGRAPHS = __PARAGRAPHS__;
      // JSON.stringify on an array produces exactly that shape.
      // Manifest's regex `const PARAGRAPHS = (\[[\s\S]*?\]);` captures
      // the array; the template already has
      // `const TOTAL_DURATION_SEC = __DURATION_SEC__;` on the next line
      // which terminates the regex.
      .replace("__PARAGRAPHS__", JSON.stringify(paragraphs));

    const path = `${listing_id}/livebook.html`;
    const { error: upErr } = await supa.storage.from("livebooks").upload(
      path,
      html,
      { contentType: "text/html; charset=utf-8", upsert: true },
    );
    if (upErr) {
      return new Response(JSON.stringify({ error: upErr.message }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Architecture note on the two path columns:
    //   livebook_audio_source_path → audio data file (this livebook.html)
    //   livebook_asset_path        → player UI file (set by install-livebook-player)
    // Always write the audio source path here. Only back-fill
    // livebook_asset_path if it is currently null (legacy state for
    // listings generated before install-livebook-player existed). For
    // listings whose asset path already points at .../player.html (the
    // new architecture) we leave it alone so a regen of audio doesn't
    // downgrade the player UI.
    const updates: Record<string, unknown> = {
      livebook_voice_id: voice.id,
      livebook_voice_kind: voice_kind,
      livebook_audio_source_path: path,
      livebook_duration_seconds: durationSec,
      livebook_generated_at: new Date().toISOString(),
      livebook_char_count: sample.reduce((n, s) => n + s.length, 0),
    };
    if (!listing.livebook_asset_path) {
      updates.livebook_asset_path = path;
    }
    await supa.from("store_listings").update(updates).eq("id", listing_id);

    const elapsed = Math.round((Date.now() - t0) / 1000);
    return new Response(
      JSON.stringify({
        ok: true,
        paragraphs: sample.length,
        duration_sec: durationSec,
        elapsed_sec: elapsed,
        html_kb: Math.round(html.length / 1024),
        url: `https://store.penworth.ai/livebook/${listing.listing_slug}`,
      }),
      { headers: { "Content-Type": "application/json" } },
    );
  } catch (e) {
    return new Response(
      JSON.stringify({ error: (e as Error).message }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
});
