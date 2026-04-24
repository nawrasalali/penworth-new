-- 027_fix_command_center_views.sql
--
-- FIX: Command Center views returned zero rows because their WHERE clauses
-- filtered on has_admin_role(auth.uid(), ...), but the page accesses them
-- via createServiceClient() (service role), under which auth.uid() is NULL.
-- The WHERE always failed, so every card on /admin/command-center showed
-- the "data unavailable" placeholder ("—").
--
-- Access control is already enforced at the page level by requireAdminRole().
-- Grants confirm only postgres + service_role can SELECT these views; no
-- anon or authenticated grant exists, so a client cannot read them directly.
-- The WHERE clauses are therefore redundant AND broken.
--
-- Fix: drop the final `WHERE has_admin_role(auth.uid(), ...)` from all four
-- views. Bodies are otherwise unchanged.
--
-- Applied to production DB 2026-04-24 via Supabase Management API during
-- CEO session. This file is the permanent record.

CREATE OR REPLACE VIEW public.v_command_center_super_admin AS
 SELECT ( SELECT row_to_json(x.*) AS row_to_json
           FROM v_system_capacity_snapshot x) AS system_capacity,
    ( SELECT row_to_json(x.*) AS row_to_json
           FROM v_pipeline_health_snapshot x) AS pipeline_health,
    ( SELECT jsonb_agg(row_to_json(x.*)) AS jsonb_agg
           FROM v_agent_load_by_window x) AS agent_load,
    ( SELECT jsonb_agg(row_to_json(i.*) ORDER BY i.detected_at DESC) AS jsonb_agg
           FROM ( SELECT pipeline_incidents.id,
                    pipeline_incidents.incident_type,
                    pipeline_incidents.agent,
                    pipeline_incidents.severity,
                    pipeline_incidents.detected_at,
                    pipeline_incidents.session_id,
                    pipeline_incidents.user_id,
                    pipeline_incidents.resolved
                   FROM pipeline_incidents
                  ORDER BY pipeline_incidents.detected_at DESC
                 LIMIT 100) i) AS recent_incidents,
    ( SELECT jsonb_agg(row_to_json(a.*) ORDER BY a.sent_at DESC) AS jsonb_agg
           FROM ( SELECT alert_log.id,
                    alert_log.source_type,
                    alert_log.severity,
                    alert_log.category,
                    alert_log.title,
                    alert_log.sent_at,
                    alert_log.acknowledged_at,
                    alert_log.delivery_status
                   FROM alert_log
                  ORDER BY alert_log.sent_at DESC
                 LIMIT 50) a) AS recent_alerts,
    ( SELECT count(*) AS count
           FROM support_tickets
          WHERE support_tickets.status = 'open'::text) AS tickets_open,
    ( SELECT count(*) AS count
           FROM guild_members
          WHERE guild_members.status = 'active'::text) AS members_active,
    ( SELECT count(*) AS count
           FROM guild_members
          WHERE guild_members.status = 'probation'::text) AS members_probation,
    ( SELECT count(*) AS count
           FROM guild_fraud_flags
          WHERE guild_fraud_flags.status = ANY (ARRAY['open'::text, 'investigating'::text])) AS open_fraud_flags,
    ( SELECT COALESCE(sum(usage.cost_usd), 0::numeric) AS "coalesce"
           FROM usage
          WHERE usage.created_at > (now() - '01:00:00'::interval)) AS ai_cost_1h,
    ( SELECT count(*) AS count
           FROM stripe_webhook_events
          WHERE stripe_webhook_events.processing_status = 'failed'::text) AS stripe_failures;

CREATE OR REPLACE VIEW public.v_command_center_ops AS
 SELECT ( SELECT row_to_json(x.*) AS row_to_json
           FROM v_pipeline_health_snapshot x) AS pipeline_health,
    ( SELECT jsonb_agg(row_to_json(x.*)) AS jsonb_agg
           FROM v_agent_load_by_window x) AS agent_load,
    ( SELECT jsonb_agg(row_to_json(i.*) ORDER BY i.detected_at DESC) AS jsonb_agg
           FROM ( SELECT pipeline_incidents.id,
                    pipeline_incidents.incident_type,
                    pipeline_incidents.agent,
                    pipeline_incidents.severity,
                    pipeline_incidents.detected_at,
                    pipeline_incidents.session_id,
                    pipeline_incidents.user_id,
                    pipeline_incidents.resolved,
                    pipeline_incidents.error_details
                   FROM pipeline_incidents
                  WHERE pipeline_incidents.resolved = false OR pipeline_incidents.detected_at > (now() - '24:00:00'::interval)
                  ORDER BY pipeline_incidents.detected_at DESC
                 LIMIT 50) i) AS recent_incidents,
    ( SELECT count(*) AS count
           FROM support_tickets
          WHERE support_tickets.status = 'open'::text) AS tickets_open,
    ( SELECT count(*) AS count
           FROM support_tickets
          WHERE support_tickets.status = 'open'::text AND support_tickets.priority = 'urgent'::text) AS tickets_urgent,
    ( SELECT count(*) AS count
           FROM nora_conversations
          WHERE nora_conversations.last_turn_at > (now() - '01:00:00'::interval)) AS nora_active_1h;

CREATE OR REPLACE VIEW public.v_command_center_finance AS
 SELECT ( SELECT count(*) AS count
           FROM stripe_webhook_events
          WHERE stripe_webhook_events.processing_status = 'failed'::text) AS stripe_failures,
    ( SELECT EXTRACT(epoch FROM now() - max(stripe_webhook_events.received_at)) / 60::numeric
           FROM stripe_webhook_events) AS minutes_since_last_webhook,
    ( SELECT count(*) AS count
           FROM guild_commissions
          WHERE guild_commissions.status = 'pending'::text) AS pending_commissions,
    ( SELECT COALESCE(sum(guild_commissions.commission_amount_usd), 0::numeric) AS "coalesce"
           FROM guild_commissions
          WHERE guild_commissions.status = ANY (ARRAY['pending'::text, 'locked'::text])) AS pending_commission_usd,
    ( SELECT count(*) AS count
           FROM guild_payouts
          WHERE guild_payouts.status = 'queued'::text) AS queued_payouts,
    ( SELECT COALESCE(sum(guild_payouts.net_amount_usd), 0::numeric) AS "coalesce"
           FROM guild_payouts
          WHERE guild_payouts.status = 'queued'::text) AS queued_payout_usd,
    ( SELECT COALESCE(sum(usage.cost_usd), 0::numeric) AS "coalesce"
           FROM usage
          WHERE usage.created_at > (now() - '01:00:00'::interval)) AS ai_cost_1h,
    ( SELECT COALESCE(sum(usage.cost_usd), 0::numeric) AS "coalesce"
           FROM usage
          WHERE usage.created_at > (now() - '24:00:00'::interval)) AS ai_cost_24h,
    ( SELECT COALESCE(sum(usage.cost_usd), 0::numeric) AS "coalesce"
           FROM usage
          WHERE usage.created_at > date_trunc('month'::text, now())) AS ai_cost_mtd,
    ( SELECT count(*) AS count
           FROM credit_transactions
          WHERE credit_transactions.transaction_type = 'purchase'::text AND credit_transactions.created_at > date_trunc('month'::text, now())) AS purchases_mtd,
    ( SELECT COALESCE(sum(guild_account_fees.amount_deferred_usd), 0::numeric) AS "coalesce"
           FROM guild_account_fees
          WHERE guild_account_fees.amount_deferred_usd > 0::numeric) AS total_deferred_balance;

CREATE OR REPLACE VIEW public.v_command_center_cs AS
 SELECT ( SELECT jsonb_agg(row_to_json(t.*) ORDER BY t.created_at DESC) AS jsonb_agg
           FROM ( SELECT support_tickets.id,
                    support_tickets.ticket_number,
                    support_tickets.user_email,
                    support_tickets.category,
                    support_tickets.priority,
                    support_tickets.status,
                    support_tickets.subject,
                    support_tickets.created_at
                   FROM support_tickets
                  WHERE support_tickets.status = ANY (ARRAY['open'::text, 'in_progress'::text, 'awaiting_user'::text])
                  ORDER BY support_tickets.priority DESC, support_tickets.created_at DESC
                 LIMIT 50) t) AS open_tickets,
    ( SELECT count(*) AS count
           FROM support_tickets
          WHERE support_tickets.status = 'open'::text) AS tickets_open_count,
    ( SELECT count(*) AS count
           FROM nora_conversations
          WHERE nora_conversations.resolution = 'open'::text AND nora_conversations.last_turn_at > (now() - '24:00:00'::interval)) AS nora_conversations_24h,
    ( SELECT count(*) AS count
           FROM guild_members
          WHERE guild_members.status = 'probation'::text) AS members_on_probation,
    ( SELECT count(*) AS count
           FROM guild_fraud_flags
          WHERE guild_fraud_flags.status = ANY (ARRAY['open'::text, 'investigating'::text])) AS open_fraud_flags,
    ( SELECT count(DISTINCT interview_sessions.user_id) AS count
           FROM interview_sessions
          WHERE (interview_sessions.pipeline_status = ANY (ARRAY['stuck'::text, 'failed'::text])) AND interview_sessions.updated_at > (now() - '24:00:00'::interval)) AS authors_with_failures_24h;
