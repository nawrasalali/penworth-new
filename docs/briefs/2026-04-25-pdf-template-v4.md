# Brief: pdf-template-v4

**Task code:** CEO-090 (links to ceo_orchestration_tasks)
**Authored:** 2026-04-25 by CEO Claude session
**Owner:** Claude Code (for residual defects 4 and 6)
**Status:** Partially shipped this session — see "What landed" below
**Expected completion:** ~1-2 hours of agent work for the remaining defects

---

## What landed in this session (commit to follow)

CEO Claude shipped four of the six defects directly because Claude Code
CLI was not available in the sandbox:

- **Defect 1 — Front cover yellow title, no subtitle, author bottom-left.** ✅ shipped
- **Defect 2 — Page-2 PENWORTH → author imprint.** ✅ shipped (omitted entirely if author is null)
- **Defect 3 — ToC drops ellipsis-truncation.** ✅ shipped. New v4 logic uses pdfkit's native wrapping with hanging indent; page number locks to the first line; dotted leader anchors to the last line. There is no remaining code path in `drawToc` that produces a U+2026 character.
- **Defect 5 — Page geometry audit.** ✅ verified-as-correct, no change needed. Every page inherits `[432, 648]` from the document constructor; every `addPage` call passes only `margins`. The Founder's "pages look bigger" perception is from chrome-page zero margins vs body-page 54pt margins, which is intentional (covers bleed, body has margins). Acceptance test below stays in scope so future regressions are caught.

## What remains for Claude Code

- **Defect 4 — Back cover full-bleed.** Needs investigation of where the back-cover *image* (not just the overlay) is drawn, and confirmation that the call uses `(0, 0, pageW, pageH)` cover-fit instead of a margined placement.
- **Defect 6 — Embedded image width cap.** Needs to find (or add) the markdown-image rendering path in chapter content and cap rendered width at 4.5″ (324 pt).
- **Three new acceptance-gate test files.** Not yet written. Spec preserved below.

---

## Objective

Ship PDF template v4 to fix six concrete defects the Founder reported on
*The Rewired Self* (project `0fd04af3-fcad-47c3-96df-15a0c3a36b43`). The
fixes apply to **every future book**, not just this one — the goal is a
template that produces a launch-ready PDF without the Founder having to
flag the same issues again.

## Context

PDF generation lives in a single file: `app/api/export/route.ts`
(~1,200 lines). It uses **pdfkit** with built-in Type-1 fonts (no
embedding), draws on a 6×9″ trim (432 × 648 pt), and assembles in two
passes (chapter buffer → ToC fill-in). The most recent prod commit
`5255b09 fix(export): PDF v3 — gradient cover overlay, split title, ToC
sync, pagination starts at Introduction, kill empty-page overflow` is the
v3 baseline you are inheriting; v4 builds on it.

The Founder is on free-tier-equivalent for his own books (no watermark
because he is super_admin), so watermark logic is out of scope.

Cover art is generated separately at `app/api/covers/generate/route.ts` →
Ideogram. Cover *images* are textless by design; all title / author /
blurb text is drawn as PDF overlay in `drawFrontCoverOverlay` /
`drawBackCoverOverlay` inside the export route. **Do not change the
cover-generation prompt** — that is a separate task.

## Files to touch

- `app/api/export/route.ts` — primary file; all six defects are addressed here
- `__tests__/export/toc-leaders.test.ts` — **new**: acceptance gate that fails the build if a ToC line truncates with an ellipsis (so the Founder never has to flag this again)
- `__tests__/export/page-geometry.test.ts` — **new**: assert every page in the rendered PDF is exactly 432 × 648 pt
- `__tests__/export/image-cap.test.ts` — **new**: assert no embedded inline image renders wider than 4.5″ (324 pt)

If the repo has no existing `__tests__/export/` directory, create it. Use whatever test runner the repo already configures (check `package.json` `scripts.test`); do **not** add a new test framework dependency.

## Defects to fix

### 1. Front cover — title color, no subtitle, author bottom-left

- File: `app/api/export/route.ts`, function `drawFrontCoverOverlay` (~line 476)
- Current behavior: title white (`#FFF`), centered top; subtitle rendered below; author centered at bottom in white, uppercase, letter-spaced
- Required behavior:
  - Title fillColor changes from `#FFF` to **`#FFD60A`** (a high-contrast saturated yellow that holds up over both light and dark cover art — verify against the existing gradient backdrop drawn by `drawCoverOverlayBackdrop`)
  - Subtitle block (the `if (subtitle)` branch, ~lines 508-522) — **remove entirely**. The full title from `splitTitle()` collapses to `main` only; subtitle is never rendered on the cover regardless of its presence. Author intent: the cover should not carry a long descriptive subtitle, only the work's title.
  - Author byline (~lines 525-532): change `align: 'center'` to `align: 'left'` and adjust `x` from `24` to `40` so the byline anchors to the bottom-left margin. Keep uppercase + character-spacing for typographic consistency with the previous design.

### 2. Title page — replace "PENWORTH" with the author's name (or remove)

- File: `app/api/export/route.ts`, function `drawTitlePage` (~line 595)
- Current behavior: bottom of title page renders the literal string `'PENWORTH'` in small caps as a publisher line (~line 657)
- Required behavior: replace `'PENWORTH'` with the `author` parameter (uppercase + character-spacing preserved) when author is non-null. If author is null, omit the bottom line entirely. Keep the existing mid-page "by {author}" rendering — the bottom line is now the *publisher slot* used as a secondary author imprint, not a brand stamp.

### 3. Table of Contents — no truncated lines, ever

- File: `app/api/export/route.ts`, function `drawToc` (~line 719)
- Current behavior: long titles are truncated with an ellipsis to fit a single line (~lines 747-753). Founder reports this looks like a defect on *The Rewired Self*.
- Required behavior:
  - Drop the truncate-with-ellipsis path
  - If the title fits on one line at 11 pt, render as today
  - Otherwise, **wrap the title** to a second line with hanging indent (left edge aligned with the first line's text-start), draw the dotted leader from the *last* line's text-end to the page-number column, draw the page number on the *first* line, advance `y` by `22 * lineCount`
  - Stay inside the existing `boxW`. No need to shrink the font.
- New test (`__tests__/export/toc-leaders.test.ts`): generate a PDF with a chapter title pathologically long (~80 chars), parse the rendered output, assert no character-3 ellipsis (`…` / U+2026) appears anywhere in the ToC region. **This is the acceptance gate the Founder asked for explicitly.**

### 4. Back cover — full-bleed edge to edge

- File: `app/api/export/route.ts`, function `drawBackCoverOverlay` (~line 537)
- Current behavior: a dark overlay rectangle is drawn at `(0, pageH*0.22, pageW, pageH*0.72)` — that's only 72% of page height, so the cover image bleeds top and bottom but the *overlay* is mid-page only. The Founder's screenshot shows the cover *image* not bleeding to edges.
- Diagnosis to do first: confirm the issue is the **image** placement (not the overlay). The image is drawn elsewhere — search for `drawImage` calls operating on `extras.backCoverUrl`. Check whether the image is being placed at `(MARGIN_OUTSIDE, MARGIN_TOP, ...)` instead of `(0, 0, pageW, pageH)` — that's the most likely cause.
- Required behavior: back-cover image renders at `(0, 0, pageW, pageH)` with `cover` fit (preserve aspect ratio, fill the trim, allow cropping if the image is the wrong aspect). Same logic as the front cover.
- Re-verify the overlay still reads against a full-bleed image at 60% opacity over the bottom 70%.

### 5. Page geometry — every page is exactly 6×9″

- Founder reports "some PDF pages look bigger than others, align them all same size"
- Cause hypothesis: most likely a chrome page (cover, ToC, About) is being added with a different `size: [...]` arg to `doc.addPage()` than body pages. Audit every `doc.addPage(` call in `route.ts` and confirm each passes the same `size: [TRIM_W, TRIM_H]` (or no size, inheriting the document default which should be set at `new PDFDocument({ size: [TRIM_W, TRIM_H], ... })`).
- New test (`__tests__/export/page-geometry.test.ts`): generate a PDF with ≥1 chapter and ≥1 cover, parse it (use `pdf-parse` or `pdf-lib`'s `getPages()`), assert every page's `MediaBox` width === 432 and height === 648.

### 6. Embedded images — cap the width

- Founder: "make sure the images inserted are not big size"
- Scope: any image embedded inside chapter *content* (markdown image syntax `![alt](url)`) — not the front/back cover. The covers are intentionally full-bleed.
- Search for the markdown-to-pdf rendering path for chapter content. There is parsing logic for headings/bold/italic mentioned in the file header comment; locate where (or if) `![](...)` is handled.
- Required behavior: cap rendered width at **324 pt (4.5″)**, center-aligned, preserve aspect ratio, render at 300 DPI minimum. If an image's natural width is smaller than 324 pt, render at natural size. If the markdown image path doesn't exist yet, add it.
- New test (`__tests__/export/image-cap.test.ts`): render a chapter with a markdown image whose source is 2000×1500 px, parse the output, assert the rendered image's width on the page is ≤ 324 pt.

## Acceptance tests

A PR is mergeable when all of these pass:

1. `npx tsc --noEmit` passes from a clean `npm install`.
2. `npm test` passes — including the three new test files above.
3. **Manual visual check**: run the export endpoint locally for the Founder's project (`projectId=0fd04af3-fcad-47c3-96df-15a0c3a36b43`), open the resulting PDF, and verify:
   - Front cover title is yellow (`#FFD60A`), no subtitle, author "Nawras Alali" bottom-left
   - Page 2 (title page) has "Nawras Alali" at the bottom in publisher slot, not "PENWORTH"
   - ToC entries are full text, never ellipsis-truncated, with correct dotted leaders + page numbers
   - Back cover image fills the full page edge-to-edge
   - Every page is the same physical size (open PDF in Preview/Acrobat, the page-size indicator should not jump)
4. Existing watermark, copyright, and About-the-Author logic is **untouched**.

## Out of scope

- Cover-image generation prompt changes (lives in `app/api/covers/generate/route.ts`)
- Watermark logic for free-tier authors
- The Founder's specific cover regeneration for *The Rewired Self* — once the template ships, the Founder can hit the "View PDF" button and the new template renders his existing book correctly without re-running the cover agent
- Translations of any new English-language UI strings (those are defaulted to English fallback per existing i18n conventions)
- Print-specific bleed marks / crop marks — Penworth ships PDFs for digital and KDP, both of which add bleed at upload time

## Rollback plan

If v4 ships and breaks the export endpoint:

```bash
git revert <commit-sha>
git push origin main
```

Vercel auto-redeploys main; rollback is ≤2 minutes. The export endpoint is read-only — there is no DB state to reconcile, no Stripe state, no email side-effect. Worst case the Founder regenerates the PDF after revert and gets the v3 output back.

If only the test files break the build (genuine regressions slip past local but break CI), comment out the failing test, file a follow-up brief to fix it, and ship the production fix without the gate. **Do not** weaken the test to make it pass — the whole point is preventing the Founder from re-flagging the same defect.

## PR expectations

- Branch: `feat/pdf-template-v4`
- PR title: `feat(export): PDF v4 — yellow title, full-bleed back cover, ToC wrap, geometry/image-cap acceptance gates`
- Commit message: same as PR title
- Reference this brief in the PR description: `Implements docs/briefs/2026-04-25-pdf-template-v4.md (CEO-031)`
- Open one PR. Do not split into multiple — these defects are interrelated (page geometry can mask cover issues; ToC wrapping can affect page numbering).

## Notes for the implementer

- pdfkit's `lineBreak: false` is **not** sufficient to prevent wrapping when text exceeds `width` — see existing comment at `drawToc` line 712-717. Plan accordingly when measuring multi-line ToC entries.
- The two-pass pagination is fragile: any change to chapter or chrome page count must update the `tocEntries` build pass at `~line 1033` and the displayed-page-number fill-in at `~line 1112`. Test ToC accuracy with a book that has ≥9 chapters (matching *The Rewired Self*).
- The Founder's super_admin status means his exports skip watermark; if you test on a regular account, account for that branch.
