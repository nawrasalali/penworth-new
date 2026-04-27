# Brief: CEO-043 Phase 1 — Validate agent translation layer

**Task code:** CEO-043 (Phase 1 of 6 per-agent wirings)
**Authored:** 2026-04-28 by CEO Claude session
**Owner:** Claude Code (or CEO session if dispatch unavailable)
**Expected completion:** ~2 hours of agent work, +1 hour acceptance verification

---

## Objective

Replace the inline Anthropic call in `app/api/ai/validate/route.ts` with a `fetchPromptBundle` + `runValidatedCompletion` pair that drives the validate agent from the seeded `validate_prompts` table. Add a translation block that maps the DB shape (`{approved, verdict, strengths, risks, missing, recommended_angle, reader_who_buys, comparable_books}`) to the legacy `ValidationScore` shape the editor's pie-chart UI consumes (`{total, breakdown:{6 slots}, verdict:'STRONG'|'PROMISING'|'RISKY'|'RECONSIDER', summary, strengths, weaknesses, alternatives}`). No UI change.

## Why option C, not A or B

- **Option A (extend DB schema with numeric score):** the DB prompt author rejected per-criterion 0-10 numeric precision on purpose — the rubric explicitly says *"Weighted scoring is aspirational; the agent holistically judges rather than literally summing weights."* Forcing the model to emit fake 0-10 sub-scores backslides on the design.
- **Option B (migrate UI to new shape):** kills the pie-chart and the existing approve/refine flow tied to numeric `total`. Net regression for the launch surface.
- **Option C (translation layer in the route):** preserves both surfaces. The DB prompt evolves freely; the UI keeps its ergonomics; the coupling is a one-way derivation table inside the route. This is the option the brief author recommended.

## Context

**Current route (158 lines).** Builds its system prompt in-line from `getValidationRubric(contentType)`, calls `anthropic.messages.create` directly, parses the response with `JSON.parse`, then maps the rubric-specific keys back onto the six fixed `ValidationScore.breakdown` slots via a chain of `??` fallbacks.

**DB-backed source.** `resolve_validate_prompt(p_content_type)` RPC returns one row from `validate_prompts` per active document type. Verified live in `lodupspxdvadamrqvkje`:

- 10 active document types with direct matches: non-fiction, fiction, memoir, business_plan, proposal, thesis, dissertation, paper, academic, poetry. Other content types fall back via the resolver's CASE statement (e.g. `self-help → non-fiction`, `pitch_deck → business_plan`).
- Output schema for non-fiction (representative) requires: `approved`, `verdict` (20-300 char string), `strengths` (3-5 items, ≥20 chars each), `risks` (3-5, ≥20), `recommended_angle` (≥30), `reader_who_buys` (≥30), `comparable_books` (2-3, ≥15). `missing` (0-3, ≥10) is allowed but not required.
- User template variables: `{{topic}}`, `{{why_this_book}}`, `{{target_audience}}`, `{{target_length_words}}`, `{{document_type}}`, `{{#if author_bio}}{{author_bio}}{{/if}}`.

**Caller surface.** The editor (`app/(dashboard)/projects/[id]/editor/page.tsx:524`) POSTs `{topic, contentType}` only. Validate fires before interview; `why_this_book`, `target_audience`, `author_bio` are gathered LATER by the interview agent. They legitimately do not exist at validate time. Phase 1 accepts that and passes empty strings for those vars; the DB system prompt tolerates missing context. Filling them is a Phase 1.5 follow-up (extend the editor's project-setup screen to collect a one-line "why this book" and a one-line "audience"). Out of scope here.

**`runValidatedCompletion` retry loop.** Already handles ajv schema validation, JSON-parse retries with feedback into the prompt, and discriminated-union failure modes (`schema_compile`, `anthropic_error`, `json_parse`, `schema`). The route just needs to call it and translate the success payload.

## Files to touch (exhaustive)

1. `app/api/ai/validate/route.ts` — core rewrite. Replace the `anthropic.messages.create(...)` block + manual JSON parse + legacy mapping with: `fetchPromptBundle('resolve_validate_prompt', contentType)`, `runValidatedCompletion(...)`, then translation. Keep the `export const maxDuration = 300;` line. Keep `getUserLanguage` + `languageDirective` for the `languagePreamble` parameter.
2. `lib/ai/validate-translation.ts` — **new file.** Pure function `translateValidateOutput(dbOutput): ValidationScore`. Lives outside the route so it's unit-testable without the network. Exports the function plus an exported `MIN_TOTAL`, `MAX_TOTAL` constant pair documenting the score band ceiling/floor. ~80 LOC.
3. `lib/ai/validate-translation.test.ts` — **new file.** Unit tests covering: approved=true with min/max risks, approved=false with min/max risks, missing optional `missing` field, length-of-strengths/risks affecting band placement, verdict-string passthrough into `summary`. Uses `vitest`. ~150 LOC.
4. `app/api/ai/validate/route.ts` — second-pass adjustment after step 1: also fetch the project's `target_word_count` (if available via the project FK that the session attaches to) and pass as `target_length_words`. If unavailable, default to `'60000'`. Read `lib/ai/user-language.ts` to confirm pattern for `languagePreamble`; the existing route already calls `languageDirective(lang)` — the new path passes the same string into `runValidatedCompletion({ languagePreamble })`.

No other file is touched. ValidationScore type stays unchanged. ValidateScreen.tsx stays unchanged. propose-stronger/route.ts stays unchanged (it consumes ValidationScore but doesn't see the new shape).

## Translation map — concrete

The new file `lib/ai/validate-translation.ts` implements:

```ts
type DbValidate = {
  approved: boolean;
  verdict: string;          // 20-300 char descriptive sentence
  strengths: string[];      // 3-5 items
  risks: string[];          // 3-5 items
  missing?: string[];       // 0-3 items
  recommended_angle: string;
  reader_who_buys: string;
  comparable_books: string[];
};

export function translateValidateOutput(d: DbValidate): ValidationScore {
  // Step 1 — verdict band. Drives every numeric output.
  //   approved & risks ≤ 3       → STRONG
  //   approved & risks 4-5       → PROMISING
  //   !approved & risks ≤ 2      → RISKY
  //   !approved & risks ≥ 3      → RECONSIDER
  const band: ValidationScore['verdict'] =
    d.approved && d.risks.length <= 3 ? 'STRONG' :
    d.approved                        ? 'PROMISING' :
    d.risks.length <= 2               ? 'RISKY' :
                                        'RECONSIDER';

  // Step 2 — total score. Anchor per band, then ±5 from len(strengths)
  // and len(risks) so two STRONG verdicts with different evidence depth
  // don't both render 85. Clamp [0,100].
  const anchor = { STRONG: 88, PROMISING: 72, RISKY: 52, RECONSIDER: 28 }[band];
  const evidenceLift = Math.min(d.strengths.length, 5) - 3;   // -2 to +2
  const riskDrag = Math.min(d.risks.length, 5) - 3;           // -2 to +2 inverted
  const total = Math.max(0, Math.min(100, anchor + (evidenceLift * 2) - (riskDrag * 2)));

  // Step 3 — six-slot breakdown. The DB prompt holistically judges, so we
  // do NOT fabricate per-slot precision. Map the band to a uniform 0-10:
  //   STRONG = 8, PROMISING = 7, RISKY = 5, RECONSIDER = 3.
  // Then apply ±1 nudges from specific signals so the chart isn't a flat hex:
  //   targetAudience: +1 if reader_who_buys.length >= 60
  //   uniqueValue:    +1 if recommended_angle.length >= 60
  //   commercialViability: +1 if comparable_books.length === 3
  //   marketDemand:   +1 if reader_who_buys.length >= 80
  //   executionFeasibility: -1 if missing && missing.length >= 2
  //   authorCredibility: stays at base (no source signal in DB output)
  const base = { STRONG: 8, PROMISING: 7, RISKY: 5, RECONSIDER: 3 }[band];
  const clamp10 = (n: number) => Math.max(0, Math.min(10, n));
  const breakdown = {
    marketDemand: clamp10(base + (d.reader_who_buys.length >= 80 ? 1 : 0)),
    targetAudience: clamp10(base + (d.reader_who_buys.length >= 60 ? 1 : 0)),
    uniqueValue: clamp10(base + (d.recommended_angle.length >= 60 ? 1 : 0)),
    authorCredibility: base,
    commercialViability: clamp10(base + (d.comparable_books.length === 3 ? 1 : 0)),
    executionFeasibility: clamp10(base - ((d.missing?.length ?? 0) >= 2 ? 1 : 0)),
  };

  // Step 4 — surface fields.
  // summary  ← d.verdict (the 20-300 char descriptive sentence)
  // strengths ← d.strengths (passthrough)
  // weaknesses ← d.risks (rename, passthrough)
  // alternatives ← single-item array iff !approved OR (approved && d.missing?.length)
  //   { title: d.recommended_angle, estimatedScore: min(100, total + 15), reason: 'recommended angle from validator' }
  const alternatives = !d.approved || (d.missing && d.missing.length > 0)
    ? [{
        title: d.recommended_angle,
        estimatedScore: Math.min(100, total + 15),
        reason: 'Recommended angle from validator — addresses core concerns above',
      }]
    : undefined;

  return {
    total,
    breakdown,
    verdict: band,
    summary: d.verdict,
    strengths: d.strengths,
    weaknesses: d.risks,
    alternatives,
  };
}
```

Implementer should:
- Type the input strictly (DbValidate above) — do NOT use `any`. AJV has already validated the shape upstream so the cast is safe.
- Place this file at `lib/ai/validate-translation.ts`. Existing `lib/ai/` colocation pattern.
- Export `translateValidateOutput` as the named export.

## Route rewrite — concrete

Replacement structure of `app/api/ai/validate/route.ts`. Approximate, target ~120 LOC down from 158:

```ts
import { NextRequest, NextResponse } from 'next/server';
import { ValidationScore } from '@/types/agent-workflow';
import { modelFor, maxTokensFor } from '@/lib/ai/model-router';
import { createClient } from '@/lib/supabase/server';
import { getUserLanguage, languageDirective } from '@/lib/ai/user-language';
import { fetchPromptBundle, runValidatedCompletion } from '@/lib/ai/prompt-bundle';
import { translateValidateOutput } from '@/lib/ai/validate-translation';

export const maxDuration = 300;

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      topic,
      contentType,
      whyThisBook = '',
      targetAudience = '',
      targetLengthWords,
      authorBio = '',
    } = body;

    if (!topic) {
      return NextResponse.json({ error: 'Topic is required' }, { status: 400 });
    }

    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    const lang = user ? await getUserLanguage(supabase, user.id) : 'en';
    const langPrefix = languageDirective(lang);

    const docType = (contentType as string) || 'non-fiction';
    const bundle = await fetchPromptBundle(supabase, 'resolve_validate_prompt', docType);
    if (!bundle) {
      return NextResponse.json(
        { error: 'Validation prompt not configured for this content type' },
        { status: 500 },
      );
    }

    const result = await runValidatedCompletion({
      bundle,
      model: modelFor('validate_idea'),
      maxTokens: maxTokensFor('validate_idea'),
      vars: {
        topic,
        why_this_book: whyThisBook,
        target_audience: targetAudience,
        target_length_words: String(targetLengthWords ?? '60000'),
        document_type: bundle.documentType,
        author_bio: authorBio,
      },
      languagePreamble: langPrefix,
    });

    if (!result.ok) {
      console.error('[validate] runValidatedCompletion failed', result.error, result.lastErrors);
      return NextResponse.json(
        { error: 'Validation generation failed', detail: result.error },
        { status: 502 },
      );
    }

    const score: ValidationScore = translateValidateOutput(result.data as never);

    // Backwards-compat: prior callers received `{score, rubric}`. The legacy
    // `rubric` was the runtime rubric used for prompting; the DB-driven path
    // doesn't expose one in the ValidationScore-consumer's shape, so we omit
    // it. ValidateScreen.tsx never reads the response's `rubric` (verified
    // against the file as of this brief). Removing it is safe.
    return NextResponse.json({ score });
  } catch (error) {
    console.error('Validation error:', error);
    return NextResponse.json({ error: 'Failed to validate topic' }, { status: 500 });
  }
}
```

Implementer note: confirm via grep that no caller of `/api/ai/validate` reads `data.rubric`. The brief author already verified ValidateScreen + propose-stronger + editor/page.tsx; flag if you find another consumer.

## Acceptance tests

All must pass for merge.

1. `npx tsc --noEmit --ignoreDeprecations 6.0` passes against the full repo.
2. `npm test -- lib/ai/validate-translation.test.ts` passes (vitest, 8+ test cases).
3. **Synthetic end-to-end against staging Anthropic key**: POST `/api/ai/validate` with body `{topic: "How to negotiate a senior software engineering offer when you've never had FAANG experience", contentType: "non-fiction"}` returns 200 with a body shape matching the legacy `ValidationScore` interface. Specifically: `data.score.total` is a number 0-100, `data.score.breakdown` has all six camelCase keys with numbers 0-10, `data.score.verdict` is one of the four bands, `data.score.summary` is a string ≥20 chars.
4. **Sad-path schema retry**: ad-hoc test by deliberately setting an absurd `temperature: 1.5` once locally and confirming the retry loop catches and surfaces ajv errors instead of crashing. Don't ship the temperature override; this is just an acceptance check.
5. **Pie chart still renders**: visit `/projects/<test-project>/editor`, click "Validate Topic" on a fresh project, confirm the same UI loads with non-empty score, breakdown chart, summary text, strengths, weaknesses, optional alternatives.
6. **Rubric mismatch case**: POST with `contentType: "screenplay"` (which falls back to `fiction` per the resolver). Confirm response is 200 (not 500) and `score.summary` is non-empty.
7. **Missing prompt case**: simulate by passing `contentType: "definitely-not-a-real-type-zzz"`. The resolver's CASE returns `non-fiction` as the catch-all, so this should still 200, not 500. Document this in a code comment if the implementer re-confirms.
8. **propose-stronger cohabitation**: after a successful validate, click "Propose stronger version" in the UI. The follow-on `/api/ai/propose-stronger` call still works with the translated `ValidationScore` (it consumes `total`, `breakdown`, `verdict` — all present in the translated shape).

## Out of scope (DO NOT TOUCH)

- ValidationScore type definition in `types/agent-workflow.ts`.
- ValidateScreen.tsx.
- propose-stronger/route.ts.
- The editor's caller signature (`handleValidate(topic)`).
- `lib/ai/interview-questions.ts` (still used by `getValidationRubric` — but Phase 1 doesn't call that anymore, so it goes unused on the validate path; leave it for now, other consumers may exist).
- Any other AI agent route (research, writing, qa, cover, publishing — those are Phases 2-6).
- Rate limits, billing, audit logging.
- The DB prompt content itself (`validate_prompts.system_prompt`, `user_prompt_template`). Those are owned by the Founder for tuning post-launch.

## Rollback plan

Single revert: `git revert <merge-commit-sha>`. The new files (`validate-translation.ts`, its test) become orphans but are inert imports — no DB migration to unwind, no runtime side effect. Vercel auto-deploys the revert; validate route returns to the pre-Phase-1 inline path which is known-working (proven by The Rewired Self pipeline completing).

If the revert is needed mid-deploy and a session is in flight, the route's failure mode is a clean `500 { error: 'Failed to validate topic' }`, not a hang. The user retries; no data corruption.

## PR expectations

- Branch: `feat/ceo-043-phase1-validate-translation`
- PR title: `feat(validate): wire to DB prompt with translation layer (CEO-043 Phase 1)`
- Commit messages: conventional commits (`feat:` for the route, `test:` for the test file).
- One squash-merge to main. No multi-commit history needed.
- PR body should include: link to this brief, the 8 acceptance test results, and a one-line summary of `validate_prompts` row count + content types covered.

## Measurement

After merge, fire one fresh interview session (Founder or CEO Claude — does not require Founder approval). Compare time-to-validate-result and result quality against The Rewired Self's historical validate output (preserved in `interview_sessions.fb09f345….validation_data`). Improvement signal: response is faster (DB prompt is shorter), the `summary` reads as a single declarative sentence (not bullet-point soup), and the breakdown chart still renders without flat-hex artifacts.

If quality regresses on the same topic, the DB prompt itself needs tuning — that's Founder's job, not a code-level fix. Surface as a CEO-043 follow-up task, not a blocker on the merge.

## Phase 1.5 follow-up (do not include in this PR)

Extend the editor's project-setup screen to collect `whyThisBook` (one-line "why are you the right author") and `targetAudience` (one-line "who is this for") before triggering validate. Pass them to `/api/ai/validate`. The DB prompt's evaluation quality lifts measurably with these populated. Tracked as its own task post-merge.
