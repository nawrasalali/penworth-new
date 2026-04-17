-- ============================================================================
-- Migration 011: Guild monthly payout queue view
-- ============================================================================
-- Builds a single view the admin payouts page can query without joining five
-- tables client-side. guild_payouts is already aggregated per (member, month)
-- by runMonthlyClose — this view just joins in the display fields and derives
-- the current-window membership status.
-- ============================================================================

CREATE OR REPLACE VIEW v_guild_monthly_payout_queue AS
SELECT
  p.id                         AS payout_id,
  p.payout_month,
  p.amount_usd,
  p.fee_usd,
  p.net_amount_usd,
  p.method,
  p.destination_masked,
  p.reference_number,
  p.status,
  p.failure_reason,
  p.approved_by,
  p.approved_at,
  p.sent_at,
  p.confirmed_at,
  p.statement_pdf_url,
  p.created_at                 AS queued_at,
  p.updated_at                 AS last_updated_at,

  m.id                         AS guildmember_id,
  m.user_id,
  m.display_name,
  m.tier,
  m.status                     AS member_status,
  m.primary_market,
  m.primary_language,
  m.referral_code,
  m.tax_residency,

  u.email                      AS member_email
FROM guild_payouts p
INNER JOIN guild_members m ON m.id = p.guildmember_id
LEFT JOIN auth.users    u ON u.id = m.user_id;

COMMENT ON VIEW v_guild_monthly_payout_queue IS
  'Admin-facing flat view of monthly Guild payouts with member display fields. Source of truth for /admin/guild/payouts.';

-- RLS: the view inherits RLS from its base tables. guild_payouts already has
-- admin-only SELECT policy via profiles.is_admin (see 010 RLS block), and
-- guild_members has admin SELECT too. Nothing to add here.
