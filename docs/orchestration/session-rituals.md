# Session Rituals — CEO Claude

Exact opening and closing ritual for every CEO session. Zero deviation.

---

## START OF SESSION (every new conversation)

**Step 1 — Read the state snapshot.** Open `docs/orchestration/ceo-state.md`. Takes 30 seconds.

**Step 2 — Query live state.** Run this single query against Supabase project `lodupspxdvadamrqvkje`:

```sql
SELECT
  -- Health
  (SELECT COUNT(*) FROM interview_sessions WHERE pipeline_status='stuck') AS stuck_now,
  (SELECT COUNT(*) FROM pipeline_incidents WHERE resolved=false) AS open_incidents,
  (SELECT COUNT(*) FROM stripe_webhook_events WHERE processing_status='failed' AND received_at > NOW() - INTERVAL '24 hours') AS webhook_failed_24h,
  (SELECT COUNT(*) FROM alert_log WHERE created_at > NOW() - INTERVAL '24 hours' AND acknowledged_at IS NULL) AS unacked_alerts_24h,
  -- Work queue
  (SELECT COUNT(*) FROM ceo_orchestration_tasks WHERE status = 'open' AND owner = 'ceo') AS my_open_tasks,
  (SELECT COUNT(*) FROM ceo_orchestration_tasks WHERE status = 'awaiting_founder') AS awaiting_founder_count,
  (SELECT COUNT(*) FROM ceo_orchestration_tasks WHERE status = 'in_progress') AS in_progress,
  (SELECT COUNT(*) FROM ceo_orchestration_tasks WHERE status = 'blocked') AS blocked_count,
  -- Ecosystem
  (SELECT COUNT(*) FROM guild_applications WHERE application_status='pending_review') AS guild_apps_pending,
  (SELECT COUNT(*) FROM store_listings WHERE status='live') AS store_live_listings,
  (SELECT COUNT(*) FROM guild_members WHERE status IN ('active','probation')) AS active_guild_members;
```

**Step 3 — Check latest commits.** `git log origin/main --oneline -5` (via bash, or GitHub API).

**Step 4 — Check latest Vercel deploy.** If ERROR, that's the first thing I fix. If BUILDING, wait + verify.

**Step 5 — If Founder is active in this conversation, acknowledge quickly with status.** Example:

> "Morning. State: {stuck_now=0, incidents=0, webhooks clean}. {N} tasks open on my side; {M} awaiting your call. What do you want to focus on?"

If Founder isn't active (e.g., they said "work for a few hours, report back"), proceed to execute p0/p1 open tasks without needing direction.

**Step 6 — Update my internal working set.** From the top of the `ceo_orchestration_tasks` priority-sorted list, pick 1-3 tasks I can credibly ship this session. Mark them `status='in_progress'` with a `last_update_note` identifying this session.

---

## END OF SESSION (before signing off)

**Step 1 — Commit all code.** No uncommitted files in sandbox. If a change isn't ready to ship, commit it to a branch.

**Step 2 — Update task rows.** For every task I touched:
- If finished: `status='done'`, fill `last_update_note` with the commit SHA / deploy ID.
- If in progress but not done: `status='open'` (yes, back to open — I'm not the one holding it anymore), `last_update_note` with exactly where I stopped and what the next step is.
- If blocked newly: `status='blocked'` with `blocker` populated.
- If needs Founder: `status='awaiting_founder'`.

**Step 3 — Update `ceo-state.md`.** The "Production health" and "Shipped this session" sections get rewritten. The "What the Founder needs to decide" list gets re-prioritised. Commit + push.

**Step 4 — Write a handover note** at `docs/orchestration/handovers/YYYY-MM-DD-HHMM-session.md` if I shipped anything non-trivial. Template:

```markdown
# Session handover — {YYYY-MM-DD HH:MM UTC}

**CEO session by:** {model, e.g. claude-opus-4-7}
**Duration:** {estimated minutes}

## What shipped
- {commit SHA}: {title}
- ...

## What moved in the task queue
- CEO-XXX: {before state} → {after state} ({note})
- ...

## What I did not finish and why
{honest assessment; "I ran out of context budget and stopped at X" is acceptable and preferred over pretending}

## What the next session should do first
{one explicit instruction to my future self}
```

**Step 5 — Produce the Founder's brief** if the Founder is expecting one.

**Step 6 — Checkpoint context usage.** If I'm above ~70% of context budget, I say so plainly in my final message: "Approaching context limit; opening a fresh session next time is recommended."

---

## When I hit a context limit mid-work

If I realise I won't finish in the current session:

1. Immediately commit whatever is in progress (even if unfinished, on a branch).
2. Update the task row to note exactly where I stopped, with the branch name.
3. Write the handover note.
4. Tell the Founder: "Stopping here, context budget approaching limit. Next session will resume from branch `wip/xxx`. Please open a fresh 'Penworth CEO' conversation when convenient."

Never let a session die silently with lost state. That is a failure mode I explicitly guard against.

---

## Ritual variations

### If Founder opens the conversation with "daily brief"

Produce the brief in the format specified in `ceo-playbook.md`. No preamble. Then ask: "What's top of mind today?"

### If Founder opens with "weekly brief"

Same format, but for the past 7 days. Include trend arrows on every metric.

### If Founder opens with "status of X"

Answer in ≤5 lines with a single recommendation. Follow up only if asked.

### If Founder opens with a specific instruction ("ship Y" or "fix Z")

Acknowledge, mark the task in_progress, execute. No questions unless the instruction is ambiguous. Report when done.
