-- ============================================================================
-- PENWORTH GUILD — Database Schema
-- Migration 010 — Creates all tables, indexes, and RLS policies for the Guild.
-- Ref: Penworth_Guild_Complete_Specification.md Sections 14.1 & 14.2
-- ============================================================================

-- ----------------------------------------------------------------------------
-- guild_applications
-- One row per application submission. Applications start in pending_review,
-- then move through auto_declined / invited_to_interview / interview_scheduled /
-- interview_completed / accepted / declined.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS guild_applications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL,
  full_name TEXT NOT NULL,
  country TEXT NOT NULL,
  primary_language TEXT NOT NULL,
  reason TEXT NOT NULL,
  reason_other TEXT,
  social_links JSONB DEFAULT '[]'::jsonb,
  cv_url TEXT,
  referred_by_code TEXT,
  motivation_statement TEXT NOT NULL,
  ip_address TEXT,
  user_agent TEXT,
  application_status TEXT NOT NULL DEFAULT 'pending_review'
    CHECK (application_status IN (
      'pending_review',
      'auto_declined',
      'invited_to_interview',
      'interview_scheduled',
      'interview_completed',
      'accepted',
      'declined',
      'withdrawn'
    )),
  auto_review_score INTEGER,
  auto_review_flags JSONB DEFAULT '[]'::jsonb,
  voice_interview_id UUID,
  decision_reason TEXT,
  decided_by UUID,
  decided_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_guild_applications_email ON guild_applications(email);
CREATE INDEX IF NOT EXISTS idx_guild_applications_status ON guild_applications(application_status);
CREATE INDEX IF NOT EXISTS idx_guild_applications_created ON guild_applications(created_at DESC);

-- ----------------------------------------------------------------------------
-- guild_voice_interviews
-- One row per voice interview. Linked to an application.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS guild_voice_interviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id UUID NOT NULL REFERENCES guild_applications(id) ON DELETE CASCADE,
  scheduled_at TIMESTAMPTZ,
  conducted_at TIMESTAMPTZ,
  duration_seconds INTEGER,
  language TEXT NOT NULL,
  transcript TEXT,
  summary TEXT,
  scores JSONB,  -- {clarity, motivation, audience, product, commitment} each 1-5
  rubric_result TEXT CHECK (rubric_result IN ('pass', 'fail', 'pending')),
  reviewer_notes TEXT,
  audio_url TEXT,
  reschedule_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_guild_voice_interviews_application
  ON guild_voice_interviews(application_id);
CREATE INDEX IF NOT EXISTS idx_guild_voice_interviews_scheduled
  ON guild_voice_interviews(scheduled_at);

-- Add FK back to applications now that voice_interviews table exists
ALTER TABLE guild_applications
  ADD CONSTRAINT fk_voice_interview
  FOREIGN KEY (voice_interview_id)
  REFERENCES guild_voice_interviews(id)
  ON DELETE SET NULL;

-- ----------------------------------------------------------------------------
-- guild_members
-- One row per Guildmember (accepted applicant). References the users table.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS guild_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  application_id UUID REFERENCES guild_applications(id) ON DELETE SET NULL,
  tier TEXT NOT NULL DEFAULT 'apprentice'
    CHECK (tier IN ('apprentice', 'journeyman', 'artisan', 'master', 'fellow', 'emeritus')),
  tier_since TIMESTAMPTZ NOT NULL DEFAULT now(),
  referral_code TEXT NOT NULL UNIQUE,
  vanity_url TEXT UNIQUE,
  payout_method TEXT CHECK (payout_method IN ('wise', 'usdt', 'pending')),
  payout_details_encrypted TEXT,  -- encrypted Wise email or USDT address
  tax_residency TEXT,
  tax_id_encrypted TEXT,
  display_name TEXT NOT NULL,
  photo_url TEXT,
  bio TEXT,
  primary_market TEXT,
  primary_language TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'probation', 'terminated', 'resigned')),
  probation_reason TEXT,
  probation_started_at TIMESTAMPTZ,
  termination_reason TEXT,
  terminated_at TIMESTAMPTZ,
  joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_guild_members_user ON guild_members(user_id);
CREATE INDEX IF NOT EXISTS idx_guild_members_referral_code ON guild_members(referral_code);
CREATE INDEX IF NOT EXISTS idx_guild_members_vanity ON guild_members(vanity_url);
CREATE INDEX IF NOT EXISTS idx_guild_members_tier_status ON guild_members(tier, status);
CREATE INDEX IF NOT EXISTS idx_guild_members_status ON guild_members(status) WHERE status = 'active';

-- ----------------------------------------------------------------------------
-- guild_tier_promotions
-- Append-only audit log of every promotion, demotion, and tier change.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS guild_tier_promotions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  guildmember_id UUID NOT NULL REFERENCES guild_members(id) ON DELETE CASCADE,
  from_tier TEXT,
  to_tier TEXT NOT NULL,
  promotion_reason TEXT NOT NULL
    CHECK (promotion_reason IN (
      'criteria_met',
      'probation_demotion',
      'fellow_council_vote',
      'emeritus_transition',
      'initial_acceptance',
      'manual_override'
    )),
  evidence JSONB,  -- { retained_referrals, retention_rate, consistency_months, ... }
  promoted_by UUID,
  promoted_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_guild_tier_promotions_member
  ON guild_tier_promotions(guildmember_id, promoted_at DESC);

-- ----------------------------------------------------------------------------
-- guild_referrals
-- Extends partner_referrals concept for Guild-specific tracking.
-- Tracks retention state which is critical for advancement criteria.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS guild_referrals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  guildmember_id UUID NOT NULL REFERENCES guild_members(id) ON DELETE CASCADE,
  referred_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  referral_code_used TEXT NOT NULL,
  signup_source_url TEXT,
  signup_country TEXT,
  tier_at_referral TEXT NOT NULL,
  commission_rate_locked NUMERIC(4,3) NOT NULL,  -- 0.200 to 0.400
  signed_up_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  first_paid_at TIMESTAMPTZ,
  first_plan TEXT,
  first_plan_price_usd NUMERIC(10,2),
  commission_window_ends_at TIMESTAMPTZ,  -- 12 months after first_paid_at
  retention_qualified_at TIMESTAMPTZ,  -- set when 60 days of paid status reached
  cancelled_at TIMESTAMPTZ,
  total_commission_earned_usd NUMERIC(10,2) NOT NULL DEFAULT 0,
  total_commission_paid_usd NUMERIC(10,2) NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'signed_up'
    CHECK (status IN (
      'signed_up',      -- user signed up but not yet paid
      'active_paid',    -- currently paying
      'retention_qualified', -- active and past 60-day mark, counts for tier
      'cancelled',      -- user cancelled subscription
      'refunded',       -- refunded, commission clawed back
      'flagged'         -- flagged for fraud review
    )),
  UNIQUE(referred_user_id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_guild_referrals_member
  ON guild_referrals(guildmember_id);
CREATE INDEX IF NOT EXISTS idx_guild_referrals_status
  ON guild_referrals(status);
CREATE INDEX IF NOT EXISTS idx_guild_referrals_commission_window
  ON guild_referrals(commission_window_ends_at) WHERE status IN ('active_paid', 'retention_qualified');

-- ----------------------------------------------------------------------------
-- guild_commissions
-- Each commission event (a payment that generates commission for a Guildmember).
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS guild_commissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  guildmember_id UUID NOT NULL REFERENCES guild_members(id) ON DELETE CASCADE,
  referral_id UUID NOT NULL REFERENCES guild_referrals(id) ON DELETE CASCADE,
  stripe_invoice_id TEXT,
  stripe_payment_intent_id TEXT,
  subscription_price_usd NUMERIC(10,2) NOT NULL,
  commission_rate NUMERIC(4,3) NOT NULL,
  commission_amount_usd NUMERIC(10,2) NOT NULL,
  commission_month TEXT NOT NULL,  -- YYYY-MM
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN (
      'pending',    -- earned but 60-day retention not yet reached
      'locked',     -- ready for payout at month end
      'paid',       -- payout completed
      'clawed_back' -- clawed back due to refund/chargeback
    )),
  clawback_reason TEXT,
  clawback_at TIMESTAMPTZ,
  earned_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  paid_at TIMESTAMPTZ,
  payout_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_guild_commissions_member_month
  ON guild_commissions(guildmember_id, commission_month);
CREATE INDEX IF NOT EXISTS idx_guild_commissions_status
  ON guild_commissions(status);
CREATE INDEX IF NOT EXISTS idx_guild_commissions_earned
  ON guild_commissions(earned_at DESC);

-- ----------------------------------------------------------------------------
-- guild_payouts
-- One row per monthly payout to a Guildmember.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS guild_payouts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  guildmember_id UUID NOT NULL REFERENCES guild_members(id) ON DELETE CASCADE,
  payout_month TEXT NOT NULL,  -- YYYY-MM
  amount_usd NUMERIC(10,2) NOT NULL,
  method TEXT NOT NULL CHECK (method IN ('wise', 'usdt')),
  destination_masked TEXT NOT NULL,  -- last 4 of email/wallet for display
  reference_number TEXT,
  fee_usd NUMERIC(10,2) NOT NULL DEFAULT 0,
  net_amount_usd NUMERIC(10,2) NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'approved', 'processing', 'sent', 'confirmed', 'failed', 'cancelled')),
  failure_reason TEXT,
  approved_by UUID,
  approved_at TIMESTAMPTZ,
  sent_at TIMESTAMPTZ,
  confirmed_at TIMESTAMPTZ,
  statement_pdf_url TEXT,
  UNIQUE(guildmember_id, payout_month),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_guild_payouts_member_month
  ON guild_payouts(guildmember_id, payout_month DESC);
CREATE INDEX IF NOT EXISTS idx_guild_payouts_status
  ON guild_payouts(status) WHERE status IN ('queued', 'approved', 'processing');

-- ----------------------------------------------------------------------------
-- guild_agent_context
-- Shared context layer for the 7 AI agents. One row per (guildmember, agent).
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS guild_agent_context (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  guildmember_id UUID NOT NULL REFERENCES guild_members(id) ON DELETE CASCADE,
  agent_name TEXT NOT NULL
    CHECK (agent_name IN ('scout', 'coach', 'creator', 'mentor', 'analyst', 'strategist', 'advisor', 'shared')),
  context JSONB NOT NULL DEFAULT '{}'::jsonb,
  last_updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(guildmember_id, agent_name)
);

CREATE INDEX IF NOT EXISTS idx_guild_agent_context_member_agent
  ON guild_agent_context(guildmember_id, agent_name);

-- ----------------------------------------------------------------------------
-- guild_growth_plans
-- Coach agent's growth plans. One per plan cycle; history preserved.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS guild_growth_plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  guildmember_id UUID NOT NULL REFERENCES guild_members(id) ON DELETE CASCADE,
  plan_version INTEGER NOT NULL DEFAULT 1,
  plan_document JSONB NOT NULL,  -- structured plan: situation, goal, weekly cadence, content, checkpoints
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  current_week INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'completed', 'superseded', 'paused')),
  completion_pct NUMERIC(5,2) DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_guild_growth_plans_member_status
  ON guild_growth_plans(guildmember_id, status);

-- ----------------------------------------------------------------------------
-- guild_weekly_checkins
-- Mentor agent's weekly check-in entries.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS guild_weekly_checkins (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  guildmember_id UUID NOT NULL REFERENCES guild_members(id) ON DELETE CASCADE,
  week_of DATE NOT NULL,
  mentor_journal_entry TEXT,
  completion_data JSONB DEFAULT '{}'::jsonb,
  metrics_snapshot JSONB DEFAULT '{}'::jsonb,
  escalated_to_human BOOLEAN NOT NULL DEFAULT false,
  escalation_reason TEXT,
  UNIQUE(guildmember_id, week_of),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_guild_weekly_checkins_member_week
  ON guild_weekly_checkins(guildmember_id, week_of DESC);

-- ----------------------------------------------------------------------------
-- guild_fraud_flags
-- Append-only log of fraud detection flags. Reviewed by Trust & Safety.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS guild_fraud_flags (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  guildmember_id UUID REFERENCES guild_members(id) ON DELETE CASCADE,
  application_id UUID REFERENCES guild_applications(id) ON DELETE CASCADE,
  flag_type TEXT NOT NULL
    CHECK (flag_type IN (
      'self_referral_suspected',
      'velocity_limit_exceeded',
      'low_retention_pattern',
      'suspicious_ip_pattern',
      'chargeback_on_referral',
      'voice_mismatch',
      'bot_traffic_suspected',
      'manual_flag'
    )),
  severity TEXT NOT NULL CHECK (severity IN ('low', 'medium', 'high', 'critical')),
  payload JSONB,
  status TEXT NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'investigating', 'confirmed', 'dismissed')),
  resolution TEXT,
  resolved_by UUID,
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_guild_fraud_flags_member
  ON guild_fraud_flags(guildmember_id) WHERE status = 'open';
CREATE INDEX IF NOT EXISTS idx_guild_fraud_flags_severity
  ON guild_fraud_flags(severity, status);

-- ----------------------------------------------------------------------------
-- RLS Policies
-- ----------------------------------------------------------------------------
ALTER TABLE guild_applications ENABLE ROW LEVEL SECURITY;
ALTER TABLE guild_voice_interviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE guild_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE guild_tier_promotions ENABLE ROW LEVEL SECURITY;
ALTER TABLE guild_referrals ENABLE ROW LEVEL SECURITY;
ALTER TABLE guild_commissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE guild_payouts ENABLE ROW LEVEL SECURITY;
ALTER TABLE guild_agent_context ENABLE ROW LEVEL SECURITY;
ALTER TABLE guild_growth_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE guild_weekly_checkins ENABLE ROW LEVEL SECURITY;
ALTER TABLE guild_fraud_flags ENABLE ROW LEVEL SECURITY;

-- Applications: anyone can insert (public application form), only self/admin can read
CREATE POLICY "Anyone can submit an application"
  ON guild_applications FOR INSERT
  WITH CHECK (true);

CREATE POLICY "Applicants can view their own application by email"
  ON guild_applications FOR SELECT
  USING (
    email = (SELECT email FROM auth.users WHERE id = auth.uid())
    OR EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true)
  );

-- Guild members: can read their own, admins read all
CREATE POLICY "Members can view their own record"
  ON guild_members FOR SELECT
  USING (
    user_id = auth.uid()
    OR EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true)
  );

CREATE POLICY "Members can update their own record"
  ON guild_members FOR UPDATE
  USING (user_id = auth.uid());

-- Referrals: guildmember sees their own referrals
CREATE POLICY "Members can view their own referrals"
  ON guild_referrals FOR SELECT
  USING (
    guildmember_id IN (SELECT id FROM guild_members WHERE user_id = auth.uid())
    OR EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true)
  );

-- Commissions: guildmember sees their own
CREATE POLICY "Members can view their own commissions"
  ON guild_commissions FOR SELECT
  USING (
    guildmember_id IN (SELECT id FROM guild_members WHERE user_id = auth.uid())
    OR EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true)
  );

-- Payouts: guildmember sees their own
CREATE POLICY "Members can view their own payouts"
  ON guild_payouts FOR SELECT
  USING (
    guildmember_id IN (SELECT id FROM guild_members WHERE user_id = auth.uid())
    OR EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true)
  );

-- Agent context: guildmember reads/writes their own
CREATE POLICY "Members can read their own agent context"
  ON guild_agent_context FOR SELECT
  USING (guildmember_id IN (SELECT id FROM guild_members WHERE user_id = auth.uid()));

CREATE POLICY "Members can update their own agent context"
  ON guild_agent_context FOR UPDATE
  USING (guildmember_id IN (SELECT id FROM guild_members WHERE user_id = auth.uid()));

-- Growth plans: member reads their own
CREATE POLICY "Members can view their own growth plans"
  ON guild_growth_plans FOR SELECT
  USING (guildmember_id IN (SELECT id FROM guild_members WHERE user_id = auth.uid()));

-- Weekly checkins: member reads their own
CREATE POLICY "Members can view their own checkins"
  ON guild_weekly_checkins FOR SELECT
  USING (guildmember_id IN (SELECT id FROM guild_members WHERE user_id = auth.uid()));

-- Tier promotions: member sees their own
CREATE POLICY "Members can view their own promotions"
  ON guild_tier_promotions FOR SELECT
  USING (guildmember_id IN (SELECT id FROM guild_members WHERE user_id = auth.uid()));

-- Voice interviews: linked via application email
CREATE POLICY "Applicants can view their own voice interview"
  ON guild_voice_interviews FOR SELECT
  USING (
    application_id IN (
      SELECT id FROM guild_applications
      WHERE email = (SELECT email FROM auth.users WHERE id = auth.uid())
    )
    OR EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true)
  );

-- Fraud flags: admins only
CREATE POLICY "Admins only on fraud flags"
  ON guild_fraud_flags FOR SELECT
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true));

-- ----------------------------------------------------------------------------
-- Triggers: update updated_at on row updates
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION update_guild_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER set_updated_at_guild_applications
  BEFORE UPDATE ON guild_applications
  FOR EACH ROW EXECUTE FUNCTION update_guild_updated_at();

CREATE TRIGGER set_updated_at_guild_voice_interviews
  BEFORE UPDATE ON guild_voice_interviews
  FOR EACH ROW EXECUTE FUNCTION update_guild_updated_at();

CREATE TRIGGER set_updated_at_guild_members
  BEFORE UPDATE ON guild_members
  FOR EACH ROW EXECUTE FUNCTION update_guild_updated_at();

CREATE TRIGGER set_updated_at_guild_referrals
  BEFORE UPDATE ON guild_referrals
  FOR EACH ROW EXECUTE FUNCTION update_guild_updated_at();

CREATE TRIGGER set_updated_at_guild_payouts
  BEFORE UPDATE ON guild_payouts
  FOR EACH ROW EXECUTE FUNCTION update_guild_updated_at();

CREATE TRIGGER set_updated_at_guild_growth_plans
  BEFORE UPDATE ON guild_growth_plans
  FOR EACH ROW EXECUTE FUNCTION update_guild_updated_at();

-- ----------------------------------------------------------------------------
-- Comments for documentation
-- ----------------------------------------------------------------------------
COMMENT ON TABLE guild_applications IS 'The Penworth Guild — Applications submitted via the public apply form. Ref spec section 6.';
COMMENT ON TABLE guild_members IS 'The Penworth Guild — Accepted Guildmembers. One row per person in the Guild.';
COMMENT ON TABLE guild_referrals IS 'The Penworth Guild — Every sign-up attributed to a Guildmember''s referral code.';
COMMENT ON TABLE guild_commissions IS 'The Penworth Guild — Commission events earned by Guildmembers. 12-month window per referral.';
COMMENT ON TABLE guild_payouts IS 'The Penworth Guild — Monthly payout records. Paid last business day of month, Adelaide time.';
COMMENT ON TABLE guild_tier_promotions IS 'The Penworth Guild — Append-only audit of tier changes (Apprentice → Fellow).';
COMMENT ON TABLE guild_voice_interviews IS 'The Penworth Guild — 10-minute AI-conducted voice interview records.';
COMMENT ON TABLE guild_agent_context IS 'The Penworth Guild — Shared context for the 7 AI support agents (Scout, Coach, Creator, Mentor, Analyst, Strategist, Advisor).';
COMMENT ON TABLE guild_growth_plans IS 'The Penworth Guild — Coach agent-generated personalised growth plans. 30-day at Apprentice, 90-day at higher tiers.';
COMMENT ON TABLE guild_weekly_checkins IS 'The Penworth Guild — Mentor agent weekly journal entries per Guildmember.';
COMMENT ON TABLE guild_fraud_flags IS 'The Penworth Guild — Fraud detection flags reviewed by Head of Trust & Safety.';
