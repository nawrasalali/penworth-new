# Brief: My Books unification + sidebar restructure + Guild → Referrals fold-in

**Task codes:** CEO-084 + CEO-085 (combined — both touch `components/dashboard/Sidebar.tsx` and `lib/i18n/strings.ts`; splitting would create merge conflicts)
**Authored:** 2026-04-25 by CEO Claude
**Owner:** Claude Code
**Expected completion:** 6–8 hours of agent work

---

## Objective

Restructure the writer-facing information architecture per Founder directive:

1. **Sidebar slim-down.** Top nav becomes exactly: Dashboard | My Books | Referrals. The orange Guild block is removed entirely. Help & Support stays where it is (in `bottomNav`, untouched).
2. **My Projects → My Books.** Rename the writer's primary workspace everywhere — sidebar label, page titles, breadcrumbs, route slug (`/projects` → `/books` with redirect), copy. The route now hosts two cards: **Published Books** and **Drafting Books**, each with the relevant CTAs surfaced in-card.
3. **Retire `/publish` as a standalone destination.** Fold the publish action into the My Books → Drafting Books card. The "See Pricing" button is already removed (separate commit, CEO-084 prep).
4. **Referrals absorbs Guild.** `/referrals` becomes the single page where authors (a) refer other authors via a shareable link/code, and (b) see an inline upgrade pitch to join the Guild and earn commission on every author they refer. Existing `/guild/**` routes redirect to `/referrals` or remain reachable as Referrals subpages.

---

## Strategic context

Founder rationale (logged 2026-04-25):

> "Guild is not a primary nav item. Folds into Referrals where it belongs — authors refer other authors, and the Guild upgrade is offered inline as a way to earn commission on referrals. The whole publish page must be redesigned. Move it to My Projects [renamed My Books]. Two cards: Published Books, Drafting Books."

Friendly testers cohort has not been picked yet (CEO-017, awaiting Founder), so this restructure can ship before any non-Founder author logs in. No user migration needed.

---

## In-scope changes

### A. Sidebar (`components/dashboard/Sidebar.tsx`)

Current state (verified 2026-04-25, commit `00368ed`):

```ts
const mainNav: NavItem[] = [
  { href: '/dashboard', icon: LayoutDashboard, labelKey: 'nav.dashboard' },
  { href: '/projects', icon: FolderOpen, labelKey: 'nav.myProjects' },
  { href: '/publish', icon: Store, labelKey: 'nav.publish' },
];
```

After this PR:

```ts
const mainNav: NavItem[] = [
  { href: '/dashboard', icon: LayoutDashboard, labelKey: 'nav.dashboard' },
  { href: '/books', icon: BookOpen, labelKey: 'nav.myBooks' },
];
```

(`Publish` removed. `My Projects` becomes `My Books`. Use `BookOpen` from `lucide-react` instead of `FolderOpen` — books, not folders.)

The orange Guild block at lines ~241–260 (the `<a href="https://guild.penworth.ai">` with the amber styling and "Earn 20–40% commission" subtitle) **is removed in its entirety**. No replacement in the sidebar — Guild lives inside Referrals now.

The `Referrals` entry stays in `bottomNav` as it is today (it is already there at `lib/i18n/strings.ts: nav.referrals` and `bottomNav` array). No move needed.

`bottomNav` stays exactly as-is: `[Referrals, Billing, Settings, Help]`. Help & Support is untouched per explicit Founder instruction.

Org section (`orgNav`, conditional `if (organization)`) stays as-is. Organization users still see Organization / Members.

Imports clean-up: remove `FolderOpen`, `Store`, `Handshake`, `ExternalLink` if no longer used after the deletions. Add `BookOpen`.

### B. Route rename: `/projects` → `/books`

- Move `app/(dashboard)/projects/` → `app/(dashboard)/books/`. Preserve the entire subtree (including `[id]/`, `[id]/edit/`, `[id]/publish/`, etc.).
- Add a 308 (permanent) redirect in `middleware.ts` (or `next.config.js`'s `redirects()` if simpler):
  - `/projects` → `/books`
  - `/projects/:path*` → `/books/:path*`
- API routes under `app/api/projects/**` and `app/api/books/**`: keep both temporarily. Add an internal alias if needed. Do NOT rename the `projects` table in Supabase — that is a database concern with much wider blast radius. Route-level URL is the only rename here.
- Update all internal links across the codebase: `grep -rn 'href="/projects' app/ components/` → replace with `/books`. Spot-check that no API call is using `fetch("/projects/...")` — those are page links, not API calls, so safe.

### C. Retire `/publish` as a destination

- Delete `app/(dashboard)/publish/page.tsx` and its sibling subroutes (`/publish/[projectId]/status`, `/publish/store/sell`, `/publish/store/[id]`).
- Add a 308 redirect: `/publish` → `/books`. The publish action moves into the My Books page (see D below).
- Keep `app/api/publish/route.ts` and `app/api/publishing/penworth-store/**`, `mark-published`, `bundle`, `metadata`, `kit` — these are API routes the in-page publish CTA still calls.
- The `<PublishClient>` component (`components/publish/PublishClient.tsx`) — this PR does NOT need to remove it, but its only consumer is being deleted. Either:
  - (i) Delete `PublishClient` entirely if no other consumer remains (preferred, cleaner), OR
  - (ii) Refactor its store-publish JSX into a smaller `<PublishToStorePanel>` component used inline on the Drafting Books card.
  - Implementer's call. State the choice in the PR description.
- Ensure `<PublishToStoreModal>` (`components/publish/PublishToStoreModal.tsx`) survives — it is the modal flow used from a draft to ship to store.

### D. My Books page redesign (`app/(dashboard)/books/page.tsx`)

Replace the current "list of projects" view with a two-card layout:

```
┌─────────────────────────────────────┐
│  My Books                           │
│  [+ New book]                       │
│                                     │
│  ┌─────────────────────────────┐    │
│  │ Drafting Books    (N)       │    │
│  │ ─────────────────────────── │    │
│  │ • [draft 1]  → [Edit] [Publish]
│  │ • [draft 2]  → [Edit] [Publish]
│  │ • ...                       │    │
│  └─────────────────────────────┘    │
│                                     │
│  ┌─────────────────────────────┐    │
│  │ Published Books   (M)       │    │
│  │ ─────────────────────────── │    │
│  │ • [published 1]  → [View on Store] [Manage]
│  │ • ...                       │    │
│  └─────────────────────────────┘    │
└─────────────────────────────────────┘
```

Drafting Books card filter: `projects.status IN ('draft','in_progress','complete')` AND no row in `marketplace_listings`/`store_listings` (verify the live table is `store_listings` — CEO-077 fixed that mapping).

Published Books card filter: `projects.id` exists in `store_listings` with `status IN ('live','pending_review')`.

Each draft row's primary CTA: **Publish** — opens the `<PublishToStoreModal>` directly, no intermediate page. Secondary CTA: **Edit**.

Each published row's primary CTA: **View on Store** (opens `https://store.penworth.ai/{slug}` in new tab). Secondary CTA: **Manage** (links to `/books/{id}` for metadata edits).

UX guidance from Founder, verbatim:

> "Writer-practicality first. Drafts at-a-glance. One-click publish. No marketing noise."

So: no hero banners, no "Three mechanisms" grid, no Tier 1/2/3 framing. Just the two cards, an empty-state message if both are empty, and a `[+ New book]` button at the top.

### E. Referrals page (`app/(dashboard)/referrals/page.tsx`) — Guild fold-in

Existing `/referrals` page: read it first to understand current state. Then expand to be the single Guild surface:

**Section 1 (top): Refer an Author**

- Author's referral code (Founder's is `NAWRAS`) — large, copyable.
- Shareable referral link: `https://penworth.ai/?ref={code}`.
- "Copy link" button.
- "Share via [WhatsApp / X / LinkedIn / Email]" buttons (use the `lucide-react` social icons; no SDK integration needed, just `mailto:` and platform share URLs).
- Live counter: "N authors joined via your referral so far." (Read from `profiles.referred_by_code` or whatever the live column is — verify.)

**Section 2: Become a Guild Member (upgrade pitch)**

- Header: "Earn 20–40% commission on every author you refer" (reuse the existing `nav.guildSubtitle` copy).
- 3 bullet points: tier breakdown (Apprentice / Journeyman / Fellow with commission rates — pull from existing Guild tier data; if not surfaced anywhere as constants, hardcode for now and CEO will follow up).
- Single CTA: **Apply to the Guild** — links to existing `/guild` (or its current entry route). Implementer: keep the existing application/voice-interview/Academy flow at its existing URLs; this CTA just deep-links into them.

**Section 3 (collapsible, only if user is already a Guild member): Guild Dashboard quick-links**

- Show only if `guild_members.user_id = current_user AND status IN ('active','probation')`.
- Quick-link cards to: Application Status, Academy, Financials, Settings, Agents (these are existing `app/guild/dashboard/*` routes).
- This avoids removing functionality for the Founder (currently the only Guild member); keeps existing deep links one click away.

### F. Existing `/guild/**` routes — keep functional

Do **not** delete `app/guild/**`. The application flow, voice interview, Academy content, Nora support, financials, settings — all stay where they are. The change here is purely the entry point: instead of a sidebar link, users land in `/referrals` first and click through.

Add redirects (not destructive):

- `/guild` (top-level landing) → `/referrals`
- `/guild/dashboard` → keeps loading (active members go straight to their dashboard via the Section-3 collapsible)
- All other `/guild/**` routes load normally.

(If the agent identifies that some `/guild/*` routes are duplicative of new Referrals sections, flag in PR description but do not delete.)

### G. i18n strings (`lib/i18n/strings.ts`)

- Add new key: `'nav.myBooks': 'My Books'` (English) plus the 10 other locales. Use the same translation strategy as existing keys (look at how `nav.myProjects` is translated for reference; reasonable equivalents in each language).
- Remove key: `'nav.publish'` and its 11 locale entries (publish is no longer a sidebar item).
- Keep: `'nav.myProjects'` for one release cycle to avoid breaking any external link/email that references the string. Add a `// @deprecated 2026-04-25 — use nav.myBooks` comment. CEO will remove in a later cleanup.
- Keep: `'nav.guild'`, `'nav.guildSubtitle'` — used inside the new Referrals page Section 2.
- Add new keys for the My Books page sections: `books.draftingHeader`, `books.publishedHeader`, `books.emptyState`, `books.newBookCta`, etc. Translate to all 11 locales.
- Add new keys for the Referrals fold-in: `referrals.referAuthorHeader`, `referrals.guildPitchHeader`, `referrals.guildPitchCta`, etc. Translate to all 11 locales.

### H. Sidebar Guild block removal — i18n cleanup

`'nav.guildSubtitle'` is still referenced by the new Referrals page Section 2 ("Earn 20–40% commission" copy). Keep the key, change its location of use only.

The Guild block itself in `Sidebar.tsx` (the `<a href="https://guild.penworth.ai">` JSX, lines ~241–260) is deleted in its entirety, along with the orange amber styling and the `Handshake`/`ExternalLink` icon imports if they are no longer used elsewhere in the file.

---

## Out of scope

- **Do NOT** modify the auto-publish MCP code paths. CEO-083 owns those (separate brief, separate PR).
- **Do NOT** rename the `projects` table in Postgres. Schema-level rename has wide blast radius; URL rename only.
- **Do NOT** modify `app/(marketing)/pricing/page.tsx` — public marketing pricing stays.
- **Do NOT** modify Help & Support routes (`app/(dashboard)/help/*`). Founder explicitly excluded.
- **Do NOT** modify the order or content of `bottomNav` (Referrals stays first, Billing/Settings/Help unchanged).
- **Do NOT** redesign `app/(marketing)/**` brochureware pages.
- **Do NOT** break Founder's existing flow: as super_admin and Guild Fellow with referral code `NAWRAS`, every change must keep her own dashboard accessible. Manual smoke step in acceptance tests covers this.

---

## Acceptance tests

CEO will verify each one before merge.

1. `npx tsc --noEmit` passes with zero errors.
2. `npm run build` succeeds.
3. `grep -rn "My Projects\|myProjects" app/ components/` returns only:
   - The `nav.myProjects` deprecated string entries in `strings.ts` (acceptable, marked deprecated).
   - Zero JSX label usages in user-visible UI. `nav.myBooks` is the active key.
4. `grep -n 'href="/projects' app/ components/ -r` returns zero hits (all replaced with `/books`).
5. Sidebar renders exactly: `Dashboard`, `My Books` in `mainNav`. The orange Guild block is gone. `bottomNav` is `Referrals, Billing, Settings, Help`.
6. Visiting `/projects` in dev → 308 redirect → `/books` (test with `curl -I http://localhost:3000/projects`).
7. Visiting `/publish` in dev → 308 redirect → `/books`.
8. Visiting `/guild` (top level) → 308 redirect → `/referrals`.
9. Visiting `/guild/dashboard` → loads normally (active Guild members go here directly).
10. `/books` page renders two cards. As Founder (UID `916a7d24-cc36-4eb7-9ad7-6358ec50bc8d`), the Drafting Books card lists current drafts; the Published Books card lists published store books. Counts match a direct DB query.
11. Click any draft's "Publish" CTA → `<PublishToStoreModal>` opens. Submit → posts to `/api/publish` (or `/api/publishing/penworth-store/...`, whichever is the live store-publish entry) and on success the book moves from Drafting to Published.
12. `/referrals` page renders three sections in order: Refer an Author, Become a Guild Member, Guild Dashboard quick-links (only visible because Founder IS a Guild Fellow).
13. Founder's referral code `NAWRAS` is displayed in Section 1 with a working copy button.
14. "Apply to the Guild" CTA in Section 2 links to `/guild` (or wherever the live Guild application entry is).
15. No 404s in the test smoke flow: dashboard → my books → click a draft → modal → close → referrals → click Apply to Guild → Guild dashboard → back.
16. `lucide-react` imports in `Sidebar.tsx` only contain icons actually used. No dead imports.
17. All 11 locales render correctly (spot-check at minimum: en, es, fr, ar — Arabic confirms RTL still works).
18. The `<PublishToStoreModal>` from a Drafting Books card writes to the same DB tables it wrote to before this PR (confirm with CEO-077 fix is preserved: writes to `store_listings`, not `marketplace_listings`).

---

## Rollback plan

If shipped and breaks:

1. Revert the merge commit on `main`.
2. Vercel auto-deploys previous commit ~3 min.
3. CEO Claude verifies via `GET /` (sidebar renders), `GET /projects` (loads — old behaviour restored), `GET /publish` (loads).
4. Re-author this brief with the broken bits identified.

The route-level move is reversible (no DB changes). Strings additions are additive. Only deletions of `/publish` page files and the Guild sidebar block need rollback, both of which `git revert` handles cleanly.

---

## PR expectations

- **Branch:** `feat/my-books-and-sidebar-restructure`
- **PR title:** `feat(nav,books,referrals): My Books unification + sidebar restructure + Guild fold into Referrals (CEO-084, CEO-085)`
- **PR description:** link this brief at `docs/briefs/2026-04-25-my-books-and-sidebar-restructure.md` and the two task rows CEO-084 and CEO-085 in `ceo_orchestration_tasks`.
- **Single PR, no auto-merge.** CEO Claude reviews against the 18 acceptance tests above before merging. CEO will smoke-test as Founder (UID `916a7d24-cc36-4eb7-9ad7-6358ec50bc8d`) on the Vercel preview deploy URL before merging to main.
