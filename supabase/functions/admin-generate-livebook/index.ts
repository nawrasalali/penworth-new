// admin-generate-livebook
// JWT-bypass admin endpoint that runs Cartesia TTS livebook generation for a
// given store_listings row. Same pipeline as generate-livebook but uses a
// shared secret in the x-admin-secret header so the founder (or the
// auto-trigger from the writer publish route) can kick off generation for
// any listing without needing the author's session token.
//
// Secrets are read from Edge Function env (Supabase project secrets):
//   - CARTESIA_KEY      (Cartesia TTS API key)
//   - ADMIN_SECRET      (shared secret for x-admin-secret header)
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are auto-injected by the runtime.
//
// CEO-105 (2026-04-25): moved CARTESIA_KEY and ADMIN_SECRET out of inline
// constants into Deno.env so the source can live in the public repo.

import { createClient } from "jsr:@supabase/supabase-js@2";
import { encodeBase64 } from "jsr:@std/encoding@1/base64";

const CARTESIA_KEY = Deno.env.get("CARTESIA_KEY");
const ADMIN_SECRET = Deno.env.get("ADMIN_SECRET");
const MODEL_ID = "sonic-2";
const TEMPLATE_URL = "https://store.penworth.ai/livebook-template.html";

const VOICES: Record<string, { id: string; name: string }> = {
  default_male:   { id: "a0e99841-438c-4a64-b679-ae501e7d6091", name: "Barbershop Man" },
  default_female: { id: "79a125e8-cd45-4c13-8a67-188112f4dd22", name: "British Lady" },
};

const MAX_WORDS = 1800;

function splitSentences(text: string): string[] {
  const cleaned = text.replace(/^#+\s+/gm, "").replace(/^\s*[*_]+\s*/gm, "").replace(/\r/g, "").replace(/\s+/g, " ").trim();
  const raw = cleaned.split(/(?<=[.!?])\s+(?=[A-Z"'\n])/);
  const out: string[] = [];
  for (const s of raw) {
    const t = s.trim(); if (!t) continue;
    if (t.length < 25 && out.length > 0) out[out.length - 1] += " " + t;
    else out.push(t);
  }
  return out;
}

function trimToBudget(s: string[], max: number): string[] {
  const out: string[] = []; let w = 0;
  for (const x of s) { const n = x.split(/\s+/).length; if (w + n > max && out.length) break; out.push(x); w += n; }
  return out;
}

async function tts(text: string, voiceId: string, ctx: string, attempt = 1): Promise<ArrayBuffer> {
  const r = await fetch("https://api.cartesia.ai/tts/bytes", {
    method: "POST",
    headers: { "X-API-Key": CARTESIA_KEY!, "Cartesia-Version": "2024-11-13", "Content-Type": "application/json" },
    body: JSON.stringify({
      model_id: MODEL_ID, transcript: text,
      voice: { mode: "id", id: voiceId, __experimental_controls: { speed: "normal", emotion: ["positivity:low", "curiosity"] } },
      output_format: { container: "mp3", encoding: "mp3", sample_rate: 44100, bit_rate: 128000 },
      language: "en", context_id: ctx,
    }),
  });
  if (r.status === 429 && attempt <= 10) { await new Promise((res) => setTimeout(res, 2000 * attempt)); return tts(text, voiceId, ctx, attempt + 1); }
  if (!r.ok) throw new Error(`cartesia ${r.status}: ${(await r.text()).slice(0, 200)}`);
  return await r.arrayBuffer();
}

function esc(s: string) { return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }
function mmss(s: number) { const m = Math.floor(s / 60), x = Math.floor(s % 60); return `${m}:${x.toString().padStart(2, "0")}`; }

Deno.serve(async (req: Request) => {
  try {
    if (!CARTESIA_KEY || !ADMIN_SECRET) {
      return new Response(
        JSON.stringify({ error: "server misconfigured: CARTESIA_KEY/ADMIN_SECRET missing from Edge Function secrets" }),
        { status: 500, headers: { "Content-Type": "application/json" } },
      );
    }
    if (req.headers.get("x-admin-secret") !== ADMIN_SECRET) {
      return new Response("forbidden", { status: 403 });
    }
    const body = await req.json();
    const { listing_id, voice_kind = "default_male" } = body as { listing_id?: string; voice_kind?: string };
    if (!listing_id) return new Response(JSON.stringify({ error: "listing_id required" }), { status: 400 });
    const voice = VOICES[voice_kind];
    if (!voice) return new Response(JSON.stringify({ error: "unknown voice_kind" }), { status: 400 });

    const supa = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: listing } = await supa.from("store_listings").select("id, listing_slug, title, author_id, cover_image_url").eq("id", listing_id).maybeSingle();
    if (!listing) return new Response(JSON.stringify({ error: "listing not found" }), { status: 404 });

    const { data: chapter } = await supa.from("store_chapters").select("title, content_markdown").eq("listing_id", listing_id).order("chapter_index", { ascending: true }).limit(1).maybeSingle();
    if (!chapter?.content_markdown) return new Response(JSON.stringify({ error: "no chapter" }), { status: 400 });

    const { data: authorProfile } = await supa.from("store_author_profiles").select("display_name").eq("user_id", listing.author_id).maybeSingle();

    const all = splitSentences(chapter.content_markdown);
    const sample = trimToBudget(all, MAX_WORDS);
    const ctxId = `livebook_${listing_id}_${Date.now()}`;
    const audioMap: Record<string, string> = {};
    const utterances: Array<{ id: string; text: string; gap_ms: number }> = [];
    let totalBytes = 0;
    const t0 = Date.now();

    for (let i = 0; i < sample.length; i++) {
      const t = sample[i];
      const buf = await tts(t, voice.id, ctxId);
      totalBytes += buf.byteLength;
      audioMap[`u${i}`] = `data:audio/mpeg;base64,${encodeBase64(new Uint8Array(buf))}`;
      utterances.push({ id: `u${i}`, text: t, gap_ms: /[.!?]["')\]]*$/.test(t) ? 320 : 200 });
    }
    const durationSec = Math.round(totalBytes / 16000);

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
      .replace("__AUDIO_MAP__", JSON.stringify(audioMap))
      .replace("__UTTERANCES__", JSON.stringify(utterances));

    const path = `${listing_id}/livebook.html`;
    const { error: upErr } = await supa.storage.from("livebooks").upload(path, html, { contentType: "text/html; charset=utf-8", upsert: true });
    if (upErr) return new Response(JSON.stringify({ error: upErr.message }), { status: 500 });

    await supa.from("store_listings").update({
      livebook_voice_id: voice.id, livebook_voice_kind: voice_kind,
      livebook_asset_path: path, livebook_duration_seconds: durationSec,
      livebook_generated_at: new Date().toISOString(),
      livebook_char_count: sample.reduce((n, s) => n + s.length, 0),
    }).eq("id", listing_id);

    const elapsed = Math.round((Date.now() - t0) / 1000);
    return new Response(JSON.stringify({
      ok: true, utterances: sample.length, duration_sec: durationSec,
      elapsed_sec: elapsed, html_kb: Math.round(html.length / 1024),
      url: `https://store.penworth.ai/livebook/${listing.listing_slug}`,
    }), { headers: { "Content-Type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), { status: 500 });
  }
});
