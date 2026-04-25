# CEO State Snapshot

**Last updated:** 2026-04-25 08:10 UTC by CEO Claude session (CEO-REF-01 referral rewire + Guild paid-author policy)
**Update frequency:** End of every CEO session.
**Purpose:** The CEO Claude's persistent memory between sessions. Read at start of every session.

---

## Production health — verified 2026-04-25 08:10 UTC

| Signal | State |
|---|---|
| Supabase migrations applied | 127 (latest: `028_guild_paid_author_policy` this session) |
| Latest main commit (writer) | `227941f` — feat(referrals): signup wiring + dashboard rewrite (this session) |
| Prior main commit (writer) | `c2df108` — feat(referrals,guild): rewire economics + paid-author policy (this session) |
| Writer Vercel latest READY | `227941f` |
| Store latest production deploy | `8fe2330` (CEO-076 livebook v2) — READY |
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

## What shipped in the most recent CEO session (2026-04-24 / 25)

1. Migration `ceo031_detector_exclude_publishing_and_stuck_current_only`: excludes `current_agent='publishing'` from stuck detection (publishing is human-driven), and tightens the "active" check to the current agent specifically.
2. Commit `f72c015`: splits escalate_to_admin incident update — only resolves when session leaves detector scope. Fixes CEO-009 ghost-incident loop.
3. Manual unstick of Founder's "The Rewired Self" (session `fb09f345`). Outline data verified intact: 9 sections, 7 body chapters, 1 front + 1 back matter.
4. 144 ghost `stuck_agent` incidents on fb09f345 consolidated with a resolution-note trace.
5. 2 stale alerts acknowledged.
6. Ghost-incident loop verified extinguished: 0 new rows, 0 new alerts, 0 stuck sessions since unstick.

## The CEO position

- **New Claude project:** "Penworth CEO"
- **Authoritative mandate:** `docs/orchestration/ceo-mandate.md`
- **Operating playbook:** `docs/orchestration/ceo-playbook.md`
- **Claude Code runbook:** `docs/orchestration/claude-code-runbook.md`
- **Session rituals:** `docs/orchestration/session-rituals.md`

## Active work — open tasks summary (verified 2026-04-24 18:00 UTC)

| Status | Count |
|---|---|
| open (ceo owns) | 9 (down from 18 at session start due to closures) |
| in_progress | 3 (CEO-031 Phase 2 remaining; CEO-043 Phase 1+ per-agent wiring; CEO-051) |
| blocked | 6 |
| awaiting_founder | 11 |

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

## Open threads I'm tracking

- **CEO-031 Phase 2** — restart-agent consumers for non-writing agents. Next session work.
- **CEO-077 ERROR deploy** — Founder's commit. First thing to triage next session.
- **CEO-070/CEO-071 cover generation** — surfaced diag traces; awaiting Founder's next click to pin upstream Ideogram error pattern.

## Known production risks (current)

- **P1**: `909a0207` ERROR deploy blocks any further pushes from deploying. Not serving — current prod is `f72c015` READY — but new work is gated.
- None at P0 severity.

## Things never to assume

1. The Founder has read an earlier session's chat history. Always re-state.
2. A chat-to-chat handover pasted by the Founder is complete. Always verify against DB + repo.
3. A task in the backlog hasn't been worked on by another session. Always check `last_update_note`.
4. **NEW**: HTTP 503 "DNS cache overflow" (18 bytes) from curl in bash_tool is the Anthropic sandbox-egress TLS Inspection CA — not a real Vercel outage. Use Vercel MCP tools, not bash curl, when checking deploy state.
5. **NEW**: The Vercel team ID in project instructions is duplicated — the "Tools" section has `team_6YlFO6rqSl9ouKa8UkeoUEwmW` (wrong, trailing W), the "Infrastructure" section has `team_6YlFO6rqSl9ouKa8UkeoUEwm` (correct). Use the correct one.

---

_This file is the CEO Claude's handoff to itself. Future sessions must start by reading it._
