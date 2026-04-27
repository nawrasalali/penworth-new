# Brief: CEO-186 — Stripe + Auth + Pipeline test coverage

**Task code:** CEO-186 (linked to ceo_orchestration_tasks)
**Authored:** 2026-04-27 by CTO security/ops session
**Owner:** Claude Code
**Expected completion:** 2–3 days of agent work, dispatched in three independent PRs

---

## Objective

Add the highest-leverage missing test coverage so a regression on the new Stripe handler refactor (CEO-179), the rotated auth flow (CEO-180), or the writer pipeline orchestrator can't ship to production undetected. Codebase already runs Vitest in CI via the pre-push hook; this brief adds **targeted unit tests** for code paths that currently have none, plus stands up **Playwright** for two end-to-end happy-path flows that touch every layer.

This is not "100% coverage." This is "the critical paths that must not break silently."

---

## Context — what already exists, what doesn't

Existing test infrastructure (do not modify):
- `vitest.config.ts` configured. `npm run test` and `npm run test:watch` work.
- Nine unit-test files in `__tests__/` covering Guild application form, compliance flows, PDF export, Guild monthly close, Nora support agent (3 files), and reports builder.
- `playwright-core` is in `package.json` as a dependency but no Playwright config, no test files, no CI integration. Setup is required, not just wiring.

Coverage gaps that matter for launch (this brief targets these):

| Subsystem | Risk if regressed | Existing tests | Gap |
|---|---|---|---|
| Stripe webhook event dispatch | Customer billed but local mirror diverges → revenue/churn data corruption | none | full unit coverage of `lib/stripe/process-event.ts` |
| Stripe reconcile cron auto-replay | Failed events accumulate; alerting on but not fixing | none | unit tests around the new Step C in `inngest/functions/stripe-reconcile.ts` |
| Supabase auth signup with HIBP | Founder testers can't sign up; user-facing 500 with no error mapping | error-map.ts has no unit tests | unit test the `mapAuthError` for every code path |
| Writer pipeline orchestrator (writeBook + writeChapter fan-out) | Books fail to generate; user pays for nothing | none | unit tests that mock Inngest steps and verify the chapter fan-out + aggregation |
| Livebook enrolment (atomic credit debit + job INSERT) | User charged 1000 credits but no livebook generated | none | unit test the success + failure-rollback paths against the `enrol_listing_in_livebook` RPC |
| E2E: signup → first project create → run validate agent | Whole writer onboarding broken | none | Playwright happy path |
| E2E: Stripe checkout → webhook arrives → plan upgrade visible in UI | Whole monetisation path broken | none | Playwright happy path with Stripe test mode |

Out of scope for this brief (separate follow-up tasks):
- Visual regression tests (no Percy/Chromatic budget yet)
- Load tests (CEO-019 covers this separately)
- Tests for stable, low-churn surfaces already covered (Nora, Guild close, compliance)

---

## Files to touch

Phase 1 — Stripe coverage (smallest, ship first):
- `__tests__/stripe-process-event.test.ts` — NEW. Unit tests for every case in `processStripeEvent()`.
- `__tests__/stripe-reconcile-replay.test.ts` — NEW. Unit tests for the auto-replay loop.
- `__tests__/_helpers/stripe-fixtures.ts` — NEW. Shared Stripe.Event JSON fixtures.

Phase 2 — Auth + pipeline + livebook coverage:
- `__tests__/auth-error-map.test.ts` — NEW. Every branch of `mapAuthError`.
- `__tests__/livebook-enrolment.test.ts` — NEW. Atomic transaction success + rollback paths.
- `__tests__/write-book-fanout.test.ts` — NEW. Fan-out vs sequential branch with mocked Inngest steps.

Phase 3 — Playwright E2E:
- `playwright.config.ts` — NEW.
- `.github/workflows/e2e.yml` — NEW. Runs on PR + main.
- `e2e/signup-and-first-project.spec.ts` — NEW.
- `e2e/stripe-checkout-to-plan-upgrade.spec.ts` — NEW.
- `e2e/_helpers/auth.ts` — NEW. Signup/login helpers using a per-run unique email.
- `e2e/_helpers/stripe.ts` — NEW. Stripe test-mode card fill helpers.
- `package.json` — add `"e2e": "playwright test"` and `"e2e:ui": "playwright test --ui"`.

Repo state when brief is dispatched: main at `c3750b7` or later, includes the Stripe handler refactor at `5cac64c` and Vercel Firewall ship.

---

## Acceptance tests

Each phase ships as its own PR. Each PR must satisfy:

### Phase 1 acceptance (Stripe)

1. `npx tsc --noEmit` passes.
2. `npm run test` passes including the new files.
3. `__tests__/stripe-process-event.test.ts` covers, with at least one assertion each:
   - `checkout.session.completed` for subscription activation (Pro + Max, monthly + annual)
   - `checkout.session.completed` for credit pack purchase
   - `checkout.session.completed` for `metadata.type === 'guild_self_pay_deferred'` (the special branch that updates `guild_account_fees`)
   - `customer.subscription.updated` upgrade path (credits granted)
   - `customer.subscription.updated` downgrade path (credits NOT granted; plan changed)
   - `customer.subscription.deleted` (revert to free, run guild cancellation hook)
   - `invoice.payment_succeeded` with `billing_reason='subscription_cycle'` (credits reset, max-plan rollover applied)
   - `invoice.payment_succeeded` with `billing_reason='subscription_create'` (early-return, no credit reset)
   - `invoice.payment_failed` (`payment_status='past_due'`, 7-day grace)
   - `charge.refunded` (guild clawback called, audit log fired)
   - `charge.dispute.created` (guild clawback with `clawbackAll=true`)
   - Unhandled event type → returns `'unhandled'`
4. Each test mocks the Supabase client (use `vi.mock` with a factory), mocks the Stripe client (`stripe.subscriptions.retrieve`), and asserts on the resulting database calls (`.from('profiles').update(...)` etc.).
5. `__tests__/stripe-reconcile-replay.test.ts` covers:
   - 0 failed rows → no replays attempted
   - 5 failed rows, all succeed on replay → 5 marked `replayed`, 0 alerts emitted on success path (still emit if drift > 0)
   - 5 failed rows, 2 fail on replay → 2 retain `failed`, 3 marked `replayed`, error_message captured
   - Row with `retry_count = 3` → skipped, `skipped_too_many_retries` increments
   - Drift detection: 3 events from Stripe API not in db → `missing_in_db` array length 3
6. Tests run in under 30 seconds total on the existing CI machine class.

### Phase 2 acceptance (auth, livebook, pipeline)

1. `npx tsc --noEmit` passes; `npm run test` passes.
2. `__tests__/auth-error-map.test.ts` covers every branch of `mapAuthError`:
   - rate limit (status 429, message variations, code variations)
   - weak password (`code: weak_password`, message contains "pwned", message contains "weak password")
   - already registered (`code: user_already_exists`, `code: email_exists`, message variations)
   - invalid email (`code: email_address_invalid`, message variation)
   - email not confirmed
   - invalid credentials
   - network failure
   - signup disabled
   - null error → genericError
   - unrecognised error → genericError (no leak of raw Supabase text)
   For each: assert the correct `StringKey` was returned and that the resolved English string is a known good user-facing line.
3. `__tests__/livebook-enrolment.test.ts` covers the `enrol_listing_in_livebook` RPC:
   - Happy path: user has 1000+ credits, listing exists, style active → credits debited, `livebook_enrolled` flipped, job row inserted, returns `{ok: true, ...}`.
   - Insufficient credits: returns `{ok: false, reason: 'insufficient_credits'}`, NO database mutations.
   - Already enrolled: idempotent return `{ok: true, already_enrolled: true}`, NO duplicate job row.
   - Inactive style: returns `{ok: false, reason: 'invalid_style'}`.
   - Non-owner: returns `{ok: false, reason: 'not_owner'}`.
   For unit testing an RPC: mock the `supabase.rpc()` call shape; do NOT actually hit the database (Phase 3 will do real-DB tests).
4. `__tests__/write-book-fanout.test.ts` covers:
   - `CHAPTER_FANOUT_ENABLED` unset → uses sequential body loop, emits N `chapter/write` events serially, waits for each.
   - `CHAPTER_FANOUT_ENABLED=true` → registers all chapter waits up-front via Promise.all, emits all events together, aggregates results.
   - `chapter/completed` event with idempotency key collision → second emit is a no-op (relies on `project_id+order_index` unique constraint).
   Mock the Inngest `step.run`, `step.sendEvent`, `step.waitForEvent` primitives.

### Phase 3 acceptance (Playwright E2E)

1. `playwright.config.ts` configures: chromium project, baseURL = `https://new.penworth.ai` for prod-like or `http://localhost:3000` for local dev (use `process.env.BASE_URL`), one retry on CI, screenshots-on-failure, video-on-failure.
2. `npm run e2e` against a running local dev server passes both spec files end-to-end.
3. `e2e/signup-and-first-project.spec.ts`:
   - Generates a unique email `e2e-${Date.now()}@penworth-test.invalid`.
   - Signs up, asserts redirect to `/dashboard` or wherever post-signup lands.
   - Creates a new project, completes the validate stage with a one-line concept, asserts validate stage shows green checkmark.
   - Cleanup: at end of test, calls a test-only API route `/api/test-cleanup/delete-user-by-email` (NEW; gate by `NODE_ENV !== 'production'` AND a shared secret in `E2E_CLEANUP_SECRET`).
4. `e2e/stripe-checkout-to-plan-upgrade.spec.ts`:
   - Uses an existing pre-seeded test account (email + password from `E2E_TEST_USER_*` env vars).
   - Goes to `/billing` or wherever upgrade lives, clicks "Upgrade to Pro", arrives at Stripe Checkout.
   - Fills card `4242 4242 4242 4242` with future expiry + any CVC.
   - Submits, waits for redirect back to `/billing/success` or equivalent.
   - Polls `/api/me` (or wherever plan is exposed) for up to 60 seconds asserting `plan === 'pro'`.
   - Cleanup: at end of test, calls a test-only API to revert the test user to free tier.
5. `.github/workflows/e2e.yml` runs both specs on `pull_request` and on push to `main`. Uses `BASE_URL=http://localhost:3000` against a `next start` server in CI.
6. The two cleanup endpoints (`/api/test-cleanup/delete-user-by-email`, `/api/test-cleanup/reset-user-plan`) MUST refuse to run when `NODE_ENV === 'production'` AND must require `Authorization: Bearer ${E2E_CLEANUP_SECRET}`. Both checks together — fail-closed if either is missing.

---

## Out of scope

- Storage upload tests (no upload happens in either E2E flow).
- Multi-locale tests (English only for now).
- Mobile viewport tests (desktop chromium only for first cut).
- Visual regression diffs.
- Tests for the Nora support agent (already has 3 files of unit coverage).
- Tests for compliance flows (already covered in `__tests__/compliance*.test.ts`).
- Tests for Guild monthly close (already covered in `__tests__/guild-close.test.ts`).
- Tests for the PDF export pipeline (already covered in `__tests__/export-pdf.test.ts`).
- Performance / load tests (CEO-019 separately).
- Adding test coverage for newly-shipped features (livebook image library matching, chapter fan-out wall-clock targets, etc.) beyond what the acceptance tests above already specify.

---

## Rollback plan

Each phase ships as its own PR — easy to revert independently if any one is flaky in CI without reverting the others.

If a Playwright spec is flaky (intermittent failure rate > 5%): mark `.fixme()` with a comment explaining the flake, file a follow-up task; do NOT remove from CI silently.

If the test-cleanup endpoints introduce a security risk (bug in the prod-guard): immediately revert their PR + rotate `E2E_CLEANUP_SECRET`. The endpoints have no other code dependencies.

---

## PR expectations

- Branches: `tests/ceo-186-phase-1-stripe`, `tests/ceo-186-phase-2-units`, `tests/ceo-186-phase-3-e2e`.
- PR titles:
  - `tests(stripe): unit coverage for process-event + reconcile-replay (CEO-186 phase 1)`
  - `tests: auth-error-map + livebook-enrolment + write-book-fanout coverage (CEO-186 phase 2)`
  - `tests(e2e): Playwright signup + Stripe-checkout happy paths (CEO-186 phase 3)`
- Each PR's body should reference the acceptance tests above as a checklist with checkmarks.
- Each PR must pass the existing pre-push Husky hook (`npx tsc --noEmit` + `vitest run` for the unit ones; for phase 3, the typecheck plus `playwright install --with-deps chromium` step in CI).

---

## What the next CTO session should verify after merge

For each PR after merge to main:
1. Watch one CI run end-to-end, confirm green.
2. Spot-check the test files for: real assertions (not just `expect(...).toBeDefined()` filler), no skipped/`.fixme` tests, no commented-out code.
3. For phase 3: confirm the cleanup endpoints respect the production guard by hitting them on the live `new.penworth.ai` deploy with a bogus token — must return 401 or 403, never 200.
4. Update CEO-186 task to `done` with the three commit SHAs.
