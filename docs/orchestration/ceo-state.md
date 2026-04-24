# CEO State Snapshot

**Last updated:** 2026-04-24 08:20 UTC by CEO Claude session (claude-opus-4-7; CEO-038 shipped, CEO-034 and CEO-038 rows closed, alerts batch-acked, CEO-042/043/044/045 raised)
**Update frequency:** End of every CEO session.
**Purpose:** The CEO Claude's persistent memory between sessions. Read at start of every session.

---

## Recently shipped — 2026-04-24

**CEO-038 (p1): Content-type picker trimmed to Books + Other; document→book rename.**
Status: **done**. Commits `6e7ed57` (main work, −165 net lines across 4 files) + `880bff1` (follow-up fix for a missing `Sparkles` import + two in-file `document` strings the initial sweep missed). Deploy `dpl_jtoJ1k4Bx23QfL9sqWrUytMUdSpH` **READY** on `880bff1`. Scope: `lib/categories.ts` trimmed from 7 categories to 2 (Books + Other); screenplay dropped; poetry/short_story/essay_collection folded into Books; `CATEGORY_ID_TO_GRANT_MACRO` reduced to `{books: 'book'}`; `CONTENT_TYPE_LABELS` keeps historical non-book labels for back-compat; EN `lib/i18n/strings.ts` renamed `document`→`book` across ~28 product-speak keys; `research.uploadResearchDoc` and `firstConsent.intro` preserved because they refer to real document artefacts. Non-English locales deferred to CEO-044. **Lesson:** `tsc --noEmit` passed locally on `6e7ed57` but Next's full build caught the Sparkles-unused-import error. Must verify Vercel `readyState=READY` before declaring a commit shipped — adding to session-rituals next pass.

**CEO-039 Phase 2 foundation (p1): Shared prompt-bundle helpers.**
Commit `7c85889` in `penworth-new`. New file `lib/ai/prompt-bundle.ts` (402 lines): `fetchPromptBundle()` for all 6 remaining `resolve_*_prompt` RPCs, `interpolateTemplate()` for `{{var}}` + `{{#if var}}…{{/if}}`, `runValidatedCompletion()` with ajv schema compile + JSON parse + 3-attempt retry loop with progressive-error feedback in the retry prompt. Typechecks clean. Zero consumers yet — foundation for CEO-043 when each of the 6 remaining agents' shape strategy is decided by Founder. Already-live interview and outline routes keep their dedicated loaders (`interview-prompts-db.ts`, `outline-prompts-db.ts`); future cleanup can unify onto this module but that is not blocking.

**CEO-034 (p1): row closed.**
Task row was mislabelled `in_progress` for ~24h after the actual code half shipped 2026-04-23 via commit `4de3654`. Closed this session with full commit reference in the note. Outline route reads system/user/schema from `outline_prompts` via `resolve_outline_prompt` RPC; ajv-validated response; retry loop on schema failure. DB half (all 10 seeded rows, including non-book fallbacks) completed on the DB-only turn prior.

**CEO-042 cancelled — duplicate of CEO-041.**
Mid-session I opened CEO-042 for "Store hero metadata decision ask" without first searching existing titles. CEO-041 already covered the same work. Cancelled with pointer to CEO-041. Rule added to housekeeping: grep titles for the key noun phrase before creating a new row, not just `MAX(task_code)`.

**CEO-043 raised (p1, awaiting_founder): Wire remaining 6 Author-pipeline agents.**
Validate, Research, Writing, QA, Cover, Publishing. Each has a genuine output-shape mismatch between the existing route and the DB-seeded prompt — e.g. validate currently emits `{total, breakdown, verdict}` (numeric score); DB prompt emits `{approved, verdict, strengths, risks, missing, recommended_angle, reader_who_buys, comparable_books}` (no score by design). Three choices per agent: (A) extend DB prompt schema for legacy fields, (B) migrate UI/persistence to new schema, (C) ship a translation layer in the route. CEO refused to invent fake legacy fields — that's fabrication. Recommend one agent per session starting with Research (closest to clean swap) and deferring Writing (inside a 941-line Inngest function).

**CEO-044 raised (p2, open, ceo): Non-English locale pass.**
CEO-038 rename shipped EN-only. During the sweep it surfaced that most non-English bundles leave `editor.document` and friends as the literal English word — the underlying coverage gap is bigger than the rename. This task covers both: translate the rename and audit untranslated-literal-English keys per locale. ~280 translations across 10 locales.

**CEO-045 raised (p3, open, ceo): `supabase/migrations/` repo folder is 50 migrations behind DB ledger.**
DB is authoritative via Supabase MCP `apply_migration`, and the repo folder is purely audit-trail mirror, but it now stops at `026_retire_escalate_to_user_bump_retry_ceiling.sql` while the DB has another 50 migrations (CEO-030 privacy + CEO-033 interview + CEO-034 outline + CEO-038 narrowing + CEO-039 Phase 1 full 32-seed matrix + the v2 cover typography layer). ~30 minutes: query ledger, write files, one commit. Worth doing before any external audit.

**Alert hygiene:** 9 unacked alerts from 2026-04-23 batch-acked this session after tracing every one back to two pre-monitoring-era Founder test sessions (`17074449…`, `1644b104…`). All 10 source incidents already resolved (7 auto-retry-recovered, 3 closed manually last week). Zero production signal.

### Earlier 2026-04-24 sessions

**CEO-040 (p2): Store hero copy — "The book that performs" / Livebook focus.**
Status: **done**. Commit `79f0d16` in `penworth-store` repo. Deploy `dpl_B9kkhfyfrDLZrAChkmCa2a4mBjN7` READY. Live on `https://store.penworth.ai`. Replaces the generic exclusivity headline with a differentiator-first line foregrounding the Livebook format. Founder-approved copy 2026-04-23.

**CEO-031 Part A (p0): Retire `escalate_to_user`, retry cap 3→5.**
Status: Part A **shipped**; row stays `in_progress` for Part B. Commit `2ef997c` in `penworth-new` (rebased cleanly on top of `4de3654`). Migration `026_retire_escalate_to_user_bump_retry_ceiling.sql` in repo; applied live on Supabase. Deploy `dpl_68WbtatRZcVqnULNfVE9ikMgEj3J` READY. Behaviour change: **no author-facing stuck-agent emails will ever fire again** — terminal state always escalates to founder via ops alert stream. `pipeline_should_auto_retry` DB function verified to contain zero references to `escalate_to_user`.

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

## Production health — verified 2026-04-24 08:20 UTC

| Signal | State |
|---|---|
| `penworth.ai` (writer, apex post-CEO-021 cutover) | READY at `880bff1` |
| `store.penworth.ai` | READY at `79f0d16` |
| `guild.penworth.ai` (shares penworth-new) | READY at `880bff1` |
| 10 language landings | READY, each on its own latest SHA |
| Supabase migrations in repo | latest: `026_retire_escalate_to_user_bump_retry_ceiling.sql` (50 behind DB ledger — see CEO-045) |
| Stuck sessions now | 0 |
| Open incidents | 0 |
| Webhook failures 24h | 0 |
| Unacked alerts 24h | 0 (9 batch-acked this session; all traced to resolved pre-monitoring test sessions) |
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

Live counts at session close (2026-04-24 08:20 UTC):

| Status | Count |
|---|---|
| open (I own) | 11 |
| in_progress (I own) | 1 (CEO-031 Part B) |
| blocked | 3 |
| awaiting_founder | 13 |

See live state: `SELECT * FROM ceo_orchestration_tasks WHERE status != 'done' ORDER BY priority, created_at;`

## What the next session should do first

Priority-ordered, executable without founder involvement:

1. **CEO-031 Part B (p0): interview UX polish** — 1-second chapter-count overlay flash + running "Questions answered: N" counter. UI work; fresh context window recommended.
2. **CEO-005 (p1): Recipients CRUD UI in Command Center.** ~300 lines, 5 files; full brief in row.
3. **CEO-016 (p1): Mentor agent UI.** ~700 lines, 10 files; full brief in row. Backend prereq verification needed before UI merge (zero production PD sessions yet).
4. **CEO-044 (p2): non-English locale pass for CEO-038 rename + broader untranslated-literal-English audit across 10 locales.** ~280 translations; plausibly dispatchable to Claude Code once the brief is written.
5. **CEO-045 (p3): sync `supabase/migrations/` folder with DB ledger.** 50 migrations behind. ~30 min; audit-trail hygiene, not blocking.

If Founder has returned an answer on CEO-041 (metadata copy) or CEO-043 (per-agent shape strategy for the 6 remaining Author-pipeline agents), those jump to the top.

## What the Founder needs to decide

### Top of the list

1. **CEO-017 (p0): Friendly-tester cohort** — hand-pick 5 testers for the Guild end-to-end dry run.
2. **CEO-014 (p1): Store seed books** — pick the 20 books that represent Penworth day one.
3. **CEO-043 (p1): Author-pipeline agent wiring strategy** — pick (A) extend DB schema / (B) migrate UI / (C) translation layer for each of the 6 remaining agents (Validate, Research, Writing, QA, Cover, Publishing). Recommend one-agent-per-session starting with Research.
4. **CEO-041 (p2): Store metadata copy** — approve (or edit) the proposed new page-title/description/OG/Twitter strings. One-line commit on "go on metadata".

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

- **Vercel readyState is the shipping gate.** `tsc --noEmit` does not catch unused-import errors that Next's full build does. End-of-session checklist must include "Vercel deploy `readyState=READY` on the final SHA" before declaring shipped. `6e7ed57` passed tsc locally and errored on Vercel; `880bff1` followed as the fix.
- **String-rename sweeps scan the whole repo, not only the file the brief names.** `lib/i18n/strings.ts` was the brief's pointer for CEO-038 but two `document` occurrences inside `app/(dashboard)/projects/new/page.tsx` were missed on the first pass. `grep -iE "<token>" --include=*.ts --include=*.tsx -r .` is the rule.
- **Single-row bare UPDATEs for critical status transitions through Supabase MCP.** A multi-statement UPDATE returning multiple rows silently dropped the `status` write on CEO-038 while landing the `last_update_note` append. Subsequent bare `UPDATE … WHERE task_code = 'CEO-038' RETURNING …` worked. Use one bare UPDATE per row for status transitions, and SELECT-verify before ending the session.
- **Before creating a new task row, grep existing titles for the key noun phrase.** `MAX(task_code) + 1` is not enough — I created CEO-042 duplicating CEO-041 because I only read codes, not descriptions. Cancelled CEO-042 mid-session with a pointer to the canonical row.

## Housekeeping from prior sessions

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
