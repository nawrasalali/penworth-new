# Phase 1A Work Plan

## Seven commits, ordered

1. **chore(db): stripe_webhook_events + guild_monthly_close_runs migrations**
   - Two new tables, no modifications to existing schema
   - Migration files 012 and 013 committed to repo
   - Applied to Supabase live DB via MCP

2. **feat(apply): lock email field when user is authenticated**
   - Client: pre-fill email from Supabase session, disable input, show note
   - Also show login nudge when unauthenticated
   - No API changes

3. **feat(apply): server overrides body.email + catches 23505 as 409**
   - Server-side: if authenticated, body.email = session.user.email (defense in depth)
   - Wrap insert in try/catch; map 23505 → 409 with friendly message
   - Covers case where trigger raises unique_violation (existing Guildmember)

4. **feat(guild): monthly close state machine — fees, deferred, probation**
   - Augment runMonthlyClose in lib/guild/commissions.ts
   - Create guild_monthly_close_runs row at start (idempotency)
   - Per member: compute C, upsert fee row, compute obligations, Cases A/B/C
   - Case A creates payout, marks commissions paid, resolves fees
   - Case B: commission covers fees but below $50 threshold — leave pending
   - Case C: fees exceed commission — defer, grow deferred balance
   - Post-processing: trigger probation at $90 deferred
   - Log every outcome to the run row
   - Returns detailed summary

5. **feat(cron): stripe reconciliation**
   - New endpoint /api/cron/stripe-reconcile
   - Daily cron registered in vercel.json
   - Lists Stripe events in past 48h, compares vs stripe_webhook_events
   - Missing events get inserted as 'replayed' and processed
   - Adds idempotency helper lib/stripe/webhook-idempotency.ts
   - Wires into both existing webhook routes

6. **test: unit tests for monthly close state machine**
   - Covers Cases A/B/C, probation trigger, idempotency, fee roll-forward
   - Uses a supabase mock so tests are deterministic

7. **test: apply form edge cases**
   - Duplicate pending email returns 409
   - Authenticated user's email overrides form body
   - Server honours 23505 → 409 mapping
