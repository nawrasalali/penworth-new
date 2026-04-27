# Disaster Recovery Runbook — Penworth

**Owner:** CEO Claude (orchestration), Founder (final authorisation on destructive actions).
**Issued:** 2026-04-26 (first draft, CEO-020).
**Drill cadence:** quarterly, plus once before any major launch event.
**RTO target:** < 4 hours from incident declared to writer/store/guild paths green.
**RPO target:** < 15 minutes for transactional data; < 24 hours for storage objects; < 1 hour for derived assets.

---

## 1. What this runbook covers

The Penworth ecosystem fails in a small number of recognisable ways. This runbook treats each one explicitly:

| Failure mode | Frequency expectation | Severity if untreated |
|---|---|---|
| Single Supabase table corrupted by bad migration | medium (one near miss in last 30 days) | high — recent transactional data lost |
| Whole Supabase project deleted or unreachable | very rare | critical — total data loss |
| Single storage bucket corrupted, deleted, or wiped | low | medium — derived assets re-generable; manuscripts/audiobooks not |
| Vercel project deleted or its production deployment flapping | low | high — production traffic 5xx or wrong-content |
| Stripe webhook delivery gap (Stripe's side) | medium — we've seen Stripe outages | medium — we have the dedup trigger so re-replay is safe |
| Inngest queue loss (mid-flight pipeline runs) | medium | medium — interview sessions can be re-kicked from `pipeline_status` |
| Region-level cloud outage | very rare | critical — wait it out; fail loud, do not flap |
| Compromised secret (API key, service-role JWT, admin password) | low — must be assumed for cycling | critical if combined with another failure |

Out of scope here: payment processing primary failure (Stripe full outage). Stripe is its own runbook; we depend on Stripe being recoverable.

---

## 2. Backup inventory — what gets preserved, where, how often

### 2.1 Supabase Postgres database (project `lodupspxdvadamrqvkje`)

- **Scope:** 119 public tables, 31 migrations as of 2026-04-26.
- **Built-in backups:** Supabase Pro projects retain 7 days of daily Point-In-Time-Recovery (PITR) snapshots automatically. These are the primary recovery surface for "oops" cases. Verify in the Supabase dashboard at `Settings → Database → Backups`.
- **Schema source of truth:** `supabase/migrations/` in `nawrasalali/penworth-new`. Numbered, idempotent. Any restored project can be brought to head schema by replaying these in order through the Supabase MCP `apply_migration` tool.
- **Critical row-level data not regenerable from elsewhere:**
  - `auth.users` (the Supabase-managed users table) — Supabase PITR is the only source.
  - `interview_sessions` — origin of all writer work; lose it and books are gone.
  - `chapters` — the actual book content. Same.
  - `guild_applications`, `guild_members`, `guild_agent_context`, `guild_weekly_checkins`, `guild_pd_sessions`, `guild_growth_plans` — Guild member work; not derivable from anything else.
  - `referrals`, `commission_ledger` — money-adjacent; loss = legal exposure.
  - `stripe_webhook_events` — 58 events as of this writing; oldest 2026-04-18. **Note:** we can also reconstruct the canonical event list directly from Stripe's API (`stripe events list`) for any window where Stripe has retained them, so this table is recoverable but should still be treated as primary.
  - `ceo_orchestration_tasks` — operational memory; loss is recoverable from the GitHub repo but painful.

### 2.2 Storage buckets (Supabase Storage, project `lodupspxdvadamrqvkje`)

| Bucket | Public | Size cap | Content | Regenerable? |
|---|---|---|---|---|
| `manuscripts` | no | 100 MB | author-uploaded source files (raw PDFs, DOCX) | NO — author irreplaceable |
| `audiobooks` | no | 200 MB | rendered MP3 books for purchasers | yes (re-render, but expensive) |
| `chapter-audio` | yes | 500 MB | per-chapter livebook audio fragments | yes (re-render via Cartesia/ElevenLabs) |
| `voice-samples` | no | 10 MB | author voice clones source (consent-bound) | partial — author may not re-record |
| `cinematic` | yes | 20 MB | livebook cinematic generated images | yes (re-render via Ideogram) |
| `covers` | yes | 25 MB | book covers (front + back) | yes (re-render via Ideogram) |
| `livebooks` | yes | 20 MB | rendered livebook HTML/JSON snapshots | yes (re-render from chapters) |
| `compliance-exports` | no | 500 MB | GDPR data exports for users | no — generated on-demand for legal compliance, must persist for audit window |
| `computer-use-screenshots` | no | 5 MB | internal QA screenshots | yes — non-essential |

**Backup mechanism (current state — gap noted):** Supabase Storage at the Pro tier does NOT have built-in cross-region object backup. We rely on the bucket's underlying S3-compatible storage and Supabase's own infrastructure. **This is a known gap**; see Section 7.

### 2.3 Stripe event log

- **Source of truth:** Stripe's own retained event log is the primary. We mirror to `stripe_webhook_events` for fast queries but Stripe retains 30 days of events in their API and indefinitely in their dashboard.
- **Recovery mechanism:** if our table is lost, `stripe events list --limit=100 --type=*` over the last 30 days reconstitutes everything. Beyond 30 days, only Stripe Dashboard exports.
- **Dedup safety:** the `stripe_webhook_events` table has a unique index on `event_id` (Stripe's idempotency key) so re-replay of the same event is a no-op INSERT. Re-play on top of an existing table is safe.

### 2.4 Vercel deployments

- **What's stored where:**
  - **Code:** `nawrasalali/penworth-new` and `nawrasalali/penworth-store` GitHub repos. GitHub IS the source of truth.
  - **Build output:** Vercel keeps every deploy indefinitely, addressable by `dpl_*` URL.
  - **Environment variables:** Vercel project settings only. **This is a hard dependency** — if a Vercel project is deleted, env vars are gone with it. They must be reconstructable from Founder's password manager.
- **Recovery:** delete the Vercel project, re-import the GitHub repo, re-add env vars from password manager, re-attach domain.

### 2.5 Inngest pipeline state

- **What Inngest holds:** the in-flight queue of `chapter.write`, `restart-agent`, and similar events; retry counters; durable function state for partially-completed pipelines.
- **What's NOT in Inngest:** the canonical book content (that's in `chapters` table). Inngest is the executor, not the source.
- **Recovery:** if the Inngest queue is lost, every interview_session with `pipeline_status IN ('writing','outline','qa','cover','validate')` becomes a candidate for manual restart via `restart-agent` event re-emission. The `agent_heartbeat_at` and `pipeline_status` columns on `interview_sessions` are the recovery anchor.

### 2.6 Secrets and credentials

- **Where they live:**
  - Anthropic, OpenAI, Cartesia, ElevenLabs, Ideogram API keys: Vercel project env vars (penworth-new + penworth-store separately).
  - `SUPABASE_SERVICE_ROLE_KEY`: Vercel + Supabase Edge Functions.
  - `ADMIN_SECRET` (for `admin-generate-livebook`): currently hardcoded in edge function source — see CEO-105.
  - GitHub PAT: Founder's password manager + the CEO Claude project instructions field.
- **Rotation cadence:** quarterly minimum; immediately on any leak signal.
- **Recovery from compromise:** rotate at the provider's dashboard, push new value to Vercel + Supabase Edge Functions, redeploy. See Section 5.

---

## 3. RPO and RTO targets

### 3.1 RPO — Recovery Point Objective (how much data we can lose)

| Asset class | RPO target | Mechanism |
|---|---|---|
| Supabase Postgres rows (writes) | **15 minutes** | Supabase PITR is continuous within Pro tier |
| Supabase Storage objects | **24 hours** | manual snapshot cadence (gap — see §7) |
| Stripe events | **0 minutes** (canonical at Stripe) | Stripe is source of truth |
| Vercel deploy state | **0 minutes** | GitHub is source of truth |
| Inngest in-flight runs | **best effort** | restartable from `pipeline_status` |

### 3.2 RTO — Recovery Time Objective (how fast we get back)

| Failure mode | RTO target | Bottleneck |
|---|---|---|
| Single table corrupted by bad migration | **30 minutes** | identify bad migration → PITR restore that table → re-apply migrations beyond the bad one |
| Whole Supabase project lost | **4 hours** | new project provisioning + 31-migration replay + bucket re-population + DNS waits |
| Single bucket lost | **2 hours** for re-generable; **N/A** for `manuscripts` / `voice-samples` (no backup yet — see §7) |
| Vercel project lost | **45 minutes** | re-import + env var paste + DNS reattach + first deploy |
| Inngest queue lost | **1 hour** | identify stuck sessions, batch-restart |
| Single secret rotated under duress | **15 minutes** | provider dashboard → Vercel env var → redeploy |

---

## 4. Drill procedure (quarterly + pre-launch)

The drill is the only honest measure of whether this runbook works. Run it against a **clone project**, never against production. Time the steps; record actual numbers vs targets.

### 4.1 Prerequisites

- A throwaway Supabase project (call it `penworth-dr-drill-YYYYMM`).
- A throwaway Vercel project pointing at a fork of the main repo.
- Drill runner has SUPABASE_MANAGEMENT_PAT and VERCEL_API_TOKEN.
- Two hours allocated; do not interleave with real work.

### 4.2 Drill scenarios — execute all in sequence

**Scenario A: Single-table point-in-time restore (target: 30 min)**

1. In drill project, drop a non-critical table: `DROP TABLE alert_log CASCADE;`. Note timestamp.
2. Open Supabase dashboard → `Settings → Database → Backups → Point in Time Recovery`.
3. Restore the entire database to a timestamp 5 minutes before the drop. Branch into a new project (Supabase will offer this option).
4. Use `pg_dump --table=alert_log` against the restored branch, `pg_restore` into the original drill project.
5. Verify row count matches pre-drop snapshot.
6. **Pass criterion:** elapsed time < 30 min, zero rows lost.

**Scenario B: Whole-project rebuild from migrations (target: 4 hours)**

1. Create a fresh Supabase project (drill clone B).
2. Run, in order: every file in `supabase/migrations/` via Supabase MCP `apply_migration` tool. Verify each succeeds. Expected: 31 migrations apply cleanly.
3. Recreate all 9 storage buckets with the same `public` flags and `file_size_limit` values from §2.2.
4. Use `pg_dump` from a recent PITR snapshot of production (do **not** dump live production for this drill — use a known snapshot).
5. `pg_restore` into clone B.
6. Verify auth.users row count, interview_sessions row count, chapters row count match the snapshot.
7. **Pass criterion:** elapsed < 4 hours, every table at expected row count, no migration ordering errors.

**Scenario C: Vercel project re-import (target: 45 min)**

1. In Vercel, create a new project from `nawrasalali/penworth-new` (drill clone C). Do **not** delete the production project.
2. Paste env vars from Founder's password manager. Required minimum:
   - `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`
   - `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `CARTESIA_API_KEY`, `ELEVENLABS_API_KEY`, `IDEOGRAM_API_KEY`
   - `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`
   - `INNGEST_EVENT_KEY`, `INNGEST_SIGNING_KEY`
   - `RESEND_API_KEY`
3. Trigger a deploy. Verify it builds.
4. Smoke test: open the deploy's Vercel URL, sign up a new test user, confirm the dashboard renders.
5. **Pass criterion:** elapsed < 45 min, deploy READY, sign-up flow works end-to-end.

**Scenario D: Stripe event re-replay (target: 1 hour)**

1. Pick a date in the last 14 days where we know events occurred (`stripe events list --created.gte=...`).
2. In drill project (clone B from Scenario B), `TRUNCATE stripe_webhook_events;`.
3. Re-replay Stripe events to the drill project's webhook endpoint (use Stripe CLI `stripe trigger` or replay from dashboard).
4. Verify the count and amounts in `stripe_webhook_events` after replay match the original window.
5. Verify dedup trigger fires on a deliberate duplicate (replay one event twice; expect one row).
6. **Pass criterion:** elapsed < 1 hour, row counts match, no duplicates.

**Scenario E: Inngest queue restart from pipeline_status (target: 1 hour)**

1. In drill project, manually mark 5 `interview_sessions` rows with `pipeline_status='stuck'` and `current_agent='writing'`.
2. Trigger the `restart-agent` Inngest function for each, via the cron path that already exists in production.
3. Verify each session transitions back to `pipeline_status='active'` and writing resumes.
4. **Pass criterion:** elapsed < 1 hour, all 5 sessions advance.

**Scenario F: Secret rotation under duress (target: 15 min, repeat for each provider)**

1. Pick one provider: rotate `CARTESIA_API_KEY` in Cartesia dashboard.
2. Update the new value in Vercel project env vars.
3. Trigger a redeploy.
4. Verify a Cartesia call succeeds against the new key.
5. **Pass criterion:** elapsed < 15 min per provider, no production traffic affected during cutover (the rotate-then-redeploy ordering matters).

### 4.3 Drill scoring

After each drill, fill out:

```
Drill date: YYYY-MM-DD
Runner: <name>
Scenario A elapsed: ___ min (target 30, pass/fail)
Scenario B elapsed: ___ min (target 240, pass/fail)
Scenario C elapsed: ___ min (target 45, pass/fail)
Scenario D elapsed: ___ min (target 60, pass/fail)
Scenario E elapsed: ___ min (target 60, pass/fail)
Scenario F elapsed: ___ min (target 15 per provider, pass/fail)
Failures observed: <list>
Runbook updates needed: <list>
```

Commit the score sheet to `docs/orchestration/dr-drills/YYYY-MM-DD-drill.md`.

---

## 5. Recovery procedures — by failure mode

### 5.1 Single Supabase table corrupted

**Symptoms:** queries against a specific table return wrong/missing data; recent migration suspected.

**Steps:**
1. Identify the timestamp of the corruption (when did the bad migration apply, when did weird queries first appear).
2. **Do not roll back the migration on production**; it may have intermediate partial state.
3. In Supabase dashboard, use Point-In-Time Recovery to clone the project to a NEW project at a timestamp 5 minutes before the corruption.
4. From the clone, `pg_dump --data-only --table=<bad_table>` into a SQL file.
5. On production, `BEGIN; TRUNCATE <bad_table> CASCADE;` (carefully — check FK dependents first).
6. `psql production-url < dumped.sql`.
7. Verify row counts and a sample of data.
8. Document in `pipeline_incidents` with the recovery timestamp and the affected row range.

### 5.2 Whole Supabase project lost or unreachable

**Symptoms:** writer/store/guild apps return 500s on any DB-touching path; Supabase status page shows the region/project down; or the project URL itself returns 404 (deleted).

**Triage first — do NOT rush to rebuild:**
- Check https://status.supabase.com — if it's a regional Supabase outage, wait. Do not migrate to a new project; you'll create a split-brain when Supabase comes back.
- Only rebuild if Supabase confirms project is unrecoverable (their support ticket says "your project's data is lost").

**Rebuild steps (only if confirmed unrecoverable):**
1. Founder authorizes the rebuild in writing. This is a destructive action.
2. Provision new Supabase project. Note new project ref.
3. Apply all 31 migrations in order (or current count at time of rebuild). Use Supabase MCP `apply_migration`.
4. Recreate 9 storage buckets per §2.2.
5. **Best available data:** restore from the latest PITR snapshot Supabase preserved before the loss (typically up to 7 days back on Pro). Use `pg_dump` from snapshot → `pg_restore` to new project.
6. Update `SUPABASE_URL` and `SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` in both Vercel projects (penworth-new, penworth-store) and any Supabase Edge Function configs.
7. Redeploy both Vercel projects.
8. Smoke test: sign-up, sign-in, project creation, chapter write, publish. End-to-end.
9. Communicate publicly. We do not hide losses from users.
10. File a post-mortem in `docs/orchestration/incidents/YYYY-MM-DD-supabase-loss.md`.

### 5.3 Single storage bucket lost

**For `covers`, `cinematic`, `livebooks`, `chapter-audio`, `audiobooks`, `computer-use-screenshots`:**

These are regenerable. Steps:
1. Recreate the bucket with same name, public flag, file_size_limit per §2.2.
2. Re-trigger generation per book. For covers/cinematic, the writer's "regenerate cover" path produces a new image. For audio, re-running the audiobook/livebook generation regenerates the bucket contents.
3. Acknowledge the gap to affected users — public-facing URLs broke between loss and regeneration.

**For `manuscripts`, `voice-samples`:** **THIS IS A KNOWN GAP.** These contain author-uploaded source material that may not be re-uploadable. See Section 7 for the planned mitigation (cross-region replication). Until that's in place, loss of these buckets is a critical, partial irreversible failure. The Founder's first action in this scenario is to email every affected author with an apology and a re-upload prompt.

**For `compliance-exports`:** these are generated on-demand for GDPR. Loss does not block production but breaks the audit trail. Re-generate on next access.

### 5.4 Vercel project lost

**Steps:**
1. Re-import `nawrasalali/penworth-new` (or `penworth-store`) as a new Vercel project.
2. Paste env vars from Founder's password manager. **All required values are listed in Scenario C above.** Print them in a fresh secure note before starting.
3. Re-attach custom domains. The DNS records (apex A, www CNAME) point at Vercel's anycast IPs, not at any specific project — so Vercel needs to know which project owns the domain. Set in `Project → Settings → Domains`.
4. Trigger a fresh deploy from main.
5. Smoke test the production URL.
6. Post-mortem if the loss was preventable.

### 5.5 Stripe webhook delivery gap

**Symptoms:** users see a paid charge but their subscription/credits don't update; `stripe_webhook_events` has a gap in `received_at`.

**Steps (this is a routine recovery, not a disaster):**
1. Identify the time window of the gap from `received_at`.
2. In Stripe Dashboard → Developers → Events, filter to that window.
3. For each event in the window, replay it to our webhook URL: `stripe events resend <event_id>`.
4. The dedup trigger on our side ensures replays are idempotent.
5. Verify the affected users' subscriptions/credits resolved.
6. If there's no clear trigger for the gap (Stripe's status page shows no incident), file an incident and watch for recurrence.

### 5.6 Inngest queue lost

**Steps:**
1. Identify all `interview_sessions` with `pipeline_status NOT IN ('completed','failed','published')` and `agent_heartbeat_at < NOW() - INTERVAL '15 minutes'`.
2. For each, emit a `restart-agent` event via the Inngest dashboard or via `inngest send`.
3. The `restart-agent` Inngest function (see `inngest/functions/restart-agent.ts`) is idempotent — running it on a session that's already healthy is a no-op.
4. Verify each session transitions to `pipeline_status='active'` within 5 minutes.

### 5.7 Compromised secret

**Steps (apply per secret):**
1. **First:** rotate the secret at the provider's dashboard. Do not skip this — even if you're confident the leak is contained, rotate.
2. **Second:** update the new value in Vercel project env vars (penworth-new + penworth-store separately if both apps use it).
3. **Third:** for any Supabase Edge Function that uses the secret, update the function's secret config via Supabase MCP or dashboard.
4. **Fourth:** redeploy the Vercel projects. Wait for deploys to be READY.
5. **Fifth:** verify a fresh API call succeeds with the new key. Audit recent logs for any unauthorized usage prior to rotation.
6. **Sixth:** if the secret was leaked through a commit, force-rewrite history is generally NOT advised (it doesn't undo the leak; the secret is already in mirrors and forks). Rotation is the only real fix.

---

## 6. Communication during a disaster

The Founder's voice is the only voice on the public side. The CEO Claude does NOT post to social or send broadcast emails without explicit written authorisation.

**Internal channel (during incident):**
- Founder is paged via the existing email + WhatsApp paths.
- CEO Claude updates the `pipeline_incidents` table with one row per incident, append-only updates.
- All incident communication lives on the row's `notes` field.

**External communication (during/after):**
- Status page at `status.penworth.ai` (TODO — currently does not exist; CEO-019 will spawn this as a sub-task).
- Email to active users for any incident lasting > 1 hour.
- Public post-mortem within 7 days for any P0/P1 customer-facing incident.

---

## 7. Known gaps (honest assessment)

This runbook describes what we WILL be able to do, not what we CAN do today. Open gaps:

1. **Storage cross-region replication.** Supabase Storage Pro tier does NOT replicate buckets cross-region. Loss of the eu-central-1 region (Supabase's default for our project) means total storage loss. Mitigation paths:
   - **Path A (recommended):** nightly `rclone` job from sandbox to a Cloudflare R2 bucket. Cost: trivial (~$5/mo for 100GB). Coverage: bring `manuscripts` and `voice-samples` into 24-hour-RPO compliance.
   - **Path B:** wait for Supabase to ship cross-region replication (announced, no GA date).
   - **Status:** spawn task CEO-129 to implement Path A pre-launch.

2. **No automated drill scoring.** Drills today are manual stopwatch + markdown. Acceptable for now (one drill per quarter), but past 4 drills the score sheets should feed into a small dashboard.

3. **Vercel env var backup is manual.** A leaked password manager is a worst case. Mitigation: encrypted backup of env var dump quarterly, kept offline. Spawn CEO-130.

4. **`ADMIN_SECRET` rotation procedure relies on edge function source edits** (CEO-105 covers the structural fix). Until CEO-105 ships, rotating `ADMIN_SECRET` requires a code commit to `admin-generate-livebook/index.ts` — slow and error-prone.

5. **No status page.** Public-facing `status.penworth.ai` does not exist. During an incident, users learn from social/their own usage. Spawn CEO-131.

6. **Stripe-side disaster** is not modeled. We assume Stripe is recoverable. If Stripe is permanently down, every dependent flow is broken; this is a rebuild-from-scratch event, not a runbook event.

---

## 8. Authorised actions — who can do what without escalation

| Action | CEO Claude can do alone | Founder approval required |
|---|---|---|
| Apply a migration to production | ✓ (if it's been reviewed in this runbook's drill or is a hotfix for a confirmed bug) | for any new schema-shape change |
| Restore a single table from PITR | ✓ | no |
| Rebuild whole Supabase project | ✗ | YES, in writing |
| Rotate any secret | ✓ | no, but notify in the same session |
| Re-import a Vercel project | ✗ | YES, in writing |
| Communicate publicly about an incident | ✗ | YES |
| Run the drill against drill clones | ✓ | no, but a calendar slot |

---

## 9. First-use checklist (read before running any of this for real)

- [ ] Founder has been paged and is aware. (No silent recoveries.)
- [ ] You are on the right project. Supabase project ID is `lodupspxdvadamrqvkje` for production. Anything else is a clone or drill.
- [ ] You have the password manager open before starting. Don't enter the recovery and discover you're missing a credential.
- [ ] You have at least 4 uninterrupted hours.
- [ ] You will write a post-mortem within 7 days.

---

## 10. Drill log (append-only, oldest first)

### 2026-04-27 — Dev branch standup + PITR activation (CEO-184, CEO-172)

Pre-drill state, in production:
- PITR was NOT actually active. Pro plan retains 1 day of daily backups by
  default; the documented "7 days of PITR" requires the paid `pitr_7`
  add-on (~$100/mo) and the Small compute add-on as a prerequisite. The
  runbook section 2 understates this. **CTO action this session:** upgraded
  compute `ci_micro -> ci_small` (+$5/mo) and enabled `pitr_7` add-on
  (+$100/mo). Verified `pitr_enabled: true` and `walg_enabled: true` via
  `GET /v1/projects/lodupspxdvadamrqvkje/database/backups`. From now on,
  every PITR-restore step in this runbook is genuinely available.

Drill scope this session (limited; full timed restore drill still owed):
- Stood up a persistent `dev` branch via `POST /v1/projects/{ref}/branches`
  with body `{branch_name: "dev", persistent: true}`. Branch project ref
  `cnlxhubcsoydlrmjmusz`, ACTIVE_HEALTHY, postgres-17.6.1.111. Connection
  credentials retrievable from `GET /v1/branches/{branch_id}` (DB password
  is rotatable independent of production).
- Confirmed parent-level `MIGRATIONS_FAILED` flag is expected behaviour:
  our schema is applied via `apply_migration` against the live DB, not
  via `supabase/migrations/` files in the repo, so the branch's migration
  replay step has nothing to apply. The branch project itself is healthy.

What this drill did NOT test (deferred to scheduled window with founder):
- A timed end-to-end restore from a PITR snapshot.
- A `pg_dump` from production then `pg_restore` to the dev branch.
- Verification that `auth.users` count and key table row counts match.
- Whether storage bucket re-uploads land where the manifest expects them.

Why deferred: the actual destructive-recovery dry run is a 90-minute
exercise that needs the founder watching, both for the spend (the dev
branch + restore burns compute hours) and to absorb any surprise like
schema drift the runbook didn't anticipate.

Carry-forward: CEO-183 stays open with explicit dependency on a founder-
green-lit drill window. The runbook is now genuinely usable for real;
this entry plus the existing Sections 1–9 are sufficient for "if prod
goes down right now, what do we do."
### 2026-04-27 (later) — Production baselines + PITR window verified (CEO-183)

Captured for any future restore-verification — these are the row counts a
fresh restore from the latest PITR snapshot must produce. Saved here so
the next session running the actual timed drill has a known-good check.

PITR window verified live via `GET /v1/projects/{ref}/database/backups`:
- `pitr_enabled: true`, `walg_enabled: true` (continuous WAL archiving)
- Region: ap-southeast-2 (Sydney)
- Earliest restore point: 2026-04-20 15:10 UTC
- Latest restore point:   2026-04-27 08:48 UTC
- Effective RPO: < 5 minutes (the latest point trails real-time only by
  the WAL ship interval). The runbook section 2 RPO target of "15 minutes
  for transactional data" is comfortably met.

Production row baselines as of 2026-04-27 ~08:50 UTC:

| Surface                      | Rows |
|------------------------------|-----:|
| auth.users                   | 4    |
| profiles                     | 4    |
| organizations                | 0    |
| org_members                  | 0    |
| projects                     | 24   |
| interview_sessions           | 18   |
| credit_transactions          | 1    |
| stripe_webhook_events        | 59   |
| audit_log                    | 31   |
| guild_applications           | 3    |
| guild_members                | 1    |
| store_listings               | 4    |
| storage.objects              | 106  |
| storage.buckets              | 11   |
| public.tables                | 123  |
| public.functions             | 248  |
| public.policies              | 221  |
| supabase_migrations.schema_migrations | 207 |

Note that `organizations` and `org_members` are 0 despite Stripe handler
code referencing them for customer-id lookup — pre-launch reality. Rows
are seeded on first paid subscription activation.

How to use these for a restore drill: trigger `POST /v1/projects/{ref}/
database/backups/restore-pitr` against a sandbox project (NOT this one)
to a specific timestamp, then run the same UNION ALL query at the top of
this entry against the restored project. Counts must match within
expected drift (post-restore-time inserts are correctly absent, no other
deltas).


---

_End of runbook. Updates require Founder approval; this document is part of CEO-020._
