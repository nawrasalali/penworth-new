# Brief: Livebook image library — Phase 0 foundation

**Task code:** CEO-163
**Authored:** 2026-04-27 by CEO Claude
**Owner:** CEO Claude (Phase 0), then Claude Code (Phases 1–2)
**Expected completion:** Phase 0 — 4–5 days; Phases 1–2 — 2 weeks; Phase 3 — ongoing

---

## Why we are building this

The current Livebook v2 (CEO-076) generates audio TTS but has no integrated visual layer. The founder's vision for v3 is paragraph-paired imagery so each scene gets its own visual cue — vintage painting, cinematic still, pencil sketch, and so on. The naive path is "generate per book at publish time" but that fails three ways:

1. **Cost is unbounded.** A 60k-word book has ~600 paragraphs; at $0.04/image generation that's $24/book and we eat the whole margin.
2. **Latency is hours.** Author publishes, has to wait. Bad UX.
3. **Quality varies shot-to-shot.** Two adjacent paragraphs may pull radically different aesthetics from the same model.

The library-first architecture inverts this. Generate a curated pool of 1000+ images per style ONCE, caption each with Claude Vision, embed the captions with Voyage-3, then retrieve by semantic similarity at publish time. Cost amortises across all books that use that style. Quality is human-curated upfront. Latency drops from "generate" to "retrieve" — minutes, not hours.

The author pays 1000 credits to enrol; that aligns incentives without putting cost on Penworth. Authors who enrol get visual exposure benefit; authors who don't, don't pay.

## Objective

Replace per-publish image generation with a curated, reusable image library. Author opts in at publish, picks a visual style, pays 1000 credits, worker matches each paragraph to a best-fit image via vector similarity search.

Done state for Phase 0: schema is in place on production (✓ shipped this session), styles are seeded (✓), and the seeding script that fills the library with ~2000 images is committed and runnable.

## Architecture

### Data model

Three new tables (migrations 035 + 036, applied to production this session):

- **`livebook_styles`** — the style catalogue. Two styles seeded for Phase 0:
  - `vintage_painting` — 1940s–50s European illustration; romance/historical/literary/memoir/travel
  - `cinematic_photoreal` — high-detail cinematography; thriller/contemporary/biography/non-fiction
- **`livebook_image_library`** — the image pool. Each row has `image_url`, Claude-Vision caption, Voyage-3 embedding (1024-dim), tags, content_genres, era, mood, aspect_ratio. HNSW index on the embedding column for fast cosine similarity search.
- **`livebook_generation_jobs`** — async job queue. One row per livebook generation attempt, with progress, match log, error, retry count.

`store_listings` gains `livebook_enrolled`, `livebook_style`, `livebook_image_status`, `livebook_image_progress`, `livebook_image_map` (resolved paragraph→image map), `livebook_enrolled_at`, `livebook_image_ready_at`. The new columns are deliberately separate from the existing `livebook_*` audio columns (those describe the TTS audio mode of the v2 livebook, which stays for backward compatibility).

### Seeding pipeline

This is the work ahead in Phase 0:

1. **Prompt deck** — Curated list of ~1000 prompts per style covering common scene types: cafe interior, beach, forest, city street, bedroom, mountain, kitchen, train station, office, party, sunset, snow, library, garden, market, dinner table, etc. Each prompt covers an emotional register (joyful / contemplative / tense / romantic / mournful) and a time-of-day (dawn / midday / dusk / night).
2. **Generate** — Flux Pro 1.1 via fal.ai, ~$0.04/image, 16:9 at 1344x768. Total Phase 0 spend ≈ $80 generation × 2 styles = $160.
3. **Caption** — Each generated image gets a rich descriptive caption via Claude vision (Sonnet 4.7). The caption describes what is visible in language matching the prose the worker will be embedding. Examples: "A woman in a green floral dress sits at an outdoor cafe table in a Mediterranean village, smiling warmly at the viewer with one hand near her chin." Cost ≈ $0.005/image × 2000 = $10.
4. **Embed** — Caption embedded with Voyage-3 (1024-dim). Cost trivial.
5. **Tag and classify** — Claude generates structured tags (subjects, mood, era, season, time-of-day) and content_genres at the same time as the caption.
6. **Insert** — Row written to `livebook_image_library` with all fields populated.

Phase 0 total spend: roughly $170. Done in batches over ~2 days (rate-limited by fal.ai concurrency, not us).

### Retrieval pipeline (Phase 1 — next week)

The `admin-generate-livebook` edge function gets rewritten so that instead of generating, it:

1. Loads the listing's chapters/paragraphs.
2. For each paragraph (or paragraph cluster — see "non-visual paragraphs" below), embeds the paragraph text with Voyage-3.
3. Runs `SELECT * FROM livebook_image_library WHERE style_slug = $1 AND is_active = true ORDER BY embedding <=> $2 LIMIT 10`.
4. Re-ranks the top-10 with a small Claude prompt that picks the best fit considering content_genres, mood, era. Falls back to top-1 if Claude declines.
5. Applies a diversity penalty so the same image doesn't appear 5 paragraphs in a row (penalty proportional to recency of last use within this book).
6. Writes the resolved map to `store_listings.livebook_image_map`.
7. Sets `livebook_image_status = 'ready'`.

Worker runs in Inngest with progress reported every N paragraphs; the store listing UI polls and shows a progress bar.

### Non-visual paragraphs — skip-or-merge policy

Pure dialogue, transitional sentences, and short tonal paragraphs don't have a meaningful visual subject. Forcing an image on them produces awkward matches. Policy: a paragraph whose embedding similarity to its top-1 candidate is below a threshold (e.g. 0.55 cosine) gets MERGED into the prior visual paragraph's image. The reader sees the same image continue for 2–3 paragraphs; no jarring mismatch. The match log records this as `fallback_reason: 'low_similarity_merged'`.

## Files to touch (Phase 0)

- `supabase/migrations/035_livebook_image_library.sql` ✓ created and applied
- `supabase/migrations/036_livebook_image_library_policies.sql` ✓ created and applied
- `scripts/seed_livebook_library.ts` (new) — Deno script that reads a prompt deck CSV and produces images. Runnable via `deno run --allow-all scripts/seed_livebook_library.ts --style vintage_painting --count 100 --batch 10`.
- `scripts/livebook_prompts/vintage_painting.csv` (new) — ~1000 rows of {prompt, mood, era, content_genres, tags}
- `scripts/livebook_prompts/cinematic_photoreal.csv` (new)
- `docs/orchestration/ceo-state.md` — bump with CEO-163 progress
- `docs/briefs/2026-04-27-livebook-image-library.md` ✓ this file

Phase 1 + 2 file lists belong to their own briefs; Phase 0 is foundation only.

## Acceptance tests

Phase 0 shipped when all of these pass:

1. ✓ `SELECT extname FROM pg_extension WHERE extname = 'vector'` returns one row
2. ✓ `SELECT count(*) FROM livebook_styles WHERE is_active = true` returns 2
3. ✓ `SELECT count(*) FROM pg_policies WHERE tablename IN ('livebook_styles','livebook_image_library','livebook_generation_jobs')` returns 6
4. (after seeding) `SELECT style_slug, count(*) FROM livebook_image_library GROUP BY 1` returns at least 1000 rows per style
5. (after seeding) Manual smoke test: pick 5 paragraphs from a published book, run the retrieval prototype, eyeball the matches. Founder approves the look.

## Out of scope (Phase 0)

- Author-facing UI changes (Phase 2)
- Reader-facing rendering changes (Phase 2 or later — depends on designer-approved 3-mode reader UX)
- Hybrid gen-on-demand fallback for low-similarity paragraphs (deferred — measure miss rate first)
- Additional styles beyond the two Phase-0 styles (Phase 3)
- Inngest worker (Phase 1)
- Per-paragraph thumbs-up/down quality flywheel (Phase 3)

## Phase 1 plan (next, separate brief)

Slug: `2026-XX-XX-livebook-retrieval-pipeline.md`

- Inngest worker `livebook-image-match` that processes `livebook_generation_jobs` rows
- Voyage-3 client wrapper
- Re-ranker prompt
- Diversity penalty
- Status reporter that updates `store_listings.livebook_image_progress` every N paragraphs
- Acceptance: regenerate one of Penworth's existing published livebooks with the library; founder eyeballs side-by-side vs the v2 livebook and approves.

## Phase 2 plan (next + 1, separate brief)

- `PublishToStoreModal` enhancement: Livebook toggle, style picker rendering `livebook_styles.sample_thumbnail_urls`, credit balance check, inline top-up flow
- Atomic credit deduction + job creation (single SQL function)
- Store listing page shows `livebook_image_status` with progress bar
- Wire designer-approved 3-mode reader UX (Read/Audio/Livebook) to consume `livebook_image_map`

## Rollback plan

Rollback is non-destructive: drop the three new tables and the 7 new columns on `store_listings`. No production data depends on them yet (Phase 0 is foundation-only). The existing v2 livebook continues to work because the new columns are additive and the existing code paths read different columns.

```sql
ALTER TABLE store_listings
  DROP COLUMN IF EXISTS livebook_enrolled,
  DROP COLUMN IF EXISTS livebook_style,
  DROP COLUMN IF EXISTS livebook_image_status,
  DROP COLUMN IF EXISTS livebook_image_progress,
  DROP COLUMN IF EXISTS livebook_image_map,
  DROP COLUMN IF EXISTS livebook_enrolled_at,
  DROP COLUMN IF EXISTS livebook_image_ready_at;
DROP TABLE IF EXISTS livebook_generation_jobs;
DROP TABLE IF EXISTS livebook_image_library;
DROP TABLE IF EXISTS livebook_styles;
DROP TYPE IF EXISTS livebook_job_status;
```

## PR expectations

Phase 0 ships in two commits:

- **Commit 1** (this session): `feat(livebook): image library schema (CEO-163 Phase 0)`. Migrations + brief.
- **Commit 2** (next session): `feat(livebook): seeding pipeline (CEO-163 Phase 0)`. Seeding script + prompt decks + smoke-test of 100 images per style.

After Commit 2, founder is asked to eyeball a sample of generated+captioned images and either approve scaling to 1000/style or refine the prompt deck.

## Founder decisions ratified for this brief

1. Phase 0 greenlit ✓
2. Starting styles: Vintage Painting + Cinematic Photorealistic ✓
3. 1000 credits per book ✓ (revisit if credit→USD ratio shifts)
4. Flux Pro 1.1 via fal.ai for image generation ✓
5. Hybrid gen-on-demand fallback deferred to v2 ✓
