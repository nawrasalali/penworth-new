# Claude Code Runbook — for the CEO session

Claude Code is Anthropic's terminal-and-web coding agent. It reads a repo, edits files, runs commands, and opens PRs autonomously. This runbook describes when the CEO Claude uses it and how.

---

## The founder never touches Claude Code

The Founder has explicitly said: "I don't want to learn Claude Code." Correct answer: I operate it so they don't have to.

---

## When I use Claude Code vs. when I do work directly

### I do the work directly (in the current CEO conversation)

- ≤3 files to touch
- Well-scoped, unambiguous
- ≤30 minutes of my own time
- Requires Supabase writes (I have MCP access; Claude Code does not by default)
- Requires inline debugging against live production

Method: clone repo in `/tmp/`, edit, typecheck, commit, push. Verify in Supabase + Vercel.

### I dispatch to Claude Code

- 4+ files to touch
- Involves large-scale refactor (monorepo consolidation, test suite expansion)
- Involves long-running work that would exhaust my session's context
- Independent enough that acceptance criteria can be written upfront
- Does not require DB writes during execution (Claude Code talks to GitHub only; DB writes are either in migrations I pre-author or Founder-authorised via a PR)

### I never dispatch to Claude Code

- Anything touching production Stripe (live-mode product creation, refund processing)
- DNS changes
- Secret rotation
- Anything marked `priority='p0'` without my direct oversight

---

## How a Claude Code dispatch works

### Step 1 — I author the brief

I commit a brief to the repo at `docs/briefs/YYYY-MM-DD-<slug>.md`. The brief must contain:

- **Objective** — one sentence, what done looks like
- **Files to touch** — exhaustive list
- **Acceptance tests** — how the PR will be verified before merge
- **Rollback plan** — if it ships and breaks, how to undo
- **Out of scope** — explicit list of things Claude Code must not touch
- **Expected PR output** — commit message, branch name, PR title

Brief template:

```markdown
# Brief: {slug}

**Task code:** CEO-XXX (links to ceo_orchestration_tasks row)
**Authored:** YYYY-MM-DD by CEO Claude
**Owner:** Claude Code
**Expected completion:** N hours of agent work

## Objective
{one sentence}

## Context
{2-3 paragraphs. Include repo state, relevant prior commits, any DB state the implementer needs to know.}

## Files to touch
- `path/to/file.ts` — {what changes}
- ...

## Acceptance tests
1. `npx tsc --noEmit` passes.
2. {specific behavioural test with exact command to run}
3. ...

## Out of scope
- {explicit don't-touch list}

## Rollback plan
{one paragraph on how to revert if the change misbehaves in prod}

## PR expectations
- Branch: `feat/{slug}`
- PR title: `feat: {slug}`
- Commit message: {template}
```

### Step 2 — I invoke Claude Code

I use the Claude Code CLI (`claude` in terminal, or `claude.ai/code` on web) from my bash_tool environment:

```bash
# From /tmp/penworth-new, having just pulled latest main:
claude --repo github.com/nawrasalali/penworth-new \
       --brief docs/briefs/YYYY-MM-DD-slug.md \
       --open-pr
```

If Claude Code CLI isn't available in the CEO session's environment, I use the web version by fetching `https://claude.ai/code?brief=...` — but this path requires a human click-through, which the Founder wants to avoid. Therefore I exhaust the CLI path first.

### Step 3 — I verify the PR

When Claude Code opens a PR, I:

1. Fetch the PR diff via GitHub API
2. Walk through it file by file against my brief's "Files to touch" list
3. Run the acceptance tests manually (typecheck; spot-check behaviour; confirm no out-of-scope changes)
4. If clean: merge via GitHub API, update the task row to `done`.
5. If issues: leave a review comment with specific asks, let Claude Code iterate, re-verify.

### Step 4 — I report to the Founder

I update the Founder in the next daily brief: "{feature} shipped, commit {sha}, deploy {status}."

---

## Claude Code versus the verification MCP chat

These are different tools for different jobs.

**Claude Code:** writes application code. Lives in the GitHub repo. Stateless across invocations (reads repo fresh each time).

**Verification MCP chat:** verifies Supabase state, applies migrations, probes live DB. Has direct Supabase MCP access. Useful for: "did migration X apply?", "why is this RLS policy blocking?", "is this function actually called?".

I, the CEO Claude, have both capabilities in my session (bash + Supabase MCP), so I rarely need to dispatch to a separate verification chat. I dispatch only when:

- I want a clean verifier that hasn't been biased by the implementation context
- I need to run a long verification that would consume my session's context

---

## Safety rails

1. Every Claude Code dispatch references a specific `ceo_orchestration_tasks` row. No off-the-books work.
2. Claude Code branches are always `feat/`, `fix/`, `refactor/`, `docs/`, or `chore/` — never direct to main.
3. I review every Claude Code PR against my brief before merging. No auto-merge.
4. If Claude Code makes a change outside the brief's scope, I reject the PR, not accept it.
5. I never hand Claude Code a brief without an acceptance test. The brief is the contract; the acceptance test is how I enforce it.

---

## What I do when Claude Code is unavailable

Rare scenario: the CLI fails, the web interface is down, the Founder has burned their Anthropic quota. I fall back to doing the work directly in my own session. This is slower but not blocked. Every task in the backlog is doable by me alone — Claude Code is an accelerator, not a dependency.
