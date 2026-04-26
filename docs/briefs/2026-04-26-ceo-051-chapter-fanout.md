# Brief: CEO-051 — write-book per-chapter Inngest fan-out

**Task code:** CEO-051 (priority p0)
**Authored:** 2026-04-26 by CEO Claude
**Owner:** Claude Code
**Expected completion:** 4–6 hours of agent work
**Repo:** github.com/nawrasalali/penworth-new

---

## Objective

Convert the body-section writing loop in `inngest/functions/write-book.ts` from a single sequential function into a fan-out: the orchestrator emits one `chapter/write` event per body section, each event spawns its own Inngest function instance (own retry/timeout/idempotency lane), and the orchestrator waits for all chapter completions before proceeding to back-matter and finalize. End state: a 9-chapter book finishes in ~slowest-chapter time instead of sum-of-chapters time, and one slow or failing chapter no longer blocks the rest.

---

## Context

`inngest/functions/write-book.ts` (961 lines, single file) is one Inngest function triggered by `book/write`. Its current shape, after `load-context` and `initialize-project`:

1. Front-matter loop (lines 282–337): for each front-matter section, `step.run('front-N', writeSection({kind: 'front_matter', ...}))`.
2. **Body loop (lines 340–401)**: for each body section (chapter), `step.run('body-N', writeSection({kind: 'body', ...}))`. Sequential.
3. Back-matter loop (lines 404–451): same pattern for back-matter.
4. `finalize` step (lines 454+): aggregate word count, mark project complete, mark agent completed, log final cost.

Each `step.run` is durable individually but they share **one wall-clock lifetime, one worker, one failure scope**. A slow chapter pauses every later chapter. A failing chapter on retry-3 fails the whole function. Per-book wall-clock at 9 chapters is currently 30–45 minutes; ideal is 3–5 minutes (one chapter's time).

The piece that makes fan-out cheap to implement here:
- **`writeSection` (lines 502–685) is already idempotent.** Migration 023 added a unique constraint on `chapters(project_id, order_index)`. `writeSection` short-circuits if a row already exists and uses `upsert` with `onConflict: 'project_id,order_index', ignoreDuplicates: true` to handle races. So multiple parallel invocations of the same chapter slot are already safe.
- **Heartbeat plumbing exists.** `pulseHeartbeat` / `withHeartbeatKeepalive` (`@/lib/pipeline/heartbeat`) — fan-out workers can reuse it as-is.
- **Inngest patterns already used here** — `step.run`, `step.event`-style events via `inngest.send`. We add `step.sendEvent` (used for fan-out) and `step.waitForEvent` (used for waiting for completions).

Founder's standing directive (logged on the task row): "ship as feature-flagged. CHAPTER_FANOUT_ENABLED env var, default off until I run a book on the new path."

---

## Files to touch

### NEW: `inngest/functions/write-chapter.ts`

A new Inngest function: `id: 'write-chapter'`, `triggers: [{ event: 'chapter/write' }]`, `retries: 3`. Handler receives one chapter's worth of input and:

1. Pulls everything it needs from the event payload (NOT from context — the orchestrator must serialize all needed inputs into the event so the worker is self-contained). The payload mirrors `WriteSectionInput` (lines 505–536 of `write-book.ts`) for `kind: 'body'`, with these fields:
   ```ts
   interface ChapterWriteEventData {
     // Identity
     projectId: string;
     userId: string;
     sessionId: string | null;
     // Slot
     orderIndex: number;
     bodyNumber: number;
     // Content
     title: string;
     description: string;
     keyPoints: string[];
     targetWords: number;
     // Shared book context (passed verbatim from orchestrator)
     docTitle: string;
     industry: string;
     meta: TemplateMeta;
     voiceProfile?: VoiceProfile;
     projectCtx: { chosenIdea: string; authorName?: string; ... };
     prior: string;
   }
   ```
2. `step.run('write', async () => { return writeSection({...}); })` — wraps the existing `writeSection` import. `writeSection` should be exported from `write-book.ts` (it currently isn't — see below) so this file can import it. **Do not duplicate `writeSection` — extract the existing one.**
3. After `writeSection` returns, emit `inngest.send({ name: 'chapter/completed', data: { sessionId, projectId, orderIndex, chapterId, wordCount } })` (or use `step.sendEvent` so it's durable). This is the signal the orchestrator's `step.waitForEvent` is listening for.
4. `onFailure` handler — log incident with `agent: 'writing'`, `severity: 'p3'`, `incidentType: classifyError(err)` (mirror the pattern at lines 364–384 of `write-book.ts`). The orchestrator's `step.waitForEvent` will time out and surface the failure.

### EDIT: `inngest/functions/write-book.ts`

1. **Export `writeSection`, `buildSectionPrompt`, `buildFlavoredSystemPrompt`, `WriteSectionInput`** so `write-chapter.ts` can import them. They're currently file-local. Promote to `export`. No behaviour change.
2. **Replace the body loop (lines 340–401) with a feature-flagged branch:**
   ```ts
   const fanoutEnabled = process.env.CHAPTER_FANOUT_ENABLED === 'true';
   if (fanoutEnabled && body.length > 0) {
     // FAN-OUT PATH
     // 1. Emit one chapter/write event per body section.
     await step.sendEvent('fan-out-chapters', body.map((b, i) => ({
       name: 'chapter/write',
       data: {
         projectId, userId, sessionId,
         orderIndex: orderIndex + i,
         bodyNumber: b.number,
         title: b.title,
         description: b.description,
         keyPoints: b.keyPoints || [],
         targetWords: b.estimatedWords || 3000,
         docTitle: title,
         industry,
         meta,
         voiceProfile: effectiveVoiceProfile,
         projectCtx,
         prior: '', // see "Out of scope" — prior-summary is sequential, fan-out drops it
       },
     })));
     // 2. Wait for each chapter/completed event matching this projectId + orderIndex.
     for (let i = 0; i < body.length; i++) {
       const expectedOrderIndex = orderIndex + i;
       const completion = await step.waitForEvent(`wait-chapter-${i}`, {
         event: 'chapter/completed',
         timeout: '15m', // per-chapter ceiling: 15 min covers Opus on a long chapter
         match: 'data.projectId',
         if: `event.data.projectId == '${projectId}' && event.data.orderIndex == ${expectedOrderIndex}`,
       });
       if (!completion) {
         throw new Error(`Chapter ${expectedOrderIndex} (body ${i+1}) did not complete within 15m`);
       }
       written.push({ chapterId: completion.data.chapterId, title: body[i].title, wordCount: completion.data.wordCount });
       await pulseHeartbeat(sessionId);
       // Update progress same way the sequential path does
       await supabase.from('projects').update({
         metadata: { totalChapters: totalSections, completedChapters: orderIndex + i + 1, lastUpdatedAt: new Date().toISOString() },
       }).eq('id', projectId);
     }
     orderIndex += body.length;
   } else {
     // SEQUENTIAL PATH (existing code, lines 340–401, unchanged)
     for (let i = 0; i < body.length; i++) { /* ... */ }
   }
   ```
3. **DO NOT touch front-matter, back-matter, or finalize.** Out of scope (see below).

### EDIT: `inngest/client.ts`

Add the two new event types alongside the existing exports:

```ts
export interface ChapterWriteEventData {
  projectId: string;
  userId: string;
  sessionId: string | null;
  orderIndex: number;
  bodyNumber: number;
  title: string;
  description: string;
  keyPoints: string[];
  targetWords: number;
  docTitle: string;
  industry: string;
  meta: import('./functions/write-book').TemplateMeta;
  voiceProfile?: import('./functions/write-book').VoiceProfile;
  projectCtx: {
    chosenIdea: string;
    authorName?: string;
    aboutAuthor?: string;
    citationStyle?: string;
    research: Array<{ title: string; url?: string | null; content_summary?: string | null; resource_type?: string }>;
    language: string;
  };
  prior: string;
}

export interface ChapterCompletedEventData {
  projectId: string;
  sessionId: string | null;
  orderIndex: number;
  chapterId: string;
  wordCount: number;
}
```

(If circular imports are awkward, define `TemplateMeta` and `VoiceProfile` in `inngest/client.ts` and have `write-book.ts` import from there. The current location is incidental — these are shared shapes.)

### EDIT: `inngest/functions/index.ts`

Add `writeChapter` to the exported function array so Inngest registers it:

```ts
import writeBook from './write-book';
import writeChapter from './write-chapter';
import restartAgent from './restart-agent';

export const functions = [writeBook, writeChapter, restartAgent];
```

(Confirm exact shape against current file — current file is 9 lines, simple aggregator.)

### EDIT: `vercel.json` or env-config doc

Document the new env var `CHAPTER_FANOUT_ENABLED`. Default unset (=> false). Add to whatever env-var inventory the repo maintains. Do NOT enable in production by default.

---

## Acceptance tests

Each must pass before the PR is mergeable. Run from the repo root.

1. **Typecheck:** `npx tsc --noEmit` passes with zero errors.
2. **Pre-push hook:** `git push` (the husky pre-push hook runs `tsc --noEmit | grep "error TS"` and rejects on any error). Confirms #1.
3. **Sequential path unchanged:** with `CHAPTER_FANOUT_ENABLED` unset, the existing test command for `write-book` (if any in the repo) still passes. If no test exists, manually inspect the diff of `write-book.ts` and confirm the existing `for (let i = 0; i < body.length; i++)` loop is reachable in the `else` branch unmodified.
4. **Fan-out path emits N events:** in a test or via reading the diff, verify `step.sendEvent('fan-out-chapters', body.map(...))` produces an array of `body.length` events, each with the correct `orderIndex`.
5. **Fan-out path waits N times with correct match expressions:** verify the orchestrator's `step.waitForEvent` is called once per body section with `if` containing both `projectId` and the expected `orderIndex`.
6. **Idempotency preserved:** spot-check that `writeSection`'s existing pre-flight check (`SELECT id FROM chapters WHERE project_id=X AND order_index=Y`) is still the first thing the worker does. The fan-out doesn't change this — but do confirm the worker calls into `writeSection` (not a duplicated copy).
7. **No drift in finalize:** the `finalize` step's `written.reduce(...)` and total-word-count logic must produce the same shape it does today. The fan-out path pushes to `written` with `{chapterId, title, wordCount}` — verify those three fields match what the sequential `result` object provides today (it does — see lines 561–565 of `writeSection`).

---

## Out of scope (DO NOT TOUCH)

1. **Front-matter and back-matter loops.** They stay sequential. They don't dominate wall-clock and the prior-context handoff (`written.map((w) => w.title).join(', ')`) is sequential by design for back-matter.
2. **`prior` text in fan-out path.** The sequential path passes `written.map((w) => w.title).join(', ')` so each chapter knows what came before. In fan-out, all chapters fire concurrently — there's no "prior" to pass. Just pass `prior: ''` in the fan-out event payload. Fixing prior-context for parallel chapters (e.g. pre-computing chapter summaries before fan-out) is a follow-up task, NOT part of this brief. Note in the PR description that this is a known regression scoped for follow-up.
3. **`onFailure` handler in `write-book.ts`** (lines 86–150). Stays as-is. It already handles the orchestrator's wall-clock failure. The new `write-chapter` function gets its own `onFailure` handler that logs incidents per chapter.
4. **Migration to a polling model** (orchestrator polls `chapters` table instead of `step.waitForEvent`). The task description mentions both options; this brief picks `step.waitForEvent` because it's idiomatic Inngest and preserves durability semantics. Do not introduce polling.
5. **CEO-049 heartbeat code.** The recently-shipped mid-step heartbeat still applies inside `writeSection` itself. Don't touch.
6. **Schema migrations.** No new tables or columns needed. The existing `chapters` table schema is sufficient.

---

## Rollback plan

If the fan-out path misbehaves in production:

1. **Immediate:** flip `CHAPTER_FANOUT_ENABLED=false` in Vercel env (Production target). Redeploy by triggering any deploy. Sequential path resumes within one deploy. No code revert needed.
2. **Full revert:** revert the merge commit. The `write-chapter.ts` file is new (delete-clean) and `write-book.ts` changes are isolated to the body-loop branch (the `else` path is the original code, so the diff is small and safe to revert).
3. **Data:** none. `chapters` rows already-written by the fan-out path are valid (idempotent inserts via existing unique constraint). Sequential resume on the same project will short-circuit on those rows via `writeSection`'s existence check (lines 553–566).

---

## PR expectations

- **Branch:** `feat/ceo-051-chapter-fanout`
- **PR title:** `feat(pipeline): per-chapter Inngest fan-out (CEO-051)`
- **PR body:** must include:
  - Summary of the fan-out path
  - The `CHAPTER_FANOUT_ENABLED=false` default-off behaviour
  - The known limitation on `prior` context (out-of-scope #2)
  - Confirmation of acceptance tests #1–7
  - Reference to this brief: `docs/briefs/2026-04-26-ceo-051-chapter-fanout.md`
- **Commit message format:** conventional commits, scoped `pipeline`. Example:
  ```
  feat(pipeline): per-chapter Inngest fan-out (CEO-051)

  Body-section loop in write-book.ts becomes feature-flagged: when
  CHAPTER_FANOUT_ENABLED=true, the orchestrator emits one chapter/write
  event per body section and waits for chapter/completed events to
  aggregate. Each chapter runs in its own Inngest function with its own
  retry/timeout/idempotency lane. Wall-clock for an N-chapter book drops
  from sum-of-chapters to ~slowest-chapter time.

  Sequential path retained as the else-branch and remains the default
  until the founder enables the flag in production.

  writeSection's existing project_id+order_index unique constraint
  (migration 023) provides the idempotency guarantee — fan-out parallel
  invocations are safe by construction.

  Out of scope: prior-chapter-context handoff (passed empty in fan-out
  path; follow-up task to pre-compute chapter summaries before fan-out).
  ```
- **No auto-merge.** The CEO Claude reviews the PR diff against this brief before merging.
- **Do not touch any file not listed in "Files to touch".** The only structural exception is "promote some private symbols to `export` in write-book.ts" — that is explicitly allowed and required.
