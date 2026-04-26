# CEO State Snapshot

**Last updated:** 2026-04-26 ~13:55 UTC by CEO Claude session (THREE-LAYER signup outage fully resolved — SMTP, HIBP, and a stale legacy-migration trigger; all three real, all three required).
**Update frequency:** End of every CEO session.
**Purpose:** The CEO Claude's persistent memory between sessions. Read at start of every session.

---

## Most recent session activity (2026-04-26 ~13:35–13:55 UTC — third layer of signup outage: stale migrate_user_on_signup trigger)

After SMTP fix and HIBP disable both shipped, Founder retried in incognito with `rohinawras@gmail.com` → same generic error. **The fix from earlier in the session DID work** — but only for emails not in `pending_migrations`. Legacy users (Thomas Dye, Feras Alali, Roheena Tahir / rohinawras) hit a third layer of failure that my probes had been accidentally avoiding.

**Diagnostic chain enabled by the telemetry shipped earlier:**
- `auth_client_errors` rows captured exactly: `status=500`, `code=unexpected_failure`, `message="Database error saving new user"` — gotrue's signature for a trigger throwing in the post-INSERT chain.
- gotrue logs (Supabase Management API → analytics/logs.all on `auth_logs`) carried the actual SQLSTATE: `column "type" of relation "credit_transactions" does not exist (SQLSTATE 42703)`.

**Trigger chain on signup:**
1. `auth.users` INSERT → `on_auth_user_created` → `handle_new_user()` inserts into `public.profiles`.
2. `public.profiles` INSERT → `trigger_migrate_user` (AFTER INSERT) → `migrate_user_on_signup()`.
3. `migrate_user_on_signup()` checks `pending_migrations` for the user's email. If found, copies legacy data and runs:
   ```sql
   INSERT INTO credit_transactions (user_id, amount, type, description)
   VALUES (NEW.id, 0, 'migration', 'Account migrated from old Penworth platform');
   ```
4. `credit_transactions` no longer has `type` or `description` columns — they were renamed to `transaction_type` and `notes` in a prior schema change. The function is stale code.

The bug fired ONLY for users in `pending_migrations` (Thomas, Feras, rohinawras, plus other legacy emails). My CEO probes used random `@gmail.com` addresses not in that table → trigger short-circuited at `IF FOUND` → success. That's why "the fix is shipped, verified" kept being true for me but signup kept failing for the actual users complaining.

**Fix shipped (migration 034_drop_legacy_migration_trigger.sql):**
- `DROP TRIGGER IF EXISTS trigger_migrate_user ON public.profiles;`
- Function `migrate_user_on_signup()` retained on disk with a `COMMENT ON FUNCTION` warning that it's dead code referencing non-existent columns.
- Founder's standing directive (CEO-021 era) was already "clean break — legacy users re-sign-up fresh." So the trigger was dead by policy AND broken by schema drift.
- Reproduction: temporary `pending_migrations` row + signup probe → was failing pre-fix, now returns HTTP 200. Probe row + auth.users row both cleaned up.

**`pending_migrations` table state at session close:**
- Still populated with legacy-user rows (Thomas, Feras, Roheena, and others) — `migrated=false` for all.
- Now harmless: trigger gone, table is just data with no behaviour attached. Founder may want to drop the table + the dead function in a future cleanup but not urgent.

**Production state at end of session — fully unblocked:**
- Email/password signup works for ALL users including legacy ones in `pending_migrations`.
- HIBP off, SMTP via Resend, all auth rate limits at 1,000,000/hr.
- `mapAuthError` recognises `weak_password`, `user_already_exists`, `email_address_invalid`, `signup_disabled` across 11 locales.
- `auth_client_errors` telemetry table active for any future failures.
- Legacy migration trigger dropped; broken function retained as documented dead code.

**Three roots of the same outage, in order of discovery:**
1. **SMTP rate limit** (`rate_limit_email_sent=2/hr` on built-in SMTP) — fixed in commit `9df91d8` via Resend SMTP + 1M/hr limits.
2. **HIBP password rejection** (`password_hibp_enabled=true` defaulting on, returning `weak_password`/422 unmapped by mapAuthError) — fixed via Management API PATCH + commit `d26bf84` for mapAuthError + i18n.
3. **Stale migration trigger on profiles** (`migrate_user_on_signup` referencing renamed `credit_transactions` columns) — fixed via migration `034`.

Each fix was real and necessary. Layer 1 hid layer 2; layer 2 hid layer 3. Without the telemetry table from `f0b1d48`, layer 3 would have taken hours more to find.

**Permanent learning to add to memory:**
- **Always inspect ALL trigger chains, not just the obvious one, when "Database error saving new user" appears.** The visible trigger is `on_auth_user_created → handle_new_user`. The chain continues silently into triggers on the destination table (`profiles`). For Penworth, that chain runs through `set_referral_code`, `migrate_user_on_signup`, and `update_profiles_updated_at`. Any of them can blow up the signup. Postgres logs / gotrue logs carry the exact SQLSTATE.

**Tasks moved this session:**
- Three layers of signup outage — all closed.
- Founder action recommended: decide whether to drop `pending_migrations` table, `pending_project_migrations` table, and `migrate_user_on_signup()` function entirely. Current state: trigger dropped, data inert. Cleanup is hygiene, not urgency.

**Recommended next-session targets (unchanged):**
- CEO-051 (p0 open): per-chapter Inngest fan-out refactor.
- CEO-043 (p1 in_progress): wire remaining 6 author-pipeline agents to DB-backed prompts.
- CEO-090 (p1 open, owner=claude_code): PDF template v4.
- CEO-117 (p1 open): `/turn` endpoint smoke-test.

---

## Earlier in same session (2026-04-26 ~12:10–13:35 UTC — production signup outage, full root-cause and fix)

The 12:10 entry below documented the SMTP layer of this incident. After that fix shipped, two more legacy users (Thomas Dye, Feras Alali) and the Founder himself (fresh browser, fresh email) all hit the same "An error occurred. Please try again." Multiple turns of progressive diagnosis followed; the actual root cause is recorded here.

**True root cause: Supabase Auth `password_hibp_enabled = true` (default for new projects).** Every password-signup request runs the password through HaveIBeenPwned's breach corpus. Common passwords like `Password123!` are rejected with HTTP 422, `error_code: "weak_password"`, `weak_password.reasons: ["pwned"]`. The front-end's `mapAuthError` did not recognize `weak_password` or status 422, so it fell back to `auth.genericError` = "An error occurred. Please try again." Google OAuth doesn't run a password through HIBP, which is why OAuth signup kept working — that asymmetry was the diagnostic key.

The SMTP rate-limit fix from 12:10 was real and necessary, but it was the OUTER layer. HIBP was the inner blocker that survived the SMTP fix and kept the outage going for another 90 minutes.

**Fix shipped (in order):**

1. **`password_hibp_enabled = false`** via Management API PATCH. Verified by reproduction: same `Password123!` that returned 422 30 seconds earlier returned 200 with `confirmation_sent_at` populated 30 seconds later. `password_min_length = 6` retained as the only password-policy constraint (Supabase default).

2. **`auth_client_errors` telemetry table** (migrations `032_auth_client_errors.sql` for the schema, `033_auth_client_errors_policies.sql` for the RLS policies — Supabase MCP partial-apply trap, see learning below). Insert-only RLS for `anon` + `authenticated`, admin-readable. Captures context (signup/login/signup_oauth/login_oauth/forgot_password), error_kind (returned/thrown), message, status, code, user_agent, URL, sha256-hashed email. Ships forensic data on every future client-side auth failure.

3. **`lib/auth/telemetry.ts`** — fire-and-forget client logger with sha256 email hashing, swallowed errors, no PII storage. Used by all four catch blocks across signup/login/forgot-password.

4. **Four catch-block fixes** in `app/(auth)/signup/page.tsx`, `app/(auth)/login/page.tsx`, `app/(auth)/forgot-password/page.tsx`. Every catch was calling `setError(t('auth.genericError', locale))` — a thrown 429 / network / 5xx looked identical to "an error occurred." Now: pipe through `mapAuthError(err, locale)` and write a telemetry row.

5. **`mapAuthError` hardened** with explicit handling for `weak_password` / pwned / status 422, `user_already_exists` / `email_exists`, `email_address_invalid`, `signup_disabled`. Each new key (`auth.err.weakPassword`, `auth.err.alreadyRegistered`, `auth.err.invalidEmail`, `auth.err.signupDisabled`) filled in all 11 locale bundles (en/ar/es/fr/pt/ru/zh/bn/hi/id/vi).

**Commits shipped this session:**
- `9df91d8` — `docs(ceo-state): production signup unblocked — Resend SMTP, auth rate limits to 1M/hr` (the SMTP-layer fix recorded; PATCH applied via Management API in same session)
- `f0b1d48` — `fix(auth): pipe thrown errors through mapAuthError + add client-error telemetry` (telemetry table + lib/auth/telemetry.ts + four catch fixes)
- `d26bf84` — `fix(auth): map weak_password/exists/invalid-email/signup-disabled to useful localized messages` (mapAuthError + 11 locales)

**Production state at end of session:**
- Email/password signup: **WORKING** for any 8+ char password, including everyday-strength ones.
- Google OAuth signup: working (was never broken).
- Login: working (was never broken).
- HIBP off, SMTP via Resend, all auth rate limits at 1,000,000/hr, smtp_max_frequency=60s (per-recipient anti-spam, kept).
- Telemetry table populated on every future failure → next failure is diagnosable in seconds, not hours.
- `auth_client_errors` is empty as of session close — sweep `WHERE created_at > NOW() - INTERVAL '24 hours'` in next session to spot any new patterns.

**Permanent learnings — must propagate to ANY new Supabase project (penworth-store, branches, future migrations):**

1. **`password_hibp_enabled` defaults to TRUE on new Supabase projects.** This silently rejects most everyday passwords with code `weak_password`/422. Disable at project setup time alongside the SMTP wiring. Like `rate_limit_email_sent=2`, this is a default that's incompatible with a consumer signup form.

2. **Supabase MCP `apply_migration` does NOT reliably batch DDL + policy creation.** My `032_auth_client_errors` migration included `CREATE TABLE`, `CREATE INDEX`, `ALTER TABLE ENABLE RLS`, `DROP POLICY IF EXISTS`, `CREATE POLICY`, and `COMMENT ON TABLE`. The table, indexes, and RLS-enable landed; the two policies did NOT — `pg_policies` showed empty even though `pg_policy` later showed them when re-applied separately. Workaround: split policy creation into a separate migration. Memory note already covers "DDL/DML and INSERT in a single batched call can silently roll back" — extend to **all multi-statement migrations involving policies**.

3. **`mapAuthError` must catch every Supabase Auth error code we want to surface or it falls through to a useless generic.** Don't add new auth features without auditing what error codes they introduce.

**Tasks moved this session:**
- New incident logged in this state file (no `pipeline_incidents` row — auth is outside the writer pipeline scope).
- The 4 keys-per-locale work confirmed memory rule #5 still holds: TypeScript build does not fall back; Vercel pre-push hook caught any drift.

**Recommended next-session targets (unchanged):**
- CEO-051 (p0 open): per-chapter Inngest fan-out refactor.
- CEO-043 (p1 in_progress): wire remaining 6 author-pipeline agents to DB-backed prompts.
- CEO-090 (p1 open, owner=claude_code): PDF template v4.
- CEO-117 (p1 open): `/turn` endpoint smoke-test.
- New: small task to query `auth_client_errors` daily and report patterns; could be a Command Center widget.

---

## Earlier in same session (2026-04-26 ~12:10 UTC — Resend SMTP + 1M/hr rate limits)

Founder forwarded a screenshot from Thomas Dye (`thomas@rgs-capinvest.com`, legacy Penworth user) hitting "An error occurred. Please try again." on `penworth.ai/signup`. Asked: "is it only him, or everyone?"

**Answer: everyone, since 2026-04-14.** Last successful signup in `auth.users` was the day this Supabase project was created. Twelve days of silent total signup failure.

**Root cause:**
- Supabase Auth was using the built-in SMTP, which has a hard default `rate_limit_email_sent = 2 per hour`. The first 2 signups (Founder testing) consumed the hourly token bucket and the bucket has not had time to drain meaningfully under continued attempts since.
- Every subsequent signup failed with HTTP 429 `over_email_send_rate_limit` from `/auth/v1/signup`.
- supabase-js wraps the 429 by throwing rather than returning a structured error, so the front-end's `catch (err)` block fired and surfaced the generic `auth.genericError` message — masking the real cause.
- This was global, not domain-specific. Reproduced and confirmed via direct probe to `https://lodupspxdvadamrqvkje.supabase.co/auth/v1/signup` — `@gmail.com` and `@rgs-capinvest.com` both 429'd before the fix.

**Fix shipped (Management API PATCH on `/v1/projects/{ref}/config/auth`):**
- `smtp_host = smtp.resend.com`, `smtp_port = "465"`, `smtp_user = "resend"`, `smtp_pass = <RESEND_API_KEY>` (already in Vercel env, sender domain `penworth.ai` already verified in Resend — confirmed by sending a probe email to `nawras@penworth.ai`, message id `88e18ac7-ebf2-468e-9d15-5006ca1f236b`).
- `smtp_admin_email = noreply@penworth.ai`, `smtp_sender_name = Penworth`.
- All seven auth rate limits set to **1,000,000/hour** (Founder directive: "make sure this limit problem never happens, allow max limits or unlimited better"). Probed up to 1,000,000 — Supabase API accepted without complaint, no documented ceiling. Effective values now: `rate_limit_email_sent`, `rate_limit_otp`, `rate_limit_verify`, `rate_limit_token_refresh`, `rate_limit_anonymous_users`, `rate_limit_sms_sent`, `rate_limit_web3` all at 1,000,000.
- `smtp_max_frequency` left at 60s. This is per-recipient, not per-account — it stops "resend confirmation" abuse where an attacker bombards a victim's inbox. Removing it would be a bad trade.

**Verified end-to-end after fix:** Probe signup with `probe-do-not-use+<ts>@rgs-capinvest.com` (Thomas's actual domain) returned HTTP 200, `confirmation_sent_at` populated, user row created in `auth.users`. Probe users (`gmail.com` and `rgs-capinvest.com`) deleted post-test.

**Where the next bottleneck now sits (and why this is the right place):**
- Supabase Auth: 1,000,000/hr → not a real ceiling.
- Resend account plan cap → IS the next ceiling, but it's billable headroom Founder controls, not a silent default. Pro plan ($20/mo) is 50,000/month, 1,000/day. Sufficient for thousands of signups; if Penworth ever exceeds that, the upgrade path is one click in Resend.
- Resend per-second send rate → 2/s on free, 10/s on Pro. Not a concern for organic signup traffic.
- `smtp_max_frequency = 60s` per recipient → intentional anti-spam guardrail.

**Permanent learnings (must propagate to any future Supabase project: penworth-store, future migrations, branches):**
1. **Built-in Supabase SMTP is rate-limited at 2/hour and is unusable for anything beyond a smoke test.** Any new Supabase project must have a custom SMTP wired before any user-facing signup is enabled. This includes preview/branch projects if they're going to be tested by humans.
2. **Default `rate_limit_email_sent = 2`** is the trap. New projects should be patched to a high value at setup time.
3. **supabase-js throws (rather than structured-errors) on 429**, so `mapAuthError` cannot translate `over_email_send_rate_limit` to a user-friendly message under current code. If we ever do hit a real rate limit in future, users get the generic error. Low-priority hardening: catch the 429 explicitly in `app/(auth)/signup/page.tsx` and surface a specific message. Not urgent now that the limit is 1M/hr, but worth a CEO-### task.

**Tasks moved this session:**
- New incident logged: production signup outage, P0 SEV2, root-caused, fixed, verified. (No `pipeline_incidents` row created — incident scope is auth, not the writer pipeline; ceo-state.md is the canonical record.)
- Founder is handling user comms with Thomas directly.

**Recommended next-session targets (unchanged from prior):**
- CEO-051 (p0 open): per-chapter Inngest fan-out refactor.
- CEO-043 (p1 in_progress): wire remaining 6 author-pipeline agents to DB-backed prompts.
- CEO-090 (p1 open, owner=claude_code): PDF template v4.
- CEO-049 (p1 open): agent mid-step heartbeat pulsing.
- CEO-117 (p1 open): `/turn` endpoint smoke-test.

---

## Prior session activity (2026-04-26 ~10:35 UTC — storage-bucket mirror live; full DR posture complete)

Founder said "continue" → I shipped CEO-129 (Supabase Storage bucket cross-region mirror) as the natural completion of the DR sweep started earlier this session.

**What shipped (CEO-129):**
- `mirror_storage.py` in `nawrasalali/penworth-backups`. Paginated bucket walker using Supabase Storage REST API. Service-role key fetched at runtime via Management API → no extra repo secret.
- `.github/workflows/nightly-storage-mirror.yml`. Cron 19:00 UTC daily (~04:30 ACST), offset 1 hour after the DB dump. `storage-YYYY-MM-DD` release tag, 30-day auto-prune.
- README updated; storage now covered.
- End-to-end manual run validated 2026-04-26 10:34 UTC: workflow run `24954499747` `success`, release `storage-2026-04-26` with 59.8 MB tarball asset.
- All 9 active-prod buckets covered: `manuscripts`, `voice-samples`, `covers`, `livebooks`, `cinematic`, `audiobooks`, `chapter-audio`, `compliance-exports`, `computer-use-screenshots`. Active footprint today: 14 objects, 64 MB.

**Off-Supabase DR posture as of this commit:**
- **Postgres**: nightly via CEO-141, 18:00 UTC, 30-day retention. RPO ≤24h, RTO ~2-6h.
- **Storage**: nightly via CEO-129, 19:00 UTC, 30-day retention. RPO ≤24h.
- **Stripe**: authoritative on Stripe side; replay via API on demand.
- **Edge functions**: source in `nawrasalali/penworth-new` repo.
- **Vercel env vars**: STILL UNCOVERED — see CEO-130 (p2 open).

**Tasks moved this session:**
- CEO-129 → done (storage mirror shipped + validated)
- CEO-139 → done (legacy cleanup)
- CEO-140 → awaiting_founder (legacy pause; needs Penworth-org free-tier downgrade)
- CEO-141 → done (DB nightly dump pipeline)
- CEO-020 → last_update_note refreshed; drill calendar slot still pending Founder
- CEO-130 → unchanged but flagged as the only remaining DR gap

**Verified along the way:** CEO-021 (DNS cutover) is genuinely DONE — task row confirms 9-step execution clean on 2026-04-21, with the 2026-04-25 "regression" retracted as a sandbox-curl false positive. The system-prompt immediate queue listing CEO-021 as still p0 was stale; live DB is authoritative.

**Founder actions queued from this session:**
1. CEO-140 — downgrade Penworth org (`mfrjhsekditomsyuayyd`) to free tier in Supabase billing dashboard, then I issue the pause API call. Stops ~$25/mo.
2. CEO-020 — pick a calendar slot for the first restore drill. Recommended: week before public launch.

**Recommended next-session targets (none touched this session):**
- CEO-051 (p0 open): per-chapter Inngest fan-out refactor. Major work.
- CEO-043 (p1 in_progress): wire remaining 6 author-pipeline agents to DB-backed prompts. Resume.
- CEO-090 (p1 open, owner=claude_code): PDF template v4. Best dispatched to Claude Code with the existing brief.
- CEO-049 (p1 open): Agent mid-step heartbeat pulsing. Bounded-scope, good fit for a focused session.
- CEO-117 (p1 open): /turn endpoint smoke-test (browser webm → Ink-Whisper). Quick verification work.

---

## Prior session activity (2026-04-26 ~10:14 UTC — off-Supabase DR pipeline + legacy Supabase cleanup)

Founder asked about getting rid of legacy Penworth backups, keeping one copy, and wiring weekly DR for the three live sites. Reframed: legacy backups don't protect live sites (different project), and weekly is too coarse — DR has to nightly-back-up the *active* prod project. Founder said "go for both" → "Continue."

**What shipped:**
- **`penworth-sg` Supabase project deleted** (`ekftsgccscbkgmbfbovx`, ap-northeast-2). Verified canonical legacy `rwkurzjbfpoqwfxtdfib` was a strict superset across every populated table (56 tables, 27,738 rows). Only delta was 32 rows from user-trashed (`status=binned`) projects of `feraselali2014@hotmail.com` — those 32 rows preserved into a new `archived_from_penworth_sg` table inside canonical legacy before deletion. CEO-139 done.
- **Off-Supabase logical snapshot of canonical legacy** uploaded as a release asset to a new private repo `nawrasalali/penworth-backups`. Tag `legacy-2026-04-26`. Tarball 46.5 MB (78 MB raw), zero per-table errors. CEO-139 done.
- **Nightly DB-dump pipeline live** in `penworth-backups` repo. `dump_supabase.py` uses Supabase Management API SQL endpoint (no DB password, no port 5432 — works in any sandboxed CI). `.github/workflows/nightly-dump.yml` cron at 18:00 UTC daily (~03:30 ACST), tarballs each table's JSON, creates a dated GitHub release, attaches the tarball as asset. 30-day retention with auto-prune. End-to-end manual run validated (run id `24954134095`, conclusion `success`) — release `prod-2026-04-26` with 876 KB tarball asset. CEO-141 done.
- **Restore drill runbook** `RESTORE_DRILL.md` shipped in penworth-backups. Complements the existing `docs/orchestration/dr-runbook.md` here in penworth-new — runbook defines the procedure, restore-drill gives the concrete script. CEO-020 cross-linked.

**Repo and infrastructure pointers:**
- Backup repo (private): `https://github.com/nawrasalali/penworth-backups`
- Latest release with active prod tarball: `https://github.com/nawrasalali/penworth-backups/releases/tag/prod-2026-04-26`
- Latest release with canonical legacy tarball: `https://github.com/nawrasalali/penworth-backups/releases/tag/legacy-2026-04-26`
- Repo Actions secret installed: `SUPABASE_MANAGEMENT_PAT` (libsodium-encrypted, registered 2026-04-26 10:12 UTC)
- Workflow uses `${{ secrets.GITHUB_TOKEN }}` for releases — no extra GitHub PAT needed

**Tasks moved this session:**
- CEO-139 (legacy cleanup) → done
- CEO-141 (off-Supabase nightly DB pipeline) → done
- CEO-140 (pause canonical legacy after free-tier downgrade) → awaiting_founder
- CEO-020 (DR drill) → last_update_note refreshed; DB tier now operationally live, drill calendar slot still pending Founder
- CEO-129 (storage-bucket cross-region mirror) → last_update_note refreshed; scope now explicitly "storage buckets only" — DB tier is shipped via CEO-141. Implementation note: same penworth-backups repo can host a sibling `storage-mirror.yml` workflow.

**Task-code collision (third in 48 hours):** My CEO-138/139/140 plan collided with a parallel session that allocated CEO-138 ("Collapse Guild voice interview STT onto ElevenLabs Scribe") at 10:20 UTC. Re-shifted to 139/140/141. Sequence-backed code generator is now overdue from "should ship soon" to "must ship next session."

**Founder actions still queued from this work:**
1. CEO-140: downgrade Penworth org (`mfrjhsekditomsyuayyd`) to free tier in the Supabase billing dashboard — then I issue the pause API call in <2 min.
2. CEO-020: pick a calendar slot for the first restore drill (recommended: week before public launch).
3. (Standing) CEO-129: storage-bucket mirror still uncovered. Cheapest path is a sibling workflow in penworth-backups using Supabase Storage REST API to push to a separate release per night. Authoring deferred until DB tier proves stable across at least one cron cycle.

**What this DR does NOT cover (call-out for future sessions):**
- Supabase Storage buckets (book covers, manuscripts, voice samples) — CEO-129 still p1 open
- Vercel env vars — CEO-130 p2 open
- Public status page — CEO-131 p3 open
- Stripe replay — covered conceptually in `dr-runbook.md` §4D, no automation yet

---

## Prior session activity (2026-04-26 ~10:00 UTC — Guild STT collapsed onto ElevenLabs Scribe)

Founder one-liner: "i enabled eleven labs" — meaning the `speech_to_text` permission on the existing `ELEVENLABS_API_KEY` was granted. CEO-134's temporary OpenAI-Whisper detour collapsed onto ElevenLabs Scribe in the same session.

**What shipped:**
- **PR #8** (squash `f878c44`) — `lib/ai/guild-interviewer.ts` `transcribeAudio` swapped from OpenAI `whisper-1` to ElevenLabs `scribe_v1`. Same multipart shape, `xi-api-key` auth, same `ELEVENLABS_API_KEY` as the TTS path. `audio_duration_secs` populated correctly.
- **Pre-flight smoke verified:** ElevenLabs TTS-generated MP3 round-tripped through Scribe and came back as identical text with word-level timing (`logprob` per token, 99-language coverage).
- **Production deploy READY** at 09:53:45 UTC for sha `f878c44d`. penworth.ai HEAD = 200.
- **Zero OpenAI code references remain** anywhere in the codebase. Single-provider voice stack: ElevenLabs `eleven_multilingual_v2` (TTS) + `scribe_v1` (STT) on one key.

**Tasks closed this session:**
- CEO-135 (add `OPENAI_API_KEY` + smoke-test Guild) → done, superseded
- CEO-138 (the STT collapse) → done

**Task-code collision noted:** my commit references "(CEO-137)" because that was the next-free code when authored, but a parallel session burned CEO-137 on an unrelated Stripe checkout 404 fix during PR #8's in-flight window. DB row is CEO-138; commit/PR text says CEO-137. Both reference `f878c44`. The collision is documented in CEO-138's `last_update_note` for future audits. This is the second collision in 24 hours — sequence-backed task-code generator is overdue.

**Single residual Founder action across the whole Cartesia kill arc:**
- Cancel the Cartesia subscription at `play.cartesia.ai/subscription`. Tracked under CEO-136. Low urgency — env vars are gone, no traffic flows there.

**The Guild voice interview is now production-ready.** First applicant attempt will work end-to-end: interviewer's voice (ElevenLabs TTS) → applicant audio (Scribe STT) → Claude conversation → next interviewer turn. No further blockers in the voice pipeline.

---

## Prior session activity (2026-04-26 ~09:42 UTC — Cartesia killed, ElevenLabs TTS live in production)

Founder gave a one-line directive: "swap to elevenlabs, kills cartesia". Cartesia credit cap had exhausted production (CEO-125 P0 from prior session). Provider swap shipped end-to-end in this session.

**What shipped:**
- **PR #7** (squash `fc3f174`) — `lib/ai/guild-interviewer.ts` + `supabase/functions/admin-generate-livebook/index.ts` swapped from Cartesia to ElevenLabs (TTS) + OpenAI Whisper (STT). Voice IDs mirror the existing Store narration map (Adam multilingual + Rachel English).
- **Edge function `admin-generate-livebook`** explicitly deployed via Supabase Management API (POST `/v1/projects/{ref}/functions/deploy?slug={name}` multipart). Bumped from version 9 (Cartesia) to version 10 (ElevenLabs). The merge alone did NOT trigger the deploy — see new memory rule.
- **Vercel env cleanup:** `CARTESIA_API_KEY` (id `GTQprTDfc0iY8OHD`) and `CARTESIA_KEY` (id `Yi5xua2oSAKLWtDp`) both DELETEd from `prj_9EWDVGIK1CNzWdMUwEv7KTSep70i`. Verified 0 Cartesia env vars remain.
- **Supabase secrets cleanup:** `CARTESIA_KEY` deleted from edge function secrets. `ELEVENLABS_API_KEY` added (mirrors the Vercel env var). Verified 0 Cartesia secrets remain.
- **Smoke verification:** edge function returns 403 "forbidden" on bad `x-admin-secret` post-cleanup, which proves the `ELEVENLABS_API_KEY` env-presence guard still passes — the function reads the new key correctly and runs to the auth check.

**Tasks closed:** CEO-125 (P0 Cartesia exhausted), CEO-133 (CARTESIA_KEY rotation — superseded), CEO-134 (the swap itself), CEO-136 (env var deletion — CEO portion done; awaiting Founder for subscription cancellation only).

**Single Founder action remaining:**
- Add `OPENAI_API_KEY` to Vercel env (`prj_9EWDVGIK1CNzWdMUwEv7KTSep70i`, all 3 targets). Without it, Guild voice interview transcription throws on every applicant turn. TTS is fully working without it. Tracked as **CEO-135 (p1, awaiting_founder)**.
- Cancel Cartesia subscription at `play.cartesia.ai/subscription`. Tracked as the last bullet under **CEO-136**.

**New memory rule captured:** Supabase edge functions do NOT auto-deploy from GitHub merges. Repo source on main can lag the deployed function indefinitely until an explicit deploy via the Management API. Verified via the version field on `GET /v1/projects/{ref}/functions/{slug}`. Memory entry #12 added.

---

## Prior session activity (2026-04-26 ~09:08 UTC — bundle PR #6 merged, 5 tasks shipped)

Multi-session arc spanning ~7 chat sessions of incremental work culminated in a single squash-merge to main. Bundle contained:

- **CEO-103** (b241221) — Command Center surfaces KB, alerts, tickets, known issues, reports
- **CEO-105** (30c92a3) — admin-generate-livebook edge fn reads CARTESIA_KEY + ADMIN_SECRET from env
- **CEO-106** (f55988a + 9298af1 follow-up) — Upload-your-own front cover with optional typography flag. New POST /api/projects/[id]/cover-upload mounted on CoverDesignScreen + PublishScreen. 4 i18n keys × 11 locales.
- **CEO-107** (b31d826) — Unpublish action + UI button on /projects/[id]/publishing
- **CEO-108** (d6e1279) — Backward-jump rerun stages with per-agent cost ladder. New POST /api/projects/[id]/rerun-stage. Debit-before-flip with refund-on-failure, fires pipeline.restart-agent Inngest event mirroring admin force-retry. Confirmation modal with cost display + insufficient-credits gating. 10 i18n keys × 11 locales.

**Squash-merge:** `8e46102` on main. **Production deploy:** READY at 09:08 UTC. **penworth.ai HEAD:** 200 OK.

**Pre-push hook caught a real bug.** The `Session` interface locally declared in `editor/page.tsx` wasn't extended alongside `InterviewSession` in `types/agent-workflow.ts` for CEO-106's two new columns. Husky's `npx tsc --noEmit` filter rejected the push; fix landed as commit `9298af1`. Without the hook this would have blocked Vercel CI for hours.

**Spawned follow-ups:**
- **CEO-133 (p2, awaiting Founder)** — Rotate ADMIN_SECRET + CARTESIA_KEY now that they're env-only. Old hardcoded values are still in Git history. Founder approval needed before key rotation since CARTESIA_KEY rotation touches Cartesia billing.
- **CEO-119 (p3, open)** — Investigate who is committing to legacy `nawrasalali/penworth-ai` repo and decide archive/delete. Hygiene only.

**Memory rule corrections from this session arc:**
- The husky pre-push typecheck hook is now on **penworth-new**, not just penworth-store as the prior memory note claimed.
- CEO-118 was a sandbox-egress mirage (parallel session retraction commit `55f4cfe` aligned with my own re-verification). Future sessions should trust direct Vercel control-plane queries over older session notes.
- Task-code collisions confirmed real and frequent — this thread cleanly took CEO-119, then a parallel session burned through CEO-120 to CEO-132 before I returned, forcing me onto CEO-133. Sequence-backed task-code generator is overdue.

**Memory rule that paid off massively:** "Re-fetch origin/main IMMEDIATELY before push." Main had advanced 15 commits between the bundle's last fetch and the push attempt, including the parallel CEO-118 retraction, DR runbook (CEO-020), and admin-grant DB fixes (migrations 030 + 031). Without the re-fetch the push would have failed or merged with stale-base assumptions.

**Health snapshot at session end:** stuck=0, incidents=0, webhooks failed 24h=0, in_progress=1, awaiting_founder=22, open total=29.

---

## Prior session activity (2026-04-26 ~02:25 UTC — CEO-128 in-platform admin-grant indicator shipped — note the P0 banner above is from a parallel session and remains the most urgent open item).

---

## ✓ Cleared P0 — Cartesia exhausted (CEO-125)

**Resolved 2026-04-26 ~09:42 UTC by CEO-134.** The Cartesia credit cap was killing every TTS call from CEO-115's voice-interview pipeline. Founder authorized the full provider swap; the entire Cartesia integration was replaced with ElevenLabs (TTS) + OpenAI Whisper (STT) and the env vars were deleted. See "Most recent session activity" at the top for the close-out detail. Historical context preserved below for the audit trail; no action needed.

The original banner read:

> **Cartesia account credit cap is EXHAUSTED.** Every call to `api.cartesia.ai/tts/bytes` returned HTTP 402 — every model, every locale. CEO-115 voice-interview pipeline was non-functional in production. Founder action requested: enable overages at `play.cartesia.ai/subscription`. CEO-134 took the alternate path: kill Cartesia entirely.

**Single residual Founder action:** cancel the Cartesia subscription at `play.cartesia.ai/subscription` (no longer urgent — the env vars are gone, no traffic flows there). Tracked under CEO-136.

---

## Most recent session activity (2026-04-26 ~02:10 UTC — CEO-128 in-platform admin-grant indicator shipped)

Continuation of the long Grant credits / PR #3 / CEO-114 session. After the three-wall RPC bug stack was peeled (CEO-122/123/124) and grants verified end-to-end live, Founder asked: "make sure the receiver is notified on the new credits received, and make sure these credits are usable."

1. **Spendability — verified, no fix needed.** `admin_grant_credits` writes to `profiles.credits_balance`. The publishing-credit spend (`lib/publishing/credits.ts`), the AI-usage endpoint (`/api/credits` POST), and the user dashboard (`/api/credits` GET) all read/write the same column. Same source. Granted credits are immediately spendable.
2. **Notification — initial pass built an email path** (Resend wrapper + `adminCreditGrant` template in `lib/email/templates.ts`, `sendAdminCreditGrantEmail` in `lib/email/index.ts`, fire-and-forget call in `actions.ts`). Founder reviewed and pivoted: "no email notification, only inside the platform, on total credits, show received from admin x credit." Email work was reverted before push — no email is sent.
3. **CEO-128 shipped as in-platform indicator.** Single emerald-tinted line under the credits balance on both `/dashboard` top stats card and `/billing` credits card: "Received N credits from admin." Source of truth is `credits_ledger` filtered by `user_id` and `transaction_type='admin_adjustment'`, summed over positive amounts only (negative-amount filter guards against future schema drift where admins might log clawbacks). Conditional render — line only shows when cumulative > 0, never adds clutter for users who've never received a grant. Three files touched: `app/(dashboard)/dashboard/page.tsx`, `app/(dashboard)/billing/page.tsx`, `lib/i18n/strings.ts`. New StringKey `dashboard.receivedFromAdminTemplate` populated for all 11 locales (en, ar, es, fr, pt, ru, zh, bn, hi, id, vi). Commit `965005c`, deploy `dpl_FwggEbLXHWibGCWx46ygve6uHuiR` READY in production.
4. **i18n caveat captured.** I'm confident on en/ar/es/fr translations; bn/hi/vi are translation-quality but should be sanity-checked by a native reviewer before launch. Logged in CEO-128 metadata.
5. **Process pattern to keep using.** Founder's "no email" pivot mid-task → reverted unpushed work cleanly via `git checkout --` before doing the right thing. Building forward-only without a kill switch would have shipped email noise nobody asked for.

**Outstanding loops at end of session:**
- PR #4 (penworth-store husky author-identity hook) still awaiting Founder merge.
- GitHub branch ruleset for server-side author-email enforcement still not authorised.
- bn/hi/vi translation review for the new admin-grant string before launch.
- **CEO-125 P0 (above) is the most urgent thing in the queue** — Cartesia exhausted means voice interview is dead in production.

**Next session first action:** if Founder authorises, top up Cartesia (CEO-125), then merge PR #4, then ship branch ruleset. Otherwise pick next priority-ranked open task.

---

## Prior session activity (2026-04-26 ~02:15 UTC — extended resume session: CEO-060 shipped, CEO-118 retracted, CEO-125 P0 surfaced)

Long single-conversation session driven by Founder rolling instructions ("Resume CEO-118", "roll", "roll", "Continue", "Continue"). Net: one P1 UX bug shipped to production, four non-issues retired from the queue, two memory rules sharpened.

1. **CEO-118 closed as non-incident.** The prior CEO-118 session had logged a 7-step P0 fix plan describing three stacked Vercel/GitHub crises. All three were sandbox-egress mirages — `curl -I` HEAD requests return real Vercel headers, but `curl` GET bodies come back as 18-byte stubs from Anthropic egress TLS inspection. Re-verified via Vercel and GitHub JSON APIs: `penworth.ai` apex + www are owned by NEW project; OLD has zero custom domains; commit `5e94d23` deployed cleanly as `dpl_CPNBtLBJf3jKCo`; legacy `nawrasalali/penworth-ai` repo is 13 days dormant. This is misfire #3 of the same pattern. Memory rule (#1) widened from "503 cert-chain check" to "any GET body ≤18 bytes is a stub; cross-verify via JSON APIs".

2. **Queue housekeeping pass after CEO-118.** Walked the priority queue and found three more stale rows: CEO-021 had a "regression detected" appendix that was the same mirage (retracted, status stays done); CEO-005 was already shipped 2026-04-24 as commit `45e2b80` (no action); CEO-016 brief is 5 days stale and now misaligned with what got built (parallel weekly-checkin model coexists with the brief's monthly-PD model — both 0-row, neither E2E tested). CEO-016 → `awaiting_founder` with the architectural choice on the row.

3. **CEO-121 closed as not-an-anomaly.** Investigated commit `52282d6a` ("feat(help): world-class redesign", `ceo@penworth.ai` author, no GitHub login). It is a legitimate 725-line help-page redesign aligned with the 2026-04-25 referral rewire. Survey of last 200 commits on `penworth-new` main found SIX author emails in active production use, all deploying cleanly: `119996438+nawrasalali@users.noreply.github.com`, `ceo-claude@penworth.ai`, `ceo@penworth.ai`, `claude@anthropic.com`, `founder@penworth.ai`, `nawras@penworth.ai`. The "Vercel rejects non-noreply" rule applies to `penworth-store` ONLY (CEO-114 husky hook is store-scoped). Memory rule (#3) refined accordingly.

4. **CEO-078 closed as duplicate of CEO-073.** Verified `app/api/covers/generate/route.ts` on main: lines ~270-330 mirror Ideogram bytes to the `covers` Supabase Storage bucket via service-role client, unconditional on coverType — both front and back covers persist via path `${userId}/covers/${sessionId}-{coverType}.{ext}`. Commit `00368ed` already shipped this. CEO-078 was filed before that commit landed; redundant now.

5. **CEO-060 SHIPPED to production.** Long-standing P1 from "The Rewired Self" incident 2026-04-24. Bug: when writing finishes, the editor's SSE `'complete'` event auto-advances to QA — but if the user closed their tab mid-write or lost connection at the wrong moment, the server still flips `pipeline_status` to `'completed'` while the client stays on `current_agent='writing'`. User comes back to a 100%-progress screen with no advance control, book FEELS stuck. Fix: emerald-tinted recovery banner at the top of `WritingScreen` with a "Continue to QA review" CTA, rendered only when `onContinueToQA` is wired AND we have chapters AND not actively writing AND (`pipelineStatus === 'completed'` OR all chapters complete). Handler in editor page mirrors the SSE branch exactly — refresh chapters from DB, `advanceToNextAgent({total, total, 100})`, `startQAChecks()`. Same outcome as SSE happy path; no surprising auto-state-change. Three i18n keys (`writing.allDoneHeading`, `writing.allDoneBody`, `writing.continueToQA`) added to `StringKey` union and populated in all 11 locale bundles via per-locale Python script (memory rule from commit 9f24dbb). Shipped as commit `4204eb4`, `dpl_YtYLTfF787Rfx7` READY in production. Pushed with `SKIP_TYPECHECK=1` because sandbox npm install left `next/headers` and `next/font/google` partially typed (3 pre-existing tsc errors, none on changed files); Vercel's full-deps `next build` typechecked clean.

6. **CEO-120 spawned (p3, awaiting_founder)** — archive dormant `nawrasalali/penworth-ai` GitHub repo + delete OLD Vercel project `prj_6wRG4Qp9FG35U2WgKRJUP7kw2Q8E`. Both reversible. Founder green-light needed for the destructive Vercel DELETE.

7. **CEO-116 BLOCKED, CEO-125 (P0) spawned** — picked up CEO-116 (verify Cartesia Sonic-3 covers all 11 Penworth locales) as a clean single-session ship. Built the smoke-test script (preserved at `/tmp/cartesia_smoke.py`), POSTed to `api.cartesia.ai/tts/bytes` with the exact production payload shape per locale. **All 11 locales returned HTTP 402 "Model credits limit reached"** — this is account-level, not sonic-3-specific (verified by also calling sonic-2 and sonic which 402 the same way; `/voices` returned 200 confirming the API key itself is valid). Implication: **CEO-115's voice-interview pipeline is non-functional in production right now** — every Guild applicant gets a 402 mid-call. Filed CEO-125 as P0 awaiting_founder for a single-click overage enable at https://play.cartesia.ai/subscription.

8. **CEO-020 DR runbook authored — `docs/orchestration/dr-runbook.md` (367 lines, commit `7f774cd`).** Real-infrastructure-anchored: 119 public tables, 31 migrations, 9 storage buckets each named with size cap + regenerability, 3 inngest function files. Six drill scenarios (A-F) with explicit pass criteria and elapsed-time targets. Honest §7 gaps section names what we cannot recover from today and spawned three sub-tasks: CEO-129 (p1, R2 cross-region storage backup — without this, manuscripts loss = legal exposure to authors), CEO-130 (p2, encrypted offline env var backup), CEO-131 (p2 awaiting_founder, status.penworth.ai). CEO-020 itself moved to awaiting_founder for runbook review + a calendar slot for first drill (recommended: week before launch).

**What needs Founder decision next session — RANK ORDER:**
- **CEO-125 (P0)**: enable Cartesia overages (60-second click, no plan commitment) — until done, Guild voice interview is dead in prod.
- **CEO-016**: weekly-checkin (recommended), monthly-PD (per stale brief), or both?
- **CEO-020**: review DR runbook + schedule first drill calendar slot.
- **CEO-131**: pick a status-page provider (instatus.com, statuspage.io, or roll-our-own).
- **CEO-120**: green-light archive + DELETE of legacy repo + OLD Vercel project?
- **PR #4 on penworth-store** (CEO-114 husky hook) still awaiting merge.

**Next session first action:** if Founder hasn't actioned CEO-125, surface it again loudly before anything else — voice interview claims to work but cannot. Otherwise proceed on remaining `open` p1 work — CEO-129 (R2 mirror) is the most launch-critical, followed by CEO-049 (heartbeat keepalive, 2-hour code change), CEO-019 (load test runbook, similar shape to CEO-020).

---

## Prior session activity (2026-04-26 ~01:40 UTC — Grant credits three-wall bug stack peeled end-to-end, plus PR #3 unblock and CEO-114 hook earlier in session)

Long session driven by Founder live reports. Five threads, all closed.

1. **PR #3 in penworth-store unblocked** (start of session). vercel[bot] refused to deploy livebook-v3 PR with "No GitHub account was found matching the commit author email address". Root cause: commit `32f84f8` authored as `[email protected]` (Cloudflare email-obfuscation rewrite — same recurring bug from recent_updates memory). Fixed via `git commit --amend --reset-author --no-edit`, force-pushed. New SHA `20709ac`. PR has since been merged to main (`462fdff`).
2. **CEO-114 shipped to PR #4 in penworth-store** (preventive). `chore(hooks): enforce GitHub-associated author identity via husky pre-commit`. Adds `husky@^9.1.7` + pre-commit hook reading `GIT_AUTHOR_IDENT`, blocks any commit whose identity is not (`nawrasalali`, `119996438+nawrasalali@users.noreply.github.com`). Tested negative + positive paths. Preview deploy READY. PR #4 awaiting Founder merge.
3. **CEO-122 shipped — Grant credits wall #1: "authentication required"** (commit `a53cf057`, dpl_XArpXjMUwJbVkHzoN7kv347cQU92, READY 65s). Server action `grantCreditsAction` was calling SECURITY DEFINER RPC `admin_grant_credits` via `createServiceClient()` (service-role). Service-role calls have no user session → `auth.uid()` returned NULL → RPC raised "authentication required" 42501 before any work. Fix: switch to `createClient()` from `@/lib/supabase/server` (cookies-bound user-context). RPC's SECURITY DEFINER attribute handles privilege elevation regardless of caller client. Defence-in-depth preserved (requireAdminRole pre-validates; has_admin_role re-checks).
4. **CEO-123 shipped — Grant credits wall #2: "invalid input syntax for type uuid: super_admin"** (migration 030, commit `4e0e550`). The RPC's role check called `has_admin_role('super_admin')` — single arg. Function signature is `(p_user_id uuid, p_required_role text DEFAULT NULL)`, so the string bound to `p_user_id` and Postgres failed with the uuid-syntax error. Fix: call `has_admin_role(v_caller_id, 'super_admin')`. Process-gap fix: function previously existed only in live DB (created out-of-band, never committed). Migration 030 captures it as authoritative source going forward. Scanned all 125 public functions for the same single-string-arg pattern; no siblings.
5. **CEO-124 shipped — Grant credits wall #3: "column reference email is ambiguous"** (migration 031, commit `d6641dc`, dpl_62b1732uBuZAzZSGDovNxt3y63EW READY). The RPC's OUT params (user_id, email, amount_granted, new_balance, ledger_id) are in scope throughout the body; multiple SELECT/UPDATE statements reference columns named `email` and `user_id` on `profiles` / `credits_ledger`, causing Postgres to fail to disambiguate. Fix: DROP and recreate function with OUT params prefixed `out_` (out_user_id, out_email, out_amount_granted, out_new_balance, out_ledger_id), plus table aliases on every column reference for defence in depth. Application-side change in `actions.ts` to read renamed keys. **Verified end-to-end live**: Founder click landed credits_ledger row `c5032be3-368f-4dda-98de-fdaca41c5da6`, amount 1000, balance_after 998200, audit description correct.

**Operational learnings captured this session:**
- Supabase Management API (`api.supabase.com/v1/projects/{ref}/database/query`) returns Cloudflare 1010 from this sandbox unless a `User-Agent` header is set. Always include `-A "penworth-ceo-claude/1.0"` on bash curl calls.
- When sandbox `node_modules` cleanup flakes mid-`npm ci`, `SKIP_TYPECHECK=1 git push` is acceptable for type-safe-by-construction changes; Vercel's `next build` typechecks independently. Used three times this session.
- Out-of-band Supabase RPC creation (via dashboard SQL editor without committing a migration) is a process gap. `admin_grant_credits` was the visible casualty — three latent bugs in one function that never went through repo review. Mitigation flagged for follow-up: scan `pg_proc` for any public function not represented in `supabase/migrations/`.
- New admin RPCs need a smoke-test step in the brief: call the RPC end-to-end from `actions.ts` before declaring shipped. `tsc --noEmit` does not catch Postgres semantic errors. All three Grant credits walls would have surfaced in 90 seconds with one test click.

**Outstanding loops at end of session:**
- PR #4 (penworth-store husky author-identity hook) awaiting Founder merge.
- GitHub branch ruleset for server-side author-email enforcement still not authorised. Recommend yes when Founder has bandwidth.
- CEO-121 (rogue `ceo@penworth.ai` commits on penworth-new main) confirmed by Founder as standard parallel-session pattern; memory rule scoped to penworth-store only.
- Optional follow-ups: orphan-RPC scan (any `pg_proc` function not in migrations); admin-RPC smoke-test step in CEO briefs.

**Next session first action:** if Founder asks for ruleset / orphan-RPC scan / smoke-test step, execute. Otherwise pick next priority-ranked open task.

---

## Prior session activity (2026-04-25 ~13:10 UTC — queue housekeeping after CEO-118 close-out)

Diagnosis-only continuation of the CEO-118 session. Founder said "roll" — I worked the priority queue and found that the next three p0/p1 items in the project-instructions queue were either already done or had stale assumptions. Net result: zero code shipped, but three task rows now reflect ground truth and two memory rules are corrected.

1. **CEO-021 phantom regression retracted.** The "REGRESSION DETECTED 2026-04-25" appendix on CEO-021's note was the same sandbox-egress mirage that drove CEO-118. Vercel API confirms penworth.ai/www are owned by NEW project; OLD has zero custom domains. Appended a retraction note to the row; status stays `done`.
2. **CEO-005 Recipients CRUD UI** — verified this was already shipped 2026-04-24 (commit `45e2b80`). The project instructions claiming it as p1 to-do are stale. No action.
3. **CEO-016 Mentor Agent UI → awaiting_founder.** Audited code + DB before writing UI. The brief (authored 2026-04-20) targets a monthly-PD model (`guild_pd_sessions`, `guild_growth_plans`, voice + PDF) — both DB tables exist but are 0-row, no API routes, no UI. Meanwhile a parallel weekly-checkin model has been built (`guild_weekly_checkins` table, `lib/guild/agents/mentor.ts` (110 lines), routes `/api/guild/agents/mentor/{start,continue,end}`, `app/guild/dashboard/agents/mentor/{page.tsx, MentorChat.tsx}`) — also 0-row, never run E2E. Founder needs to choose: ship monthly-PD per brief (heavier — voice + PDF runtime needs E2E first), ship the simpler weekly-checkin (smaller — finish wiring + one E2E), or both. Recommendation: weekly-checkin. Question parked on the row.
4. **CEO-121 closed as not-an-anomaly.** Investigated commit `52282d6a` ("feat(help): world-class redesign", `ceo@penworth.ai` author). It's a legitimate 725-line help-page redesign aligned with the 2026-04-25 referral rewire. Survey of last 200 commits on penworth-new main: SIX author emails in active production use (`119996438+nawrasalali@users.noreply.github.com`, `ceo-claude@penworth.ai`, `ceo@penworth.ai`, `claude@anthropic.com`, `founder@penworth.ai`, `nawras@penworth.ai`). All deploy cleanly. The "Vercel rejects non-noreply" rule was over-generalized from `penworth-store` burns — it does NOT apply to `penworth-new`. CEO-114's husky hook is store-only.
5. **Memory rules refined:**
   - Sandbox-egress rule (#1) widened from "503 cert-chain check" to "any GET body ≤18 bytes is a stub; HEAD works; cross-verify via Vercel/GitHub JSON APIs". Misfire #3 now logged.
   - Git-identity rule (#3) scoped to `penworth-store` ONLY. Don't burn cycles "fixing" non-noreply commits on `penworth-new`.
6. **Tasks created/closed this pass:**
   - `CEO-118` → done (non-incident, see prior session entry)
   - `CEO-120` → awaiting_founder (legacy repo + OLD Vercel project cleanup, p3, needs go for Vercel DELETE)
   - `CEO-121` → done (rogue committer was standard pattern)
   - `CEO-016` → awaiting_founder (mentor architecture choice)
   - `CEO-021` → done (retraction note appended)

**What the Founder needs to decide next:**
- **CEO-016**: ship monthly-PD per brief, ship weekly-checkin (recommended), or both?
- **CEO-120**: green-light DELETE of OLD Vercel project `prj_6wRG4Qp9FG35U2WgKRJUP7kw2Q8E` and archive of `nawrasalali/penworth-ai` GitHub repo? (Both reversible.)
- **PR #4 on penworth-store** (CEO-114 husky hook) still awaiting merge from the 12:56 UTC session.

**Next session first action:** if Founder picks a CEO-016 path, execute. Otherwise pick the highest-priority `open` task that has not been audited this day — likely CEO-019 (load test) or CEO-020 (DR drill), both of which need a runbook authored from scratch.

---

## Prior session activity (2026-04-25 ~12:56 UTC — CEO-122 admin-grant fix shipped + CEO-114 husky hook + PR #3 unblock, all in one session)

This was a multi-thread session driven by Founder live reports. Three threads, all closed:

1. **PR #3 in penworth-store unblocked** (start of session). `vercel[bot]` had refused to deploy livebook-v3 PR with "No GitHub account was found matching the commit author email address". Root cause: commit `32f84f8` authored as `[email protected]` (Cloudflare email-obfuscation rewrite — exactly the recurring bug documented in recent_updates memory). Cloned `penworth-store`, set GitHub-noreply identity, ran `git commit --amend --reset-author --no-edit`, force-pushed. New SHA `20709ac`. Vercel went Building immediately; PR has since been merged to main (`462fdff`).
2. **CEO-114 shipped to PR #4 in penworth-store** (preventive hardening). `chore(hooks): enforce GitHub-associated author identity via husky pre-commit` at https://github.com/nawrasalali/penworth-store/pull/4. Adds `husky@^9.1.7` + `prepare: "husky || true"` script + `.husky/pre-commit` that reads `GIT_AUTHOR_IDENT`, parses name/email with sed, blocks any commit whose identity is not (`nawrasalali`, `119996438+nawrasalali@users.noreply.github.com`). Tested negative path (blocks `Bad Person <[email protected]>`) and positive path. Preview deploy READY. Awaiting Founder merge. Founder also flagged the same hook should land in penworth-new (CEO-121 already tracking the symptom there).
3. **CEO-122 admin-grant fix shipped to production** (mid-session, Founder live report with screenshot). Founder hit "authentication required" red banner on `/admin/command-center/grants` when clicking Grant credits. Diagnosed via Supabase Management API: RPC `admin_grant_credits` is `SECURITY DEFINER` and internally checks `auth.uid()` for caller identity + `has_admin_role('super_admin')` for authz. The server action was calling it via `createServiceClient()` (service-role key) — service-role calls have no user session, so `auth.uid()` returned NULL and the RPC raised "authentication required" (42501) before doing any work. Fix: switch to `createClient()` from `@/lib/supabase/server` (cookies-bound user-context). RPC's `SECURITY DEFINER` attribute handles privilege elevation regardless of caller client. Defence-in-depth preserved — `requireAdminRole` pre-validates AND `has_admin_role` re-checks. Deployed as commit `a53cf057` / `dpl_XArpXjMUwJbVkHzoN7kv347cQU92`, READY in 65 seconds, aliased to penworth.ai/new.penworth.ai/www.penworth.ai. Pushed with `SKIP_TYPECHECK=1` because sandbox node_modules reinstall flaked; Vercel `next build` typechecked independently and passed. Only one admin server action with this pattern; scanned, no siblings.
4. **Operational learnings captured:**
   - Supabase Management API (`api.supabase.com/v1/projects/{ref}/database/query`) returns Cloudflare 1010 from this sandbox unless a `User-Agent` header is set. Always include `-A "penworth-ceo-claude/1.0"` or equivalent on bash-based curl calls to it.
   - When sandbox node_modules cleanup flakes mid-`npm ci`, fall back to `SKIP_TYPECHECK=1 git push` for tightly-scoped changes that are type-safe by construction (e.g. import swaps to functions with identical signatures), and rely on Vercel's independent `next build` typecheck to catch anything wrong. Rollback is `git revert` if the build errors.
5. **Outstanding loops at end of session:**
   - PR #4 in penworth-store awaiting Founder merge.
   - Founder's earlier "ship the GitHub branch ruleset too" question (server-side enforcement of author email allow-list) deferred — not yet authorised. Recommend yes when Founder has bandwidth.
   - Founder agreed on Vercel auth: leave Deployment Protection on for `penworth-store`, durable fix is signing into Vercel in browser as team owner.
6. Tasks updated: CEO-114 → `awaiting_founder` (PR #4 merge); CEO-122 → `done` (production verified).

**Next session first action:** if Founder replies "merge PR #4" or "ship the ruleset", execute. Otherwise pick next priority-ranked open task.

---

## Prior session activity (2026-04-25 ~12:45 UTC — CEO-118 closed as non-incident, two follow-ups spawned)

1. **CEO-118 closed as a non-incident.** The prior CEO-118 session left a 7-step P0 fix plan describing three stacked issues: (A) `penworth.ai` still aliased to OLD Vercel project, (B) commit `5e94d23` did not auto-deploy on NEW project, (C) legacy `nawrasalali/penworth-ai` repo had four unknown commits this session. Re-verified all three from authoritative sources (Vercel API for aliases + deployments, GitHub API for commit history). All three were false positives.
2. **Reality (A):** Vercel API confirms `penworth.ai` and `www.penworth.ai` are owned by NEW project `prj_9EWDVGIK1CNzWdMUwEv7KTSep70i`, both verified, www→apex 308 redirect intact. OLD project `prj_6wRG4Qp9FG35U2WgKRJUP7kw2Q8E` has zero custom domains — only `project-zeoe1.vercel.app`. CEO-021 Step 1 already worked.
3. **Reality (B):** Commit `5e94d23` (Send credits + Store Admin) deployed successfully as `dpl_CPNBtLBJf3jKCo` to production at 2026-04-25 12:04:31 UTC. Auto-deploy is healthy. Current production is `dpl_FhsjxjHZKFuQvj9Ut3sujnL3TotC` at sha `3fbbc67f` — a docs-only commit on top.
4. **Reality (C):** `nawrasalali/penworth-ai` legacy repo's last commit is 2026-04-12 17:34 UTC, 13 days dormant. No fresh pushes this session. The previous session imagined the four pushes from sandbox-egress noise.
5. **Root cause of the misdiagnosis** is the same Anthropic sandbox-egress TLS-inspection trap that misfired CEO-028 twice. Sandbox `curl -I` HEAD requests return real Vercel headers; sandbox `curl` GET bodies return an 18-byte "DNS cache overflow" stub. The prior session ran GETs against `penworth.ai/`, got the 18-byte stub, interpreted the empty body as evidence the wrong project was serving, and built a fictional crisis. Memory rule updated to widen the diagnostic from "TLS cert chain check" to "any GET body ≤18 bytes is a stub — never act on it; always cross-verify via Vercel/GitHub JSON APIs". This is misfire #3.
6. **One real anomaly captured separately as CEO-121 (p3, open):** commit `52282d6a55` on `penworth-new` main (2026-04-25 11:12:56 UTC, "feat(help): world-class redesign") was authored under `ceo@penworth.ai` with no associated GitHub login. Violates the noreply-email memory rule but Vercel accepted it and it deployed. Yellow flag, not red — needs investigation but not blocking.
7. **CEO-120 (p3, awaiting_founder)** spawned for the legitimate cleanup loose end: archive the dormant `nawrasalali/penworth-ai` GitHub repo (reversible) and delete OLD Vercel project `prj_6wRG4Qp9FG35U2WgKRJUP7kw2Q8E` (recoverable from same GitHub repo). Founder green-light needed for the destructive Vercel DELETE.
8. **No code shipped this session** — diagnosis-only resume. The two follow-ups are queued in `ceo_orchestration_tasks`.

**Next session first action:** if any task arrives that requires fetching a live web page body, route via Vercel/GitHub API or `web_fetch` (different egress path), never via bash `curl <url>` for HTML.

---

## Prior session activity (2026-04-25 ~12:15 UTC — CEO-115 voice-interview Cartesia swap shipped)

1. **CEO-115 closed** — guild voice-interview pipeline now runs entirely on Cartesia (Ink-Whisper STT + Sonic-3 TTS). Single-file commit `7dec203` swapping `lib/ai/guild-interviewer.ts`. Production smoke-test against Founder's Arabic test application (`0945e125-5d1e-47de-888e-527e18750a06`) returned HTTP 200 + 284KB Arabic mp3 from Sonic-3; interview row `2752e61e-1a60-42f1-9c32-b26b0e72e38b` created. Founder ready to walk full UI test at `https://new.penworth.ai/guild/interview/schedule?application_id=0945e125-5d1e-47de-888e-527e18750a06`.
2. **Root cause why the pipeline was dead:** `OPENAI_API_KEY` was never set on writer Vercel. The original code called OpenAI Whisper + OpenAI TTS. The first call to `/api/guild/interview/start` would 500 on `synthesizeSpeech` before returning the opening question to the browser. Discovered via Vercel env-var enumeration during the diagnostic phase.
3. **Why Cartesia and not OpenAI:** the Founder already has a Cartesia key in project secrets, and Cartesia replaces both ends of the voice loop (`/stt` for transcription, `/tts/bytes` for synthesis). `sonic-3` covers 42+ languages including Arabic, Bengali, Indonesian, Vietnamese — the older `sonic-2` and `sonic-multilingual` reject Arabic with explicit `400 model does not support language` (verified live; the Cartesia docs language enum is stale and only lists 15 languages, but `sonic-3` actually accepts more).
4. **Voice choice:** Katie (`f786b574-daa5-4673-aa0c-cbe3e8534c02`) — Cartesia's recommended default for voice agents, "stable and realistic". Output mp3 44.1kHz 128kbps. Confirmed Arabic round-trip: TTS returns 117KB for ~7s of speech, Ink-Whisper transcribes it back faithfully (harakat dropped as expected).
5. **Vercel env-var trap (new lesson):** initial auto-deploy `dpl_2eCKBykxnRtaYbiamuuGBSpbLtgE` READY but returned `Cartesia TTS failed: 401` because `CARTESIA_API_KEY` was added mid-build. Manual redeploy `dpl_DqpPf5gxnb1fJGzytiWA8FS5VJNi` of the same commit picked up the env. Pattern: when adding a new env var that gates a runtime call on a freshly-pushed commit, always trigger an explicit redeploy after the env var is set, do not rely on the auto-deploy.
6. **Commit-message error (low-stakes):** the commit message says `(CEO-110)` but CEO-110 is the unrelated ambient-music-library task. Real code is **CEO-115** — fix-forward via this state note and the row's `last_update_note`, not by amending pushed history.
7. **Spawned follow-ups:** CEO-116 (verify all 11 Penworth locales on sonic-3, particularly bn/id/vi/zh — p2), CEO-117 (smoke-test the browser MediaRecorder webm path through `/api/guild/interview/turn` — p1, will be hit naturally on Founder's test).
8. Handover note: `docs/orchestration/handovers/2026-04-25-ceo115-cartesia-swap.md`.

**Next session first action:** if Founder reports the test passed, mark CEO-117 done with the actual test interview's row id. If Founder reports a defect, the most likely failure surface is the webm→Ink-Whisper transcription path (test only covered mp3 round-trip); fix in `transcribeAudio()`.

---

## Prior session activity (2026-04-25 ~12:10 UTC — PR #3 unblock + CEO-114 husky author-identity hook)

1. **PR #3 in penworth-store unblocked** — `vercel[bot]` had refused to deploy the livebook-v3 PR with "No GitHub account was found matching the commit author email address". Root cause was commit `32f84f8` authored as `[email protected]` (Cloudflare email-obfuscation rewrite, exactly the mechanism documented in the recent_updates memory). Cloned `penworth-store`, set the GitHub-noreply identity, ran `git commit --amend --reset-author --no-edit`, force-pushed. New SHA `20709ac`. Vercel went Building immediately; PR has since been merged to main (`462fdff`).
2. **CEO-114 shipped to PR #4** — `chore(hooks): enforce GitHub-associated author identity via husky pre-commit` at https://github.com/nawrasalali/penworth-store/pull/4. Adds `husky@^9.1.7` + `prepare: "husky || true"` script + `.husky/pre-commit` that reads `GIT_AUTHOR_IDENT`, parses name/email with sed, blocks any commit whose identity is not (`nawrasalali`, `119996438+nawrasalali@users.noreply.github.com`). Tested negative path (blocks `Bad Person <[email protected]>`) and positive path (own commit landed clean). PR #4 preview deploy READY — proves `prepare: "husky || true"` doesn't break Vercel's prod-mode install.
3. **Limitation flagged to Founder** — hook is local-only and bypassable with `--no-verify` or by committing before running `npm install`. Durable answer is a GitHub branch ruleset on the author email allow-list. Awaiting Founder go before shipping.
4. **Operational learning captured** — Supabase Management API (`api.supabase.com/v1/projects/{ref}/database/query`) returns Cloudflare 1010 from this sandbox unless a `User-Agent` header is set. Trivial fix once known; future Supabase ops from bash should always include `-A "penworth-ceo-claude/1.0"` or equivalent.
5. Task row CEO-114 inserted in `ceo_orchestration_tasks` with `status='awaiting_founder'`, `priority='p2'`, `category='infra'`, full PR + commit + acceptance test details in metadata. No handover note this session — work was small enough.
---

## Earlier session activity (2026-04-25 ~11:15 UTC — CEO-096 baseline + 2s-lag thread closed)

1. **CEO-096 closed** — store performance baseline captured for `/`, `/collections`, `/audiobooks`, `/browse`, `/book/the-new-rich-4bd4acc1`. Tool: lighthouse 12.x via Puppeteer-bundled Chromium (PageSpeed Insights API quota is now zero for unauthenticated callers; Lighthouse-via-Puppeteer is the working substitute).
2. **The 2s-lag thread is closed at every level** — row, master goal (CEO-082 umbrella), and customer-visible. Verified two ways: (a) edge cache headers — `cache-control` changed from `private, no-cache, no-store` to `public, max-age=0, must-revalidate`, `x-vercel-cache` returns HIT after first prime on every cacheable surface; (b) Lighthouse — homepage warm-cache TTFB 83ms (down from the original 2s symptom), `/collections` 179ms, `/audiobooks` 616ms, `/book/[slug]` 355ms. `/browse` stays dynamic by design (827ms TTFB, has searchParams; CEO-095 data-layer cache mitigates).
3. **What is NOT closed by CEO-096:** Lighthouse Performance scores 57-67 ("needs improvement" tier) driven by TBT 2.2-6.2s and LCP 2.8-4.1s. Both are independent of the 2s-lag thread (those were client-bundle main-thread work and cover-image priority, neither was the original symptom). Recommend separate tickets if launch traffic warrants; not on critical path now.
4. **CEO-101 anomaly flagged** — task row title says "Remove locale-cookie read from i18n/request.ts" but `last_update_note` is about a livebook auto-trigger migration. Looks like a task-code collision (same pattern in `recent_updates` memory). The actual i18n locale-cookie fix already shipped via CEO-092 (`eff9fe0`). Recommend a row cleanup pass; not done this session because it crosses session ownership.
5. Handover note: `docs/orchestration/handovers/2026-04-25-ceo096-baseline.md`.

---

## Earliest tracked session this day (2026-04-25 ~09:35 UTC — CEO-084 + CEO-085 shipped to PR)

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
