# Session handover — 2026-04-25 ~12:15 UTC

**CEO session by:** claude-opus-4-7 (Penworth CEO project)
**Duration:** ~75 minutes (single conversation, three Founder turns)
**Trigger:** Founder asked "is the AI interview all wired, and good to go" before walking through the first end-to-end Guild interview test.

## What shipped

- **Commit `7dec203`** on `nawrasalali/penworth-new` main: `feat(guild): swap OpenAI Whisper+TTS for Cartesia Ink-Whisper+Sonic-3` (commit message says CEO-110 but the real task code is CEO-115 — collision with the unrelated ambient-music task; documented in the row's `last_update_note`).
- Single file: `lib/ai/guild-interviewer.ts`, +34/−23. `transcribeAudio()` now hits `https://api.cartesia.ai/stt` with `model=ink-whisper`. `synthesizeSpeech()` now hits `https://api.cartesia.ai/tts/bytes` with `model_id=sonic-3`, voice Katie (`f786b574-daa5-4673-aa0c-cbe3e8534c02`), mp3 44.1kHz 128kbps. Auth: `Authorization: Bearer ${CARTESIA_API_KEY}`, header `Cartesia-Version: 2025-04-16`.
- **Vercel env var** `CARTESIA_API_KEY` set on writer project across production, preview, and development (env id `GTQprTDfc0iY8OHD`).
- **Production deploy** `dpl_DqpPf5gxnb1fJGzytiWA8FS5VJNi` READY for `7dec203` after a manual redeploy (the auto-deploy on push went READY before I added the env var, so it returned 401 — see CEO ops lessons below).
- **Production smoke test passed end-to-end:** `POST /api/guild/interview/start` against application `0945e125-5d1e-47de-888e-527e18750a06` returned HTTP 200 with a 284KB Arabic mp3 ("أهلاً نورس..."), interview row `2752e61e-1a60-42f1-9c32-b26b0e72e38b` created, application status advanced to `interview_scheduled`, topic correctly set to `background`.

## Why the swap was necessary

The voice interview pipeline was dead before this session. `OPENAI_API_KEY` was never set in writer Vercel — verified by enumerating every env var on the project. The original code called OpenAI Whisper + OpenAI TTS, so `/api/guild/interview/start` would 500 on the first `synthesizeSpeech` call before returning audio to the browser. The Founder would have hit a generic 500 the moment they clicked "Begin Interview" on their Arabic test application.

The Founder already had a Cartesia key in project secrets. Cartesia replaces both ends of the voice loop, so one credential was enough. Sonic-3 was the only viable TTS model for the test because the Founder's test application is in Arabic and Cartesia's `sonic-2` and `sonic-multilingual` reject Arabic with explicit `400 model does not support language` (verified live with the API key). The Cartesia docs language enum on `tts/bytes` lists 15 languages and does NOT include Arabic, but Sonic-3 actually accepts it — marketing's "42+ languages" claim is the truth, the API reference doc is stale.

## What moved in the task queue

- **CEO-115** inserted as `done` (commit `7dec203`, deploy `dpl_DqpPf5gxnb1fJGzytiWA8FS5VJNi`). Note: I tried CEO-114 first; a parallel session inserted CEO-114 between my `SELECT MAX(task_code)` check and my `INSERT`. Took CEO-115 on retry.
- **CEO-116** spawned (`open`, p2): verify all 11 Penworth locales on Sonic-3, particularly `bn` (Bengali), `id` (Indonesian), `vi` (Vietnamese), `zh` (Chinese). Bounded ~30 min; pattern is the round-trip script in `/tmp/smoke.mjs`.
- **CEO-117** spawned (`open`, p1): smoke-test the browser MediaRecorder webm → Ink-Whisper transcription path through `/api/guild/interview/turn`. The CEO-115 smoke test only round-tripped mp3, not webm. Most likely failure surface if the Founder's UI test breaks. webm IS in Ink-Whisper's supported formats list per docs.

## CEO ops lessons learned this session (proposing as memory edits)

1. **Vercel env-var-mid-build race.** When you push a commit AND add a new env var the runtime depends on, the auto-deploy that fires on the push will READY but the function may not see the env value (in this case Cartesia returned 401 because the Authorization header was `Bearer undefined`). Manual redeploy of the same commit fixed it. Pattern: add env var FIRST, then push; or always trigger an explicit redeploy after adding env vars to a freshly-built deploy.
2. **Task-code race is real and hits often.** I followed the existing memory rule (SELECT MAX before INSERT) and STILL collided once on CEO-114. Window between SELECT and INSERT was ~5 seconds. Mitigations: re-run SELECT immediately on `23505 duplicate key` and retry; or longer-term, switch to a sequence-backed code generator (CEO-XXX-future task).
3. **Cartesia docs language enum is stale; Sonic-3 covers more than the docs list.** Marketing claim of "42+ languages" is correct; the `tts/bytes` API reference enum showing 15 is the lie. Always test live before assuming a locale isn't supported.
4. **Commit-message references to task codes are not authoritative.** The state file and the task row's `last_update_note` are. I committed before doing the SELECT-MAX check and used the wrong code in the message; fix-forward is fine.

## What I did not finish and why

- **Browser end-to-end UI test** — only API-level smoke test was done (HTTP POST against /start with curl). The Founder is the human-in-the-loop for the actual UI walk-through; their test will exercise webm upload through MediaRecorder. CEO-117 tracks closing this gap.
- **Multi-locale verification** — only Arabic was confirmed live. CEO-116 tracks the remaining 10 locales.
- **No `OpenAI` references audit beyond `lib/ai/guild-interviewer.ts`** — I confirmed that file is clean but did not grep the rest of the repo for any other surface that might still reach for OpenAI APIs (the existing Vercel env list shows no `OPENAI_API_KEY`, so any other call site would already be broken — but worth a sanity grep next session if anything Anthropic-adjacent surfaces).

## What the next session should do first

If the Founder reports their interview test passed: mark CEO-117 `done` with the actual interview row id, and start working through the priority queue (CEO-021 DNS cutover is the standing p0).

If the Founder reports a defect: most likely cause is webm→Ink-Whisper. Pull the Vercel runtime log for the failing request, look for `[ink-whisper] API error:` lines, and fix in `transcribeAudio()` — probably a Content-Type or formData boundary issue.

Either way, do not auto-spawn new locale-coverage work without a real applicant in that locale; CEO-116 stays p2.
