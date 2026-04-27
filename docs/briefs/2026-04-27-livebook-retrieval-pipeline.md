# Brief: Livebook retrieval pipeline (CEO-163 Phase 1)

**Task code:** CEO-165 (sub of CEO-163)
**Authored:** 2026-04-27 by CEO Claude
**Owner:** CEO Claude
**Expected completion:** 2 days of agent work, end-to-end verifiable
**Depends on:** CEO-163 Phase 0 schema (shipped) + library seeded with at least 100 images per style (blocked on founder providing API keys)

---

## Objective

Replace the existing `admin-generate-livebook` audio-only edge function's image step (currently absent) with a retrieval pipeline that takes a published book, embeds each paragraph, performs vector similarity search against `livebook_image_library` constrained to the book's chosen style, applies a re-ranker and a diversity penalty, and writes the resolved paragraph→image map to `store_listings.livebook_image_map`. The whole thing runs as an async Inngest worker so the publish flow doesn't block.

Done state: a previously-published Penworth book can be re-processed end-to-end and the founder eyeballs a side-by-side of the v2 (audio-only) Livebook vs the v3 (audio + matched images). Founder approves the look or hands back specific feedback.

## Architecture

### The matching algorithm

For each paragraph in the book:

1. **Pre-filter for visualness.** Skip paragraphs that are pure dialogue (>70% inside quote marks) or shorter than 8 words. These get marked `skip_reason='non_visual'` in the match log; the reader sees the prior visual paragraph's image continue.

2. **Embed the paragraph.** Voyage-3, `input_type='query'` (different from the `'document'` mode used at seeding time — Voyage's recommended asymmetric retrieval setup).

3. **ANN candidate retrieval.** Pull top-20 candidates by cosine similarity, filtered to the book's chosen style:
   ```sql
   SELECT id, image_url, caption, content_genres, mood, era, use_count_in_book, embedding <=> $1 AS distance
   FROM livebook_image_library
   WHERE style_slug = $2 AND is_active = true
   ORDER BY embedding <=> $1
   LIMIT 20
   ```

4. **Diversity penalty.** Track `images_used_this_book` as an in-memory map. For each candidate, add a penalty proportional to how many times this image has appeared in the current book and how recently. Penalty function:
   ```
   adjusted_distance = base_distance + 0.05 * uses_in_book + 0.10 * (1 if used_in_last_3_paragraphs else 0)
   ```
   This is a soft penalty — a perfect-fit image is allowed to repeat, but a marginal one is pushed down.

5. **Re-rank with Claude.** Send top-5 candidates and the paragraph to Claude Haiku 4.5 (cheaper, faster than Opus for this) with a prompt asking it to pick the best fit considering paragraph mood, content_genres alignment, and visual coherence with the previous paragraph's image. If Claude's pick is in top-5, use it; otherwise fall back to top-1.

6. **Write the resolved row** to the in-memory map: `{paragraph_idx, image_id, image_url, thumbnail_url, similarity, reranker_pick: bool}`.

7. **Update progress** every 25 paragraphs: `UPDATE store_listings SET livebook_image_progress = ... WHERE id = $1`. The store listing UI polls this column.

### Implementation pattern (revised after reconnaissance)

The original brief drafted this as an Inngest worker. After inspecting the codebase, the convention here is **direct edge function invocation with fire-and-forget POST** — that's how the audio livebook (`admin-generate-livebook`) is triggered from the publish handler. Inngest is used only for the 7-agent writing pipeline.

To stay consistent with established patterns, Phase 1 ships as:

- A new edge function `admin-match-livebook-images` (mirror of `admin-generate-livebook` for naming consistency)
- Fired fire-and-forget from the publish handler when `livebook_enrolled = true`
- Authenticated by the same `x-admin-secret` shared secret
- Long-run note: a 600-paragraph book runs ~30 seconds end-to-end (Voyage embeddings batched 50/req, SQL match is HNSW-fast, Claude reranker invoked only on close-call paragraphs to save cost)

The match function in SQL handles the diversity penalty in one round-trip per paragraph: HNSW ANN cut to top-50, then in-memory penalty re-rank within those candidates. This is `livebook_match_image_for_paragraph` in migration 037.

### Job lifecycle

The `livebook_generation_jobs` row is created at the moment the founder enrols the book (Phase 2). Phase 1 just consumes it:

- `queued` → Inngest event fired → worker picks up → set to `running`
- progress updates every 25 paragraphs
- terminal states: `succeeded`, `failed`, `cancelled`

A separate small SQL function `livebook_match_image_for_paragraph(p_style text, p_query_emb vector, p_used_ids uuid[], p_recent_ids uuid[])` does the candidate retrieval with the diversity penalty applied in SQL — keeps the per-paragraph round-trip count to one DB call.

## Files to touch

- `supabase/functions/livebook-image-match/index.ts` (new) — the edge function that the Inngest worker invokes per job
- `supabase/migrations/037_livebook_match_function.sql` (new) — SQL function for diversity-penalised candidate retrieval
- `lib/inngest/functions/livebook-image-match.ts` (new) — Inngest worker definition
- `lib/inngest/index.ts` (existing) — register new function
- `lib/inngest/events.ts` or wherever event types live — add `livebook/image.match.requested`
- `app/api/publishing/penworth-store/route.ts` (existing, modify) — when livebook_enrolled, emit the Inngest event AFTER successful audio livebook generation
- `docs/orchestration/ceo-state.md` — bump

## Acceptance tests

Phase 1 ships when all of these pass:

1. Migration 037 applied; `SELECT prosrc FROM pg_proc WHERE proname = 'livebook_match_image_for_paragraph'` returns a definition
2. Inngest function `livebook-image-match` registered (visible in Inngest dashboard or via `pnpm inngest:list`)
3. Manual end-to-end test: against a real published book on store.penworth.ai, fire the event manually, watch progress in `store_listings.livebook_image_progress` go 0→100 over a few minutes
4. The resulting `livebook_image_map` jsonb has one entry per non-skipped paragraph, each with valid `image_url`, `similarity` ≥ 0.55 unless flagged as a fallback merge
5. Founder eyeballs 5 randomly-selected paragraphs from the resolved map; matches are "obviously plausible" — not perfect every time, but coherent. Founder approval gate before scaling to all books.

## Out of scope (Phase 1)

- Publish modal UI changes (Phase 2)
- Reader-side rendering changes (Phase 2 — depends on the designer-approved 3-mode reader UX)
- Per-paragraph thumbs-up/down feedback loop (Phase 3)
- Auto-rerun when a new image is added to the library (deferred — for now, books are matched once at publish)
- Multi-language paragraphs (the seeded library is captioned in English; non-English paragraphs need either translation-then-embed or a multilingual embedding model — flag this for Phase 3 if it becomes urgent)

## Rollback plan

The whole pipeline is additive. If anything misbehaves:
- Comment out the Inngest event emission in `app/api/publishing/penworth-store/route.ts`
- Reset `store_listings.livebook_image_status = 'not_enrolled'` for any book that was mid-process
- The audio livebook keeps working unaffected because it reads from different columns

## PR expectations

One PR, one commit per logical step:
1. `feat(livebook): SQL match function (CEO-165)`
2. `feat(livebook): edge function for image matching (CEO-165)`
3. `feat(livebook): Inngest worker + publish-flow integration (CEO-165)`

PR title: `feat: Livebook image retrieval pipeline (CEO-165)`. Acceptance tests above must all pass before merge.

## What "world class" looks like for this phase

The matching algorithm produces images that feel chosen, not random. A solitary moonlit paragraph gets a moonlit image. A dialogue between two characters at a cafe gets the cafe scene that's actually warmest in the library, not the most generic one. The diversity penalty prevents the same hero image from appearing 5 times in 60 pages. The re-ranker catches edge cases the embedding misses (e.g., the embedding might match "snow" lexically but the prose is about emotional coldness — Claude catches this).

This is the layer where the library's curation pays off. Without good matching, even the best library produces mediocre livebooks. With it, the founder's vision starts to look like the reference images.
