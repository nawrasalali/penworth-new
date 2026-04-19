# Phase 2.5 Item 3 — Mount Guard 404 Postmortem

**Date resolved:** 2026-04-19
**Time to resolution:** ~6 hours across 4 commits + 1 migration
**Author surface status at close:** Live in production, verified end-to-end
**Final commit:** `63bddf0` (Commit 15) + migration `nora_grant_select_auth_users_to_service_role`
**Go-live evidence:** conversation `7dc67030-0dc4-4ae6-8b25-e9268c9280c2` in `nora_conversations`, 3 turns, 1 usage row, zero 42501s post-migration (15:43:03 UTC)

---

## Symptom

Every `POST /api/nora/conversation/start` returned HTTP 404. Postgres audit log showed matching `42501 permission denied for table users` errors under `user=authenticator` at each click. Zero rows created in `nora_conversations`. Users saw a mount-guard failure on the Nora widget.

## Root cause (one sentence)

The `service_role` Postgres role lacked `SELECT ON auth.users`, which `v_nora_member_context` (a SECURITY INVOKER view) needs in order to join the `auth.users` table.

## The fix

```sql
-- migration: nora_grant_select_auth_users_to_service_role
GRANT SELECT ON auth.users TO service_role;
```

Postgres itself suggested this fix in the error `HINT` field. Impersonating the role from a Postgres console with `SET LOCAL ROLE service_role; SELECT * FROM v_nora_member_context;` surfaced the hint immediately.

## Why it took four commits to find

The initial verification of "can service_role read this view cleanly?" was performed using the Supabase MCP tool, **which connects as the `postgres` superuser role, not `service_role`**. `postgres` has SELECT on everything, including `auth.users`, so the verification returned the row and masked the missing GRANT. That false-positive sent us looking for a client-side auth bug that didn't exist.

The resulting commit arc:

| # | SHA | Hypothesis | Outcome |
|---|-----|------------|---------|
| 12 | `00485ac` | Schema fields wrong | ✅ Genuine fix — caught language, ended_at, role-split rows, stats UPDATE |
| 13 | `ab88578` | `@supabase/supabase-js` not attaching service key; fix via `global.headers.Authorization` pre-seed | ❌ Still 42501 — library docs said guard would preserve header, Postgres said otherwise |
| 14 | `5454e39` | Session leakage from `auth.getSession()`; fix via `detectSessionInUrl: false` flag trio | ❌ Still 42501 — the three flags control storage/refresh/URL-hash, not in-memory session |
| 15 | `63bddf0` | Library is fundamentally broken in this code path; bypass with raw `fetch` | 🔬 Surfaced `[raw-fetch-error]` 403 with 42501 body → proved it was NOT a library bug |
| — | migration | Postgres itself produced the fix hint when impersonated correctly | ✅ Resolved |

Commits 13/14/15 were chasing a non-existent client-side bug. The raw-fetch helper in Commit 15 *was* the diagnostic tool that finally proved the bug wasn't in our code — once raw fetch still returned 42501, the only remaining surface was the database itself.

## What we kept from the failed commits

All three are defensive improvements that earn their place in main:

- **Commit 13 (`global.headers`)** — reverted in Commit 14, so no residual code
- **Commit 14 (`detectSessionInUrl: false`)** — session hygiene for `createServiceClient`. Harmless and correct regardless of the 42501 root cause; keeps the server-side client cleanly isolated from any auth state
- **Commit 15 (raw-fetch bypass + 4 log prefixes)** — the log prefixes are how verification chat pinned the issue so fast on the final probe. The raw-fetch helper stays as a forcing function: if `createServiceClient` ever has a genuine library-level auth leak in future, this path is already proven to work around it

No revert needed on any of them.

## Triage protocol addition

> **When investigating an RLS or GRANT failure, never verify "role X can do Y" using a tool that runs as role Z.**
>
> If the symptom is a role-specific Postgres error (42501 is the canonical case), the very first triage step is to reproduce the failure while impersonating the same role the failing code uses. In Postgres:
>
> ```sql
> SET LOCAL ROLE <the_role_in_the_error>;
> <the_exact_query_the_code_ran>;
> ```
>
> This produces the same error the application sees, plus Postgres's `HINT` field, which often names the exact fix. Skipping this step to verify with a general-purpose connection tool (Supabase MCP as `postgres`, psql as the owner, Supabase Studio's SQL runner) hides the entire problem.

This rule applies beyond this incident. Any future triage of:

- `42501 permission denied` errors
- `insufficient_privilege` errors
- RLS policy failures
- Any "works in dev tool, fails in app" symptom

…starts with role impersonation before anything else.

## Secondary lessons

1. **When a library diff reads like "this should work" and production disagrees, the library is probably fine.** I read the compiled `fetchWithAuth` and `PostgrestClient` request builder in `@supabase/supabase-js@2.103.2` carefully enough to prove on paper that Commit 13's `global.headers.Authorization` pre-seed should have won the header race. It did. The failure wasn't in the library.

2. **Diagnostic logging that differentiates branches is worth more than diagnostic logging that fires everywhere.** The four distinct prefixes added across Commits 14-15 (`start`, `error`, `no-data`, `raw-fetch-error`) made the final diagnosis a grep-and-read exercise instead of a narrative reconstruction.

3. **Postgres error hints are reliable.** `HINT: GRANT SELECT ON auth.users TO service_role;` is not a guess. If the first triage step had surfaced this hint, the fix would have been a two-line migration applied in minutes.

## What's next

Phase 2.5 Item 3 (Nora support assistant, Tier 1 tools) closes. Tier 2 tools (60-min undo window) and Tier 3 (admin approval queue) are the next items in Phase 2.5's roadmap.
