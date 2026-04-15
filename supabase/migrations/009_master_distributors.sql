-- Master Distributor Program Schema
-- For Operation Viet But and global expansion

-- Master Distributors table
CREATE TABLE IF NOT EXISTS master_distributors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
  
  -- Distributor info
  full_name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  phone TEXT,
  country TEXT NOT NULL,
  region TEXT, -- e.g., "Ho Chi Minh City", "Sydney"
  
  -- Status
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'active', 'suspended', 'terminated')),
  approved_at TIMESTAMPTZ,
  approved_by UUID REFERENCES profiles(id),
  
  -- Distributor code for tracking
  distributor_code TEXT UNIQUE NOT NULL,
  
  -- Tier (based on performance)
  tier TEXT DEFAULT 'bronze' CHECK (tier IN ('bronze', 'silver', 'gold', 'platinum')),
  
  -- Commission rates (percentages)
  commission_rate_monthly DECIMAL(5,2) DEFAULT 30.00,
  commission_rate_annual DECIMAL(5,2) DEFAULT 25.00,
  commission_rate_credits DECIMAL(5,2) DEFAULT 20.00,
  
  -- Targets
  signup_target INTEGER DEFAULT 100,
  signup_deadline TIMESTAMPTZ,
  
  -- Performance
  total_signups INTEGER DEFAULT 0,
  total_conversions INTEGER DEFAULT 0,
  total_revenue_generated DECIMAL(12,2) DEFAULT 0,
  total_commission_earned DECIMAL(12,2) DEFAULT 0,
  total_commission_paid DECIMAL(12,2) DEFAULT 0,
  
  -- Banking for payouts
  bank_name TEXT,
  bank_account_name TEXT,
  bank_account_number TEXT,
  bank_routing TEXT,
  paypal_email TEXT,
  
  -- Metadata
  notes TEXT,
  application_data JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Distributor signups tracking
CREATE TABLE IF NOT EXISTS distributor_signups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  distributor_id UUID REFERENCES master_distributors(id) ON DELETE CASCADE,
  user_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
  
  -- Signup source
  source TEXT DEFAULT 'direct', -- direct, gala, workshop, social, referral
  campaign TEXT, -- e.g., 'vietnam-april-2026', 'hcmc-gala'
  
  -- Attribution
  referral_code TEXT,
  landing_page TEXT,
  utm_source TEXT,
  utm_medium TEXT,
  utm_campaign TEXT,
  
  -- Conversion tracking
  signed_up_at TIMESTAMPTZ DEFAULT NOW(),
  first_book_at TIMESTAMPTZ,
  first_payment_at TIMESTAMPTZ,
  converted_to_paid BOOLEAN DEFAULT FALSE,
  
  -- Revenue from this signup
  total_payments DECIMAL(10,2) DEFAULT 0,
  commission_due DECIMAL(10,2) DEFAULT 0,
  commission_paid BOOLEAN DEFAULT FALSE,
  
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Commission payouts
CREATE TABLE IF NOT EXISTS distributor_payouts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  distributor_id UUID REFERENCES master_distributors(id) ON DELETE CASCADE,
  
  -- Payout details
  amount DECIMAL(10,2) NOT NULL,
  currency TEXT DEFAULT 'USD',
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  
  -- Status
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
  
  -- Payment method
  payment_method TEXT, -- bank_transfer, paypal, stripe
  payment_reference TEXT,
  
  -- Breakdown
  signups_count INTEGER DEFAULT 0,
  conversions_count INTEGER DEFAULT 0,
  revenue_generated DECIMAL(10,2) DEFAULT 0,
  
  -- Timestamps
  requested_at TIMESTAMPTZ DEFAULT NOW(),
  processed_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  
  notes TEXT
);

-- Expansion campaigns
CREATE TABLE IF NOT EXISTS expansion_campaigns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Campaign info
  name TEXT NOT NULL,
  code TEXT UNIQUE NOT NULL, -- e.g., 'operation-viet-but'
  country TEXT NOT NULL,
  region TEXT,
  
  -- Status
  status TEXT DEFAULT 'planned' CHECK (status IN ('planned', 'active', 'paused', 'completed')),
  
  -- Dates
  start_date DATE,
  end_date DATE,
  
  -- Targets
  signup_target INTEGER DEFAULT 10000,
  revenue_target DECIMAL(12,2),
  
  -- Progress
  current_signups INTEGER DEFAULT 0,
  current_revenue DECIMAL(12,2) DEFAULT 0,
  
  -- Special offers
  bonus_credits INTEGER DEFAULT 0, -- Extra credits for this campaign
  discount_percentage INTEGER DEFAULT 0,
  
  -- Landing page
  landing_url TEXT,
  
  -- Budget
  marketing_budget DECIMAL(10,2),
  spent DECIMAL(10,2) DEFAULT 0,
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Events (galas, workshops)
CREATE TABLE IF NOT EXISTS expansion_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id UUID REFERENCES expansion_campaigns(id) ON DELETE CASCADE,
  
  -- Event info
  name TEXT NOT NULL,
  type TEXT CHECK (type IN ('gala', 'workshop', 'webinar', 'conference', 'meetup')),
  
  -- Location
  venue_name TEXT,
  address TEXT,
  city TEXT,
  country TEXT,
  is_virtual BOOLEAN DEFAULT FALSE,
  virtual_link TEXT,
  
  -- Schedule
  event_date DATE NOT NULL,
  start_time TIME,
  end_time TIME,
  timezone TEXT DEFAULT 'Asia/Ho_Chi_Minh',
  
  -- Capacity
  max_attendees INTEGER,
  registered_count INTEGER DEFAULT 0,
  attended_count INTEGER DEFAULT 0,
  
  -- Registration
  registration_open BOOLEAN DEFAULT TRUE,
  registration_deadline TIMESTAMPTZ,
  registration_fee DECIMAL(8,2) DEFAULT 0,
  
  -- Signups from event
  signups_from_event INTEGER DEFAULT 0,
  
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Event registrations
CREATE TABLE IF NOT EXISTS event_registrations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID REFERENCES expansion_events(id) ON DELETE CASCADE,
  
  -- Attendee info
  user_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
  full_name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT,
  company TEXT,
  
  -- Status
  status TEXT DEFAULT 'registered' CHECK (status IN ('registered', 'confirmed', 'attended', 'no_show', 'cancelled')),
  
  -- Referred by distributor?
  distributor_id UUID REFERENCES master_distributors(id),
  
  -- Timestamps
  registered_at TIMESTAMPTZ DEFAULT NOW(),
  confirmed_at TIMESTAMPTZ,
  attended_at TIMESTAMPTZ
);

-- Insert Operation Viet But campaign
INSERT INTO expansion_campaigns (name, code, country, region, status, start_date, end_date, signup_target, bonus_credits, landing_url)
VALUES (
  'Operation Viet But',
  'operation-viet-but',
  'Vietnam',
  'Ho Chi Minh City',
  'active',
  '2026-04-01',
  '2026-06-30',
  100000,
  1000, -- Extra 1000 credits (total 2000)
  'https://vi.penworth.ai'
) ON CONFLICT (code) DO NOTHING;

-- Indexes
CREATE INDEX IF NOT EXISTS idx_distributors_country ON master_distributors(country);
CREATE INDEX IF NOT EXISTS idx_distributors_status ON master_distributors(status);
CREATE INDEX IF NOT EXISTS idx_distributor_signups_distributor ON distributor_signups(distributor_id);
CREATE INDEX IF NOT EXISTS idx_distributor_signups_campaign ON distributor_signups(campaign);
CREATE INDEX IF NOT EXISTS idx_campaigns_status ON expansion_campaigns(status);
CREATE INDEX IF NOT EXISTS idx_campaigns_country ON expansion_campaigns(country);

-- RLS Policies
ALTER TABLE master_distributors ENABLE ROW LEVEL SECURITY;
ALTER TABLE distributor_signups ENABLE ROW LEVEL SECURITY;
ALTER TABLE distributor_payouts ENABLE ROW LEVEL SECURITY;
ALTER TABLE expansion_campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE expansion_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE event_registrations ENABLE ROW LEVEL SECURITY;

-- Distributors can view their own data
CREATE POLICY "Distributors view own data" ON master_distributors
  FOR SELECT USING (user_id = auth.uid());

CREATE POLICY "Distributors view own signups" ON distributor_signups
  FOR SELECT USING (distributor_id IN (SELECT id FROM master_distributors WHERE user_id = auth.uid()));

CREATE POLICY "Distributors view own payouts" ON distributor_payouts
  FOR SELECT USING (distributor_id IN (SELECT id FROM master_distributors WHERE user_id = auth.uid()));

-- Public can view active campaigns
CREATE POLICY "Public view active campaigns" ON expansion_campaigns
  FOR SELECT USING (status = 'active');

-- Public can view upcoming events
CREATE POLICY "Public view events" ON expansion_events
  FOR SELECT USING (event_date >= CURRENT_DATE);

-- Users can register for events
CREATE POLICY "Users register for events" ON event_registrations
  FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "Users view own registrations" ON event_registrations
  FOR SELECT USING (user_id = auth.uid());
