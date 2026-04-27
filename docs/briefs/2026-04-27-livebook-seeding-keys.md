# Brief: API keys for Livebook seeding (CEO-163 Phase 0)

**Task code:** CEO-163 (sub)
**Authored:** 2026-04-27 by CEO Claude
**Owner:** Founder (provision keys); CEO Claude (run seeding once keys are in)
**Why this exists:** The seeding script `scripts/seed_livebook_library.ts` is shipped and verified end-to-end against the live database. To actually populate the library it needs three external API keys that Penworth doesn't currently use. The Founder needs to acquire each one and add it to project secrets.

---

## What I need

Three new keys, in addition to the secrets that already live in the Penworth CEO project instructions.

### 1. `FAL_KEY` — fal.ai (image generation)

- **Why:** Flux Pro 1.1 is the current quality/cost sweet spot for the kind of imagery the Founder approved. fal.ai is the cheapest reliable host that exposes Flux Pro 1.1 via a stable HTTP API.
- **Get one:** https://fal.ai/dashboard/keys → "Add new key" → copy the `Key XXXX...` string.
- **Cost model:** Pay-as-you-go. Flux Pro 1.1 at 1344x768 is approximately $0.04 per image. Phase 0 spend at 100 images per style: ~$8. At 1000 images per style (full library): ~$80.
- **Account funding:** fal.ai requires a prepaid balance. $50 deposit is enough for the Phase 0 100-image-per-style smoke generation.

### 2. `ANTHROPIC_API_KEY` — Anthropic API (vision captioning)

- **Why:** Each generated image gets captioned by Claude vision so the caption describes what's *visible* in language matching prose. The caption — not the source prompt — is what gets embedded for retrieval.
- **Get one:** https://console.anthropic.com/settings/keys → "Create Key". Recommend creating a dedicated key named `penworth-livebook-seeding` with a $50 monthly cap so it can't surprise-spend.
- **Cost model:** Claude Opus 4.7 at ~600 output tokens per call ≈ $0.005 per image. Phase 0 spend: ~$1 across both styles.
- **Note:** This is the FIRST Anthropic API key Penworth needs as a paying customer — until now Claude has only been used through Claude.ai's CEO interface, which is a different product. Adding this key opens the door to other Anthropic-API integrations later (e.g. paragraph embedding via Voyage during the retrieval pipeline in Phase 1).

### 3. `VOYAGE_API_KEY` — Voyage AI (text embeddings)

- **Why:** Voyage-3 produces 1024-dim embeddings — this is the embedding the database schema is keyed to. It's the current best-in-class retrieval embedding model and is the model Anthropic recommends post-acquisition.
- **Get one:** https://dash.voyageai.com → API Keys → Create. Free tier includes 50M tokens — more than enough to embed every caption in Phase 0 with room to spare.
- **Cost model:** voyage-3 is $0.00006 per 1K tokens. A typical caption is ~80 tokens → $0.00005 per image. Phase 0 spend: $0.10 total. Free tier covers all of Phase 0 + Phase 1 retrieval.

---

## Total Phase 0 cost forecast

| Stage | Per-image | 100 imgs × 2 styles | 1000 imgs × 2 styles |
|---|---|---|---|
| fal.ai Flux Pro 1.1 | $0.040 | $8.00 | $80.00 |
| Claude Opus vision caption | $0.005 | $1.00 | $10.00 |
| Voyage-3 embedding | $0.00005 | $0.01 | $0.10 |
| **Per image total** | **$0.045** | **$9.01** | **$90.10** |

Recommendation: smoke-seed 100 per style first (≈ $9), Founder eyeballs samples, approve scaling to 1000 (≈ $80 incremental).

---

## Where to put the keys

These are sensitive secrets. Two acceptable locations:

1. **Penworth CEO project instructions** (Claude.ai → Penworth CEO project → Settings → Project instructions, in the existing SECRETS block). Add three lines:
   ```
   - FAL_KEY: {{KEY_VALUE_HERE}}
   - ANTHROPIC_API_KEY: {{KEY_VALUE_HERE}}
   - VOYAGE_API_KEY: {{KEY_VALUE_HERE}}
   ```
2. **`.env.local` on the founder's machine** if the founder runs the script locally rather than asking me to.

The keys must NEVER be committed to the repo. The script reads them via `process.env.*`.

---

## How seeding runs

Once the three keys are in place, in the next session I:

1. Read the keys from project instructions into the sandbox env.
2. Run a 5-image smoke test in the sandbox if fal.ai is reachable; if it returns the 18-byte stub (sandbox egress issue, see CEO ops note in memory), I'll:
   - Author a one-shot Vercel cron or a one-time GitHub Actions workflow that runs the script with the keys as repository secrets, OR
   - Hand the script + a copy-paste instruction to the Founder to run locally.
3. Smoke seeds 100 prompts per style → ~9 USD spend.
4. Founder reviews 6–10 sample images per style (random sample). Approves or refines the prompt deck.
5. Scale to 1000 per style if approved.
6. Trigger Phase 1 brief: retrieval pipeline.

---

## Acceptance test

When this task is done:
- All three secret names appear in the project instructions block.
- The script `pnpm tsx scripts/seed_livebook_library.ts --style vintage_painting --count 1` runs to completion without an env-var error and inserts one row into `livebook_image_library`.
- The inserted row has a non-null `embedding` of length 1024, a `caption` of >50 words, and a non-empty `image_url` resolving to a Supabase Storage public URL.
