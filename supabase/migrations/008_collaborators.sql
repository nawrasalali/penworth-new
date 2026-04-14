-- Collaborators table for co-author invitations
CREATE TABLE IF NOT EXISTS collaborators (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  collaborator_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  email TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'reviewer' CHECK (role IN ('reviewer', 'editor', 'co_author')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'declined', 'revoked')),
  invite_token TEXT UNIQUE,
  invite_sent_at TIMESTAMPTZ DEFAULT NOW(),
  accepted_at TIMESTAMPTZ,
  permissions JSONB DEFAULT '{"can_comment": true, "can_edit": false, "can_export": false}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE collaborators ENABLE ROW LEVEL SECURITY;

-- Owner can manage collaborators
CREATE POLICY "Owners can manage collaborators"
  ON collaborators FOR ALL
  USING (auth.uid() = owner_id);

-- Collaborators can view their own invites
CREATE POLICY "Collaborators can view own invites"
  ON collaborators FOR SELECT
  USING (auth.uid() = collaborator_id OR email = (SELECT email FROM auth.users WHERE id = auth.uid()));

-- Collaborators can update their own status (accept/decline)
CREATE POLICY "Collaborators can accept/decline invites"
  ON collaborators FOR UPDATE
  USING (email = (SELECT email FROM auth.users WHERE id = auth.uid()))
  WITH CHECK (status IN ('accepted', 'declined'));

-- Indexes
CREATE INDEX idx_collaborators_project ON collaborators(project_id);
CREATE INDEX idx_collaborators_owner ON collaborators(owner_id);
CREATE INDEX idx_collaborators_email ON collaborators(email);
CREATE INDEX idx_collaborators_token ON collaborators(invite_token);
CREATE INDEX idx_collaborators_collaborator ON collaborators(collaborator_id);

-- Trigger for updated_at
CREATE TRIGGER update_collaborators_updated_at
  BEFORE UPDATE ON collaborators
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Function to generate invite token
CREATE OR REPLACE FUNCTION generate_invite_token()
RETURNS TEXT AS $$
DECLARE
  chars TEXT := 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  result TEXT := '';
  i INTEGER;
BEGIN
  FOR i IN 1..24 LOOP
    result := result || substr(chars, floor(random() * length(chars) + 1)::integer, 1);
  END LOOP;
  RETURN result;
END;
$$ LANGUAGE plpgsql;
