# Session handover — 2026-04-21 19:05 UTC

**CEO session by:** claude-opus-4-7
**Duration:** ~40 min
**Outcome:** CEO-021 cutover **aborted at Step 0 (pre-flight)**. Team-wide Vercel 503 "DNS cache overflow" discovered and logged as **CEO-028 (p0, awaiting Founder)**. Not a deploy bug — a Vercel platform/account issue that needs Vercel support.

---

## Starting state

- Founder in-conversation said: "Execute CEO-021" (the penworth.ai → new platform cutover).
- Prior handover (`2026-04-21-1800-ceo021-vercel-tooling-handover.md`) flagged tooling blockers: read-only Vercel MCP, and `api.vercel.com` blocked by the bash egress proxy (`x-deny-reason: host_not_allowed`).
- This session discovered the tooling blockers **no longer apply**: `bash_tool` network config has `Allowed Domains: *` with no deny, and `curl https://api.vercel.com/*` works end-to-end with the Vercel API token.

## What actually happened

1. Loaded Supabase + Vercel MCPs, marked CEO-021 `in_progress`.
2. Verified auth against Vercel API. **Found a typo in the project-instructions** — see "Correction to project instructions" below.
3. Ran Step 0 pre-flight: inventory OLD + NEW project domains, confirm NEW deployment READY, check signup flow on `new.penworth.ai`.
4. **Pre-flight failed.** Every Vercel deployment on the team returns HTTP 503 with body "DNS cache overflow" from the edge.
5. Ran 8 follow-up diagnostics (redeploy, other-project tests, static-path tests, upstream-reachability tests, billing/suspension check). Concluded: Vercel-side platform issue, not fixable by any code or config change.
6. Aborted CEO-021 in the database, opened CEO-028 incident with full diagnostic dump.

## The 503, verified

Error signature:
```
HTTP/2 503
content-length: 18
content-type: text/plain

DNS cache overflow
```

Scope of affected URLs (all tested multiple times this session):

| URL | Result | Note |
|---|---|---|
| `penworth.ai` | 503 every request | OLD custom domain |
| `new.penworth.ai` | flaky 200↔503 | Edge cache HITs mask origin |
| `penworth-new.vercel.app` | 503 every request, every path incl `/robots.txt` | NEW canonical |
| `guild.penworth.ai` | 503 | |
| `store.penworth.ai` | 503 | |
| `command.penworth.ai` | 503 / 404 "deployment not found" | |
| 3 older NEW deployment URLs | 503 every path | Hours old, cache-busted |
| Fresh redeploy `dpl_B4jdFCAhG1Ls5zj3JVivMqwbAoGV` (built READY in 5s) | 503 every path | Proves not a deploy bug |
| `project-zeoe1.vercel.app` | 200 | `x-vercel-cache: HIT` — stale |

What was ruled out:
- Not deployment protection (SSO/password null on NEW project)
- Not a code bug (3 different old deploys + 1 fresh deploy all fail identically)
- Not team suspension (billing status `active`, `plan=pro plus`, `softBlock=null`, `blocked=null`, `featureBlocks={}`)
- Not a Vercel-wide incident (status.vercel-status.com: only Observability degraded)
- Not upstream DNS (Supabase / Stripe / Anthropic all reachable from bash)
- Not runtime error inside the Next.js app (error body is served by the Vercel edge, not the app; confirmed via HTTP/2 response with Vercel date header, and zero app logs for the failing requests)

Only plausible remaining cause: **something wrong at Vercel's edge for this specific team, account, or region**. Needs Vercel support.

## What was committed this session

**DB only. No code changes.** All via Supabase MCP:

- `ceo_orchestration_tasks` UPDATE: CEO-021 → `status='blocked'`, `blocker='CEO-028: Vercel team-wide 503...'`, `last_update_note` appended with full session trace.
- `ceo_orchestration_tasks` INSERT: CEO-028 (p0, awaiting_founder, category=infra, full diagnostic + Vercel support message in `last_update_note`).
- `pipeline_incidents` INSERT: `incident_type=infrastructure_error`, `severity=p0`, error_details JSONB with reproducer URL and affected domains.
- `audit_log` INSERT: `action=admin.override`, `entity_type=ceo_task`, `severity=critical`.

No git commits to `main` other than this handover note.

## Correction to project instructions (please fix once, Founder)

The Vercel team ID in the project-instructions field has an extra trailing `W`:

```
Wrong:    team_6YlFO6rqSl9ouKa8UkeoUEwmW   (29 chars)
Correct:  team_6YlFO6rqSl9ouKa8UkeoUEwm    (28 chars)
```

Using the wrong ID, `https://api.vercel.com/v2/teams/{id}` returns `{"error":{"code":"forbidden","message":"Not authorized"}}`. This session worked around it by reading the correct ID from `/v2/teams` and substituting. The one-line fix in project instructions means the next session doesn't have to discover this.

## What the Founder needs to do (required before CEO-021 can proceed)

**Open a Vercel support ticket. Draft provided in CEO-028's `last_update_note` — the founder-brief message for this session has it as copy-pasteable text.**

Key asks in the ticket:
- What is the "DNS cache overflow" 503 error?
- Why is every deployment across team `team_6YlFO6rqSl9ouKa8UkeoUEwm` returning it at origin?
- Fresh redeploys also 503 — so it's not a build-artifact issue. What's happening at the edge?
- Reproducer URL: `https://penworth-9xepo4gqu-nawraselali-2147s-projects.vercel.app/`

Urgency: all three brand domains are effectively down at the origin. Edge caching masks some of it for returning users on warm paths but new users / uncached paths see the 503.

## What the next session should do

Before doing anything else:

1. Check CEO-028's status. If Founder has heard back from Vercel support, follow any guidance they gave. If not yet resolved, proceed to step 2.
2. Run the cheap diagnostics again to see if the 503 cleared on its own:
   - `curl -sI https://penworth-new.vercel.app/robots.txt?cb=$RANDOM` — if 200, platform is back.
   - `curl -sI https://penworth.ai/?cb=$RANDOM` — same check on OLD custom domain.
3. If 503 cleared → run CEO-021 Step 0 pre-flight in full. If green, execute Steps 1-9 of the runbook in `ceo_orchestration_tasks` CEO-021 `last_update_note`. All the raw API calls needed are documented in that row.
4. If 503 persists and Vercel still investigating → do not cutover. Instead, in parallel: (a) try deploying a trivial static-only Next.js project to a new Vercel project in the same team to see whether the issue reproduces in isolation (if yes, account-wide; if no, project-specific); (b) check whether the team region `syd1` can be switched to `iad1` as a workaround.
5. If Vercel support confirms it requires a team-level action the Founder must authorise (region move, plan change, escalation), log that as a new `awaiting_founder` task and wait.

**What the next session should NOT do:**
- Don't ask the Founder about Vercel MCP connectors, Chrome extension, or tokens — setup is done.
- Don't try to "fix" the 503 by redeploying. I already tried. It's not code.
- Don't cutover penworth.ai to NEW while the 503 persists. Would convert a zero-user issue into a production-domain outage.

## Stable references

- CEO-021 task row: `SELECT * FROM ceo_orchestration_tasks WHERE task_code='CEO-021';` — full runbook in `last_update_note`
- CEO-028 task row: `SELECT * FROM ceo_orchestration_tasks WHERE task_code='CEO-028';` — full incident diagnostic in `last_update_note`
- This handover: `docs/orchestration/handovers/2026-04-21-1905-ceo021-vercel-platform-503-blocker.md`
- Prior handover: `docs/orchestration/handovers/2026-04-21-1800-ceo021-vercel-tooling-handover.md`
