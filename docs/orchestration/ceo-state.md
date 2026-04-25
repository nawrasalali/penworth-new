# CEO State Snapshot

**Last updated:** 2026-04-25 ~09:35 UTC by CEO Claude session (CEO-084 + CEO-085 shipped to PR #4 — awaiting Founder smoke-test). Earlier this session: CEO-REF-01 phase 2 — migration 029 Apprentice grant rewire shipped.
**Update frequency:** End of every CEO session.
**Purpose:** The CEO Claude's persistent memory between sessions. Read at start of every session.

---

## Most recent session activity (2026-04-25 ~09:35 UTC — CEO-084 + CEO-085 shipped to PR)

1. **PR #4 open** at https://github.com/nawrasalali/penworth-new/pull/4 — `feat(nav,books,referrals): My Books unification + sidebar restructure + Guild fold into Referrals`. Branch `feat/my-books-and-sidebar-restructure`, head SHA `87b50e0`. Vercel preview READY at https://penworth-at58vtnyz-nawraselali-2147s-projects.vercel.app.
2. **Implementation complete across all eight brief sections.** Sidebar slim-down (mainNav = Dashboard + My Books, orange Guild block deleted), `/projects → /books` route rename via `git mv` with history preserved, `/publish` retired with 308 redirects, new two-card My Books page (Drafting + Published, classified by `store_listings` per CEO-077's contract), three-section Referrals page (Section 1 ReferralDashboard reused, Section 2 deliberately omitted because parallel commit `227941f` already moved that pitch INTO ReferralDashboard, Section 3 Guild quick-links for active members only). i18n: `nav.myBooks` + 24 new keys across all 11 locales; `nav.publish` and `nav.marketplace` removed. Four orphaned components deleted.
3. **Acceptance tests run on preview this session — all green.** Static (1, 3, 4, 5, 16): typecheck clean via pre-push hook, zero "My Projects"/myProjects in user-visible code, zero `href="/projects` anywhere, no dead lucide imports. Redirects (6, 7, 8, 9): `/projects → /books`, `/publish → /books`, `/guild → /referrals`, `/guild/dashboard` loads normally (auth-bounce). Pages compile cleanly: `/books`, `/referrals`, `/dashboard` all 307→/login through middleware (zero 500s).
4. **CEO-084 and CEO-085 set to `awaiting_founder`** with PR + preview URLs in `last_update_note`. Authenticated smoke tests (10, 11, 12, 13, 17, 18) require Founder click-through — that is the remaining merge gate.
5. **Three rebases during the session** (main moved 5+2+2 commits from parallel sessions). One conflict resolved: `components/guild/ShowcaseGrantsCard.tsx` — took main's UX intent (no content_type prefill on grant CTA) with my path rename (`/books/new`).
6. Handover note: `docs/orchestration/handovers/2026-04-25-ceo084-085-shipped.md`.

**Next session first action:** if Founder replies "merge PR #4", squash-merge via GitHub API, confirm production deploy READY for new SHA, mark CEO-084/085 `done` with merge SHA. If Founder flags defects, push fix commit on the same branch (no force-push without telling Founder), wait for new preview READY, re-request Founder smoke.

---

## Production health — verified 2026-04-25 ~09:30 UTC

| Signal | State |
|---|---|
| Supabase migrations applied | 128 (latest: `029_apprentice_grant_3_books_any_type`) |
| Latest main commit (writer) | `320ebde` — fix(covers): strip framing nouns from prompt + remove title overlay |
| Prior notable main commit | `250c520` — feat(covers): designer-brief composer + museum-poster framing (CEO-098) |
| Writer Vercel latest READY | `250c520` and `2fbc02d` both READY (preview for `87b50e0` also READY) |
| Writer open PR | **#4** (CEO-084/085) — preview READY, awaiting Founder smoke-test |
| Store latest production deploy | `63bbda7` (CEO-082 force-dynamic on /book/[slug]) — READY as `dpl_CSrnEcHAy1HDnc7g7XPWb4pdegCS` |
| Stuck sessions right now | 0 |
| Open incidents | 0 |
| Webhooks failed 24h | 0 |
| Unacked alerts | 0 |
| Guild applications pending | 0 |
| Guild active members | 1 (Founder, Fellow tier, fee_starts 2026-07-17 = pre_grace under new policy) |
| Store live listings | 1 ("The New Rich") |

## Founder context

- **Name:** Nawras Alali
- **Timezone:** Adelaide, South Australia (ACST, UTC+9:30 since 2026-04-06)
- **Role now:** leadership + approvals; execution delegated to CEO
- **Preferred comms:** direct, no abbreviations, top-recommendation-first, "go" = approved

## What shipped in the most recent CEO session (2026-04-25 ~09:00 UTC — CEO-095 close-out)

1. Commit `0a217e0` on penworth-store/main: `perf(store): make /browse + /collections caching effective (CEO-095)`. Vercel deploy `dpl_5oT6C6Rr3gFfmpq6HbcxhKfiarGS` READY in production. Switches `getPublicCollections`, `getFilteredListings`, `getCategoryFacets`, `getLanguageFacets` from `createClient` (cookie-reading) to `createServiceClient`. Wraps the three `/browse` data functions in `unstable_cache` (300s TTL, tag `store-listings`) so DB roundtrips are cached server-side per filter combination. Removes the dead `revalidate=300` on `/browse` and replaces with explicit `force-dynamic` + rationale comment.
2. CEO-095 closed (`done`) with audit. /browse data layer caching is effective in production. /collections data layer is isolated.
3. CEO-098 spawned (`open`, p2, ceo, store) — `Extract auth-aware nav from SiteHeader into client component to unblock edge caching`. Discovered post-deploy: /collections is STILL dynamic at the edge despite the data-layer fix because `components/store/site-header.tsx` lines 10–11 call `createClient() + supabase.auth.getUser()` to render the auth nav, and SiteHeader is on every page. This is the same wall CEO-092 hit on homepage and book-detail; the fix pattern (extract auth-aware fragment to client component) is already in the repo. Bounded ~1-2 hours.
4. Handover note: `docs/orchestration/handovers/2026-04-25-ceo095-closeout.md` — full session record including the searchParams discovery for /browse and the SiteHeader discovery for /collections.

## What shipped earlier this evening (2026-04-25 — CEO-082 close-out)

1. Commit `63bbda7` on penworth-store/main: explicit `force-dynamic` on `app/book/[slug]/page.tsx` mirroring the homepage pattern. Vercel deploy `dpl_CSrnEcHAy1HDnc7g7XPWb4pdegCS` READY.
2. CEO-082 closed with full audit. Five fixes confirmed effective in production: storage cacheControl 1-year-immutable upgrade, font self-hosting via next/font/google, cover-image weight cap via literal sizes prop, homepage Promise.all + dedup across rails, priorityFirst hint on first rendered rail.
3. CEO-095 spawned (now closed in the section above) and CEO-096 spawned (`open`, p2, ceo, store) for performance measurement once CEO-098 lands.
4. State-file correction: rule #4 in "things never to assume" was over-broad — corrected to reflect the bash-curl path is the working one for Vercel REST API; only the specific HTTP 503 "DNS cache overflow" signature is the sandbox-egress red herring.
5. Handover note: `docs/orchestration/handovers/2026-04-25-ceo082-closeout.md`.

## What shipped earlier today (2026-04-24 / 25)

1. Migration `ceo031_detector_exclude_publishing_and_stuck_current_only`: excludes `current_agent='publishing'` from stuck detection (publishing is human-driven), and tightens the "active" check to the current agent specifically.
2. Commit `f72c015`: splits escalate_to_admin incident update — only resolves when session leaves detector scope. Fixes CEO-009 ghost-incident loop.
3. Manual unstick of Founder's "The Rewired Self" (session `fb09f345`). Outline data verified intact: 9 sections, 7 body chapters, 1 front + 1 back matter.
4. 144 ghost `stuck_agent` incidents on fb09f345 consolidated with a resolution-note trace.
5. 2 stale alerts acknowledged.
6. Ghost-incident loop verified extinguished: 0 new rows, 0 new alerts, 0 stuck sessions since unstick.
7. Migration `028_guild_paid_author_policy` and commits `c2df108` + `227941f`: referral rewire (1000 credits referrer, 100 welcome, no cap; Guild upgrade banner at 3+ referrals; Guild monthly fee retired in favour of Pro/Max-after-90-days requirement).
7a. Migration `029_apprentice_grant_3_books_any_type` and commit `2fbc02d`: Apprentice grant 5-categories → 3 of any kind. Trigger seeds 3 generic 'showcase' grants per new member (was 5 category-locked); RPC drops category match (consumes oldest unused). UI rewritten to "Three free books — your choice of type" with generic Free book #N tiles. Founder's 5 historical grants preserved for backward compat. Closes the gap flagged in 2026-04-25-0810-referral-rewire handover.
8. Commit `668f31b2` on penworth-store/main (PR #1): CEO-094 top-nav swap For Authors → Livebooks. 13 files. Final shape: single nav-swap commit (a font hotfix originally bundled was dropped during rebase because a parallel session shipped the equivalent as `8b7055a`).

## The CEO position

- **New Claude project:** "Penworth CEO"
- **Authoritative mandate:** `docs/orchestration/ceo-mandate.md`
- **Operating playbook:** `docs/orchestration/ceo-playbook.md`
- **Claude Code runbook:** `docs/orchestration/claude-code-runbook.md`
- **Session rituals:** `docs/orchestration/session-rituals.md`

## Active work — open tasks summary (verified 2026-04-25 ~08:35 UTC)

| Status | Count |
|---|---|
| open | 23 |
| in_progress | 3 |
| blocked | 6 |
| awaiting_founder | 13 |
| done | 48 |
| cancelled | 2 |

Live priority-sorted query: `SELECT * FROM ceo_orchestration_tasks WHERE status != 'done' ORDER BY priority, created_at;`

## What the Founder needs to decide or do, in order of urgency

### P0 — immediate

1. **BUILD ERROR on latest main (`909a0207`)** — Founder's CEO-077 commit is failing Vercel build. Production is still on `f72c015` (READY), but any new push will be blocked until this is fixed. First next-session action is to inspect build logs and either roll forward with a fix or have the Founder revert. Dpl ID: `dpl_G7Ysi76Q2PKy6n7R1vVS2B3itw6b`.

2. **CEO-017 (p0, blocked)**: Friendly-tester cohort — deferred until end-to-end book completes; still waiting.

### P1 — this week

3. **CEO-043 (p1, in_progress)**: Phase 0 shipped; Phase 1+ is per-agent DB-prompt wiring, dispatch via Claude Code briefs.
4. **CEO-014 (p1, blocked)**: 20 Store seed books — deferred on same dependency as CEO-017.
5. **CEO-023 (p1, blocked on Founder)**: Stripe Plus/Premium. Needs either Stripe MCP connector enabled OR STRIPE_SECRET_KEY added to project instructions.
6. **CEO-053 (p1, awaiting founder)**: voice recording root cause — Founder, which screen produced the "Clone failed (401)" toast?
7. **CEO-058 (p1, awaiting founder)**: ELEVENLABS_API_KEY is now in project instructions — CEO-058 can likely progress next session using it.
8. **CEO-022, CEO-018, CEO-011**: external vendor / counsel engagements still awaiting founder authorisation.
9. **CEO-077 (p1, awaiting founder)** → now also the ERROR deploy (above).

### P2 — when convenient

10. **CEO-003, CEO-010, CEO-025, CEO-046**: small founder-time asks.

## What I'm doing next without asking

- Investigate `909a0207` build error, file a hotfix if the root cause is obvious (class: probably a TypeScript error in the new publish route, same pattern as the earlier CEO-059 hotfix on store repo).
- CEO-031 Phase 2: extend `inngest/functions/restart-agent.ts` with consumers for the other agents (currently only `writing` has a consumer). Likely a Claude Code brief.
- Watch for a second/third stuck session to confirm the detector fix works under real load (not just on one test case).

## Shipped this session (2026-04-24/25)

Commits:
1. `f72c015` on main — pipeline-health cron chronic-incident fix (READY in prod).

Migrations:
1. `ceo031_detector_exclude_publishing_and_stuck_current_only`

DB state changes:
1. Session `fb09f345` pipeline_status: stuck → active, failure_count reset.
2. 144 pipeline_incidents rows consolidated with resolution trace.
3. 2 alert_log rows acknowledged.

Task-state closures:
1. CEO-009 → done
2. CEO-054 → done
3. CEO-063 → done
4. CEO-059 → done
5. CEO-076 → done

### Continued — 2026-04-25 ~08:20 UTC (livebooks-nav session)

Commits (penworth-store):
1. `668f31b2` on main — CEO-094 top-nav swap For Authors → Livebooks (squash of PR #1, original branch SHA `d597cd9c`). Production deploy READY.

Files touched in PR #1: 13 (`components/store/site-header.tsx`, `components/store/site-footer.tsx`, 9 locale files in `messages/`, new `app/livebooks/page.tsx`, new `lib/data/livebooks.ts`).

Operational facts learned this session and saved to memory:
1. Vercel git-identity rule: any commit reaching Vercel must be authored by `119996438+nawrasalali@users.noreply.github.com` / `nawrasalali`. Other identities (e.g. `ceo@penworth.ai`) get blocked at deploy with "GitHub could not associate the committer with a GitHub user". This bit prior CEO sessions (`0436013`, `1ef47c8`) and bit me again on the first push of PR #1.
2. main can be force-pushed by parallel sessions or by the Founder mid-session. Always `git fetch origin main` and `git log origin/main..HEAD` before pushing/merging. PR #1 hit a stale-base merge conflict on `app/layout.tsx` that cost ~3 tool calls. Both rules now in `userMemories`.

Bundled hotfix: `feat/livebooks-nav` originally carried a `next/font` Fraunces axes/weight hotfix (commit `ae4d8c6`). It was dropped during rebase because a parallel session had already shipped the equivalent fix to main as `8b7055a` while I was working. Final shape of PR #1 was a single nav-swap commit.

Task-state closures:
1. CEO-094 → done.

### Flagged for next session — `feat/remove-certified-tier` deploy ERROR

Branch `feat/remove-certified-tier` on penworth-store has a Vercel deploy in ERROR state (`sha=4cc87c2f`) as of 2026-04-25 ~08:15 UTC. Not opened by me. Likely belongs to a parallel session or unfinished prior work. Triage: pull build logs via Vercel API (deployment UID listed in `/v6/deployments?...`), classify as identity-block vs build-error, and either fix or close.

## Open threads I'm tracking

- **CEO-096** (p2, store) — performance measurement (Lighthouse + Speed Insights). NOW UNBLOCKED AND MEANINGFUL: as of `eff9fe0` deploy `dpl_Fue1ZE66a6yh7yJLghyGSD5jDfG1` SHA `b52b608`, store edge caching is verified working in production (`/`, `/collections`, `/audiobooks` all serve `x-vercel-cache: HIT` on second hit, `cache-control: public`). Run Lighthouse + capture numbers to close out CEO-082's master goal at the customer-visible level.
- **CEO-031 Phase 2** — restart-agent consumers for non-writing agents.
- **CEO-077 ERROR deploy** — Founder's commit. Triage when convenient.
- **CEO-070/CEO-071 cover generation** — surfaced diag traces; awaiting Founder's next click to pin upstream Ideogram error pattern.
- **`feat/remove-certified-tier` deploy ERROR** on penworth-store. Triage with `api.vercel.com/v13/deployments/...` to read `readyStateReason` and `seatBlock` — likely another `COMMIT_AUTHOR_REQUIRED` block.

## Known production risks (current)

- **P1**: `909a0207` ERROR deploy blocks any further pushes from deploying. Not serving — current prod is `f72c015` READY — but new work is gated.
- None at P0 severity.

## Things never to assume

1. The Founder has read an earlier session's chat history. Always re-state.
2. A chat-to-chat handover pasted by the Founder is complete. Always verify against DB + repo.
3. A task in the backlog hasn't been worked on by another session. Always check `last_update_note`.
4. **NEW (corrected 2026-04-25 evening)**: HTTP 503 "DNS cache overflow" (18 bytes) from curl in bash_tool is the Anthropic sandbox-egress TLS interception, NOT a real Vercel outage. Verify with a non-Vercel host (httpbin.org) and the cert issuer chain. **However, regular bash curl to `https://api.vercel.com/v13/...` with `Authorization: Bearer $VERCEL_API_TOKEN` works correctly** — verified this session as the working path for deploy state, error reason, and seatBlock fields. The Vercel MCP integration layer specifically returns 403 across multiple sessions and is the broken path; the REST API is the working path.
5. **NEW**: The Vercel team ID in project instructions is duplicated — the "Tools" section has `team_6YlFO6rqSl9ouKa8UkeoUEwmW` (wrong, trailing W), the "Infrastructure" section has `team_6YlFO6rqSl9ouKa8UkeoUEwm` (correct). Use the correct one.

---

_This file is the CEO Claude's handoff to itself. Future sessions must start by reading it._
