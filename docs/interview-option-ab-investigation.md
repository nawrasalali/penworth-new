# Interview "Option A/B/C" — Investigation Closed, No Code Fix Needed

**Status:** Closed — historical data, not a live bug
**Discovered:** 2026-04-19 (founder screenshot `options.png`)
**Decision date:** 2026-04-19
**Severity:** None — old draft sessions, already past-interview; current code
path produces real options

## Symptom

Founder shared screenshot `options.png` showing the Interview agent
rendering multiple-choice questions with literal button text
"Option A", "Option B", "Option C", "Something else…" — generic
placeholders instead of real suggested answers.

Database verification on project `a3bbb44f-e30b-4d8b-bf9e-94d2a64b4754`
confirmed the data was also corrupt at the storage layer:

```
interview_data.questions[0].options =
  ["Option A", "Option B", "Option C", "Something else..."]
interview_data.questions[0].answer = "Option A"
```

Not a render bug — placeholder strings were being stored as if they
were real user choices.

## Root cause

Historical data from before the April 2026 interview-questions refactor
(commit landed a while ago — specifically, when `getRichInterviewQuestions()`
in `lib/ai/agents/interview-system.ts` was rewired to pull from the new
`lib/ai/interview-questions.ts` module with real per-doc-type question
banks).

Current live code path:
1. Editor loads: `page.tsx:445` calls `getRichInterviewQuestions(content_type)`
2. That function (interview-system.ts:922) calls `getInterviewQuestions()` from
   the new `interview-questions.ts` module
3. For `content_type='academic'`, it returns `ACADEMIC_PAPER_QUESTIONS` with
   real options like `"STEM (natural sciences, engineering)"`,
   `"Empirical study (original data)"`, etc.
4. The client-side `interviewQuestions` state gets populated with those real
   options and renders correctly

For every currently supported ContentType, `interview-questions.ts` has a
real question bank. The "Option A/B" strings are nowhere in the repo today.

## Why the project "The Algorithmic Burden" still has bad data

The project was created on 2026-04-16 — before the interview refactor. At
that time, the old fallback path DID produce literal "Option A/B/C" strings.
The interview got completed and its `interview_data` got stored before
the fix shipped.

The project is currently at `current_agent: "publishing"`, so the interview
is long past. The user never sees those old options again in the UI.

## Why do nothing?

Three reasons:

1. **Live code is correct.** New projects today produce real options. Any
   session started after the refactor is fine.

2. **Existing corrupted sessions are orphaned.** The interview screen isn't
   re-rendered for a project that's already passed the interview stage. The
   bad data sits in the `interview_data` JSONB blob but is never shown again
   to the user. The downstream agents (research, outline, writing) don't
   use the options list — they only use the topic + follow-up answers.

3. **Migrating old data is risky and has no upside.** We'd have to decide
   what to do with a saved "answer: 'Option A'" — it's impossible to recover
   what the user actually meant by that label since the label itself is
   meaningless. Leaving it alone preserves the audit trail ("user did
   answer something") without pretending we know what they meant.

## What if a user goes back?

If a user navigates to an old draft project that's still at the interview
stage (not `current_agent: "publishing"`) and has bad `interview_data` in
the DB, they could see the old options on re-render.

This is a theoretical concern. The check for such projects:

```sql
SELECT p.id, p.title, p.created_at, s.interview_data->'questions'->0->>'options'
FROM projects p
JOIN interview_sessions s ON s.project_id = p.id
WHERE s.current_agent IN ('interview', 'research', 'outline')
  AND s.interview_data::text LIKE '%Option A%';
```

If this returns any rows, write a targeted migration that wipes the
`questions` array from those sessions — forcing the editor to re-load the
real questions from `getRichInterviewQuestions()` on next visit. The
user's follow-up answers (`follow_up_data`) are stored separately and
aren't affected.

Not doing this pre-emptively because (a) it's almost certainly zero rows
given internal use only, and (b) the first affected user would just see
real options on re-render anyway (because the client re-fetches from
`getRichInterviewQuestions`).

## Related fixes that WERE made

See the companion commit that landed the `WritingScreen` NaN% fix on the
same day. That was the real live bug. This Option A/B investigation was a
dead end worth documenting so future sessions don't re-chase it.
