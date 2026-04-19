# Compliance Deletion Auto-Fulfilment — Design Document

**Status:** Design / Pre-implementation
**Author:** Claude (Opus 4.7)
**Date:** 2026-04-19
**Target implementation:** Multi-session
**Related commits:** `6cd5688` (export auto-fulfilment — the mirror of this design)

## Purpose

Ship a one-click admin endpoint that fulfils a `data_deletion_requests` row
end-to-end: removes every row of user-scoped data across the database,
deletes the `auth.users` row last, updates the request state to
`completed`, writes an audit entry, and emails the user a confirmation.

This mirrors the export auto-fulfilment shipped in `6cd5688`, but is
**destructive** and therefore needs significantly more architectural
care. The export engine can afford to be tolerant of per-table failures
(a manifest entry with `status: error` is acceptable). The deletion
engine cannot — a partial deletion that reports `success: true` is a
data-leak masquerading as a compliance action.

## Current State

`data_deletion_requests` table exists (migration 017) with the lifecycle
`received → processing → completed | rejected | failed`. Today, admin
moves requests through this lifecycle **manually**: SQL statements issued
in FK dependency order by hand, notes recorded on the row, state
transitioned via the admin dashboard PATCH endpoint (`281b2b9`).

The footer on `/admin/compliance` explicitly documents this manual
process (`2518a56`):

> Deletions: still manual. Admin runs DELETE statements in FK
> dependency order, records manifest + notes, transitions to
> completed.

This is a regulatory embarrassment for a platform operating in 9
jurisdictions. Every manual admin run is a risk of a missed table, an
incomplete delete, or a human-error inconsistency between the
compliance record and the actual data state.

## The Naive Mental Model (and why it's wrong)

The obvious approach, mirrored from the export engine:

1. Walk a registry of 45 user-scoped tables
2. Topologically sort them by FK dependency
3. Issue `DELETE FROM {table} WHERE {user_column} = $user_id`
4. Finally `DELETE FROM auth.users WHERE id = $user_id`

This is wrong for Penworth's schema because the database already knows
the dependency graph via `ON DELETE` actions. A sort of the registry
would be re-deriving information pg already has, and would miss the
real problem — which isn't sorting, it's the non-CASCADE FKs.

## The FK Graph (empirically surveyed, 2026-04-19)

Source: `pg_constraint` query over `public` + `auth` schemas, filtered
to `contype = 'f'`. 175 FK relationships total.

### Category 1: CASCADE from `auth.users` — ~30 tables

These tables will be **automatically cleaned up** by Postgres when
`DELETE FROM auth.users WHERE id = $user` runs. No explicit action
required from the deletion helper.

Direct CASCADE children of `auth.users`:

- `audiobook_chapters`
- `collaborators.owner_id`
- `computer_use_sessions`
- `consent_records`
- `data_deletion_requests.user_id` (self-referencing — the deletion
  request being processed will cascade-delete itself; handle carefully,
  see Architectural Challenge 3)
- `data_exports.user_id`
- `guild_advisor_usage`
- `guild_members`
- `interview_sessions`
- `nora_conversations`
- `nora_usage`
- `profiles.id`
- `publishing_credentials`
- `publishing_metadata`
- `publishing_records`
- `store_admins.user_id`
- `store_author_credentials.author_id`
- `store_author_profiles.user_id`
- `store_follows.author_id`
- `store_listings.author_id`
- `store_publish_drafts.author_id`
- `store_readers`

Plus every `auth.*` table (sessions, identities, mfa_*, oauth_*, etc.)
which CASCADE back to `auth.users`.

Transitive CASCADEs (these are cleaned up automatically when their
parent CASCADE children are deleted):

- `chapters` → `projects` CASCADE (and `projects` has SET NULL to
  `profiles`; but profiles CASCADEs to auth.users, so deleting
  auth.users cascades to profiles which then... see Architectural
  Challenge 2 below)
- `chapter_regenerations` → `chapters` / `projects` CASCADE
- `ai_sessions.project_id` → `projects` CASCADE
- `nora_turns` → `nora_conversations` CASCADE
- `computer_use_events` → `computer_use_sessions` CASCADE
- `marketplace_listings.seller_id` CASCADE profiles (but marketplace_*
  tables have their own sub-tree of CASCADEs)
- `research_resources` → `interview_sessions` CASCADE
- `cover_regenerations` → `interview_sessions` CASCADE
- `sources` → `projects` CASCADE
- `support_ticket_replies.ticket_id` → `support_tickets` CASCADE
- All `guild_*` member-scoped tables CASCADE via `guild_members`
  (except the four RESTRICT ones, see below)
- `share_link_clicks` → `share_links` CASCADE
- Multiple `store_*` tables CASCADE via `store_listings` / `store_readers`

### Category 2: SET NULL from `auth.users` — ~7 tables

Rows remain in the table, with the user_id column set to NULL. This
is the correct GDPR handling for audit trails where the user was the
actor — the event record must persist, but the actor's identity is
erased.

- `ai_sessions.user_id` — analytics
- `audit_log.actor_user_id` — **critical**: audit log of admin actions
  this user performed as an admin stays intact but anonymised. Matches
  legal requirement (Australian tax law § 262A requires 5-year
  retention of financial records; audit log includes financial events).
- `collaborators.collaborator_id`
- `distributor_signups.user_id`
- `event_registrations.user_id`
- `guild_applications.user_id`
- `guild_account_fees.waiver_granted_by` — admin action
- `projects.user_id` — **This is a problem** (see Architectural Challenge 2)
- `store_collections.curator_id` — admin action
- `store_listings.parent_listing_id` (self-ref, not user-scoped)
- `support_ticket_replies.author_id`
- `support_tickets.user_id`

### Category 3: RESTRICT from `auth.users` or `guild_members` — 7 tables

**These block the deletion** until the child rows are handled. This
is the hard part.

Direct RESTRICT on `auth.users`:

- `nora_actions.user_id` RESTRICT
- `store_admin_actions.admin_user_id` RESTRICT (admin actor)
- `store_listing_appeals.author_id` RESTRICT
- `store_listing_appeals.admin_user_id` RESTRICT (admin actor)
- `store_listing_moderation_events.acted_by` RESTRICT (admin actor)
- `store_payouts.author_id` RESTRICT (financial record, tax retention)

Via `guild_members` chain (if user has a Guild member row, CASCADE
deletes guild_members, which RESTRICT-blocks on these children):

- `guild_payouts.guildmember_id` RESTRICT (financial record, tax)
- `guild_commissions.guildmember_id` RESTRICT (financial record, tax)
- `guild_referrals.guildmember_id` RESTRICT (financial tracking)
- `guild_account_fees.guildmember_id` RESTRICT (financial record)

### Category 4: NO_ACTION from `auth.users` — ~9 tables

Equivalent to RESTRICT at a single-statement level (both block the
delete). NO_ACTION is deferrable within a transaction, RESTRICT is
not. For single-statement deletion both behave identically.

- `credit_transactions.user_id` → `profiles` NO_ACTION
- `data_deletion_requests.processed_by` NO_ACTION (admin actor)
- `data_exports.processed_by` NO_ACTION (admin actor)
- `master_distributors.approved_by` NO_ACTION (admin actor)
- `nora_kb_articles.author_id` NO_ACTION (admin KB authorship)
- `nora_kb_articles.reviewed_by` NO_ACTION (admin review)
- `project_publications.user_id` NO_ACTION
- `store_admins.granted_by` NO_ACTION (admin actor)
- `store_transparency_snapshots.published_by` NO_ACTION (admin actor)
- `support_tickets.assigned_to` NO_ACTION (admin assignment)
- `referrals.referee_id` / `referrer_id` NO_ACTION
- `share_tracks.user_id` NO_ACTION

## Architectural Challenges

### Challenge 1: Admin Actor vs User Actor

About **15 of the blocker FKs** (RESTRICT + NO_ACTION) are present
because the deleted user was an ADMIN who performed actions on other
users — `approved_by`, `processed_by`, `granted_by`, `admin_user_id`,
`acted_by`, `published_by`, `curator_id`, `reviewed_by`, `assigned_to`,
`author_id` of KB articles, `actor_user_id` of audit_log.

These audit records **must not be deleted**. They document actions
the platform took, for legal/compliance reasons. The correct GDPR
handling is to null out or pseudonymise the user reference while
preserving the action record.

**Current state:** None of these FKs are SET NULL. They're RESTRICT or
NO_ACTION. The deletion helper must either:

a) **Pre-step null-outs** — issue `UPDATE {table} SET {col} = NULL`
   for every (table, col) in this list, converting the RESTRICT/NO_ACTION
   into a solved problem, before deleting the parent.

b) **Schema migration to SET NULL** — change the FK action on these
   10-15 columns from RESTRICT/NO_ACTION to SET NULL, so Postgres
   handles the null-out automatically during cascade. Cleaner.
   Requires migration 020 (one-time) + null-column support in the
   relevant tables (most already allow NULL; need to audit).

**Recommendation: (b) + a migration.** Option (a) is fragile (helper
logic must stay in sync with schema changes); (b) makes the schema
self-documenting about correct behaviour.

**Policy decision required from founder:** for financial records
(guild_payouts, guild_commissions, guild_referrals, guild_account_fees,
store_payouts, credit_transactions), convert to SET NULL or to a
different mechanism (soft delete + pseudonymise via a dedicated
"deleted user" sentinel UUID)?

### Challenge 2: `projects.user_id` is SET NULL

When `DELETE FROM auth.users` cascades to `profiles` (CASCADE), it
hits `projects.user_id` FK which is SET NULL. So all the deleted user's
projects become orphaned — they remain in the table with `user_id = NULL`.

This is a **GDPR violation** in most jurisdictions. The project CONTENT
is personal data (it's the user's book), and SET NULL keeps the content
while removing only the identifier. The content persists.

The export engine correctly exports `projects` rows. The deletion
engine must correctly delete them.

**Fix:** Explicit `DELETE FROM projects WHERE user_id = $user` step
BEFORE the auth.users delete. This cascades to `chapters`,
`chapter_regenerations`, `ai_sessions`, `computer_use_sessions`,
`publishing_metadata`, `publishing_records`, `project_publications`
(NO_ACTION — needs another pre-step), `share_links`, `share_tracks`
(NO_ACTION), `sources`, `collaborators`, `interview_sessions`,
`marketplace_listings` (and then the marketplace sub-tree), and
`guild_showcase_grants.project_id` (SET NULL — retains the grant but
removes the project reference; that's the Guild member's record, so
correct).

Similarly audit the other SET NULL references to `profiles`/`auth.users`
to check if any should actually be hard deletes:

- `ai_sessions.user_id` SET NULL → appropriate (analytics)
- `audit_log.actor_user_id` SET NULL → appropriate (audit integrity)
- `collaborators.collaborator_id` SET NULL → questionable (might leak
  that this user collaborated on project X)
- `distributor_signups.user_id` SET NULL → appropriate
- `event_registrations.user_id` SET NULL → appropriate
- `guild_applications.user_id` SET NULL → appropriate (application
  record must persist post-offboarding, anonymised)
- `projects.user_id` SET NULL → **WRONG** (see above)

### Challenge 3: Deleting the deletion request itself

`data_deletion_requests.user_id` CASCADEs from `auth.users`. When the
helper deletes `auth.users`, the request row being processed will
cascade-delete itself.

This is a problem because:
1. The helper needs to UPDATE that row to `status = completed` AFTER
   the deletion succeeds.
2. The admin dashboard needs to show a completed request to the admin.
3. The audit_log entry references the request by ID — it persists but
   the target is gone.

**Fix:** Change `data_deletion_requests.user_id` FK from CASCADE to
SET NULL in the same migration that fixes the other issues. The
request becomes an audit record of the deletion, with `user_id = NULL`
after completion. The admin dashboard displays these correctly
(`completed` state, redacted user reference, notes retained, manifest
retained).

Similar consideration for `data_exports` — `data_exports.user_id` also
CASCADEs from `auth.users`. If a user requests both export and
deletion, the export record should remain as evidence of fulfilment.

### Challenge 4: Storage Objects

The user's `compliance-exports` bucket files must be deleted. This
happens outside the SQL transaction. Current export cleanup cron
(`c985377`) handles "expired" rows; but post-deletion, the `data_exports`
row is gone (or user_id=NULL per Challenge 3), so the cron won't
match them as belonging to this user. Need an explicit storage cleanup
step in the deletion helper that iterates `{user_id}/` prefix in the
bucket and removes all matching objects.

Similarly for any other user-owned storage prefixes (check other
buckets exist in the project — `project-assets`? `cover-images`?
`audiobook-files`? — need to audit and extend).

### Challenge 5: Transaction Scope

The deletion helper should ideally wrap everything in a single
transaction so a failure at step N rolls back steps 1..N-1. But:

- Storage deletes (Supabase Storage API) are NOT transactional with
  SQL. If SQL commits and storage delete fails, we have orphaned files.
- Alternatively, if storage succeeds and SQL rolls back, we have SQL
  rows pointing to deleted storage.

**Recommended order:**

1. SQL transaction BEGIN
2. Explicit DELETE `projects WHERE user_id = $user` (cascades content)
3. Explicit handling for remaining CASCADE-blocker tables per policy
4. DELETE `auth.users WHERE id = $user` (cascades ~30 tables)
5. SQL COMMIT — point of no return for data side
6. Storage deletion — best-effort with retry
7. If storage fails, leave row in a new state `completed_storage_pending`
   for the daily cleanup cron to retry

### Challenge 6: Admin Actor

The admin performing the deletion is authenticated via cookie. The
audit_log entry needs `actor_user_id = admin`, `entity_id = user_being_deleted`.
This is standard audit instrumentation, matches the pattern used by
every other admin endpoint; but needs to fire BEFORE the SQL
transaction runs (so we have an audit record even if deletion fails
part-way). Or better: fire twice — once at start (`action: 'delete.initiate'`),
once at completion (`action: 'delete.complete'`). Both logged, with
`status` and outcome in `metadata`.

### Challenge 7: Concurrent Deletion / Export Race

User A has a pending export AND a pending deletion. Admin fulfils
export first — generates file, signed URL, emails user. Admin fulfils
deletion next — user A's `data_exports` row is in
`data_exports.user_id` CASCADE to auth.users, so it gets deleted too.
If the deletion's cascade deletes an export that's in `delivered`
state with a 7-day signed URL, the user has 7 days of signed URL
access to a file whose referring row is gone.

The orphan cleanup cron from `c985377` will sweep the file eventually
— it's classified as ORPHAN because no matching `data_exports` row
exists. So the signed URL continues to work for the remainder of its
validity, but the file will be swept on the cron's next run.

**Acceptable behaviour** for V1. Flag for future: consider revoking
the signed URL or deleting the file immediately as part of the
deletion flow.

## Design for the Deletion Helper

### File layout

```
lib/compliance-delete.ts          Main deletion engine (mirrors compliance-fulfil.ts)
lib/email/compliance.ts           Add sendDataDeletionCompletedEmail()
app/api/admin/compliance/requests/deletion/[id]/fulfil/route.ts
                                  POST endpoint; mirrors export fulfil endpoint
app/admin/compliance/[kind]/[id]/
  actions.tsx                     Add AutoFulfilDeletion component (red CTA)
__tests__/compliance-delete.test.ts  Unit tests for pure logic
supabase/migrations/020_deletion_preparation.sql
                                  Schema fixes for the FK issues described above
```

### The Migration 020

One-time DDL that converts the problematic FKs to correct behaviour:

```sql
-- 1. Projects: was SET NULL on auth.users, but must be explicit DELETE
--    No DDL change — the helper handles this. Projects SET NULL is
--    used by admin deletion of individual projects, not by user deletion.
--    Actually, reconsider: the whole point is that cascade from
--    auth.users→profiles→projects SET NULL. We can't change projects.user_id
--    to CASCADE because that would break admin "delete this user's
--    subscription" workflows that want to preserve projects. The helper
--    must explicit-delete projects before auth.users.

-- 2. Change data_deletion_requests.user_id FK from CASCADE to SET NULL
--    so the deletion request record persists as an audit trail.
ALTER TABLE data_deletion_requests
  DROP CONSTRAINT data_deletion_requests_user_id_fkey,
  ADD CONSTRAINT data_deletion_requests_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE SET NULL;

-- 3. Change data_exports.user_id FK from CASCADE to SET NULL for the
--    same reason — export record is an audit/fulfilment trail.
ALTER TABLE data_exports
  DROP CONSTRAINT data_exports_user_id_fkey,
  ADD CONSTRAINT data_exports_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE SET NULL;

-- 4. Admin-actor columns: change RESTRICT/NO_ACTION to SET NULL so
--    the deleted admin's action records persist, anonymised. This is
--    a bulk change across ~12 FKs.

ALTER TABLE data_deletion_requests
  DROP CONSTRAINT data_deletion_requests_processed_by_fkey,
  ADD CONSTRAINT data_deletion_requests_processed_by_fkey
    FOREIGN KEY (processed_by) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE data_exports
  DROP CONSTRAINT data_exports_processed_by_fkey,
  ADD CONSTRAINT data_exports_processed_by_fkey
    FOREIGN KEY (processed_by) REFERENCES auth.users(id) ON DELETE SET NULL;

-- ... similar for master_distributors.approved_by,
-- nora_kb_articles.author_id, nora_kb_articles.reviewed_by,
-- store_admins.granted_by, store_transparency_snapshots.published_by,
-- support_tickets.assigned_to, store_admin_actions.admin_user_id,
-- store_listing_appeals.admin_user_id, store_listing_moderation_events.acted_by,
-- store_listing_appeals.author_id (if tax retention not required; otherwise keep RESTRICT and handle explicitly)

-- 5. Financial records: policy decision required.
--    Current RESTRICTs: guild_payouts.guildmember_id, guild_commissions,
--    guild_referrals, guild_account_fees, store_payouts.author_id,
--    credit_transactions.user_id.
--
--    OPTION A: Change to SET NULL. Records persist anonymised.
--              Acceptable for Australian tax retention if the dollar
--              amounts, dates, and account numbers remain on the row.
--    OPTION B: Keep RESTRICT. Helper explicit-deletes these rows
--              after a configurable retention check (e.g., only delete
--              rows older than 7 years). Complex.
--    OPTION C: Separate "pseudonymisation" mode — helper replaces
--              user_id with a sentinel "00000000-0000-0000-0000-000000000000"
--              UUID and nulls personal fields on the user's profile.
--              Preserves aggregate accounting queries. Most complex.
--
--    RECOMMENDED: Option A. Simplest. Pseudonymisation via NULL user_id
--    is standard GDPR practice. Tax auditors care about the transaction
--    not the user identity.
```

### The Helper API

```typescript
// lib/compliance-delete.ts

export interface DeletionResult {
  success: boolean;
  user_id: string;
  rows_deleted_by_table: Record<string, number>;
  storage_objects_deleted: number;
  errors: Array<{ step: string; error: string }>;
  duration_ms: number;
}

export async function fulfilDeletionRequest(args: {
  userId: string;
  deletionRequestId: string;
  adminId: string;
  dryRun?: boolean;  // if true, count rows but don't delete
}): Promise<DeletionResult> {
  // ...
}
```

Helper contract:
- If `dryRun: true`, counts rows per table that WOULD be deleted, issues
  no DELETEs, returns the count map. Safe to call repeatedly for
  verification before commitment.
- If `dryRun: false`, executes the full deletion. `success: true` means
  auth.users row is gone AND all known-reachable rows are gone. Storage
  success is reported separately in the result (a row for
  `storage_objects_deleted`); SQL success does not depend on storage
  success.

### The Admin Endpoint

```typescript
// app/api/admin/compliance/requests/deletion/[id]/fulfil/route.ts

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  // 1. Auth — admin only
  // 2. Load the deletion request, verify status === 'received' or 'processing'
  // 3. Audit log start
  // 4. Call fulfilDeletionRequest({ userId, deletionRequestId, adminId, dryRun: false })
  // 5. On success:
  //      - UPDATE data_deletion_requests SET status = 'completed',
  //        manifest = result, completed_at = now()
  //      - Audit log complete
  //      - Send sendDataDeletionCompletedEmail
  //      - Return 200
  // 6. On failure:
  //      - UPDATE status = 'failed', failure_reason = errors.join
  //      - Audit log failure
  //      - Return 500 with error detail (admin sees it in the dashboard)
}
```

### Admin UI

Mirror the existing `AutoFulfilExport` component. Differences:
- Red CTA styling ("Fulfil deletion") — destructive action needs
  visible gravity
- Confirm modal with the exact user email typed to confirm
  (`"Type 'user@example.com' to confirm"`)
- Pre-flight dry-run display: "This will delete N rows across M tables
  + K storage objects. User has no outstanding payouts / legal holds."
- Post-completion: show the `rows_deleted_by_table` summary, the
  manifest link, the email sent confirmation

## Test Plan

1. **Pure-logic unit tests** — `__tests__/compliance-delete.test.ts`:
   - Table registry shape
   - Storage path construction
   - Error-result shape
2. **Dry-run integration test** — using a real test user seeded in
   dev, run `dryRun: true`, verify row counts are non-zero, no data
   actually deleted.
3. **Full integration test** — using a one-time test user:
   - Create via Supabase auth API
   - Seed data: 1 project, 1 chapter, 1 credit_transaction, 1
     consent_record, 1 nora_conversation, 1 support_ticket
   - Run `fulfilDeletionRequest({ dryRun: false })`
   - Verify: auth.users row gone, profiles row gone, projects row gone,
     chapters row gone (CASCADE), consent_records gone, nora_conversations
     gone, support_tickets row has user_id=NULL, credit_transactions
     row has user_id=NULL (if policy A), deletion request status=completed,
     audit_log has 2 entries (delete.initiate + delete.complete),
     email sent (mock Resend).
4. **RLS verification** — confirm the endpoint returns 403 for
   non-admin users and 401 for unauth.

## Implementation Sequence

Next session (1 of 2 or 3):
1. Write migration 020 after founder policy decision on financial FKs
2. Apply migration to prod via MCP
3. Build `lib/compliance-delete.ts` with dry-run support
4. Unit tests for pure-logic shape
5. Integration test harness setup (needs a "throwaway test user"
   pattern since prod Supabase — maybe a branch DB)

Session 2:
6. Admin endpoint + email
7. Admin UI component with confirm-typed-email flow
8. End-to-end verification against a seeded test user
9. Update admin compliance footer copy (`2518a56` needs updating)

Session 3 (if needed):
10. Daily cron extension: also handle stuck `processing` deletion
    requests the way the export cron handles expired exports
11. Storage cleanup for non-compliance-exports buckets (project-assets
    etc. — scope TBD)

## Open Questions for Founder

1. **Financial record policy** (Challenge 1, Migration 020 section 5):
   Option A (SET NULL, simplest, standard GDPR), Option B (retention-based
   explicit delete, complex), or Option C (pseudonymise with sentinel
   UUID, most complex)?

2. **Admin-actor columns** (Migration 020 section 4): confirm the list
   of admin-actor FKs to convert to SET NULL. Any that should stay
   RESTRICT (e.g., for forensic audit integrity)?

3. **Confirm email type**: user-facing "Your deletion has been
   completed" email — what information to include? A receipt of
   what was deleted (row counts) or just a generic confirmation?

4. **Appeals / legal hold**: Is there a case where the admin should
   REJECT a deletion request? Per Australian Privacy Act § 11 — yes,
   for ongoing legal proceedings, for tax-record retention periods,
   etc. Need a rejection flow. Currently the `rejected` status exists
   in the enum but has no UI path.

5. **Test user pattern**: OK to use the founder's own throwaway test
   account for integration testing on prod? Or need a separate test
   account / dev branch?

## Success Criteria

The auto-fulfilment is correct if, given a user that exists in the DB
with any combination of projects, Guild membership, Store data, Nora
history, support tickets, etc., running the helper:

1. Deletes (or pseudonymises per policy) 100% of user-scoped rows
2. Leaves audit records (with user_id=NULL) intact
3. Completes in <60 seconds for a typical user (P95 <2 minutes)
4. Writes 2 audit_log entries (initiate + complete)
5. Sends a confirmation email
6. Marks the data_deletion_requests row completed
7. If re-run on the same user, returns idempotently (user already
   deleted)
