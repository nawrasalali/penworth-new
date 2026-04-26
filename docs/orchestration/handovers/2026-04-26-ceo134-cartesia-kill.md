# Session handover — 2026-04-26 ~09:42 UTC Cartesia kill

**CEO session by:** claude-opus-4-7
**Founder directive:** "swap to elevenlabs, kills cartesia" (one line)
**Outcome:** Cartesia removed from production end-to-end. ElevenLabs (TTS) live and verified. P0 cleared.

---

## What shipped

**Code:** PR #7 squash-merged as `fc3f174` on main.
- `lib/ai/guild-interviewer.ts` — `synthesizeSpeech` now uses ElevenLabs `eleven_multilingual_v2` with the same per-language voice ID map as Store narration. `transcribeAudio` now uses OpenAI Whisper-1 with `verbose_json` for the duration field. Both functions early-throw on missing env vars.
- `supabase/functions/admin-generate-livebook/index.ts` — `tts()` swapped to ElevenLabs. `__experimental_controls` (Cartesia-specific emotion + speed) dropped. Voice IDs: Adam (default_male) + Rachel (default_female).

**Edge function deploy:** `admin-generate-livebook` explicitly deployed via Supabase Management API (`POST /v1/projects/{ref}/functions/deploy?slug={name}` multipart) — version bumped from 9 (Cartesia) to 10 (ElevenLabs). Smoke-tested via `pg_net.http_post` post-deploy: 403 on bad x-admin-secret = `ELEVENLABS_API_KEY` env-presence guard passes.

**Env var changes:**
- `ELEVENLABS_API_KEY` added to Supabase edge function secrets (was already in Vercel from prior store-narration work).
- `CARTESIA_API_KEY` (id `GTQprTDfc0iY8OHD`) and `CARTESIA_KEY` (id `Yi5xua2oSAKLWtDp`) DELETEd from Vercel project `prj_9EWDVGIK1CNzWdMUwEv7KTSep70i`.
- `CARTESIA_KEY` deleted from Supabase edge function secrets for project `lodupspxdvadamrqvkje`.
- Verified zero Cartesia env vars remain in either platform.
- Post-deletion smoke test: edge function still returns 403 on bad secret = ElevenLabs path is fully wired.

## What moved in the task queue

- CEO-125 (P0 Cartesia exhausted) → **done** (resolved by CEO-134)
- CEO-133 (rotate CARTESIA_KEY) → **done** (superseded — env var deleted entirely)
- CEO-134 (provider swap) → **done**
- CEO-135 (add OPENAI_API_KEY + smoke-test Guild interview) → **awaiting_founder, p1** (new)
- CEO-136 (Cartesia teardown — env vars + subscription cancellation) → **awaiting_founder** (CEO portion done; Founder cancels subscription only)

## What I did not finish and why

Two items are explicitly Founder-only:

1. **Adding `OPENAI_API_KEY` to Vercel env.** I don't have an OpenAI key. Until this lands, Guild voice interview transcription throws on every applicant turn. TTS is fully working without it — the interviewer's voice plays normally; only the applicant's reply transcription is broken. Same broken state as Cartesia exhaustion; net no worse than before the swap.

2. **Cancelling the Cartesia subscription.** Requires Founder login at `play.cartesia.ai/subscription`. Low urgency — the env vars are gone, so no traffic flows to Cartesia regardless. Subscription will continue billing until cancelled.

## What the next session should do first

1. **If Founder has provided `OPENAI_API_KEY`:** add it to Vercel env via the Vercel API (`POST /v10/projects/{id}/env` with `target=['production','preview','development']`, `type=encrypted`, `key=OPENAI_API_KEY`). Verify by triggering a fresh deploy. Smoke-test Guild voice interview end-to-end via `/api/guild/interview/start` then `/api/guild/interview/turn` with a short audio sample.
2. **If not:** continue priority queue. CEO-119 (legacy repo cleanup) is the next p3 hygiene task; everything else needing CEO attention is awaiting_founder.

## Memory rule corrections from this session

1. **Supabase edge functions do NOT auto-deploy from GitHub merges.** Memory entry #12 added. PR #7's `supabase/functions/admin-generate-livebook/index.ts` change merged to main but the deployed function kept running version 9 (Cartesia code) until I explicitly deployed via the Management API. Without the explicit deploy, "PR merged" would have been a false signal — production would have continued failing on Cartesia 402s while the repo source said ElevenLabs.
2. **Edge function deploy procedure:** `POST https://api.supabase.com/v1/projects/{ref}/functions/deploy?slug={name}` multipart with `metadata` (JSON) + `file=index.ts`. Returns the new version number. Verify via `GET /v1/projects/{ref}/functions/{slug}` — `version` field bumps.

## Memory rule that paid off massively (carried from earlier session)

"Re-fetch origin/main IMMEDIATELY before push." Main had advanced 16 commits between my prior session's last fetch and this session's push. The merge was clean only because of the re-fetch. Without it, a stale-base merge would have wasted tool calls or shipped broken code.
