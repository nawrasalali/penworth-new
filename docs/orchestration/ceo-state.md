# CEO State Snapshot

**Last updated:** 2026-04-22 by CEO Claude session (privacy rework complete)
**Update frequency:** End of every CEO session.
**Purpose:** The CEO Claude's persistent memory between sessions. Read at start of every session.

---

## Recently shipped — 2026-04-22

**CEO-030 (p0): Privacy correction — remove reader-ownership promise + covenant framing.**
Status: **done**. Handover at `docs/orchestration/handovers/2026-04-22-privacy-rework-complete.md`.

Scope: reverse the prior design that promised authors ownership of reader data (name, email,
country, reading progress) delivered via CSV export. Privacy liability under GDPR / Australian
Privacy Act. Shipped end-to-end in three commits + one DB migration:

- `penworth-store` `c1a3572` — deleted CSV endpoint, author-readers dashboard, covenants
  page, FiveCovenants component, SharingToggle. Rewrote ~20 pages removing covenant language.
- `penworth-store` `fefbe2d` — column-drop hygiene, deleted reader-settings endpoint,
  stripped `share_email_with_authors` from remaining consumers.
- `penworth-new` `51c70f0` — writer landing benefit "Your own readers" → "Distribution
  included" (en + ar MSA). Arabic grammar `الأيدي السَّبع` → `الأيادي السبعة`.
- DB migration `drop_reader_privacy_vestiges` — dropped `store_readers.share_email_with_authors`
  and `store_purchases.reader_pseudonym`. Privacy posture documented in table comments.

Verified: both Vercel deploys READY; RLS on `store_readers` blocks author access (the
previous leak was application-layer only via service-role bypass); advisors show no new
warnings.

Note on task codes: commit messages reference CEO-014 — I conflated with the existing
catalogue-seeding task. Permanent record is CEO-030.

**CEO-012 (p2): Marketing copy** — literary rewrite shipped earlier on 2026-04-22 across
all 13 domains. Status: `awaiting_founder` (pending native-speaker review for 10 non-English
landings, tracked as CEO-013).

---

## Production health — verified 2026-04-22

| Signal | State |
|---|---|
| penworth.ai (writer) | READY at `51c70f0` |
| store.penworth.ai | READY at `fefbe2d` |
| guild.penworth.ai | READY (shares penworth-new repo, at `51c70f0`) |
| 10 language landings | READY, each on its latest SHA |
| Supabase migrations applied | latest: `drop_reader_privacy_vestiges` (this session) |
| Active incidents | 0 |
| Privacy-critical issues | 0 |

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
