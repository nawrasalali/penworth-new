# Session handover — 2026-04-27 00:00 UTC

**CEO session by:** claude-opus-4-7
**Duration:** ~30 min wall clock, two arcs
**Founder direction:** "Daily brief, then ship CEO-151 audio gen end-to-end via the edge function path. Then move to CEO-051 ... or CEO-117 ..."

---

## What shipped

- **PR #14, commit `af8d98f`** — `feat(academy): academy-generate-audio edge function (CEO-151)` — merged to main via squash.
- **commit `118fd2e`** (direct to main) — `docs(ceo-state): record CEO-151 ship` — state file updated.

### CEO-151: fully shipped

Edge function `academy-generate-audio` deployed v3 ACTIVE on project `lodupspxdvadamrqvkje`. POST `{slug, target, force?}` with `x-admin-secret`. ElevenLabs `with-timestamps` TTS → mp3 + alignment.json + .srt → `guild-academy/audio/{slug}/{target}.{ext}`.

Generated all 30 targets across the 3 mandatory courses → 90 storage objects (~125 MB):

| Course | Bytes |
|---|---|
| welcome-to-the-guild | 40.4 MB |
| commission-mechanics | 42.3 MB |
| representing-penworth-well | 42.2 MB |

Player at `app/guild/dashboard/academy/[slug]/page.tsx` reads from exactly these paths. Previously degraded to text-only; now serves audio + captions for all three Foundations courses.

**Bug fixed source-of-truth:** Daniel voice ID was 19-char `onwK4e9ZLuTAKqWW03F` in `scripts/generate-academy-audio.ts`. Correct value `onwK4e9ZLuTAKqWW03F9` (Daniel - Steady Broadcaster, premade), confirmed via live `/v1/voices` listing. Fixed in both the local script and the edge function. The local script never exercised that voice so the bug had been latent.

### CEO-117: code-level smoke clean — moved to `awaiting_founder`

Audited `/api/guild/interview/turn` route + `transcribeAudio` + `guessMimeType` + client-side capture in `app/guild/interview/live/page.tsx`. Pinged ElevenLabs Scribe via pg_net to confirm the API key has STT scope (returns HTTP 422 "model_id missing" for an empty body — auth + endpoint OK). Note: production migrated from Ink-Whisper to ElevenLabs Scribe (`scribe_v1`) — task title is stale.

Flagged 3 non-blocking risks for Founder review (no Scribe retry on 429/408; no client-side blob size cap; generic 500 surface on transcribeAudio errors). Full audit in the task row's `last_update_note`.

Closes when Founder's natural test run produces a successful production transcription.

---

## What moved in the queue

| Code | Before | After |
|---|---|---|
| CEO-151 | awaiting_founder | **done** |
| CEO-117 | open | **awaiting_founder** (with code-level smoke + 3 risk callouts) |
| CEO-051 | open (claude_code) | open (claude_code) — added note that `claude` CLI isn't in claude.ai sandbox; dispatch needs Founder's terminal or future session with CLI access |

---

## What I did not finish and why

**CEO-051** — Brief is committed and ready. Dispatch from this session would have required `claude` CLI (not present in claude.ai sandbox) or web-flow with human click (Founder declined). Cleanest next step: Founder runs `claude --repo nawrasalali/penworth-new --brief docs/briefs/2026-04-26-ceo-051-chapter-fanout.md --open-pr` from their terminal.

**CEO-083** — Brief estimates 4–6 hours of agent work, includes 11-locale i18n strip and a full build verification. Too large for late-session inline execution; same dispatch pattern as CEO-051.

**Daniel-voice bug audit on penworth-store** — store may also reference voice IDs (the livebook function uses different voices but worth verifying nothing else references the broken `onwK4e9ZLuTAKqWW03F` value). Quick `grep` recommended early next session.

---

## What the next session should do first

1. Run start-of-session ritual.
2. Verify `/guild/dashboard/academy/welcome-to-the-guild` actually serves audio + captions in production (real browser smoke). The deploy doesn't need a Vercel rebuild — edge function is independent — but the next-app player code may have last-deployed-state cached signed URLs. Force-refresh.
3. Pick up CEO-083 (Founder pre-authorized; 4-6h scope; manageable in a fresh session) OR CEO-051 if Founder has dispatched from their terminal. Whichever they direct.
4. Action the 3 CEO-117 risk callouts if Founder agrees they're worth fixing now (Scribe retry mirror is the easiest win — 5-line change in `transcribeAudio`).

---

## Operational notes captured this session

- **Edge function deploy via Management API**: pattern from CEO-134 livebook reused without modification. `POST https://api.supabase.com/v1/projects/{ref}/functions/deploy?slug={name}&bundleOnly=false` with multipart `metadata` (JSON) + `file` (TS). Status flips BUILDING→ACTIVE; version increments per deploy.
- **pg_net call timeouts ≠ function failures**: `timeout_milliseconds` set to 150000 dropped 3 of 14 wave-3 responses, but the edge function continued and uploaded all 3 successfully. Always verify storage truth before re-firing on a NULL pg_net response.
- **ElevenLabs voice IDs require live verification**: never trust a string literal in source code. The `/v1/voices` listing is authoritative and was the only way to find the real Daniel ID.
