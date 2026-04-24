# Brief: CEO-043 — Wire remaining Author-pipeline agents to DB-backed prompts

**Task code:** CEO-043
**Authored:** 2026-04-24 (research by prior CEO session, persisted by follow-up session)
**Status at persist time:** in_progress — Phase 0 (maxDuration patch) shipping in the same commit as this brief.

---

## Headline finding

The wiring question is downstream of a bigger problem. Fourteen `interview_sessions` have ever been created; ten failed. Six of the ten failures died at `validate` with stuck-agent timeouts (3-22 minutes stale). None of the six agent routes set `maxDuration` in the Next.js module, so every one is on Vercel Pro's 60-second default. Sonnet on `validate` commonly runs 30-50 seconds with spikes over 60. The timeout hits, the agent process is killed mid-response, the session never reaches `pipeline_status='completed'`. Same pattern likely for the three `publishing` failures.

This makes every per-agent wiring choice moot until the timeout is raised. A freshly-wired validate agent with a better DB-backed prompt would still die in the same place.

## Phase 0 — `maxDuration = 300` patch (shipping first)

One commit, seven files, one line per file: `export const maxDuration = 300;` added to every `app/api/ai/*/route.ts` except `chat` (edge runtime — different timeout model, not affected by this issue). The brief's original summary said "6 agent routes" referring to the six pipeline stages (validate, research, writing, QA, cover, publishing); writing/cover/publishing are not HTTP routes, and the seven HTTP routes that ARE in `app/api/ai/` all call Sonnet and all need the same headroom. Over-applying is free — Vercel bills actual execution time, not reserved time.

This patch may, by itself, produce the first book that completes the pipeline end-to-end. That is the single-highest-ROI intervention available.

## Per-agent wiring recommendations (Phase 1+)

After Phase 0 ships and a clean end-to-end book completes, dispatch one Claude Code brief per agent. Recommended order follows observed failure rate.

### 1. Validate — option C (translation layer)

Current `app/api/ai/validate/route.ts` already contains legacy-shape mapping: numeric total + six-slot breakdown backing a pie-chart UX. The DB prompt deliberately emits a different shape — `{approved, verdict, strengths, risks, missing, recommended_angle, reader_who_buys, comparable_books}` — no numeric score by design. Option A (extend DB schema with numeric score) would fabricate precision the DB prompt author rejected on purpose. Option B (migrate UI) would regress the pie-chart UX. Option C (translation layer in the route) preserves both surfaces without coupling them.

### 2. Research — option B (migrate UI)

DB schema is stricter than the current route's ad-hoc shape, but the consumer is a simple list. A clean swap with one UI commit costs less than a translation layer that would survive forever for no benefit.

### 3. Writing — option C (translation layer), with heavy caveat

Prose quality is the product. Prompt lives inside a 941-line Inngest function. Test against three topics per doc type (narrative non-fiction, how-to, academic) before merging. **Do not dispatch to Claude Code** — too much judgment required in comparing output quality across prompt versions. CEO session implements and measures directly.

### 4. QA — option B (migrate persistence)

Findings live in a structured table. Deterministic checks stay in the route unchanged. Low priority regardless of option — zero QA-stage failures in the observed data.

### 5. Cover — option A (extend DB schema)

The v2 typography layer is net-new capability. Extending the schema captures the quality win; translating would throw it away.

### 6. Publishing — option C (translation layer)

External contract (17 platform APIs) stays fixed by necessity. AI block swaps DB-side. Also needs `maxDuration` investigation for the 17-platform sequential calls — may need its own Phase 0-style patch if Phase 0 doesn't already cover the publishing orchestration route (it may live outside `app/api/ai/`).

## Sequencing

- **Week 1:** Phase 0 only + end-to-end test with one book. Measure success rate against the historical 0/14.
- **Week 2:** validate → research → writing → publishing (failure-rate order).
- **Week 3:** cover → QA → iterate on observed issues.

Each Phase 1+ step is its own Claude Code brief with acceptance tests against a fresh interview session. No two agent wirings merged in the same deploy.

## What happens if Phase 0 alone doesn't fix completion rate

Return to the data. Stuck-agent timeouts after 300s mean a different root cause — likely model error, token budget, or a non-timeout Inngest failure. Reopen the analysis rather than proceeding with wiring changes blind.
