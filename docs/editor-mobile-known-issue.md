# Editor Known Issue — Mobile Viewport Unusable

**Status:** Known broken
**Discovered:** 2026-04-19
**Severity:** High — blocks all mobile authors from the writing flow
**Scope:** `/projects/[id]/editor` only. Dashboard, billing, and marketing
pages are unaffected or minimally affected.

## Symptom

On any viewport narrower than ~1200px, the editor page's horizontal
space budget goes negative:

- Outer dashboard shell contributes a 256px `position: fixed` sidebar
  rail (from `app/(dashboard)/layout.tsx`)
- Editor contributes a 240px left unified panel + 280px right preview
  panel
- Together: **776px of chrome** before the writing column gets any
  space

At a 390px iPhone viewport:
- 390 total − 256 dashboard = 134px remaining
- 134 − 240 left − 280 right = **−386px for the writing column**

The writing surface either clips, squeezes below minimum legibility,
or causes horizontal page scroll. All three outcomes are broken.

## What "works" today and why

Both editor panels (left + right) have collapse buttons that reduce
them to 40px rails. At 40 + 40 = 80px of editor chrome, the writing
column becomes viable on ~1000px+ viewports. But:

1. A user has to manually discover and press both collapse buttons
2. The 256px dashboard sidebar remains `position: fixed` and cannot
   be collapsed from the editor
3. Even fully collapsed, 256 + 40 + 280min-content + 40 ≈ 620px
   minimum. Phones are typically 360–430px.

## Why this wasn't caught before

The editor was designed against the founder's screenshot at ~1500px
viewport. No mobile viewport review happened during the UX revision
this session. Lesson for next editor work: test at 390px / 768px /
1024px / 1440px explicitly before considering the change done.

## Mobile-capable rewrite — scope

This is a multi-session initiative, not a follow-up commit. Key
decisions needed:

1. **Dashboard sidebar on mobile.** Convert to an off-canvas drawer
   (hamburger button in header, slide-in from left). Pattern:
   `sheet` component from shadcn/ui with a `md:` breakpoint guard.
   Affects every page inside `app/(dashboard)/`, not just editor.

2. **Editor panels on mobile.** Three candidate patterns:

   a) **Stacked tabs** — agent pipeline becomes a horizontal scroll
      row above the writing area; document preview becomes a bottom
      sheet triggered by a button. Simplest implementation.

   b) **Full-screen drawers** — agent pipeline and document preview
      each open as full-viewport drawers over the writing area.
      Cleanest mobile UX but most JS state to manage.

   c) **Viewport-aware collapse** — at `sm:` breakpoints, both
      panels start collapsed by default and the user expands on
      demand. Fallback: works even if no drawer pattern ships.
      Weakest UX but smallest code change.

   Recommend (c) as immediate fix, (a) or (b) as follow-up.

3. **Agent pipeline on mobile.** The 8-agent vertical list doesn't
   fit in a narrow drawer. Either:
   - Horizontal scrollable chip row showing just active + completed
   - Vertical list in a full-screen drawer
   - Collapsed to a single status badge ("Agent 5 of 8 — Writing")
     with tap-to-expand

4. **Document preview on mobile.** The cover preview + progress stats
   + quick actions don't all fit. Probably: progress stats inline
   at the top of the writing area; cover preview + quick actions in
   a bottom sheet.

5. **Writing surface itself.** Already scales to any width via
   `flex-1`. No change needed once the chrome stops competing.

## Immediate mitigation considered (and rejected)

Could ship a blunt `@media (max-width: 900px) { body::before { content:
'Please use a larger screen to write' ... } }` banner. Rejected
because:
- Blocks all mobile functionality including reading your own
  in-progress draft
- User can't tell whether the problem is device or account
- Doesn't degrade gracefully when the mobile work ships
- Better: leave the overflow broken but visible, file this doc,
  prioritise the rewrite

## Effort estimate

- (c) viewport-aware default-collapse: 1 session (~2-3h of work)
- (a) stacked tabs pattern: 2 sessions
- (b) full-screen drawers: 3 sessions
- Dashboard sidebar off-canvas drawer: 2 sessions (affects all pages,
  needs testing)

## Priority vs other backlog

At Penworth's current user stage (~hundreds of authors, largely
desktop-first knowledge workers doing long-form writing), this is
probably lower priority than deletion auto-fulfilment (regulatory)
but higher priority than Turborepo consolidation (engineering hygiene).
Founder decision when to schedule.

## Test coverage for the fix

When the rewrite ships, add Playwright tests at three viewports:
- 390×844 (iPhone 12 Pro)
- 768×1024 (iPad portrait)
- 1440×900 (laptop)

Each test: navigate to `/projects/{id}/editor`, verify writing
surface is visible and at least 280px wide, verify no horizontal
page scroll. This would have caught the current issue in CI.
