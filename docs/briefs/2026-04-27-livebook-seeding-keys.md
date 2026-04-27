# Brief: API keys for Livebook (CEO-163/165 activation)

**Task code:** CEO-163 + CEO-165 (sub)
**Authored:** 2026-04-27 by CEO Claude — supersedes earlier draft
**Owner:** Founder (provision keys)

---

## Current state (verified live this session via Management/Vercel APIs)

| Secret | Vercel writer | Supabase Edge Functions | GitHub Actions |
|---|---|---|---|
| `ADMIN_SECRET` | ✓ present | ✓ present | needs paste |
| `ANTHROPIC_API_KEY` | ✓ present | ✓ present | needs paste |
| `FAL_KEY` | not needed | not needed | **needs paste** |
| `VOYAGE_API_KEY` | not needed | **needs paste** | **needs paste** |
| `NEXT_PUBLIC_SUPABASE_URL` | ✓ present | auto-injected | needs paste |
| `SUPABASE_SERVICE_ROLE_KEY` | ✓ present | auto-injected | needs paste |
| `SUPABASE_MANAGEMENT_PAT` | n/a | n/a | needs paste (smoke harness only) |

**Vercel env vars do NOT flow to Supabase Edge Functions or GitHub Actions.** Each store is independent. The same value has to be pasted into each location where it is needed.

## Step 1 — Get a Voyage AI key (the only key not yet anywhere)

https://dash.voyageai.com → API Keys → Create. Free tier: 50M tokens — covers all of Phase 0 + Phase 1 with room to spare. Voyage-3 at $0.00006 per 1K tokens; a typical caption is ~80 tokens.

## Step 2 — GitHub Actions secrets (for seeding workflow)

URL: https://github.com/nawrasalali/penworth-new/settings/secrets/actions

Click "New repository secret" once per row:

```
FAL_KEY                     ← from https://fal.ai/dashboard/keys (deposit ~$50 at fal.ai)
ANTHROPIC_API_KEY           ← copy from Vercel env (writer project) — same value
VOYAGE_API_KEY              ← from Voyage dashboard (Step 1)
NEXT_PUBLIC_SUPABASE_URL    = https://lodupspxdvadamrqvkje.supabase.co
SUPABASE_SERVICE_ROLE_KEY   ← copy from Vercel env (writer project) — same value
ADMIN_SECRET                = pw_admin_2026_livebook_83kj  (rotate later via CEO-105)
SUPABASE_MANAGEMENT_PAT     ← from Penworth CEO project secrets (sbp_…)
```

## Step 3 — Supabase Edge Function secrets (for paragraph matcher)

URL: https://supabase.com/dashboard/project/lodupspxdvadamrqvkje/functions/secrets

```
VOYAGE_API_KEY              ← only key currently missing here; same Voyage key as Step 2
```

`ANTHROPIC_API_KEY` is already present (verified). `ADMIN_SECRET` already present.

## Step 4 — Run

Once Steps 1–3 are done:

1. **Seed the library** — GitHub UI → Actions → "Seed Livebook Library" → Run workflow:
   - First run: `style=vintage_painting`, `count=5`, `dry_run=false` — sanity check (~$0.25)
   - Then: `count=100` per style — smoke seed (~$9 total)
   - Founder eyeballs samples; if approved: `count=all` per style (~$80 incremental)

2. **Verify the matcher** — GitHub UI → Actions → "Smoke Test Livebook Matcher" → Run workflow against a real published book (e.g. `The Sunflower Secret`, `id=425d873e-4950-49e0-8298-0ef2977c7ee9`). Workflow checks preconditions (Voyage key present, library populated), then triggers the edge function and prints the resolved paragraph→image map summary.

## Cost forecast (unchanged)

- Phase 0 image: $0.045 each
- 100 imgs × 2 styles: ~$9
- 1000 imgs × 2 styles: ~$90
- Phase 1 matching per book: ~$0.05 (mostly Voyage embeddings; reranker only on close calls)
