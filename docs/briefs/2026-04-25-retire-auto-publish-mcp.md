# Brief: Retire auto-publish MCP — extract intact to `archive/` for resale

**Task code:** CEO-083
**Authored:** 2026-04-25 by CEO Claude
**Owner:** Claude Code
**Expected completion:** 4–6 hours of agent work

---

## Objective

Cleanly remove the external-platform auto-publish feature (the "Tier 2 / Tier 3" mechanisms in the publish flow) from the main Penworth codebase. Preserve the removed code intact in `archive/auto-publish-mcp/` as a self-contained, sellable package — Founder intends to sell the auto-publish technology to a third party later. Main app must continue to publish to `store.penworth.ai` (Tier 1) without regression.

---

## Strategic context

This is a deliberate product decision, not a technical refactor. Founder's reasoning (logged 2026-04-25):

> "Apple does not refer their clients to Amazon. The auto-publish MCP made sense before we had `store.penworth.ai`. Now that we own the store, we do not pave the road for writers to leave the ecosystem. We do not pay the inference cost to help a writer publish on Amazon, then lose the customer relationship."

Same reasoning applies to the AI-generated **publishing guide** (which instructed writers how to publish on external platforms): retire that too. We do not refer writers out.

What survives: store-internal publishing only. Tier 1, full stop.

---

## In-scope: code to extract → `archive/auto-publish-mcp/`

The agent must inventory and move the following surface area. **Move, don't copy** — the source paths must end up empty / removed from the main tree.

### API routes (under `app/api/publishing/`)

- `app/api/publishing/computer/**` — computer-use auto-publish (entire directory)
- `app/api/publishing/oauth/**` — external-platform OAuth flows (entire directory)
- `app/api/publishing/apikey/**` — external-platform API-key connection flows
- `app/api/publishing/platforms/route.ts` — listing of external publishing platforms
- `app/api/publishing/tier2/**` — Tier 2 publishing surface
- `app/api/publishing/generate-guide/route.ts` — publishing-guide generator (external-platforms version)

### UI components

- `components/publish/ComputerSessionPanel.tsx`
- `components/publish/KitPanel.tsx` (verify it is external-only; if it has Store branches, refactor first to split)
- Any "Tier 2" or "Tier 3" sections inside `components/publish/PublishClient.tsx` — extract those JSX blocks. Tier 1 (Penworth Store) stays in PublishClient. CEO-084 will redesign that file separately; agent must not over-edit it here, only remove the Tier 2/3 surface.

### Inngest functions

Search `inngest/` for any function names matching `publish-external`, `kdp`, `apple-books`, `tier2`, `computer-publish`, `auto-publish`, `oauth-publish`. Move all such functions to `archive/auto-publish-mcp/inngest/`. Update `inngest/client.ts` exports accordingly so the moved functions are NOT registered with the live app.

### Library / utility files

Search `lib/publishing/`, `lib/external-platforms/`, `lib/oauth/` (if exists). Move external-platform-specific files. Anything Store-specific stays.

### i18n strings

Remove all string keys from `lib/i18n/strings.ts` whose keys begin with `publish.tier2.`, `publish.tier3.`, `publish.computer.`, `publish.platforms.`, `publish.guide.` (the AI publishing guide), and the corresponding entries from the type union. Move the original English copies into `archive/auto-publish-mcp/strings-en.json` for reference.

### DB schema / migrations

**Do NOT drop tables.** Schema removal is risky and irreversible. Instead:

1. Identify any tables/columns specific to external-platform auto-publish (e.g., `external_platform_connections`, `oauth_tokens`, `publishing_sessions` if external-only, `computer_sessions`).
2. Document them in `archive/auto-publish-mcp/SCHEMA.md` with their CREATE statements so the buyer can recreate them.
3. Leave the live tables in place; CEO will mark them `deprecated_*` via a separate Supabase migration in a follow-up task.

### Sidebar / nav references

The Founder's directive in CEO-085 already removes the `/publish` link from sidebar. This brief does NOT modify Sidebar.tsx — that is CEO-085's job. Don't double-edit.

### Documentation

Move any `docs/**` files specifically about auto-publish, external platforms, KDP integration, Apple Books, etc., into `archive/auto-publish-mcp/docs/`.

---

## Archive package structure

The archive directory must be self-describing and resellable. Final shape:

```
archive/auto-publish-mcp/
├── README.md              ← purpose, what's inside, how a buyer would lift it out
├── LICENSE                ← copy of repo's existing LICENSE file (or "Proprietary — Penworth A.C.N. 675 668 710 PTY LTD")
├── SCHEMA.md              ← DB tables this feature relied on (CREATE statements only, no data)
├── api/                   ← all moved app/api/publishing/* directories, preserving structure
├── components/            ← all moved components/publish/* files
├── inngest/               ← all moved inngest functions
├── lib/                   ← any moved lib/ utilities
├── docs/                  ← any moved feature docs
└── strings-en.json        ← removed i18n strings (English only — buyer can re-translate)
```

`archive/auto-publish-mcp/README.md` must include:

- One-paragraph explanation of what the package does
- Stack assumptions (Next.js App Router, Supabase, Inngest, OpenAI/Anthropic SDKs)
- Required env vars the package referenced (extract from the moved code)
- "Lifting it out" instructions: how a buyer would integrate it into a different repo
- Date archived, repo SHA at archive time

---

## Out of scope

- **Do NOT** modify `Sidebar.tsx`. CEO-085 owns that.
- **Do NOT** rename `My Projects` → `My Books`. CEO-084 owns that.
- **Do NOT** redesign `app/(dashboard)/publish/page.tsx`. CEO-084 owns the publish-page retirement.
- **Do NOT** drop database tables or write destructive migrations.
- **Do NOT** touch Stripe, store-internal publishing (`app/api/publishing/penworth-store/**`, `app/api/publishing/mark-published/route.ts`, `app/api/publishing/bundle/route.ts`, `app/api/publishing/metadata/route.ts`, `app/api/publishing/kit/route.ts` — wait, KitPanel may be external; verify), or `app/api/publish/route.ts`.
- **Do NOT** remove the `Store` icon import from anywhere — Tier 1 store publishing still uses publish concepts.

---

## Acceptance tests

The PR must pass all of these before merge. CEO will verify each one explicitly.

1. `npx tsc --noEmit` passes with zero errors.
2. `grep -rn "auto-publish\|autoPublish\|auto_publish" app/ components/ lib/ inngest/` returns zero hits outside `archive/`.
3. `grep -rn "tier2\|Tier 2\|tier3\|Tier 3\|publish.computer\|publish.platforms" app/ components/ lib/` returns zero hits outside `archive/` and outside this brief itself.
4. The following routes are reachable in dev (`npm run dev`) and respond with the same status as before this PR:
   - `GET /publish` (renders Tier 1 store flow only — Tier 2/3 sections gone)
   - `POST /api/publish` (store publish endpoint)
   - `POST /api/publishing/penworth-store/narrate`
   - `POST /api/publishing/mark-published`
5. The following routes return 404 (they should be gone):
   - `GET /api/publishing/platforms`
   - `GET /api/publishing/computer/*`
   - `GET /api/publishing/oauth/*`
   - `GET /api/publishing/apikey/*`
   - `GET /api/publishing/tier2/*`
   - `GET /api/publishing/generate-guide`
6. `archive/auto-publish-mcp/README.md` exists and is non-empty.
7. `archive/auto-publish-mcp/SCHEMA.md` exists and lists at least one CREATE TABLE statement (the relevant DB surface).
8. `archive/auto-publish-mcp/api/` contains the moved route files at recognizable paths.
9. The repo's `.next` build (`npm run build`) succeeds. No new build warnings beyond pre-existing baseline.
10. Visual smoke check: `/publish` page loads and shows only the Penworth Store mechanism. The Tier 2 / Tier 3 cards from the "Three mechanisms" grid in PublishClient.tsx are gone.

---

## Rollback plan

If this PR ships and breaks production publishing:

1. Revert the merge commit on `main` via GitHub UI.
2. Vercel will auto-deploy the previous commit within ~3 min.
3. CEO Claude verifies via `GET https://new.penworth.ai/api/publish` returning 200 to a test fixture.
4. Re-author this brief with the broken bits identified and dispatch again.

The archive directory is not user-facing and never imported by main code, so leaving it in place during rollback is safe.

---

## PR expectations

- **Branch:** `chore/retire-auto-publish-mcp`
- **PR title:** `chore(publish): retire auto-publish MCP, archive intact for resale (CEO-083)`
- **Commit message template:**
  ```
  chore(publish): retire auto-publish MCP (CEO-083)

  - Move app/api/publishing/{computer,oauth,apikey,platforms,tier2,generate-guide} → archive/auto-publish-mcp/api/
  - Move ComputerSessionPanel, KitPanel, Tier 2/3 PublishClient sections → archive/
  - Move related inngest functions (deregistered from main client)
  - Strip publish.tier2.*, publish.tier3.*, publish.computer.*, publish.platforms.*, publish.guide.* i18n keys
  - Document removed DB schema in archive/auto-publish-mcp/SCHEMA.md (no migrations applied)
  - Strategic: Penworth no longer refers writers to external publishing platforms
    (rationale: Apple does not refer customers to Amazon). Store.penworth.ai is the
    only publish target going forward. Archive preserved for resale.
  ```
- **PR description:** link to this brief at `docs/briefs/2026-04-25-retire-auto-publish-mcp.md` and the task row CEO-083 in `ceo_orchestration_tasks`.
- **Single PR, no auto-merge.** CEO Claude reviews against the 10 acceptance tests above before merging.
