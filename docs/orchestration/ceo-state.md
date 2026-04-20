# CEO State Snapshot

**Last updated:** 2026-04-20 by CEO Claude session (initial)
**Update frequency:** End of every CEO session.
**Purpose:** The CEO Claude's persistent memory between sessions. Read at start of every session.

---

## Production health — verified 2026-04-20

| Signal | State |
|---|---|
| Supabase migrations applied | 125 (latest: `ceo_orchestration_tasks_foundation` this session) |
| Latest main commit | `cf8ecbc` — voice_profile persist (shipped this session) |
| Prior main commit | `8a5f696` — fix(inngest): restart-agent trigger config |
| Vercel latest deploy | READY (pre-cf8ecbc); new deploy building for cf8ecbc as of this writing |
| Stuck sessions right now | 0 |
| Failed sessions 24h | 10 (historical orphans; all from founder's pre-monitoring testing; not actionable) |
| Open incidents | 0 |
| Webhooks failed 24h | 0 |
| Alerts 24h | 21 (email spam storm, contained by dedup trigger; handled) |
| Guild applications pending | 0 |
| Guild active members | 1 (Founder, Fellow tier, referral code `NAWRAS`) |
| Nora conversations total | 2 |
| Store live listings | 1 ("The New Rich") |

## Founder context

- **Name:** Nawras Alali
- **Timezone:** Adelaide, South Australia
- **Role now:** leadership + approvals only; execution delegated to CEO
- **Preferred comms:** direct, no abbreviations, top-recommendation-first, "go" = approved

## The CEO position

- **Current CEO session:** the one writing this document.
- **New Claude project:** "Penworth CEO" (to be created by Founder; setup kit at `docs/orchestration/new-project-setup-kit.md`)
- **Authoritative mandate:** `docs/orchestration/ceo-mandate.md`
- **Operating playbook:** `docs/orchestration/ceo-playbook.md`
- **Claude Code runbook:** `docs/orchestration/claude-code-runbook.md`

## Active work — open tasks summary

Counts by status as of this document:

| Status | Count |
|---|---|
| open (I own) | ~9 |
| in_progress | 0 |
| blocked | 3 |
| awaiting_founder | ~11 |
| done | 1 (this session — CEO-001 voice_profile) |

See live state: `SELECT * FROM ceo_orchestration_tasks WHERE status != 'done' ORDER BY priority, created_at;`

## What the Founder needs to decide, in order of urgency

These are the `awaiting_founder` items the Founder will see on first daily brief after returning:

### Top of the list — needed within 48 hours

1. **CEO-021 (p0): Domain cutover** — written "go" to move penworth.ai DNS to new platform.
2. **CEO-017 (p0): Friendly-tester cohort** — hand-pick 5 testers for the Guild end-to-end dry run.
3. **CEO-014 (p1): Store seed books** — pick the 20 books that represent Penworth day one.

### This week

4. **CEO-023 (p1): Stripe Plus/Premium products** — confirm $9.99 and $19.99 final; I create in live mode.
5. **CEO-022 (p1): IP counsel engagement** — authorise Visual Audiobook + Cinematic Livebook provisionals.
6. **CEO-011 (p1): Anthropic tier upgrade** — authorise me to draft the email, or take the call yourself.
7. **CEO-018 (p1): Pen-test engagement** — authorise external firm ($15-25k).

### When convenient

8. **CEO-003 (p2): Book_title live verification** — 5 minutes of clicking.
9. **CEO-010 (p2): Tier 2 Nora probe** — 8 scenarios; you click, I verify.
10. **CEO-025 (p2): Compliance deletion** — answer 5 policy questions in the design doc.
11. **CEO-013 (p3): Help FAQ translations** — authorise external reviewers for 11 locales.

## What I'm doing next without asking

I have the Founder's blanket approval for these categories:

- Small bug fixes (email concat, audit log wiring, pre-push hook) — shipping this session
- Orchestration infrastructure (this table, docs, migration) — shipping this session
- Internal documentation, briefs for Claude Code
- Anything that doesn't touch production data, Stripe live mode, or DNS

## Shipped this session (2026-04-20 CEO session)

1. `cf8ecbc` — voice_profile persist fix (closes repo/DB inconsistency)
2. Migration `ceo_orchestration_tasks_foundation` — orchestration table live in Supabase
3. Backlog seeded into `ceo_orchestration_tasks` — 25 tasks from 4 handover documents, priority-ranked
4. Operating docs committed: mandate, playbook, runbook, state snapshot (this file), session rituals, new project setup kit

## Open threads I'm tracking

- **Email concat bug** in `lib/email/guild.ts` — CEO-006, shipping this session if time permits
- **Pre-push hook** (husky + tsc) — CEO-007, shipping this session if time permits
- **Audit log wiring on admin actions** — CEO-004, shipping this session if time permits
- **Command Center orchestration page** — CEO-002, will be a Claude Code brief, dispatched next session

## Known production risks (current)

None at P0 or P1 severity. The email spam storm from yesterday was fully contained by the DB dedup trigger (`alert_log_enforce_dedup_window_trigger`). The remaining bugs behind it (App Bug A, App Bug B) are P3 cleanup now that the trigger exists.

## Things never to assume

1. The Founder has read an earlier session's chat history. Always re-state.
2. A chat-to-chat handover pasted by the Founder is complete. Always verify against DB + repo.
3. A task in the backlog hasn't been worked on by another session. Always check `last_update_note`.

---

_This file is the CEO Claude's handoff to itself. Future sessions must start by reading it._
