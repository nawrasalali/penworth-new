# Brief: Livebook publish + reader integration (CEO-163 Phase 2)

**Task code: CEO-166 (sub of CEO-163)
**Authored:** 2026-04-27 by CEO Claude
**Owner:** Claude Code (multi-file frontend + backend; ideal for delegation)
**Expected completion:** 3–4 days of agent work
**Depends on:** CEO-165 retrieval pipeline shipped + library seeded with at least 1000 images per style

---

## Objective

Wire the Livebook image library into the author publish experience and the reader experience. Author opts in at publish, picks a visual style from a thumbnail gallery, pays 1000 credits atomically, sees progress as the matcher runs, and the resulting livebook renders in the reader with paragraph-paired images.

## What ships

### Author side: publish modal enhancement

`PublishToStoreModal` (already exists, was extended in commit `2e10425`) gains a Livebook section:

- **Toggle:** "Enrol this book in the Livebook image library (1000 credits)"
  - When OFF: rest of the section greys out
  - When ON: style picker appears, balance check runs, top-up button shows if balance < 1000
- **Style picker:** Renders `livebook_styles` rows where `is_active = true`, shows display_name, description, and a 3-up grid of `sample_thumbnail_urls`. Author selects one (radio). Default = no selection (must pick one to submit).
- **Balance display:** "You have N credits. Enrolling costs 1000."
- **Top-up button:** Routes to existing credits page if balance < 1000. Returns to publish modal with state restored on completion.
- **Publish button** is disabled if Livebook toggle is on and (no style picked OR balance insufficient).

### Backend: atomic credit deduction + job creation

Single SQL function `enrol_listing_in_livebook(p_listing_id uuid, p_style text, p_user_id uuid)` that:

1. Locks the user's profile row `FOR UPDATE`.
2. Verifies `credits_balance >= 1000`. If not, returns `{ok: false, reason: 'insufficient_credits'}`.
3. Verifies the listing is owned by the user. If not, returns `{ok: false, reason: 'not_owner'}`.
4. Verifies the listing isn't already enrolled. If so, returns `{ok: false, reason: 'already_enrolled'}`.
5. Decrements `credits_balance` by 1000.
6. Writes a `credit_transactions` audit row.
7. Updates `store_listings`: `livebook_enrolled=true, livebook_style=p_style, livebook_image_status='queued', livebook_enrolled_at=now()`.
8. Inserts a `livebook_generation_jobs` row with status `queued`.
9. Returns `{ok: true, job_id: uuid}`.

The publish handler then emits the Inngest event using the returned job_id.

### Reader side: paragraph-paired image rendering

The 3-mode reader (Read / Audio / Livebook) — designer-approved UX is in memory but diverges from v2; this brief stays aligned with what's shipped + what the matcher produces.

When mode = Livebook:
- For each paragraph, look up `livebook_image_map[paragraph_idx]`. If present, render the image above the text with a soft fade-in. If absent (skipped paragraph), render no image; the previous image stays in view via the trailing-echo technique.
- Image sizing: 16:9, fills the reader column width up to a 720px cap, rounded corners.
- Tap-to-reveal mode controls (existing pattern).
- Portrait/landscape: image stays prominent in portrait, becomes a side-panel in landscape (matches designer-approved restaging).

### Locale strings

Per the i18n rule (memory note: every new `StringKey` must be filled in all 11 locale bundles), these new keys must land everywhere on the same commit:

- `livebook.publish.enrol.label`
- `livebook.publish.enrol.cost`
- `livebook.publish.style.title`
- `livebook.publish.style.description`
- `livebook.publish.balance.have`
- `livebook.publish.balance.cost`
- `livebook.publish.balance.insufficient`
- `livebook.publish.topup.cta`
- `livebook.publish.error.no_style`
- `livebook.publish.error.insufficient_credits`
- `livebook.publish.success.queued`
- `livebook.status.queued`
- `livebook.status.generating`
- `livebook.status.ready`
- `livebook.status.failed`
- `livebook.reader.mode.read`
- `livebook.reader.mode.audio`
- `livebook.reader.mode.livebook`

11 bundles × 18 keys = 198 string entries. Use a per-locale Python script for translation (memory pattern from CEO-2c865305 burn).

## Files to touch

Frontend (penworth-new):
- `components/publishing/PublishToStoreModal.tsx` — add Livebook section
- `components/publishing/LivebookEnrolmentSection.tsx` (new) — extracted for cleanliness
- `components/publishing/LivebookStylePicker.tsx` (new)
- `lib/api/livebook.ts` (new) — client wrapper for enrol endpoint
- `app/api/livebook/enrol/route.ts` (new) — server endpoint that calls the SQL function
- `lib/i18n/strings.ts` — 18 new keys
- `lib/i18n/{en,ar,es,fr,pt,ru,zh,bn,hi,id,vi}.ts` — fill all 18 keys per locale

Backend:
- `supabase/migrations/038_enrol_listing_in_livebook.sql` (new) — the SQL function

Reader (penworth-store repo):
- The reader rendering changes happen in penworth-store. Separate brief for that repo.

## Acceptance tests

1. As founder (test account with 5000 credits): publish a book, toggle Livebook on, pick vintage_painting, submit. Credits drop to 4000. `livebook_generation_jobs` has a new `queued` row. Inngest event fires.
2. Repeat with 500 credits: top-up button appears, publish button disabled.
3. Try to enrol a book that's already enrolled: server returns 409 with reason `already_enrolled`.
4. Try to enrol someone else's book: server returns 403.
5. Type-check passes (`npx tsc --noEmit` clean).
6. Build passes on Vercel preview deploy.
7. All 11 locales have all 18 keys (CI grep check: no `[missing]` placeholders).
8. Reader: open a book that has `livebook_image_status='ready'`, switch to Livebook mode, scroll. Each visible paragraph has a matched image above it.

## Rollback plan

Each piece is independently rollback-able:
- Roll back the modal change → Livebook toggle disappears, no enrolment possible
- Roll back the SQL function → enrolment endpoint fails, modal shows generic error
- Roll back the reader change → reader renders text-only, `livebook_image_map` simply unused

## Out of scope

- Quality flywheel (thumbs up/down on individual matches) — Phase 3
- Style preview before enrolment (hover for full-size sample) — nice-to-have, not blocking
- Per-paragraph manual override by author — Phase 3
- Refund flow if matcher fails — covered by simple "retry on failure, refund only if 3 retries fail" policy in worker; doesn't need user-facing UI in Phase 2
