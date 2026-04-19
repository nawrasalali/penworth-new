# 8-Item Editor Bug Batch — April 19-20, 2026 — CLOSED

**Status:** All 8 items resolved
**Source:** Founder uploaded 9 screenshots on 2026-04-19 showing bugs
across the author dashboard and editor:
  `admin.png`, `chapters.png`, `cons.png`, `create_new.png`, `fake.png`,
  `new_proj.png`, `options.png`, `sup.png`, `124.png`

This doc is the closing summary. The per-bug technical detail lives in
the linked commit messages + companion investigation docs.

## The most important lesson from this batch

**4 of the 8 bugs were already fixed in production when the founder
reported them.** The screenshots were genuine — the founder took them
from their own browser — but they were stale. Refactors that had
landed on Apr 17-19 fixed the underlying problems before the
screenshots could be acted on.

Going forward: **always verify a reported bug against live production
before writing a fix.** Steps:

1. Navigate to the affected URL on `new.penworth.ai` via Chrome MCP
2. Run `document.body.innerText` scan or DOM query for the specific
   broken strings / elements shown in the screenshot
3. Only proceed to fix if the bug actually reproduces

This batch took 4 sessions of investigation time; the first 15
minutes of live verification would have compressed it to 1 session.

## The eight items

### 1. Writing Agent generating placeholder text (`fake.png`)

Screenshot showed chapter content reading "This is the beginning of
Chapter 4: Real-World Applications. The content explores Pr…" —
literal template strings.

**Resolution: already fixed in production.** Commit `8ad45b2`
(Apr 17) landed the WritingScreen i18n pass which replaced the old
mock streaming fallback. No "This is the beginning" text anywhere
in the current repo. The Inngest pipeline (`write-book.ts`) calls
Claude Opus correctly. Verified via grep + database inspection
(the project in the screenshot has 0 rows in `chapters`).

### 2. Interview Agent "Option A/B/C" (`options.png`)

Screenshot showed multiple-choice interview buttons reading literal
"Option A", "Option B", "Option C", "Something else…".

**Resolution: stale data, no code fix.** The data in the DB was
genuine corruption from a project created 2026-04-16 — before the
interview-questions refactor made `getRichInterviewQuestions()`
use real per-doc-type banks from `lib/ai/interview-questions.ts`.
Current code produces real options for every supported ContentType.
The corrupted session is at `current_agent: "publishing"`, so users
never see the bad options again. Orphaned data is harmless.

Full investigation: `docs/interview-option-ab-investigation.md`

### 3. Create New Project "Visibility" field (`create_new.png`)

Screenshot showed a Visibility picker with Private/Organization/Public
options — wrong for a B2C author platform with no organisation concept.

**Resolution: already fixed in production.** Live `/projects/new` has
no Visibility section. Verified with `document.body.innerText` scan:
no matches for "Visibility", "Organization", "Public", "Private".

### 4. Header text overlap on editor (`options.png`, `fake.png`)

Screenshots showed the project title appearing twice in a visually
overlapping way in the top-left region of the editor.

**Resolution: shipped in commit `dbc409a` (Apr 20).** Live DOM scan
showed it wasn't overlap but redundancy — the title rendered at y=14
(top breadcrumb) AND y=62 (UnifiedLeftPanel header), 48px apart in
the same column. Both truncated. Fixed by replacing the left panel's
title render with a generic "Back to projects" navigation label;
the top breadcrumb keeps its "Title › Agent" role. Also deleted the
~103-line dead `NavigationSidebar` function that had been kept "in
case". New i18n key `editor.backToProjects` × 11 locales.

Verified live: title count went from 3 → 2, "Back to projects"
appears at the previous title's position.

### 5. Project type cards generic icons (`new_proj.png`)

Screenshot showed 13 project-type cards all using the same generic
document icon with no descriptions.

**Resolution: already fixed in production.** Live `/projects/new`
shows 7 categories (Books / Business / Academic / Legal / Technical
/ Creative / Other) each with specific Lucide icons (`BookOpen`,
`Briefcase`, `GraduationCap`, `Scale`, `Code`, `Sparkles`,
`MoreHorizontal`) and descriptions per option. The 13-card layout
with generic icons no longer exists.

### 6. NaN% / Chapter 1 / 0 (discovered via live inspection)

Not in the original screenshots but discovered while verifying
items 1 and 4. The WritingScreen rendered "Currently writing:
Chapter 1 / 0" and "NaN% complete" when `chapters.length === 0`
(the transient state between writing-agent activation and the
first SSE chapter row arriving).

**Resolution: shipped in commit `ab2dc89` (Apr 20).** Guards added:

```ts
const progress = chapters.length > 0
  ? (completedChapters / chapters.length) * 100
  : 0;
const hasChapters = chapters.length > 0;
```

When no chapters yet, render "Preparing chapters…" (italic) + "0%"
instead of the NaN/divide-by-zero result. New i18n key
`writing.preparing` × 11 locales.

Verified live: zero "NaN" in editor text, zero "Chapter 1 / 0"
counter, "Preparing chapters…" + "0% complete" render correctly.

### 7. Admin Command Center missing quicklinks (`admin.png`)

Screenshot showed only the "Computer sessions" quicklink in the
admin header — missing Guild review, Guild payouts, Compliance
that had been shipped in commit `4e922e04`.

**Resolution: already fine in production.** Live `/admin` header
shows all 4 quicklinks: "Guild review" (→ `/admin/guild`), "Guild
payouts", "Computer sessions" (→ `/admin/computer`), **"Compliance"**
(→ `/admin/compliance`). Verified via DOM scan of the admin header.

### 8. Supabase auth redirect URLs missing language subdomains (`sup.png`)

Screenshot showed the Supabase dashboard URL Configuration page
with only 6 redirect URLs whitelisted — `new.penworth.ai`,
`penworth.ai`, `store.penworth.ai`, `console.penworth.ai`,
`localhost:3000`, and the explicit `/auth/callback`. None of the
10 language subdomains (es, ar, hi, vi, fr, id, bn, zh, ru, pt)
are in the allowlist.

**Resolution: founder task, not code.** This is a Supabase dashboard
configuration change that the founder (or an admin with Supabase
project access) must perform manually. Can't be done from code
because Supabase auth redirect URL configuration is project-level
settings, not database schema.

Action for the founder (when ready):
1. Open the Supabase dashboard → Authentication → URL Configuration
2. Add these 10 wildcard redirect URLs:
   - `https://es.penworth.ai/**`
   - `https://ar.penworth.ai/**`
   - `https://hi.penworth.ai/**`
   - `https://vi.penworth.ai/**`
   - `https://fr.penworth.ai/**`
   - `https://id.penworth.ai/**`
   - `https://bn.penworth.ai/**`
   - `https://zh.penworth.ai/**`
   - `https://ru.penworth.ai/**`
   - `https://pt.penworth.ai/**`

Without these, any user on a language subdomain attempting OAuth
(Google / passwordless email magic link / password reset email link)
will be rejected by Supabase because the callback URL is not on
the allowlist.

**Impact as of today:** minimal — language subdomains are still
pre-launch and auth is routed centrally through `new.penworth.ai`
for all deployments. When language subdomains go live with their
own auth flows this becomes a blocker; until then it's a latent
issue to close before that launch.

## Related commits

All commits that landed during this batch:

- `ab2dc89` — NaN% guard + Option A/B/C decision doc
- `dbc409a` — Redundant title + dead NavigationSidebar cleanup
- `e331afd` (pre-batch) — UX revision: ambient animation, unified left panel, collapsible preview
- `1f9e437` (pre-batch) — prefers-reduced-motion guard + mobile known-issue doc
- `8ad45b2` (pre-batch) — WritingScreen i18n pass (the refactor that made item 1 obsolete)
