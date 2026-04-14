-- v2 Pricing Model Migration
-- Adds plan, credits_balance, credits_purchased columns to profiles

-- Add plan column (free/pro/max)
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS plan TEXT DEFAULT 'free' CHECK (plan IN ('free', 'pro', 'max'));

-- Add credits columns
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS credits_balance INTEGER DEFAULT 1000;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS credits_purchased INTEGER DEFAULT 0;

-- Add documents_this_month counter (resets monthly)
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS documents_this_month INTEGER DEFAULT 0;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS documents_reset_at TIMESTAMPTZ DEFAULT NOW();

-- Update organizations to use v2 plan names
ALTER TABLE organizations DROP CONSTRAINT IF EXISTS organizations_subscription_tier_check;
ALTER TABLE organizations ADD CONSTRAINT organizations_subscription_tier_check 
  CHECK (subscription_tier IS NULL OR subscription_tier IN ('free', 'pro', 'max'));

-- Create index for plan lookups
CREATE INDEX IF NOT EXISTS idx_profiles_plan ON profiles(plan);

-- Function to reset monthly credits
CREATE OR REPLACE FUNCTION reset_monthly_credits()
RETURNS void AS $$
DECLARE
  plan_limits JSONB := '{
    "free": {"credits": 1000, "docs": 1},
    "pro": {"credits": 2000, "docs": 2},
    "max": {"credits": 5000, "docs": 5}
  }'::JSONB;
BEGIN
  UPDATE profiles
  SET 
    credits_balance = (plan_limits->plan->>'credits')::INTEGER,
    documents_this_month = 0,
    documents_reset_at = NOW()
  WHERE documents_reset_at < DATE_TRUNC('month', NOW());
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Comment for documentation
COMMENT ON COLUMN profiles.plan IS 'v2 pricing tier: free, pro, or max';
COMMENT ON COLUMN profiles.credits_balance IS 'Current monthly credits remaining';
COMMENT ON COLUMN profiles.credits_purchased IS 'Purchased credits that never expire';
