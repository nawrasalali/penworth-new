# Session handover — 2026-04-26 ~10:00 UTC Guild STT collapse onto ElevenLabs Scribe

**CEO session by:** claude-opus-4-7
**Founder directive:** "i enabled eleven labs" (one line — meaning speech_to_text permission was granted on the existing key)
**Outcome:** Guild voice interview now runs entirely on ElevenLabs. Single provider, single key. No OpenAI dependency.

---

## Context

CEO-134 (earlier this morning) killed Cartesia and moved TTS to ElevenLabs but had to detour STT to OpenAI Whisper because the existing `ELEVENLABS_API_KEY` was scoped to TTS only. CEO-135 was queued asking the Founder to either provide an OpenAI key or grant `speech_to_text` on the existing key. Founder chose the latter.

## What shipped

**PR #8** (squash `f878c44`) — single-file change, `lib/ai/guild-interviewer.ts`.

`transcribeAudio` swapped from OpenAI `whisper-1` to ElevenLabs `scribe_v1`:
- POST `/v1/speech-to-text` (was `/v1/audio/transcriptions`)
- Multipart fields: `file`, `model_id=scribe_v1`, `language_code` (was `model=whisper-1`, `language`, `response_format=verbose_json`)
- `xi-api-key` auth (same key as TTS)
- Response shape: `{ text, language_code, language_probability, words[], audio_duration_secs }` — `audio_duration_secs` populated `duration_s` end-to-end.

Header doc updated with the full provider history (Original → CEO-110 → CEO-134 → CEO-138). `OPENAI_API` and `OPENAI_STT_MODEL` constants dropped. Zero OpenAI code references remain anywhere in the codebase.

## Verified

- `npx tsc --noEmit` clean against full project (pre-push hook)
- Round-trip smoke pre-merge: TTS-generated MP3 → Scribe → identical text back, `audio_duration_secs=2.368`
- Vercel production deploy state=READY for `f878c44d` at `ready_ms=1777198425453`
- penworth.ai HEAD = 200

## Task-code collision

My commit and PR reference "(CEO-137)" because that was the next-free task code when authored. A parallel session burned CEO-137 on an unrelated Stripe checkout 404 fix during PR #8's in-flight window (their commit `25b4283` on penworth-store). My DB row is CEO-138 with the collision documented in `last_update_note`. Second collision in 24 hours — sequence-backed task-code generator is overdue.

## What moved in the task queue

- CEO-135 (OPENAI_API_KEY) → **done**, superseded
- CEO-138 (STT collapse) → **done**, shipped

## What I did not finish and why

Nothing material. The Cartesia kill arc is fully closed. Single residual Founder action remains:

- **Cancel Cartesia subscription** at `play.cartesia.ai/subscription`. Tracked under CEO-136. Low urgency — env vars are gone, no traffic flows there.

## What the next session should do first

1. **Smoke-test the live Guild voice interview** end-to-end via `/api/guild/interview/start` (verify ElevenLabs TTS audio comes back) followed by `/api/guild/interview/turn` with a sample audio file (verify Scribe transcript + ElevenLabs response audio). The pre-merge smoke proved the API surface; only end-to-end production verification remains. CEO-115's first Guild applicant is the canonical test.
2. Continue priority queue. Top of remaining `awaiting_founder` items:
   - CEO-119 (legacy `nawrasalali/penworth-ai` repo) — Founder confirms archive/delete/keep
   - CEO-136 last bullet — Founder cancels Cartesia subscription

## Memory rules carried forward

- Supabase edge functions don't auto-deploy from GitHub merges (memory #12, captured this morning)
- Re-fetch origin/main IMMEDIATELY before push (memory #6 — paid off massively across the bundle PR + CEO-134 + CEO-138 sequence today)
- SELECT max(task_code) immediately before INSERT to avoid parallel-session collisions (memory #8 — caught CEO-137 collision this session)

## The voice stack as of session end

```
Guild voice interview:
  Inbound (applicant audio → text):  ElevenLabs Scribe (scribe_v1)
  Outbound (text → interviewer audio): ElevenLabs eleven_multilingual_v2

Store livebook generation (admin-generate-livebook edge fn):
  TTS:                                ElevenLabs eleven_multilingual_v2

Both paths: single ELEVENLABS_API_KEY, present in Vercel env (3 targets)
            and Supabase edge function secrets.

Cartesia: completely removed from code, env, and secrets.
OpenAI:   never made it to production for STT — collapsed off before
          OPENAI_API_KEY was ever requested.
```
