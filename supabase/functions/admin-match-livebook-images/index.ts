// admin-match-livebook-images
// CEO-165 Phase 1 — Livebook image retrieval pipeline
//
// Triggered (fire-and-forget) by the writer's publish handler when a book
// is enrolled in the Livebook image library. Embeds each paragraph,
// matches via livebook_match_image_for_paragraph, applies an optional
// Claude reranker on close calls, and writes the resolved paragraph→image
// map to store_listings.livebook_image_map.
//
// Mirror of the audio admin-generate-livebook fire-and-forget pattern:
// shared admin-secret auth, same publish-handler call style. Phase 1
// deliberately does NOT use Inngest because the codebase convention here
// is direct edge function invocation; Inngest is reserved for the
// existing 7-agent writing pipeline.
//
// SECRETS (Supabase Edge Function env):
//   ADMIN_SECRET            shared with the writer for x-admin-secret
//   ANTHROPIC_API_KEY       Claude reranker (optional; falls back to top-1 if missing)
//   VOYAGE_API_KEY          paragraph embeddings (REQUIRED)
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY auto-injected
//
// REQUEST
//   POST /functions/v1/admin-match-livebook-images
//   Headers: x-admin-secret: <ADMIN_SECRET>
//   Body: { listing_id: uuid, job_id?: uuid }
//
// RESPONSE
//   200: { ok: true, paragraphs_total, paragraphs_matched, paragraphs_skipped, elapsed_sec }
//   4xx/5xx: { error: string }
//
// Long-run note: a 600-paragraph book takes ~30s end-to-end (Voyage batched
// 50/req → ~5 batches × 200ms; SQL match 600 × 5ms; reranker invoked only
// on ~10% close-call paragraphs). Edge function timeout is 400s (Pro plan).

import { createClient } from "jsr:@supabase/supabase-js@2";

// ---- Config --------------------------------------------------------------

const ADMIN_SECRET = Deno.env.get("ADMIN_SECRET");
const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");
const VOYAGE_API_KEY = Deno.env.get("VOYAGE_API_KEY");

const VOYAGE_API = "https://api.voyageai.com/v1/embeddings";
const VOYAGE_MODEL = "voyage-3";
const ANTHROPIC_API = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_MODEL = "claude-haiku-4-5-20251001"; // cheap + fast for reranking

// Tuning knobs — start conservative; revise once first books are matched
// and we have founder feedback on what feels right.
const MIN_PARAGRAPH_WORDS = 8;
const MAX_DIALOGUE_RATIO = 0.7; // skip if >70% inside quotes
const SIMILARITY_THRESHOLD = 0.55; // below this cosine sim, mark as merge-candidate
const RERANKER_AMBIGUITY_THRESHOLD = 0.05; // top-1 vs top-2 distance gap
const VOYAGE_BATCH_SIZE = 50;
const PROGRESS_REPORT_EVERY = 25;
const MAX_PARAGRAPHS = 1000; // safety cap

// ---- Types ---------------------------------------------------------------

type MatchCandidate = {
  id: string;
  image_url: string;
  thumbnail_url: string | null;
  caption: string;
  caption_short: string | null;
  base_distance: number;
  adjusted_distance: number;
};

type ResolvedMatch = {
  paragraph_idx: number;
  image_id: string;
  image_url: string;
  thumbnail_url: string | null;
  base_similarity: number; // 1 - base_distance
  adjusted_similarity: number;
  reranker_picked: boolean;
  fallback_reason?: "low_similarity_merge_with_prior" | "non_visual_skip";
};

// ---- Paragraph splitting + visualness pre-filter ------------------------

function splitParagraphs(markdown: string): string[] {
  // Strip markdown headings/leaders; split on blank lines.
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
  return out.slice(0, MAX_PARAGRAPHS);
}

function isNonVisual(paragraph: string): boolean {
  const wordCount = paragraph.split(/\s+/).length;
  if (wordCount < MIN_PARAGRAPH_WORDS) return true;
  // Crude dialogue ratio: count chars inside quote-like marks.
  const quoteChars = (paragraph.match(/[""'']/g) ?? []).length;
  const insideQuotes = paragraph.match(/[""'][^""'']{1,300}[""'']/g) ?? [];
  const insideLen = insideQuotes.reduce((n, s) => n + s.length, 0);
  const ratio = insideLen / Math.max(paragraph.length, 1);
  if (ratio > MAX_DIALOGUE_RATIO && quoteChars >= 4) return true;
  return false;
}

// ---- Voyage embeddings (batched) ----------------------------------------

async function embedBatch(texts: string[], attempt = 1): Promise<number[][]> {
  if (!VOYAGE_API_KEY) throw new Error("VOYAGE_API_KEY missing from edge function secrets");
  const r = await fetch(VOYAGE_API, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${VOYAGE_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      input: texts,
      model: VOYAGE_MODEL,
      input_type: "query", // asymmetric retrieval — captions seeded as 'document', queries as 'query'
    }),
  });
  if ((r.status === 429 || r.status === 503) && attempt <= 5) {
    await new Promise((res) => setTimeout(res, 2000 * attempt));
    return embedBatch(texts, attempt + 1);
  }
  if (!r.ok) throw new Error(`voyage ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const data = await r.json() as { data: Array<{ embedding: number[]; index: number }> };
  // Voyage returns results in input order but include index for safety
  const sorted = [...data.data].sort((a, b) => a.index - b.index);
  return sorted.map((d) => d.embedding);
}

async function embedAll(paragraphs: string[]): Promise<number[][]> {
  const out: number[][] = [];
  for (let i = 0; i < paragraphs.length; i += VOYAGE_BATCH_SIZE) {
    const batch = paragraphs.slice(i, i + VOYAGE_BATCH_SIZE);
    const embs = await embedBatch(batch);
    out.push(...embs);
  }
  return out;
}

// ---- Claude reranker (only on ambiguous candidates) ---------------------

async function rerankWithClaude(
  paragraph: string,
  candidates: MatchCandidate[],
  attempt = 1,
): Promise<{ pickedId: string; pickedIndex: number } | null> {
  if (!ANTHROPIC_API_KEY) return null; // graceful: caller falls back to top-1
  const candidatesBlock = candidates
    .slice(0, 5)
    .map((c, i) => `[${i}] ${c.caption}`)
    .join("\n");
  const r = await fetch(ANTHROPIC_API, {
    method: "POST",
    headers: {
      "x-api-key": ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: ANTHROPIC_MODEL,
      max_tokens: 30,
      messages: [{
        role: "user",
        content:
          `Choose the image whose caption best matches this paragraph mood and visual content. ` +
          `Reply with ONLY a single integer 0-${candidates.length - 1}. No words, no explanation.\n\n` +
          `Paragraph:\n${paragraph.slice(0, 1500)}\n\n` +
          `Captions:\n${candidatesBlock}`,
      }],
    }),
  });
  if ((r.status === 429 || r.status === 529) && attempt <= 3) {
    await new Promise((res) => setTimeout(res, 1500 * attempt));
    return rerankWithClaude(paragraph, candidates, attempt + 1);
  }
  if (!r.ok) return null; // soft fail — top-1 fallback
  const data = await r.json() as { content: Array<{ type: string; text?: string }> };
  const text = (data.content.find((c) => c.type === "text")?.text ?? "").trim();
  const m = text.match(/\d+/);
  if (!m) return null;
  const idx = parseInt(m[0], 10);
  if (idx < 0 || idx >= candidates.length) return null;
  return { pickedId: candidates[idx].id, pickedIndex: idx };
}

// ---- Main handler --------------------------------------------------------

Deno.serve(async (req: Request) => {
  const t0 = Date.now();
  try {
    if (!ADMIN_SECRET) {
      return new Response(
        JSON.stringify({ error: "server misconfigured: ADMIN_SECRET missing" }),
        { status: 500, headers: { "Content-Type": "application/json" } },
      );
    }
    if (req.headers.get("x-admin-secret") !== ADMIN_SECRET) {
      return new Response("forbidden", { status: 403 });
    }
    const body = await req.json();
    const { listing_id, job_id } = body as { listing_id?: string; job_id?: string };
    if (!listing_id) {
      return new Response(JSON.stringify({ error: "listing_id required" }), { status: 400 });
    }

    const supa = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Load listing + verify enrolment + style.
    const { data: listing, error: lErr } = await supa
      .from("store_listings")
      .select("id, livebook_enrolled, livebook_style, author_id")
      .eq("id", listing_id)
      .maybeSingle();
    if (lErr || !listing) {
      return new Response(JSON.stringify({ error: "listing not found" }), { status: 404 });
    }
    if (!listing.livebook_enrolled || !listing.livebook_style) {
      return new Response(
        JSON.stringify({ error: "listing not enrolled in livebook image library" }),
        { status: 400 },
      );
    }

    // Mark generating.
    await supa.from("store_listings").update({
      livebook_image_status: "generating",
      livebook_image_progress: 0,
    }).eq("id", listing_id);

    if (job_id) {
      await supa.from("livebook_generation_jobs").update({
        status: "running",
        started_at: new Date().toISOString(),
        progress_percent: 0,
      }).eq("id", job_id);
    }

    // Load chapters in order.
    const { data: chapters, error: cErr } = await supa
      .from("store_chapters")
      .select("chapter_index, content_markdown")
      .eq("listing_id", listing_id)
      .order("chapter_index", { ascending: true });
    if (cErr || !chapters || chapters.length === 0) {
      throw new Error("no chapters found for listing");
    }
    const fullText = chapters.map((c) => c.content_markdown ?? "").join("\n\n");
    const paragraphs = splitParagraphs(fullText);
    if (paragraphs.length === 0) throw new Error("no paragraphs after splitting");

    // Pre-filter visualness; embed only the visual ones.
    const isVisual = paragraphs.map((p) => !isNonVisual(p));
    const visualIdxs: number[] = [];
    const visualTexts: string[] = [];
    for (let i = 0; i < paragraphs.length; i++) {
      if (isVisual[i]) {
        visualIdxs.push(i);
        visualTexts.push(paragraphs[i]);
      }
    }

    const embeddings = await embedAll(visualTexts);

    // Per-paragraph match. Track used + recent for diversity.
    const resolved: ResolvedMatch[] = [];
    const usedIds: string[] = [];
    const recentIds: string[] = [];
    let lastVisualMatch: ResolvedMatch | null = null;
    let visualCursor = 0;

    for (let i = 0; i < paragraphs.length; i++) {
      // Progress reporting every N paragraphs.
      if (i > 0 && i % PROGRESS_REPORT_EVERY === 0) {
        const pct = Math.round((i / paragraphs.length) * 100);
        await supa.from("store_listings").update({
          livebook_image_progress: pct,
        }).eq("id", listing_id);
        if (job_id) {
          await supa.from("livebook_generation_jobs").update({
            progress_percent: pct,
            paragraphs_matched: resolved.filter((r) => !r.fallback_reason).length,
            paragraphs_skipped: resolved.filter((r) => r.fallback_reason).length,
          }).eq("id", job_id);
        }
      }

      if (!isVisual[i]) {
        // Non-visual paragraph: merge with prior visual match if one exists.
        if (lastVisualMatch) {
          resolved.push({
            paragraph_idx: i,
            image_id: lastVisualMatch.image_id,
            image_url: lastVisualMatch.image_url,
            thumbnail_url: lastVisualMatch.thumbnail_url,
            base_similarity: lastVisualMatch.base_similarity,
            adjusted_similarity: lastVisualMatch.adjusted_similarity,
            reranker_picked: false,
            fallback_reason: "non_visual_skip",
          });
        }
        continue;
      }

      const emb = embeddings[visualCursor++];

      // RPC call to the SQL match function.
      const { data: candidates, error: mErr } = await supa.rpc(
        "livebook_match_image_for_paragraph",
        {
          p_style: listing.livebook_style,
          p_query_emb: JSON.stringify(emb),
          p_used_image_ids: usedIds,
          p_recent_image_ids: recentIds.slice(-3),
          p_top_k: 5,
        },
      );
      if (mErr || !candidates || candidates.length === 0) {
        // No matches at all (library too small for this style?). Skip.
        continue;
      }

      let pickedIdx = 0;
      let rerankerPicked = false;
      const top1 = candidates[0] as MatchCandidate;
      const top2 = candidates[1] as MatchCandidate | undefined;

      // Reranker only on close calls — saves cost.
      if (
        top2 &&
        (top2.adjusted_distance - top1.adjusted_distance) < RERANKER_AMBIGUITY_THRESHOLD
      ) {
        const rerank = await rerankWithClaude(paragraphs[i], candidates as MatchCandidate[]);
        if (rerank) {
          pickedIdx = rerank.pickedIndex;
          rerankerPicked = true;
        }
      }

      const picked = candidates[pickedIdx] as MatchCandidate;
      const baseSim = 1 - picked.base_distance;
      const adjSim = 1 - picked.adjusted_distance;

      // Low-similarity fallback: merge with prior visual.
      if (baseSim < SIMILARITY_THRESHOLD && lastVisualMatch) {
        resolved.push({
          paragraph_idx: i,
          image_id: lastVisualMatch.image_id,
          image_url: lastVisualMatch.image_url,
          thumbnail_url: lastVisualMatch.thumbnail_url,
          base_similarity: lastVisualMatch.base_similarity,
          adjusted_similarity: lastVisualMatch.adjusted_similarity,
          reranker_picked: false,
          fallback_reason: "low_similarity_merge_with_prior",
        });
        continue;
      }

      const match: ResolvedMatch = {
        paragraph_idx: i,
        image_id: picked.id,
        image_url: picked.image_url,
        thumbnail_url: picked.thumbnail_url,
        base_similarity: baseSim,
        adjusted_similarity: adjSim,
        reranker_picked: rerankerPicked,
      };
      resolved.push(match);
      lastVisualMatch = match;
      usedIds.push(picked.id);
      recentIds.push(picked.id);
      if (recentIds.length > 3) recentIds.shift();

      // Bump use_count on the image (for cross-book diversity over time).
      await supa.rpc("increment_image_use_count", { p_image_id: picked.id }).then(
        () => {},
        () => {}, // function may not exist yet — graceful
      );
    }

    const matched = resolved.filter((r) => !r.fallback_reason).length;
    const skipped = resolved.filter((r) => r.fallback_reason).length;

    // Final write.
    await supa.from("store_listings").update({
      livebook_image_status: "ready",
      livebook_image_progress: 100,
      livebook_image_map: resolved,
      livebook_image_ready_at: new Date().toISOString(),
    }).eq("id", listing_id);

    if (job_id) {
      await supa.from("livebook_generation_jobs").update({
        status: "succeeded",
        progress_percent: 100,
        paragraphs_total: paragraphs.length,
        paragraphs_matched: matched,
        paragraphs_skipped: skipped,
        completed_at: new Date().toISOString(),
        match_log: resolved.map((r) => ({
          paragraph_idx: r.paragraph_idx,
          image_id: r.image_id,
          adjusted_similarity: r.adjusted_similarity,
          reranker_picked: r.reranker_picked,
          fallback_reason: r.fallback_reason,
        })),
      }).eq("id", job_id);
    }

    const elapsed = Math.round((Date.now() - t0) / 1000);
    return new Response(
      JSON.stringify({
        ok: true,
        paragraphs_total: paragraphs.length,
        paragraphs_matched: matched,
        paragraphs_skipped: skipped,
        elapsed_sec: elapsed,
      }),
      { headers: { "Content-Type": "application/json" } },
    );
  } catch (e) {
    const errMsg = (e as Error).message;
    // Best-effort failure marking — don't throw on this branch.
    try {
      const supa = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      );
      const body = await req.clone().json().catch(() => ({}));
      const lid = (body as { listing_id?: string }).listing_id;
      if (lid) {
        await supa.from("store_listings").update({
          livebook_image_status: "failed",
        }).eq("id", lid);
      }
      const jid = (body as { job_id?: string }).job_id;
      if (jid) {
        await supa.from("livebook_generation_jobs").update({
          status: "failed",
          error_text: errMsg.slice(0, 1000),
          completed_at: new Date().toISOString(),
        }).eq("id", jid);
      }
    } catch (_) { /* swallow */ }
    return new Response(
      JSON.stringify({ error: errMsg }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
});
