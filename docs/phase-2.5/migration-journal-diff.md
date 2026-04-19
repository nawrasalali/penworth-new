# Phase 2.5 Item 2 — Migration Journal Diff

Status: partial. 11 of 15 local files map cleanly to journal entries.
61 journal entries applied to prod have no corresponding file in this
repo. 4 local files have no matching journal entry. Full backfill is
scoped as a separate exercise — see "Full backfill" below.

## Why this document exists

The Phase 2.5 brief scoped Item 2 as "backfill 014 and 015 only,"
based on the verification chat's claim that those were the only
MCP-applied migrations without corresponding local files.

The diff (run in the turn that landed this doc, against the 100-row
journal the verification chat pasted) shows something different:
014 and 015 are both present locally under slightly different
filenames. The real gap is 61 other migrations that were historically
applied to prod via `supabase db push` from a local clone whose
migration files are NOT in this repo.

Those 61 migrations matter for:
- Local dev reproducibility — a fresh clone running `supabase db reset`
  will not reproduce prod schema (Nora tables, Guild academy, state
  machine helpers, encryption helpers, etc. all missing)
- Schema auditability — the repo is not the source of truth for prod
  DDL until they're backfilled

They do NOT matter for production deploys of this repo — prod already
has all 61 applied; no re-application is necessary.

## Categorization

### LOCAL (11) — already in repo, mapped to journal entries

| Journal version | Journal name                                    | Local file                                                   |
|-----------------|-------------------------------------------------|--------------------------------------------------------------|
| 20260414104442  | initial_schema                                  | 001_initial_schema.sql                                       |
| 20260414104508  | rls_policies                                    | 002_rls_policies.sql                                         |
| 20260415112145  | 009_master_distributors                         | 009_master_distributors.sql                                  |
| 20260417053109  | guild_schema_010                                | 010_guild_schema.sql                                         |
| 20260418080723  | stripe_webhook_events                           | 012_stripe_webhook_events.sql                                |
| 20260418080736  | guild_monthly_close_runs                        | 013_guild_monthly_close_runs.sql                             |
| 20260418181658  | 014_projects_billing_type_and_grant_helper      | 014_projects_billing_type_and_grant_helper.sql               |
| 20260418185405  | 015_audit_log_append_only                       | 016_audit_log_append_only.sql                                |
| 20260419005104  | 015_guild_admin_rpcs_and_advisor_rate_limit     | 015_phase_2_admin_rpcs_and_advisor_rate_limit.sql            |
| 20260419011557  | 017_data_deletion_and_export_requests           | 017_data_deletion_and_export_requests.sql                    |
| 20260419023120  | 018_nora_consume_turn                           | 018_nora_consume_turn.sql                                    |

Note the naming drift: some local files use sequential prefixes
(001, 002, 009, 010, 014, 015, 016, 017, 018) while the journal uses
timestamp prefixes (20260414104442 etc.). This drift does not break
prod (idempotent migrations) but would cause `supabase db push` from
a fresh clone to attempt re-application, since the CLI treats the
filename prefix as the version identifier.

### STORE (28) — belong to `penworth-store` repo, out of scope here

All `penworth_store_*`, `store_*`, and numeric-prefixed store migrations
(0009_admin_system, 0010_publish_storage_buckets,
0011_publish_payment_status_allow_comped, 0016_store_fk_covering_indexes,
0017_audiobook_per_chapter_audio, 0018_audiobooks_bucket_harden).
28 entries total. These should live in the `penworth-store` repo and
are not expected to be in this repo.

### MISSING (61) — applied to prod, not in this repo

Categorized by feature area. Listed in journal order (oldest first
— which is the order they must be applied in).

#### Profiles, auth, RLS (9)
- 20260414132247  003_plg_referral_system
- 20260414133317  003_referral_system
- 20260414134156  004_fix_function_security
- 20260414135952  005_marketplace_purchases
- 20260415122005  010_user_migration_pending
- 20260415122146  011_auto_migrate_on_signup
- 20260416111518  fix_org_members_rls_recursion
- 20260416111542  fix_org_admin_rls_recursion
- 20260416174712  add_is_admin_to_profiles

#### Projects, content, publishing (12)
- 20260416113228  fix_content_type_check_constraint
- 20260416143835  create_interview_sessions
- 20260416143845  create_research_resources
- 20260416143854  create_publishing_platforms
- 20260416143902  create_project_publications
- 20260416143913  create_regeneration_tracking
- 20260416143922  update_marketplace_add_columns
- 20260416143944  seed_publishing_platforms
- 20260416190139  widen_projects_content_type_check
- 20260417025933  add_soft_delete_to_projects
- 20260417054736  publishing_tiers_and_metadata
- 20260417103927  credit_transactions_add_publishing_types

#### Admin surface + policy recursion fixes (3)
- 20260417021049  admin_bypass_policies
- 20260417023156  fix_admin_policy_recursion
- 20260417025216  add_preferred_language_to_profiles

#### Audiobook + computer use (5 — some may be store-adjacent, flag for verification)
- 20260417030001  fix_share_tracks_cascade
- 20260417041313  add_audiobook_chapters
- 20260417041328  create_audiobooks_storage_bucket
- 20260417092423  computer_use_sessions
- 20260417092434  computer_use_screenshots_bucket

#### Guild schema hardening + views + encryption (10)
- 20260417070004  guild_commission_hardening
- 20260417070540  guild_admin_views
- 20260417092012  guild_financial_integrity_fks
- 20260417092219  guild_views_security_invoker
- 20260417093621  guild_payout_encryption_helpers
- 20260417093651  guild_payout_encryption_fix
- 20260417093725  guild_payout_encryption_fix_searchpath
- 20260418102251  guild_payout_queue_view_v2
- 20260418141714  guild_monthly_close_member_function
- 20260418141745  guild_monthly_close_run_function

#### Guild academy + applications + sessions + checkins (9)
- 20260417160652  guild_academy_schema
- 20260417165706  guild_academy_translations
- 20260418045710  guild_applications_user_linking
- 20260418055225  guild_pd_sessions
- 20260418061011  retire_weekly_checkins_add_account_fees
- 20260418114749  guild_weekly_checkins
- 20260418114808  v_guild_current_pd_plan
- 20260418122623  guild_state_machine_helpers
- 20260418141902  fix_monthly_close_run_status_values

#### Guild voice interview → application interview rename (3)
- 20260418134141  rename_voice_interviews_to_application_interviews
- 20260418134215  update_finalize_acceptance_to_renamed_interview_table
- 20260418134249  admin_interview_grading_view_and_helpers

#### Guild showcase grants + probation/offboarding (2)
- 20260418063929  guild_showcase_grants_probation_offboarding
- 20260418163527  guild_consume_showcase_grant_function

#### Consent records (2)
- 20260417142723  create_consent_records
- 20260418044333  profiles_consent_accepted_at

#### Nora schema (6)
- 20260418065637  nora_support_infrastructure
- 20260418071743  nora_kb_seed_articles
- 20260418072312  nora_member_context_view
- 20260418141948  nora_kb_article_translations_table
- 20260419011511  nora_kb_fulltext_search_v2
- 20260419011632  nora_kb_search_websearch_with_fallback

### LOCAL-ONLY (4) — in repo but not in prod journal

These files exist in `supabase/migrations/` but match no journal
entry. Likely legacy / superseded by later migrations. Candidates
for removal after verification confirms their content is already
represented in prod via other applied migrations:

- 006_v2_plan_columns.sql
- 007_publishing_records.sql
- 008_collaborators.sql
- 011_guild_payout_queue_view.sql

## Item 2 resolution

The brief's explicit scope ("backfill 014 and 015 only") is a no-op
because both files are already in the repo. Ship no new migrations
from Item 2 — the MCP-applied changes from Phase 1E and Phase 2 are
already captured in `014_projects_billing_type_and_grant_helper.sql`
and `015_phase_2_admin_rpcs_and_advisor_rate_limit.sql`. The Phase 2.5
Item 3 migration (`018_nora_consume_turn.sql`) is similarly already
captured.

No production impact — prod is correct as-is.

## Full backfill (separate tech debt)

Proper full backfill requires the `statements` column from the prod
`supabase_migrations.schema_migrations` table for all 61 MISSING
entries. That's a significant paste (likely >150KB of SQL) and is
out of scope for Item 2 as originally briefed.

To execute the full backfill in a future phase:

### Step 1 — Extract statements from prod

Run against prod via Supabase MCP:

```sql
SELECT version,
       name,
       statements
FROM supabase_migrations.schema_migrations
WHERE version IN (
  '20260414132247', '20260414133317', '20260414134156', '20260414135952',
  '20260415122005', '20260415122146', '20260416111518', '20260416111542',
  '20260416113228', '20260416143835', '20260416143845', '20260416143854',
  '20260416143902', '20260416143913', '20260416143922', '20260416143944',
  '20260416174712', '20260416190139', '20260417021049', '20260417023156',
  '20260417025216', '20260417025933', '20260417030001', '20260417041313',
  '20260417041328', '20260417054736', '20260417070004', '20260417070540',
  '20260417092012', '20260417092219', '20260417092423', '20260417092434',
  '20260417093621', '20260417093651', '20260417093725', '20260417103927',
  '20260417142723', '20260417160652', '20260417165706', '20260418044333',
  '20260418045710', '20260418055225', '20260418061011', '20260418063929',
  '20260418065637', '20260418071743', '20260418072312', '20260418102251',
  '20260418114749', '20260418114808', '20260418122623', '20260418134141',
  '20260418134215', '20260418134249', '20260418141714', '20260418141745',
  '20260418141902', '20260418141948', '20260418163527', '20260419011511',
  '20260419011632'
)
ORDER BY version;
```

### Step 2 — Write files

For each returned row, write `supabase/migrations/{version}_{name}.sql`
with `statements` as the body.

### Step 3 — Resolve local filename drift

Rename the 11 LOCAL files to `{journal_version}_{journal_name}.sql`
form for CLI consistency. This is optional for prod correctness
(idempotent migrations handle re-application) but required for a
fresh clone's `supabase db push` to be a no-op against prod.

### Step 4 — Handle the 4 LOCAL-ONLY files

Inspect `006_v2_plan_columns.sql`, `007_publishing_records.sql`,
`008_collaborators.sql`, `011_guild_payout_queue_view.sql`.
For each:
- If DDL is represented elsewhere in prod (verify with `pg_dump`) →
  delete the local file
- If DDL genuinely missing from prod → that's a separate backfill-
  to-prod task (not this repo → prod direction)

### Step 5 — Verify

Run `supabase db reset` against a fresh local DB. Compare schema diff
against prod via `supabase db diff --linked`. Should be empty except
for pre-existing drifts known to be separate tech debt.

## References

- Phase 2.5 brief, Item 2
- Verification chat journal snapshot (2026-04-19 ~01:30 UTC)
