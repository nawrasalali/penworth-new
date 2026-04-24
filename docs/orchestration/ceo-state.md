# CEO State Snapshot

**Last updated:** 2026-04-24 04:19 UTC by CEO Claude session (claude-opus-4-7; CEO-040 hero copy + CEO-031 Part A pipeline policy)
**Update frequency:** End of every CEO session.
**Purpose:** The CEO Claude's persistent memory between sessions. Read at start of every session.

---

## Recently shipped — 2026-04-24

**CEO-040 (p2): Store hero copy — "The book that performs" / Livebook focus.**
Status: **done**. Commit `79f0d16` in `penworth-store` repo. Deploy `dpl_B9kkhfyfrDLZrAChkmCa2a4mBjN7` READY. Live on `https://store.penworth.ai`. Replaces the generic exclusivity headline with a differentiator-first line foregrounding the Livebook format. Founder-approved copy 2026-04-23.

**CEO-031 Part A (p0): Retire `escalate_to_user`, retry cap 3→5.**
Status: Part A **shipped**; row stays `in_progress` for Part B. Commit `2ef997c` in `penworth-new` (rebased cleanly on top of `4de3654`). Migration `026_retire_escalate_to_user_bump_retry_ceiling.sql` in repo; applied live on Supabase. Deploy `dpl_68WbtatRZcVqnULNfVE9ikMgEj3J` READY. Behaviour change: **no author-facing stuck-agent emails will ever fire again** — terminal state always escalates to founder via ops alert stream. `pipeline_should_auto_retry` DB function verified to contain zero references to `escalate_to_user`.

**CEO-034 (p1): Outline agent wired to `resolve_outline_prompt` RPC + ajv schema validation.**
Status: **shipped by another CEO session during 2026-04-24** — commit `4de3654`, deploy `dpl_2arwsJFaJbidTvEjvzpcQNors6Ya` READY. Files: `app/api/ai/outline/route.ts` (592-line rewrite), `lib/ai/outline-prompts-db.ts` (new helper with ajv-based JSON schema validation and retry-with-errors loop), `package.json` (ajv dep). CEO-039 DB-seeded prompts for non-fiction / fiction / memoir now used end-to-end at runtime.

**CEO-021 (p0): DNS cutover** — verified still holding 72 hours after prior-session execution. Apex 200, www + new 308 → apex, store 200. Row was already `done`.

**CEO-041 raised (p2, awaiting_founder): Store metadata copy rewrite.**
Spawned as follow-up to CEO-040. `app/layout.tsx` page title, meta description, OG title, OG description, Twitter title all still mirror the old "Books you will not find anywhere else" / "Stories written this year…" framing. Proposed replacement already in task row. Ships on "go on metadata".

## Recently shipped — 2026-04-22

**CEO-030 (p0): Privacy correction — remove reader-ownership promise + covenant framing.** Status: **done**. Handover at `docs/orchestration/handovers/2026-04-22-privacy-rework-complete.md`.

Scope: reverse the prior design that promised authors ownership of reader data (name, email, country, reading progress) delivered via CSV export. Privacy liability under GDPR / Australian Privacy Act. Shipped end-to-end in three commits + one DB migration:

- `penworth-store` `c1a3572` — deleted CSV endpoint, author-readers dashboard, covenants page, FiveCovenants component, SharingToggle. Rewrote ~20 pages removing covenant language.
- `penworth-store` `fefbe2d` — column-drop hygiene, deleted reader-settings endpoint, stripped `share_email_with_authors` from remaining consumers.
- `penworth-new` `51c70f0` — writer landing benefit "Your own readers" → "Distribution included" (en + ar MSA). Arabic grammar `الأيدي السَّبع` → `الأيادي السبعة`.
- DB migration `drop_reader_privacy_vestiges` — dropped `store_readers.share_email_with_authors` and `store_purchases.reader_pseudonym`. Privacy posture documented in table comments.

Verified: both Vercel deploys READY; RLS on `store_readers` blocks author access (the previous leak was application-layer only via service-role bypass); advisors show no new warnings.

Note on task codes: commit messages reference CEO-014 — I conflated with the existing catalogue-seeding task. Permanent record is CEO-030.

**CEO-012 (p2): Marketing copy** — literary rewrite shipped earlier on 2026-04-22 across all 13 domains. Status: `awaiting_founder` (pending native-speaker review for 10 non-English landings, tracked as CEO-013).

---

## Production health — verified 2026-04-24

| Signal | State |
|---|---|
| `penworth.ai` (writer, apex post-CEO-021 cutover) | READY at `2ef997c` |
| `store.penworth.ai` | READY at `79f0d16` |
| `guild.penworth.ai` (shares penworth-new) | READY at `2ef997c` |
| 10 language landings | READY, each on its own latest SHA |
| Supabase migrations in repo | latest: `026_retire_escalate_to_user_bump_retry_ceiling.sql` |
| Stuck sessions now | 0 |
| Open incidents | 0 |
| Webhook failures 24h | 0 |
| Unacked alerts 24h | 9 (dedup trigger holding) |
| Author-facing stuck-agent emails | disabled platform-wide as of `2ef997c` (CEO-031) |

## Founder context

- **Name:** Nawras Alali
- **Timezone:** Adelaide, South Australia
- **Role now:** leadership + approvals only; execution delegated to CEO
- **Preferred comms:** direct, no abbreviations, top-recommendation-first, "go" = approved

## The CEO position

- **Current CEO session:** the one writing this document.
- **Claude project:** "Penworth CEO" (active)
- **Authoritative mandate:** `docs/orchestration/ceo-mandate.md`
- **Operating playbook:** `docs/orchestration/ceo-playbook.md`
- **Claude Code runbook:** `docs/orchestration/claude-code-runbook.md`
- **Session rituals:** `docs/orchestration/session-rituals.md`

## Active work — open tasks summary

Live counts at session close:

| Status | Count |
|---|---|
| open (I own) | 12 |
| in_progress (I own) | 2 (CEO-031 Part B, CEO-039 poetry seed tail) |
| blocked | 3 |
| awaiting_founder | 11 |

See live state: `SELECT * FROM ceo_orchestration_tasks WHERE status != 'done' ORDER BY priority, created_at;`

## What the next session should do first

Priority-ordered, executable without founder involvement:

1. **CEO-038 (p1): content_type picker allowlist + document→book locale sweep.** Fully specified in task row. ~60 min. Prior-session commitment: "first thing shipped the moment bash is in toolbox." Now it is.
2. **CEO-031 Part B (p0): interview UX polish** — 1-second chapter-count overlay flash + running "Questions answered: N" counter. UI work, needs a fresh context window.
3. **CEO-005 (p1): Recipients CRUD UI in Command Center.** ~300 lines, 5 files; full brief in row.
4. **CEO-016 (p1): Mentor agent UI.** ~700 lines, 10 files; full brief in row. Backend prereq verification needed before UI merge (zero PD sessions have run end-to-end in production).

## What the Founder needs to decide

### Top of the list

1. **CEO-017 (p0): Friendly-tester cohort** — hand-pick 5 testers for the Guild end-to-end dry run.
2. **CEO-014 (p1): Store seed books** — pick the 20 books that represent Penworth day one.
3. **CEO-041 (p2): Store metadata copy** — approve (or edit) the proposed new page-title/description/OG/Twitter strings. One-line commit on "go on metadata".

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

## Housekeeping captured this session

- Git author identity for commits from any `/tmp/penworth-*` sandbox MUST be `nawrasalali <119996438+nawrasalali@users.noreply.github.com>`. Any other author triggers Vercel's team seat-block `COMMIT_AUTHOR_REQUIRED` and the deploy errors with no build events. Both `/tmp/penworth-store` and `/tmp/penworth-new` have this persisted in their git config; re-set on fresh clone.
- Remote needs the PAT embedded: `git remote set-url origin "https://${GITHUB_PAT}@github.com/nawrasalali/<repo>.git"`.
- `penworth-new` has a husky pre-push hook running `tsc --noEmit`. Respect it.
- `~/.env_ceo` in the sandbox persists `VERCEL_API_TOKEN` and `GITHUB_PAT`, sourced from `~/.bashrc`. Use `. ~/.env_ceo` (bash_tool's `sh` doesn't have `source`).
- Repo `supabase/migrations/` numbering is behind live DB. Repo uses `NNN_` sequential (now at 026); Supabase uses YYYYMMDDhhmmss. When committing a repo migration, note in-file that it was applied live on a specific date — the file is for audit trail, not re-run.

## Things never to assume

1. The Founder has read an earlier session's chat history. Always re-state.
2. A chat-to-chat handover pasted by the Founder is complete. Always verify against DB + repo.
3. A task in the backlog hasn't been worked on by another session. Always check `last_update_note`.

---

_This file is the CEO Claude's handoff to itself. Future sessions must start by reading it._
