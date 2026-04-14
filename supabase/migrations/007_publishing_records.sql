-- Publishing records table
CREATE TABLE IF NOT EXISTS publishing_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  platform TEXT NOT NULL CHECK (platform IN ('kdp', 'ingram_spark', 'd2d', 'lulu', 'google_play')),
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'submitted', 'live', 'rejected', 'removed')),
  external_id TEXT, -- Platform-specific ID (ASIN, ISBN, etc.)
  external_url TEXT, -- Link to published book
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE publishing_records ENABLE ROW LEVEL SECURITY;

-- RLS policies
CREATE POLICY "Users can view own publishing records"
  ON publishing_records FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own publishing records"
  ON publishing_records FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own publishing records"
  ON publishing_records FOR UPDATE
  USING (auth.uid() = user_id);

-- Indexes
CREATE INDEX idx_publishing_records_user ON publishing_records(user_id);
CREATE INDEX idx_publishing_records_project ON publishing_records(project_id);
CREATE INDEX idx_publishing_records_platform ON publishing_records(platform);

-- Trigger for updated_at
CREATE TRIGGER update_publishing_records_updated_at
  BEFORE UPDATE ON publishing_records
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
