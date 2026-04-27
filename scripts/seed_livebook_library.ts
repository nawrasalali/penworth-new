/**
 * Seed the Livebook image library (CEO-163 Phase 0).
 *
 * Reads a CSV prompt deck for a given style, generates each image via
 * fal.ai (Flux Pro 1.1), captions it via Claude vision, embeds the caption
 * via Voyage-3, uploads the image to Supabase Storage, and inserts a row
 * into livebook_image_library.
 *
 * Resumable: skips rows where the same source_prompt already exists for
 * the style (idempotency on prompt text).
 *
 * USAGE
 *   pnpm tsx scripts/seed_livebook_library.ts --style vintage_painting --count 10
 *   pnpm tsx scripts/seed_livebook_library.ts --style cinematic_photoreal --all
 *   pnpm tsx scripts/seed_livebook_library.ts --style vintage_painting --dry-run --count 3
 *
 * FLAGS
 *   --style <slug>      Required. Must match a row in livebook_styles.
 *   --count <n>         Process the first N unprocessed prompts. Default: 10.
 *   --all               Process every unprocessed prompt in the deck.
 *   --concurrency <n>   Parallel workers. Default: 4. Cap at 8 to stay
 *                       under fal.ai concurrency limits.
 *   --dry-run           No external API calls. Inserts placeholder rows
 *                       so DB plumbing can be verified end-to-end.
 *   --force             Reprocess prompts that already have a row.
 *
 * REQUIRED ENV (read from .env.local or process env)
 *   FAL_KEY                       fal.ai API key for Flux Pro 1.1
 *   ANTHROPIC_API_KEY             Anthropic API key for Claude vision
 *   VOYAGE_API_KEY                Voyage AI key for voyage-3 embeddings
 *   NEXT_PUBLIC_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *
 * COSTS (approximate, per image)
 *   Flux Pro 1.1 generation:  $0.04
 *   Claude vision caption:    $0.005
 *   Voyage-3 embedding:       $0.00012
 *   ----------------------------------
 *   Per-image total:          ~$0.045
 *
 *   Phase 0 target: 1000 images per style × 2 styles = 2000 images ≈ $90.
 *
 * NETWORK
 *   The Anthropic CEO sandbox blocks fal.ai. Run this locally on the
 *   founder's machine or via a Vercel cron job. The Supabase Management
 *   API is reachable from sandbox so post-run verification can be done
 *   from the CEO session.
 */

import { createClient } from '@supabase/supabase-js';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

// ---- Config ---------------------------------------------------------------

const FAL_API = 'https://fal.run/fal-ai/flux-pro/v1.1';
const ANTHROPIC_API = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_MODEL = 'claude-opus-4-7'; // for captioning + tagging
const VOYAGE_API = 'https://api.voyageai.com/v1/embeddings';
const VOYAGE_MODEL = 'voyage-3'; // 1024-dim, matches DB schema
const STORAGE_BUCKET = 'livebook-library';

// Per-style aesthetic prefix — prepended to every prompt to enforce
// consistency. Without this prefix the image model drifts wildly.
const STYLE_PREFIXES: Record<string, string> = {
  vintage_painting:
    '1950s European hand-painted illustration, oil-on-canvas style, soft brushstrokes, ' +
    'warm Mediterranean palette, romantic atmospheric lighting, classical composition, ' +
    'illustrated romance novel cover aesthetic, NOT photorealistic. Subject: ',
  cinematic_photoreal:
    'Cinematic film still, 35mm photography, dramatic natural lighting, shallow depth of field, ' +
    'photorealistic, high-detail, atmospheric, prestige drama production design. Subject: ',
};

// Negative prompts per style — fal.ai Flux supports these implicitly via
// prompt engineering; we include them as appended directives.
const STYLE_NEGATIVES: Record<string, string> = {
  vintage_painting:
    ' Avoid: modern clothing, smartphones, contemporary signage, harsh digital aesthetic, anime style.',
  cinematic_photoreal:
    ' Avoid: cartoon, anime, painted style, oversaturated colors, plastic skin, deformed anatomy.',
};

// ---- Types ----------------------------------------------------------------

type CsvRow = {
  prompt: string;
  mood: string;
  era: string;
  content_genres: string; // pipe-separated
  tags: string; // pipe-separated
};

type CaptionResult = {
  caption: string;
  caption_short: string;
  visible_tags: string[];
};

// ---- CLI args -------------------------------------------------------------

function parseArgs(): {
  style: string;
  count: number;
  all: boolean;
  concurrency: number;
  dryRun: boolean;
  force: boolean;
} {
  const args = process.argv.slice(2);
  const out = {
    style: '',
    count: 10,
    all: false,
    concurrency: 4,
    dryRun: false,
    force: false,
  };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--style') out.style = args[++i] ?? '';
    else if (a === '--count') out.count = parseInt(args[++i] ?? '10', 10);
    else if (a === '--all') out.all = true;
    else if (a === '--concurrency') out.concurrency = Math.min(8, parseInt(args[++i] ?? '4', 10));
    else if (a === '--dry-run') out.dryRun = true;
    else if (a === '--force') out.force = true;
  }
  if (!out.style) {
    console.error('ERROR: --style <slug> is required.');
    process.exit(1);
  }
  return out;
}

// ---- CSV parser (no quoting; pipe-separated arrays inside cells) ----------

function parseCsv(path: string): CsvRow[] {
  const text = readFileSync(path, 'utf8');
  const lines = text.split('\n').map((l) => l.replace(/\r$/, '')).filter((l) => l.trim().length > 0);
  if (lines.length === 0) return [];
  const header = lines[0].split(',');
  const expected = ['prompt', 'mood', 'era', 'content_genres', 'tags'];
  for (const col of expected) {
    if (!header.includes(col)) {
      throw new Error(`CSV missing column "${col}" in header: ${header.join(',')}`);
    }
  }
  const out: CsvRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    // Naive split — prompts that contain commas must be quoted, but to keep
    // the deck author-friendly we accept up to 4 commas per row by reassembling
    // the prompt from the leftmost N-4 fields.
    const cols = line.split(',');
    if (cols.length < expected.length) {
      console.warn(`Row ${i + 1} skipped — too few columns: ${line}`);
      continue;
    }
    const tags = cols[cols.length - 1];
    const content_genres = cols[cols.length - 2];
    const era = cols[cols.length - 3];
    const mood = cols[cols.length - 4];
    const prompt = cols.slice(0, cols.length - 4).join(',').trim();
    out.push({ prompt, mood, era, content_genres, tags });
  }
  return out;
}

// ---- fal.ai Flux Pro 1.1 --------------------------------------------------

async function generateImage(
  fullPrompt: string,
  attempt = 1,
): Promise<{ imageBytes: Uint8Array; width: number; height: number }> {
  const FAL_KEY = process.env.FAL_KEY;
  if (!FAL_KEY) throw new Error('FAL_KEY env var not set');
  const r = await fetch(FAL_API, {
    method: 'POST',
    headers: {
      Authorization: `Key ${FAL_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      prompt: fullPrompt,
      image_size: 'landscape_16_9',
      num_inference_steps: 28,
      guidance_scale: 3.5,
      num_images: 1,
      enable_safety_checker: true,
      output_format: 'jpeg',
    }),
  });
  if ((r.status === 429 || r.status === 503) && attempt <= 5) {
    const wait = 2000 * attempt;
    console.warn(`fal.ai ${r.status}, retry ${attempt} after ${wait}ms`);
    await new Promise((res) => setTimeout(res, wait));
    return generateImage(fullPrompt, attempt + 1);
  }
  if (!r.ok) {
    throw new Error(`fal.ai ${r.status}: ${(await r.text()).slice(0, 200)}`);
  }
  const data = (await r.json()) as { images: Array<{ url: string; width: number; height: number }> };
  const first = data.images?.[0];
  if (!first) throw new Error('fal.ai returned no images');
  // Download the actual bytes — fal.ai URLs are temporary.
  const imgRes = await fetch(first.url);
  if (!imgRes.ok) throw new Error(`fal.ai image download ${imgRes.status}`);
  const buf = new Uint8Array(await imgRes.arrayBuffer());
  return { imageBytes: buf, width: first.width, height: first.height };
}

// ---- Claude vision: caption + visible-tags --------------------------------

async function captionImage(
  imageBase64: string,
  styleSlug: string,
  attempt = 1,
): Promise<CaptionResult> {
  const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
  if (!ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY env var not set');
  const r = await fetch(ANTHROPIC_API, {
    method: 'POST',
    headers: {
      'x-api-key': ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: ANTHROPIC_MODEL,
      max_tokens: 600,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              source: {
                type: 'base64',
                media_type: 'image/jpeg',
                data: imageBase64,
              },
            },
            {
              type: 'text',
              text:
                `This image is part of the Penworth livebook image library, style: ${styleSlug}. ` +
                `Generate a JSON object with three fields:\n` +
                `1. "caption": A rich descriptive caption (50-90 words) describing what is visually present in language ` +
                `that would match descriptive prose in a novel. Describe people, setting, action, atmosphere, lighting. ` +
                `Do NOT mention art style or that this is an illustration.\n` +
                `2. "caption_short": A 6-12 word summary suitable for a thumbnail tooltip.\n` +
                `3. "visible_tags": An array of 5-15 lowercase tag strings for what is visible (subjects, objects, setting elements, mood). No style tags.\n\n` +
                `Return ONLY the JSON object, no preamble or markdown fence.`,
            },
          ],
        },
      ],
    }),
  });
  if ((r.status === 429 || r.status === 529) && attempt <= 5) {
    const wait = 2000 * attempt;
    console.warn(`Anthropic ${r.status}, retry ${attempt} after ${wait}ms`);
    await new Promise((res) => setTimeout(res, wait));
    return captionImage(imageBase64, styleSlug, attempt + 1);
  }
  if (!r.ok) {
    throw new Error(`Anthropic ${r.status}: ${(await r.text()).slice(0, 200)}`);
  }
  const data = (await r.json()) as { content: Array<{ type: string; text?: string }> };
  const text = data.content.find((c) => c.type === 'text')?.text ?? '';
  const cleaned = text.trim().replace(/^```json\s*/i, '').replace(/```$/i, '').trim();
  let parsed: CaptionResult;
  try {
    parsed = JSON.parse(cleaned) as CaptionResult;
  } catch (e) {
    throw new Error(`Caption JSON parse failed: ${cleaned.slice(0, 200)}`);
  }
  if (!parsed.caption || !parsed.caption_short || !Array.isArray(parsed.visible_tags)) {
    throw new Error(`Caption missing fields: ${JSON.stringify(parsed).slice(0, 200)}`);
  }
  return parsed;
}

// ---- Voyage-3 embedding ---------------------------------------------------

async function embedText(text: string, attempt = 1): Promise<number[]> {
  const VOYAGE_API_KEY = process.env.VOYAGE_API_KEY;
  if (!VOYAGE_API_KEY) throw new Error('VOYAGE_API_KEY env var not set');
  const r = await fetch(VOYAGE_API, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${VOYAGE_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      input: [text],
      model: VOYAGE_MODEL,
      input_type: 'document',
    }),
  });
  if ((r.status === 429 || r.status === 503) && attempt <= 5) {
    const wait = 2000 * attempt;
    console.warn(`Voyage ${r.status}, retry ${attempt} after ${wait}ms`);
    await new Promise((res) => setTimeout(res, wait));
    return embedText(text, attempt + 1);
  }
  if (!r.ok) {
    throw new Error(`Voyage ${r.status}: ${(await r.text()).slice(0, 200)}`);
  }
  const data = (await r.json()) as { data: Array<{ embedding: number[] }> };
  const emb = data.data?.[0]?.embedding;
  if (!emb || emb.length !== 1024) {
    throw new Error(`Voyage returned bad embedding shape: ${emb?.length}`);
  }
  return emb;
}

// ---- Process one prompt ---------------------------------------------------

async function processOne(
  row: CsvRow,
  rowIdx: number,
  styleSlug: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- no generated Database types in this repo; runtime correctness comes from PostgREST, not TS.
  supabase: any,
  flags: { dryRun: boolean; force: boolean },
): Promise<{ ok: boolean; reason?: string }> {
  // Idempotency check.
  if (!flags.force) {
    const { data: existing } = await supabase
      .from('livebook_image_library')
      .select('id')
      .eq('style_slug', styleSlug)
      .eq('source_prompt', row.prompt)
      .maybeSingle();
    if (existing) return { ok: false, reason: 'already_seeded' };
  }

  const fullPrompt = (STYLE_PREFIXES[styleSlug] ?? '') + row.prompt + (STYLE_NEGATIVES[styleSlug] ?? '');

  let imageBytes: Uint8Array;
  let width: number;
  let height: number;
  let caption: CaptionResult;
  let embedding: number[];

  if (flags.dryRun) {
    // Synthesise placeholder data so DB plumbing can be smoke-tested without
    // hitting paid APIs. Embedding is a deterministic random-feeling vector.
    imageBytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]); // tiny jpeg header
    width = 1344;
    height = 768;
    caption = {
      caption: `Dry-run placeholder caption for prompt: ${row.prompt.slice(0, 60)}`,
      caption_short: 'Dry-run placeholder',
      visible_tags: row.tags.split('|').filter(Boolean),
    };
    // Deterministic 1024-dim vector seeded from rowIdx
    embedding = Array.from({ length: 1024 }, (_, i) => Math.sin(rowIdx * 0.13 + i * 0.007));
  } else {
    const gen = await generateImage(fullPrompt);
    imageBytes = gen.imageBytes;
    width = gen.width;
    height = gen.height;
    const b64 = Buffer.from(imageBytes).toString('base64');
    caption = await captionImage(b64, styleSlug);
    embedding = await embedText(caption.caption);
  }

  // Upload to Supabase Storage.
  const fileName = `${styleSlug}/${rowIdx.toString().padStart(5, '0')}-${Date.now()}.jpg`;
  let publicUrl: string;
  if (flags.dryRun) {
    publicUrl = `https://example.invalid/${fileName}`;
  } else {
    const { error: upErr } = await supabase.storage
      .from(STORAGE_BUCKET)
      .upload(fileName, imageBytes, { contentType: 'image/jpeg', upsert: false });
    if (upErr) throw new Error(`Storage upload failed: ${upErr.message}`);
    const { data: pub } = supabase.storage.from(STORAGE_BUCKET).getPublicUrl(fileName);
    publicUrl = pub.publicUrl;
  }

  // Merge CSV-declared tags with vision-detected visible tags (dedup).
  const declaredTags = row.tags.split('|').map((t) => t.trim()).filter(Boolean);
  const allTags = Array.from(new Set([...declaredTags, ...caption.visible_tags.map((t) => t.toLowerCase())]));
  const genres = row.content_genres.split('|').map((t) => t.trim()).filter(Boolean);

  const { error: insErr } = await supabase.from('livebook_image_library').insert({
    style_slug: styleSlug,
    image_url: publicUrl,
    thumbnail_url: publicUrl, // Phase 0: same URL. Phase 1 will add thumbnail generation.
    aspect_ratio: '16:9',
    caption: caption.caption,
    caption_short: caption.caption_short,
    tags: allTags,
    content_genres: genres,
    era: row.era,
    mood: row.mood,
    embedding: JSON.stringify(embedding),
    source_model: flags.dryRun ? 'dry-run' : 'flux-pro-1.1',
    source_prompt: row.prompt,
    generation_cost_cents: flags.dryRun ? 0 : 5, // Flux Pro 1.1: ~$0.045 → round to 5 cents
    width_px: width,
    height_px: height,
    file_size_bytes: imageBytes.length,
  });
  if (insErr) throw new Error(`DB insert failed: ${insErr.message}`);

  return { ok: true };
}

// ---- Main -----------------------------------------------------------------

async function main() {
  const flags = parseArgs();
  const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!SUPABASE_URL || !SERVICE_KEY) {
    console.error('ERROR: NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set.');
    process.exit(1);
  }
  const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

  // Load CSV deck.
  const deckPath = join('scripts', 'livebook_prompts', `${flags.style}.csv`);
  if (!existsSync(deckPath)) {
    console.error(`ERROR: prompt deck not found at ${deckPath}`);
    process.exit(1);
  }
  const allRows = parseCsv(deckPath);
  console.log(`Loaded ${allRows.length} prompts from ${deckPath}`);

  // Filter to unprocessed (unless --force).
  let toProcess: { row: CsvRow; idx: number }[];
  if (flags.force) {
    toProcess = allRows.map((row, idx) => ({ row, idx }));
  } else {
    const { data: seeded } = await supabase
      .from('livebook_image_library')
      .select('source_prompt')
      .eq('style_slug', flags.style);
    const seenPrompts = new Set((seeded ?? []).map((r: any) => r.source_prompt as string));
    toProcess = allRows
      .map((row, idx) => ({ row, idx }))
      .filter((x) => !seenPrompts.has(x.row.prompt));
    console.log(`${seenPrompts.size} already seeded; ${toProcess.length} remaining`);
  }

  if (!flags.all) {
    toProcess = toProcess.slice(0, flags.count);
  }

  if (toProcess.length === 0) {
    console.log('Nothing to process. Done.');
    return;
  }

  // Cost estimate.
  const perImageCents = flags.dryRun ? 0 : 5;
  const totalEstCents = perImageCents * toProcess.length;
  console.log(
    `\nWill process ${toProcess.length} prompts at ~$${(perImageCents / 100).toFixed(3)}/image. ` +
      `Estimated total: $${(totalEstCents / 100).toFixed(2)}.\n` +
      `Mode: ${flags.dryRun ? 'DRY-RUN (no API spend)' : 'LIVE'}\n` +
      `Concurrency: ${flags.concurrency}\n`,
  );

  // Run with bounded concurrency.
  let done = 0;
  let skipped = 0;
  let failed = 0;
  const startedAt = Date.now();
  const queue = [...toProcess];
  const running: Promise<void>[] = [];

  async function worker() {
    while (queue.length > 0) {
      const item = queue.shift();
      if (!item) break;
      try {
        const r = await processOne(item.row, item.idx, flags.style, supabase, flags);
        if (r.ok) {
          done++;
          process.stdout.write(`✓ ${done}/${toProcess.length} ${item.row.prompt.slice(0, 70)}\n`);
        } else {
          skipped++;
          process.stdout.write(`- skip (${r.reason}) ${item.row.prompt.slice(0, 60)}\n`);
        }
      } catch (e) {
        failed++;
        const msg = e instanceof Error ? e.message : String(e);
        process.stdout.write(`✗ FAIL ${item.row.prompt.slice(0, 50)} — ${msg.slice(0, 120)}\n`);
      }
    }
  }

  for (let i = 0; i < flags.concurrency; i++) running.push(worker());
  await Promise.all(running);

  const elapsedSec = Math.round((Date.now() - startedAt) / 1000);
  console.log(
    `\n========\n` +
      `Done in ${elapsedSec}s. Generated: ${done}. Skipped: ${skipped}. Failed: ${failed}.\n` +
      `Estimated spend: $${((done * perImageCents) / 100).toFixed(2)}\n`,
  );

  // Refresh denormalised library_size on the style row.
  const { count } = await supabase
    .from('livebook_image_library')
    .select('*', { count: 'exact', head: true })
    .eq('style_slug', flags.style)
    .eq('is_active', true);
  if (typeof count === 'number') {
    await supabase.from('livebook_styles').update({ library_size: count }).eq('slug', flags.style);
    console.log(`livebook_styles.${flags.style}.library_size updated to ${count}`);
  }
}

main().catch((e) => {
  console.error('FATAL:', e);
  process.exit(1);
});
