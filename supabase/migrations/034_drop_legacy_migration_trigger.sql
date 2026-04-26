-- The migrate_user_on_signup() trigger fires AFTER INSERT on public.profiles
-- and tries to copy legacy data from pending_migrations / pending_project_migrations
-- when a user signs up with an email present in pending_migrations.
--
-- The function references credit_transactions(type, description) — columns that
-- were renamed to transaction_type / notes in a prior schema change. Result: every
-- signup attempt by a user with a pending_migrations row blew up with
-- SQLSTATE 42703 ("column type does not exist") and gotrue surfaced it as
-- "500: Database error saving new user" → frontend showed generic
-- "An error occurred. Please try again." Outage was global for legacy users
-- (Thomas Dye, Feras Alali, Roheena Tahir / rohinawras@gmail.com all blocked).
-- New gmail addresses with no pending_migrations row signed up fine, which is
-- why CEO probes succeeded while real legacy-user attempts failed.
--
-- Founder's standing directive (CEO-021 era): clean break — old users re-sign-up
-- fresh on the new platform; no automated migration. The trigger is therefore
-- dead code by policy AND broken by schema drift.
--
-- Drop the trigger; keep the function on disk in case the policy changes later.
-- Verified: probe with email in pending_migrations table returned HTTP 200 with
-- confirmation_sent_at populated post-fix.
--
-- Applied to production 2026-04-26 via Supabase MCP apply_migration.
DROP TRIGGER IF EXISTS trigger_migrate_user ON public.profiles;

COMMENT ON FUNCTION public.migrate_user_on_signup() IS
  'DEAD CODE — trigger trigger_migrate_user dropped 2026-04-26 (CEO session). Legacy migration policy is "clean break, fresh signup". Function retained as a reference; references credit_transactions.type which no longer exists. Do not re-attach without rewriting against the current credit_transactions schema (transaction_type / notes columns).';
