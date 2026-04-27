/* eslint-disable no-console */
/**
 * scripts/test_image_quality.ts — CEO-167 quality probe.
 *
 * Generates one image per scene-segment for the first N pages of a
 * given listing, in 3 distinct styles, using fal.ai Flux Pro 1.1.
 * Writes an HTML gallery to /mnt/user-data/outputs/quality_test.html
 * (or to scripts/output/quality_test.html locally) for the founder
 * to eyeball.
 *
 * Why scene extraction (not paragraph split): The New Rich and many
 * other Penworth books are exported with single-\n separators rather
 * than markdown-standard double-\n paragraphs. Splitting on \n\s*\n+
 * returns ONE block for an entire chapter. Splitting on \n produces
 * ~1500 single-line fragments. Neither matches what a human reads as
 * a "scene." We let Claude read the entire excerpt once and segment
 * it by narrative meaning rather than whitespace.
 *
 * Pipeline:
 *   1. Read first PAGE_LIMIT * CHARS_PER_PAGE characters of chapter 1
 *   2. Send the whole excerpt to Claude Opus 4.7. Ask for an array
 *      of scenes — concrete VISUAL prompts synthesised from each
 *      narrative segment. Abstract concepts ("the bottleneck of
 *      creation") get rewritten as visual metaphors a designer would
 *      illustrate ("a single key on a stone bridge spanning a canyon").
 *   3. For each scene × style, call fal.ai Flux Pro 1.1 with style
 *      prefix + visual prompt + suffix. Bounded concurrency 4.
 *   4. Render gallery: scene | excerpt | visual prompt | 3 style outputs.
 *
 * Run via GitHub Actions workflow `test-image-quality.yml` to keep
 * keys out of the local environment. Locally:
 *   ANTHROPIC_API_KEY=... FAL_KEY=... \
 *   SUPABASE_SERVICE_ROLE_KEY=... NEXT_PUBLIC_SUPABASE_URL=... \
 *   npx tsx scripts/test_image_quality.ts \
 *     --listing 5c63f175-ce4b-4446-8771-3107fc8ab5c9 --pages 3
 */

import { createClient } from '@supabase/supabase-js';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
const FAL_KEY = process.env.FAL_KEY;
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!ANTHROPIC_KEY || !FAL_KEY || !SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error(
    'Missing required env: ANTHROPIC_API_KEY, FAL_KEY, NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY',
  );
  process.exit(1);
}

const ANTHROPIC_MODEL = 'claude-opus-4-7';
const FLUX_ENDPOINT = 'https://fal.run/fal-ai/flux-pro/v1.1';

const CHARS_PER_PAGE = 3000;

const STYLES = [
  {
    slug: 'minimalist_editorial',
    label: 'Minimalist editorial illustration',
    prompt_prefix:
      'Editorial illustration, minimalist line art with selective color accents, '
      + 'flat design, clean composition, modern magazine aesthetic, '
      + 'restrained palette of two or three colors against off-white background, '
      + 'evocative of The Atlantic or Wired feature illustrations, '
      + 'subject: ',
    prompt_suffix:
      ', no text, no watermarks, no logos',
  },
  {
    slug: 'pencil_sketch',
    label: 'Hand-drawn pencil sketch',
    prompt_prefix:
      'Detailed graphite pencil sketch on cream-textured paper, '
      + 'classical illustration technique, hatching and cross-hatching, '
      + 'subtle tonal gradation, editorial book illustration style, '
      + 'monochrome with faint warm undertone, vignette edges, '
      + 'subject: ',
    prompt_suffix:
      ', no text, no watermarks, no logos',
  },
  {
    slug: 'conceptual_abstract',
    label: 'Conceptual abstract / Bauhaus',
    prompt_prefix:
      'Conceptual abstract illustration in Bauhaus tradition, '
      + 'geometric shapes and bold primary colors, '
      + 'symbolic representation, flat composition, '
      + 'reminiscent of Saul Bass and mid-century modern poster design, '
      + 'subject: ',
    prompt_suffix:
      ', no text, no watermarks, no logos',
  },
];

interface Scene {
  index: number;
  excerpt: string;
  visual_prompt: string;
}

interface CompletedJob {
  scene: Scene;
  style: typeof STYLES[number];
  url: string | null;
  error: string | null;
}

interface SceneResult {
  scene: Scene;
  styles: { slug: string; label: string; image_url: string | null; error: string | null }[];
}

async function fetchExcerpt(listingId: string, pages: number): Promise<string> {
  const supa = createClient(SUPABASE_URL!, SUPABASE_SERVICE_KEY!);
  const { data, error } = await supa
    .from('store_chapters')
    .select('content_markdown')
    .eq('listing_id', listingId)
    .order('chapter_index', { ascending: true })
    .limit(1)
    .single();
  if (error) throw new Error(`Supabase read failed: ${error.message}`);
  const total = (data?.content_markdown ?? '') as string;
  // pages=0 means read the entire first chapter (full-book mode).
  if (pages <= 0) return total;
  return total.slice(0, pages * CHARS_PER_PAGE);
}

async function extractScenesChunked(fullText: string, targetScenes: number): Promise<Scene[]> {
  // Chunk the book to keep each Claude call well within input-token
  // budget AND keep the per-call scene count in a regime where Claude
  // produces consistent quality. Claude tends to "compress" when asked
  // for too many scenes from one chunk: 80 scenes from 86k chars in
  // one call = thin prompts. 10 scenes per ~10k-char chunk = the
  // density we proved at quality test #3.
  const CHARS_PER_CHUNK = 10000;
  const chunks: string[] = [];
  for (let i = 0; i < fullText.length; i += CHARS_PER_CHUNK) {
    chunks.push(fullText.slice(i, i + CHARS_PER_CHUNK));
  }
  const scenesPerChunk = Math.max(4, Math.round(targetScenes / chunks.length));
  console.log(`     chunks: ${chunks.length}, target scenes/chunk: ${scenesPerChunk}`);

  const all: Scene[] = [];
  for (let i = 0; i < chunks.length; i++) {
    process.stdout.write(`     chunk ${i + 1}/${chunks.length}… `);
    const sceneSlice = await extractScenes(chunks[i], scenesPerChunk);
    console.log(`${sceneSlice.length} scenes`);
    for (const s of sceneSlice) {
      all.push({ ...s, index: all.length });
    }
  }
  return all;
}

async function extractScenes(excerpt: string, targetScenes = 8): Promise<Scene[]> {
  const lo = Math.max(3, targetScenes - 2);
  const hi = targetScenes + 2;
  const system = `You are a senior book-illustration art director. The author has written a non-fiction memoir about building AI startups. Your job: read the excerpt and segment it into scenes — distinct narrative or conceptual moments worth illustrating.

For each scene, write a visual prompt of 25–40 words that describes ONE concrete image a magazine illustrator would draw to represent that scene. The prompt must:
- Describe people, objects, and setting concretely (a man at a desk, a winding road, a single key on a table).
- Avoid abstract nouns ("innovation," "potential," "bottleneck") — convert them into visual metaphors a human eye can see.
- Avoid the phrase "the author" — describe what's IN the image, not who it represents.
- Avoid camera/style directives like "cinematic shot of" — that's the style layer's job.
- Stay grounded in the era and content (modern setting, contemporary clothing, modern devices).

Return JSON only, no preamble:
{"scenes":[{"excerpt":"<the 1–3 sentences this scene illustrates>","visual_prompt":"<25–40 word concrete visual>"}]}

Aim for ${lo}–${hi} scenes total. Quality over quantity.`;

  const user = `EXCERPT (illustrate this):\n\n${excerpt}`;

  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': ANTHROPIC_KEY!,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: ANTHROPIC_MODEL,
      max_tokens: 4000,
      system,
      messages: [{ role: 'user', content: user }],
    }),
  });
  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`Anthropic call failed (${resp.status}): ${errText.slice(0, 500)}`);
  }
  type ContentBlock = { type: string; text?: string };
  const data = (await resp.json()) as { content?: ContentBlock[] };
  const textBlock = data.content?.find((c) => c.type === 'text');
  const text = textBlock?.text ?? '';
  // Strip code fences if present.
  const cleaned = text.replace(/^```(?:json)?\s*|\s*```\s*$/g, '').trim();
  let parsed: { scenes: { excerpt: string; visual_prompt: string }[] };
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    const m = cleaned.match(/\{[\s\S]*\}/);
    if (!m) throw new Error(`Claude returned non-JSON: ${cleaned.slice(0, 300)}`);
    parsed = JSON.parse(m[0]);
  }
  if (!parsed.scenes || !Array.isArray(parsed.scenes)) {
    throw new Error('Claude response missing scenes array');
  }
  return parsed.scenes.map((s, i) => ({
    index: i,
    excerpt: s.excerpt,
    visual_prompt: s.visual_prompt,
  }));
}

async function generateImage(
  visualPrompt: string,
  stylePrefix: string,
  styleSuffix: string,
): Promise<{ url: string | null; error: string | null }> {
  const fullPrompt = `${stylePrefix}${visualPrompt}${styleSuffix}`;
  try {
    const resp = await fetch(FLUX_ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Key ${FAL_KEY!}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        prompt: fullPrompt,
        image_size: 'landscape_4_3',
        num_inference_steps: 28,
        guidance_scale: 3.5,
        enable_safety_checker: false,
        output_format: 'jpeg',
      }),
    });
    if (!resp.ok) {
      const errText = await resp.text();
      return { url: null, error: `HTTP ${resp.status}: ${errText.slice(0, 200)}` };
    }
    const data = (await resp.json()) as { images?: { url: string }[] };
    const url = data.images?.[0]?.url ?? null;
    if (!url) return { url: null, error: 'No image URL in response' };
    return { url, error: null };
  } catch (e) {
    return { url: null, error: e instanceof Error ? e.message : String(e) };
  }
}

async function main() {
  const args: Record<string, string> = {};
  for (let i = 2; i < process.argv.length; i += 2) {
    const k = process.argv[i];
    const v = process.argv[i + 1];
    if (k?.startsWith('--')) args[k.slice(2)] = v ?? '';
  }
  const listingId = args.listing || '5c63f175-ce4b-4446-8771-3107fc8ab5c9';
  const pages = parseInt(args.pages || '3', 10);
  // --style filters STYLES to only the matching slug; default = all 3.
  const styleFilter = (args.style || '').trim().toLowerCase();
  const activeStyles = styleFilter
    ? STYLES.filter((s) => s.slug === styleFilter)
    : STYLES;
  if (styleFilter && activeStyles.length === 0) {
    throw new Error(`Unknown style "${styleFilter}". Valid: ${STYLES.map((s) => s.slug).join(', ')}`);
  }
  // --target-scenes overrides the auto-derived scene count.
  // Default: 1 scene per ~1100 chars of source text (matches the
  // density we proved at the 3-page test where 9000 chars → 10 scenes).
  const targetOverride = parseInt(args['target-scenes'] || '0', 10);

  console.log(`\n=== CEO-167 quality test ===`);
  console.log(`Listing: ${listingId}`);
  console.log(`Pages:   ${pages === 0 ? 'all (full chapter 1)' : `${pages} (${pages * CHARS_PER_PAGE} chars)`}`);
  console.log(`Styles:  ${activeStyles.map((s) => s.slug).join(', ')}\n`);

  console.log('1/3 Reading excerpt from Supabase…');
  const excerpt = await fetchExcerpt(listingId, pages);
  console.log(`     read ${excerpt.length} chars\n`);

  const targetScenes = targetOverride > 0
    ? targetOverride
    : Math.max(8, Math.round(excerpt.length / 1100));
  console.log(`2/3 Extracting ~${targetScenes} scenes via Claude Opus 4.7…`);
  const scenes = excerpt.length <= 12000
    ? await extractScenes(excerpt, targetScenes)
    : await extractScenesChunked(excerpt, targetScenes);
  // Re-index in order
  scenes.forEach((s, i) => { s.index = i; });
  console.log(`     ${scenes.length} scenes total\n`);

  console.log(`3/3 Generating ${scenes.length * activeStyles.length} images via Flux Pro 1.1…`);
  // Bounded concurrency: 4 jobs in flight. fal.ai rate-limits per-key.
  const queue: { scene: Scene; style: typeof STYLES[number] }[] = [];
  for (const scene of scenes) {
    for (const style of activeStyles) queue.push({ scene, style });
  }
  const completed: CompletedJob[] = [];
  const inflight = new Set<Promise<void>>();
  const concurrency = 4;
  let next = 0;
  while (next < queue.length || inflight.size > 0) {
    while (inflight.size < concurrency && next < queue.length) {
      const job = queue[next++];
      const p = generateImage(
        job.scene.visual_prompt,
        job.style.prompt_prefix,
        job.style.prompt_suffix,
      ).then((r) => {
        completed.push({ scene: job.scene, style: job.style, url: r.url, error: r.error });
        const status = r.url ? 'ok' : `FAIL ${r.error?.slice(0, 60)}`;
        console.log(`     [${job.scene.index}/${job.style.slug}] ${status}`);
      });
      const wrapped = p.finally(() => inflight.delete(wrapped));
      inflight.add(wrapped);
    }
    if (inflight.size > 0) await Promise.race(inflight);
  }

  // Re-shape into per-scene results
  const results: SceneResult[] = scenes.map((scene) => ({
    scene,
    styles: activeStyles.map((style) => {
      const c = completed.find((r) => r.scene.index === scene.index && r.style.slug === style.slug);
      return {
        slug: style.slug,
        label: style.label,
        image_url: c?.url ?? null,
        error: c?.error ?? null,
      };
    }),
  }));

  const html = renderGallery(listingId, pages, scenes.length, results);
  const candidates = ['/mnt/user-data/outputs/quality_test.html', 'scripts/output/quality_test.html'];
  let writtenPath: string | null = null;
  for (const path of candidates) {
    try {
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, html, 'utf8');
      writtenPath = path;
      break;
    } catch {
      // try next
    }
  }
  if (!writtenPath) throw new Error('Failed to write gallery to any candidate path');
  console.log(`\nGallery: ${writtenPath}`);

  const okCount = completed.filter((c) => c.url).length;
  const proCostUsd = okCount * 0.04;
  console.log(`Generated: ${okCount}/${completed.length} images (~$${proCostUsd.toFixed(2)} on Flux Pro 1.1)\n`);
}

function renderGallery(
  listingId: string,
  pages: number,
  sceneCount: number,
  results: SceneResult[],
): string {
  const cards = results.map((r) => {
    const gridClass = r.styles.length === 1 ? 'styles-grid single-style' : 'styles-grid';
    const styleCells = r.styles.map((s) => {
      if (s.image_url) {
        return `
          <div class="cell">
            <div class="cell-label">${escapeHtml(s.label)}</div>
            <img src="${escapeHtml(s.image_url)}" alt="${escapeHtml(s.slug)}" loading="lazy" />
          </div>`;
      }
      return `
        <div class="cell cell-error">
          <div class="cell-label">${escapeHtml(s.label)}</div>
          <div class="error">${escapeHtml(s.error || 'No image')}</div>
        </div>`;
    }).join('');
    return `
      <article class="scene">
        <header><span class="scene-index">Scene ${r.scene.index + 1}</span></header>
        <blockquote class="excerpt">${escapeHtml(r.scene.excerpt)}</blockquote>
        <p class="visual-prompt"><strong>Visual prompt:</strong> ${escapeHtml(r.scene.visual_prompt)}</p>
        <div class="${gridClass}">${styleCells}</div>
      </article>`;
  }).join('\n');

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>CEO-167 image quality test — Penworth Livebook</title>
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <style>
    * { box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      max-width: 1400px; margin: 0 auto; padding: 32px;
      background: #fafafa; color: #1a1a1a; line-height: 1.5;
    }
    h1 { font-size: 26px; margin: 0 0 8px; }
    .meta { color: #666; font-size: 14px; margin-bottom: 32px; }
    .scene {
      background: white; border-radius: 10px; padding: 24px;
      margin-bottom: 32px; box-shadow: 0 1px 3px rgba(0,0,0,0.06);
    }
    .scene header {
      display: flex; justify-content: space-between; align-items: center;
      margin-bottom: 16px; border-bottom: 1px solid #eee; padding-bottom: 12px;
    }
    .scene-index {
      font-weight: 700; font-size: 13px; color: #666;
      text-transform: uppercase; letter-spacing: 0.05em;
    }
    .excerpt {
      margin: 0 0 12px 0; padding: 14px 18px;
      background: #f5f3ee; border-left: 3px solid #d4af37;
      font-style: italic; color: #333; font-size: 14px;
    }
    .visual-prompt {
      font-size: 13px; color: #555; margin: 0 0 16px 0;
    }
    .styles-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
      gap: 16px;
    }
    .styles-grid.single-style {
      grid-template-columns: 1fr;
      max-width: 720px;
      margin: 0 auto;
    }
    .cell { display: flex; flex-direction: column; gap: 8px; }
    .cell img {
      width: 100%; aspect-ratio: 4/3; object-fit: cover; border-radius: 6px;
      background: #eee;
    }
    .cell-label { font-size: 12px; font-weight: 600; color: #444; text-align: center; }
    .cell-error {
      background: #fff5f5; border-radius: 6px; padding: 12px; border: 1px solid #fcc;
    }
    .cell-error .error {
      font-size: 12px; color: #c00; font-family: monospace; word-break: break-all;
    }
    @media (max-width: 800px) { .styles-grid { grid-template-columns: 1fr; } }
  </style>
</head>
<body>
  <h1>Penworth Livebook — image quality test</h1>
  <p class="meta">
    Listing <code>${escapeHtml(listingId)}</code> &middot;
    First ${pages} pages &middot;
    ${sceneCount} scenes &middot;
    3 styles per scene &middot;
    Flux Pro 1.1
  </p>
  ${cards}
</body>
</html>`;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string),
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
