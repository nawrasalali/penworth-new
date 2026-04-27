/**
 * Quick visual quality test for Livebook image generation.
 *
 * Generates one image per paragraph for the FIRST N paragraphs of a
 * listing, in K different styles. Produces a single HTML gallery at
 * /mnt/user-data/outputs/ so the founder can eyeball quality across
 * styles in one view before committing to library seeding or per-book
 * generation strategy.
 *
 * NOT integrated with the Livebook library or any production tables.
 * Pure quality probe — discardable test artefact.
 *
 * USAGE
 *   pnpm tsx scripts/test_image_quality.ts \
 *     --listing-id 5c63f175-ce4b-4446-8771-3107fc8ab5c9 \
 *     --paragraphs 12 \
 *     --styles minimalist_editorial,pencil_sketch,conceptual_abstract \
 *     --out /mnt/user-data/outputs/quality_test.html
 *
 * Default: 12 paragraphs × 3 styles = 36 images at $0.04 each = $1.44.
 *
 * REQUIRED ENV
 *   FAL_KEY                    fal.ai (Flux Pro 1.1)
 *   ANTHROPIC_API_KEY          Claude (paragraph → scene-prompt)
 *   NEXT_PUBLIC_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *
 * The pipeline per paragraph per style:
 *   1. Claude reads the paragraph and writes a concrete VISUAL scene
 *      description in 25-40 words. This is the bridge from prose to
 *      something an image model can render — non-fiction prose like
 *      "I built three applications" doesn't have a visual subject;
 *      Claude has to invent one consistent with the meaning.
 *   2. Style prefix is prepended to the scene description.
 *   3. Flux Pro 1.1 generates the image.
 *   4. Image bytes are saved to /tmp/quality-test/<style>/<idx>.jpg
 *      and embedded as base64 into the gallery HTML at the end.
 *
 * NOTHING is written to Supabase. The gallery HTML is the only output.
 */

import { createClient } from '@supabase/supabase-js';
import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';

// ---- Style catalogue tuned for non-fiction / business / memoir -----------
// (The vintage_painting + cinematic_photoreal styles seeded earlier are
// for fiction. The first test book is a non-fiction AI/business memoir,
// so we use a different set here. Once the founder picks a winner, we
// can register it in livebook_styles and seed the library against it.)

const STYLES: Record<string, { display: string; prefix: string; suffix: string }> = {
  minimalist_editorial: {
    display: 'Minimalist Editorial',
    prefix:
      'Minimalist editorial illustration in the style of The Atlantic or Wired magazine. ' +
      'Clean composition, limited muted palette (off-white, charcoal, single accent colour), ' +
      'lots of negative space, geometric shapes, modern professional aesthetic. Subject: ',
    suffix: ' Avoid: photorealism, busy backgrounds, cartoon style.',
  },
  pencil_sketch: {
    display: 'Pencil Sketch',
    prefix:
      'Detailed graphite pencil sketch on cream paper. Hand-drawn linework, soft cross-hatching ' +
      'for shading, architectural-illustration sensibility, monochrome with a hint of warm tone. ' +
      'Subject: ',
    suffix: ' Avoid: colour, digital aesthetic, photographic detail.',
  },
  conceptual_abstract: {
    display: 'Conceptual Abstract',
    prefix:
      'Conceptual abstract digital art for a non-fiction book chapter header. Bauhaus-inspired ' +
      'composition, bold geometric forms, restrained 3-colour palette, dynamic but quiet, ' +
      'evokes ideas more than scenes. Subject metaphor: ',
    suffix: ' Avoid: representational human figures, clutter, retro pixel art.',
  },
};

// ---- Config + CLI --------------------------------------------------------

const FAL_API = 'https://fal.run/fal-ai/flux-pro/v1.1';
const ANTHROPIC_API = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_MODEL = 'claude-opus-4-7'; // top quality for scene synthesis

interface Args {
  listingId: string;
  paragraphs: number;
  styles: string[];
  out: string;
}

function parseArgs(): Args {
  const args = process.argv.slice(2);
  const out: Args = {
    listingId: '',
    paragraphs: 12,
    styles: Object.keys(STYLES),
    out: '/mnt/user-data/outputs/quality_test.html',
  };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--listing-id') out.listingId = args[++i] ?? '';
    else if (a === '--paragraphs') out.paragraphs = parseInt(args[++i] ?? '12', 10);
    else if (a === '--styles') out.styles = (args[++i] ?? '').split(',').filter(Boolean);
    else if (a === '--out') out.out = args[++i] ?? out.out;
  }
  if (!out.listingId) {
    console.error('ERROR: --listing-id required');
    process.exit(1);
  }
  return out;
}

// ---- Paragraph splitting --------------------------------------------------

function splitParagraphs(markdown: string, maxN: number): string[] {
  const cleaned = markdown
    .replace(/^#+\s+/gm, '')
    .replace(/\r/g, '')
    .replace(/[ \t]+$/gm, '');
  const blocks = cleaned.split(/\n\s*\n+/);
  const out: string[] = [];
  for (const b of blocks) {
    const t = b.replace(/\s+/g, ' ').trim();
    if (t.length < 60) continue; // skip tiny blocks
    const wordCount = t.split(/\s+/).length;
    if (wordCount < 15) continue; // skip ultra-short
    out.push(t);
    if (out.length >= maxN) break;
  }
  return out;
}

// ---- Claude scene-prompt synthesis ---------------------------------------

async function synthesiseScenePrompt(paragraph: string, attempt = 1): Promise<string> {
  const r = await fetch(ANTHROPIC_API, {
    method: 'POST',
    headers: {
      'x-api-key': process.env.ANTHROPIC_API_KEY!,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: ANTHROPIC_MODEL,
      max_tokens: 200,
      messages: [{
        role: 'user',
        content:
          `Read this paragraph from a book and write a concrete VISUAL SCENE that captures its meaning. ` +
          `25-40 words. The output must describe what is visible — people, objects, setting, lighting, mood — ` +
          `not abstract concepts. If the paragraph is abstract or argumentative, INVENT a concrete scene metaphor ` +
          `that conveys the meaning visually. Do NOT include any style instructions (no "in the style of", ` +
          `no "watercolor", no "photorealistic"). Just the scene. Reply with ONLY the scene description, ` +
          `no preamble.\n\nPARAGRAPH:\n${paragraph.slice(0, 2000)}`,
      }],
    }),
  });
  if ((r.status === 429 || r.status === 529) && attempt <= 5) {
    await new Promise((res) => setTimeout(res, 2000 * attempt));
    return synthesiseScenePrompt(paragraph, attempt + 1);
  }
  if (!r.ok) throw new Error(`Anthropic ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const data = await r.json() as { content: Array<{ type: string; text?: string }> };
  const text = (data.content.find((c) => c.type === 'text')?.text ?? '').trim();
  return text;
}

// ---- Flux Pro 1.1 generation ---------------------------------------------

async function generateImage(fullPrompt: string, attempt = 1): Promise<Uint8Array> {
  const r = await fetch(FAL_API, {
    method: 'POST',
    headers: {
      Authorization: `Key ${process.env.FAL_KEY!}`,
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
    await new Promise((res) => setTimeout(res, 2000 * attempt));
    return generateImage(fullPrompt, attempt + 1);
  }
  if (!r.ok) throw new Error(`fal.ai ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const data = await r.json() as { images: Array<{ url: string }> };
  const imgUrl = data.images?.[0]?.url;
  if (!imgUrl) throw new Error('fal.ai returned no image url');
  const imgRes = await fetch(imgUrl);
  if (!imgRes.ok) throw new Error(`image download ${imgRes.status}`);
  return new Uint8Array(await imgRes.arrayBuffer());
}

// ---- Main ----------------------------------------------------------------

async function main() {
  const args = parseArgs();
  const supa = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );

  // Load chapters and concatenate.
  const { data: chapters, error: cErr } = await supa
    .from('store_chapters')
    .select('chapter_index, content_markdown')
    .eq('listing_id', args.listingId)
    .order('chapter_index', { ascending: true });
  if (cErr || !chapters || chapters.length === 0) {
    throw new Error(`No chapters found for listing ${args.listingId}`);
  }
  const fullText = chapters.map((c) => c.content_markdown ?? '').join('\n\n');
  const paragraphs = splitParagraphs(fullText, args.paragraphs);
  console.log(`Loaded ${paragraphs.length} paragraphs from listing ${args.listingId}`);

  const styleKeys = args.styles.filter((s) => STYLES[s]);
  if (styleKeys.length === 0) throw new Error('No valid styles requested');
  console.log(`Testing ${styleKeys.length} styles: ${styleKeys.join(', ')}`);

  const totalImages = paragraphs.length * styleKeys.length;
  console.log(`Will generate ${totalImages} images (~$${(totalImages * 0.04).toFixed(2)}). Starting…\n`);

  // Step 1 — synthesise one scene prompt per paragraph (re-used across styles).
  const scenes: string[] = [];
  for (let i = 0; i < paragraphs.length; i++) {
    process.stdout.write(`  scene ${i + 1}/${paragraphs.length}… `);
    try {
      const scene = await synthesiseScenePrompt(paragraphs[i]);
      scenes.push(scene);
      process.stdout.write(`✓ ${scene.slice(0, 60)}…\n`);
    } catch (e) {
      console.error(`✗ ${(e as Error).message}`);
      scenes.push(`A neutral abstract scene related to: ${paragraphs[i].slice(0, 100)}`);
    }
  }

  // Step 2 — generate one image per (paragraph × style). Save each to disk.
  mkdirSync('/tmp/quality-test', { recursive: true });
  const results: Array<{ paragraphIdx: number; style: string; scene: string; imageB64: string | null; error?: string }> = [];

  for (let pi = 0; pi < paragraphs.length; pi++) {
    for (const styleKey of styleKeys) {
      const cfg = STYLES[styleKey];
      const fullPrompt = cfg.prefix + scenes[pi] + cfg.suffix;
      process.stdout.write(`  img p${pi + 1}/${styleKey}… `);
      try {
        const bytes = await generateImage(fullPrompt);
        const b64 = Buffer.from(bytes).toString('base64');
        const fname = `/tmp/quality-test/${styleKey}_p${pi}.jpg`;
        writeFileSync(fname, bytes);
        results.push({ paragraphIdx: pi, style: styleKey, scene: scenes[pi], imageB64: b64 });
        process.stdout.write(`✓\n`);
      } catch (e) {
        const errMsg = (e as Error).message;
        console.error(`✗ ${errMsg}`);
        results.push({ paragraphIdx: pi, style: styleKey, scene: scenes[pi], imageB64: null, error: errMsg });
      }
    }
  }

  // Step 3 — render gallery HTML.
  const html = renderGallery(paragraphs, styleKeys, results);
  writeFileSync(args.out, html);
  console.log(`\nGallery written to ${args.out}`);
  console.log(`Per-image jpegs in /tmp/quality-test/`);
}

function renderGallery(
  paragraphs: string[],
  styleKeys: string[],
  results: Array<{ paragraphIdx: number; style: string; scene: string; imageB64: string | null; error?: string }>,
): string {
  const rows = paragraphs.map((para, pi) => {
    const cells = styleKeys.map((sk) => {
      const r = results.find((x) => x.paragraphIdx === pi && x.style === sk);
      const styleDisplay = STYLES[sk].display;
      if (r?.imageB64) {
        return `<td><div class="img-wrap"><img src="data:image/jpeg;base64,${r.imageB64}" alt="${sk}" /></div><div class="cap">${styleDisplay}</div></td>`;
      }
      return `<td><div class="img-wrap empty">FAILED<br><small>${r?.error ?? 'unknown'}</small></div><div class="cap">${styleDisplay}</div></td>`;
    }).join('');
    const scene = results.find((x) => x.paragraphIdx === pi)?.scene ?? '';
    return `
      <tr class="para-row">
        <td class="para-cell" colspan="${styleKeys.length}">
          <div class="para-num">Paragraph ${pi + 1}</div>
          <div class="para-text">${escapeHtml(para.slice(0, 600))}${para.length > 600 ? '…' : ''}</div>
          <div class="scene-prompt"><strong>Scene:</strong> ${escapeHtml(scene)}</div>
        </td>
      </tr>
      <tr class="img-row">${cells}</tr>
    `;
  }).join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Livebook Image Quality Test — The New Rich</title>
<style>
  body { font-family: -apple-system, system-ui, sans-serif; max-width: 1400px; margin: 2rem auto; padding: 0 1rem; color: #222; }
  h1 { margin-bottom: 0.3rem; }
  .meta { color: #666; font-size: 0.9rem; margin-bottom: 2rem; }
  table { border-collapse: collapse; width: 100%; margin-bottom: 0; }
  td { vertical-align: top; padding: 0.4rem; border: 1px solid #eee; }
  .para-cell { background: #fafafa; padding: 1rem 1.2rem; }
  .para-num { font-weight: 600; color: #444; font-size: 0.85rem; text-transform: uppercase; letter-spacing: 0.05em; }
  .para-text { margin: 0.4rem 0 0.6rem; line-height: 1.5; font-size: 0.95rem; }
  .scene-prompt { font-size: 0.85rem; color: #777; font-style: italic; }
  .img-wrap { width: 100%; aspect-ratio: 16/9; overflow: hidden; border-radius: 4px; background: #f0f0f0; display: flex; align-items: center; justify-content: center; }
  .img-wrap img { width: 100%; height: 100%; object-fit: cover; display: block; }
  .img-wrap.empty { color: #c00; font-size: 0.85rem; text-align: center; }
  .cap { text-align: center; font-size: 0.75rem; color: #555; margin-top: 0.4rem; padding-bottom: 0.4rem; }
  .img-row td { width: ${100 / styleKeys.length}%; }
</style>
</head>
<body>
<h1>Livebook Image Quality Test</h1>
<div class="meta">
  Book: <strong>The New Rich</strong> &middot; First ${paragraphs.length} paragraphs &middot;
  ${styleKeys.length} styles tested &middot; ${paragraphs.length * styleKeys.length} images total
</div>
<table>
${rows}
</table>
</body>
</html>`;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

main().catch((e) => {
  console.error('FATAL:', e);
  process.exit(1);
});
