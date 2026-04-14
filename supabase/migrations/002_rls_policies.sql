-- =============================================
-- PENWORTH DATABASE SCHEMA
-- Migration 002: Row Level Security Policies
-- =============================================

-- Enable RLS on all tables
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.org_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chapters ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.usage ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.marketplace_listings ENABLE ROW LEVEL SECURITY;

-- =============================================
-- PROFILES POLICIES
-- =============================================
CREATE POLICY "Users can view own profile"
  ON public.profiles FOR SELECT
  USING (auth.uid() = id);

CREATE POLICY "Users can update own profile"
  ON public.profiles FOR UPDATE
  USING (auth.uid() = id);

CREATE POLICY "Users can view profiles of org members"
  ON public.profiles FOR SELECT
  USING (
    id IN (
      SELECT user_id FROM public.org_members
      WHERE org_id IN (
        SELECT org_id FROM public.org_members WHERE user_id = auth.uid()
      )
    )
  );

-- =============================================
-- ORGANIZATIONS POLICIES
-- =============================================
CREATE POLICY "Org members can view their organizations"
  ON public.organizations FOR SELECT
  USING (
    id IN (SELECT org_id FROM public.org_members WHERE user_id = auth.uid())
  );

CREATE POLICY "Org owners and admins can update organizations"
  ON public.organizations FOR UPDATE
  USING (
    id IN (
      SELECT org_id FROM public.org_members 
      WHERE user_id = auth.uid() AND role IN ('owner', 'admin')
    )
  );

CREATE POLICY "Users can create organizations"
  ON public.organizations FOR INSERT
  WITH CHECK (true);

CREATE POLICY "Org owners can delete organizations"
  ON public.organizations FOR DELETE
  USING (
    id IN (
      SELECT org_id FROM public.org_members 
      WHERE user_id = auth.uid() AND role = 'owner'
    )
  );

-- =============================================
-- ORG MEMBERS POLICIES
-- =============================================
CREATE POLICY "Org members can view memberships in their orgs"
  ON public.org_members FOR SELECT
  USING (
    org_id IN (SELECT org_id FROM public.org_members WHERE user_id = auth.uid())
  );

CREATE POLICY "Org owners and admins can manage memberships"
  ON public.org_members FOR ALL
  USING (
    org_id IN (
      SELECT org_id FROM public.org_members 
      WHERE user_id = auth.uid() AND role IN ('owner', 'admin')
    )
  );

CREATE POLICY "Users can see their own memberships"
  ON public.org_members FOR SELECT
  USING (user_id = auth.uid());

-- =============================================
-- PROJECTS POLICIES
-- =============================================
CREATE POLICY "Users can view own projects"
  ON public.projects FOR SELECT
  USING (user_id = auth.uid());

CREATE POLICY "Users can view org projects"
  ON public.projects FOR SELECT
  USING (
    org_id IN (SELECT org_id FROM public.org_members WHERE user_id = auth.uid())
  );

CREATE POLICY "Users can view public projects"
  ON public.projects FOR SELECT
  USING (visibility = 'public');

CREATE POLICY "Users can create projects"
  ON public.projects FOR INSERT
  WITH CHECK (
    user_id = auth.uid() OR
    org_id IN (
      SELECT org_id FROM public.org_members 
      WHERE user_id = auth.uid() AND role IN ('owner', 'admin', 'editor')
    )
  );

CREATE POLICY "Users can update own projects"
  ON public.projects FOR UPDATE
  USING (user_id = auth.uid());

CREATE POLICY "Org editors can update org projects"
  ON public.projects FOR UPDATE
  USING (
    org_id IN (
      SELECT org_id FROM public.org_members 
      WHERE user_id = auth.uid() AND role IN ('owner', 'admin', 'editor')
    )
  );

CREATE POLICY "Users can delete own projects"
  ON public.projects FOR DELETE
  USING (user_id = auth.uid());

-- =============================================
-- CHAPTERS POLICIES
-- =============================================
CREATE POLICY "Users can view chapters of accessible projects"
  ON public.chapters FOR SELECT
  USING (
    project_id IN (
      SELECT id FROM public.projects 
      WHERE user_id = auth.uid() 
      OR org_id IN (SELECT org_id FROM public.org_members WHERE user_id = auth.uid())
      OR visibility = 'public'
    )
  );

CREATE POLICY "Users can manage chapters of own projects"
  ON public.chapters FOR ALL
  USING (
    project_id IN (SELECT id FROM public.projects WHERE user_id = auth.uid())
  );

CREATE POLICY "Org editors can manage org project chapters"
  ON public.chapters FOR ALL
  USING (
    project_id IN (
      SELECT id FROM public.projects 
      WHERE org_id IN (
        SELECT org_id FROM public.org_members 
        WHERE user_id = auth.uid() AND role IN ('owner', 'admin', 'editor')
      )
    )
  );

-- =============================================
-- AI SESSIONS POLICIES
-- =============================================
CREATE POLICY "Users can view own AI sessions"
  ON public.ai_sessions FOR SELECT
  USING (user_id = auth.uid());

CREATE POLICY "Users can view AI sessions for accessible projects"
  ON public.ai_sessions FOR SELECT
  USING (
    project_id IN (
      SELECT id FROM public.projects 
      WHERE user_id = auth.uid() 
      OR org_id IN (SELECT org_id FROM public.org_members WHERE user_id = auth.uid())
    )
  );

CREATE POLICY "Users can create AI sessions"
  ON public.ai_sessions FOR INSERT
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can update own AI sessions"
  ON public.ai_sessions FOR UPDATE
  USING (user_id = auth.uid());

-- =============================================
-- SOURCES POLICIES
-- =============================================
CREATE POLICY "Users can view sources for accessible projects"
  ON public.sources FOR SELECT
  USING (
    project_id IN (
      SELECT id FROM public.projects 
      WHERE user_id = auth.uid() 
      OR org_id IN (SELECT org_id FROM public.org_members WHERE user_id = auth.uid())
    )
  );

CREATE POLICY "Users can manage sources for own projects"
  ON public.sources FOR ALL
  USING (
    project_id IN (SELECT id FROM public.projects WHERE user_id = auth.uid())
  );

-- =============================================
-- USAGE POLICIES
-- =============================================
CREATE POLICY "Users can view own usage"
  ON public.usage FOR SELECT
  USING (user_id = auth.uid());

CREATE POLICY "Org admins can view org usage"
  ON public.usage FOR SELECT
  USING (
    org_id IN (
      SELECT org_id FROM public.org_members 
      WHERE user_id = auth.uid() AND role IN ('owner', 'admin')
    )
  );

CREATE POLICY "System can insert usage"
  ON public.usage FOR INSERT
  WITH CHECK (true);

-- =============================================
-- MARKETPLACE LISTINGS POLICIES
-- =============================================
CREATE POLICY "Anyone can view active marketplace listings"
  ON public.marketplace_listings FOR SELECT
  USING (status = 'active');

CREATE POLICY "Sellers can view own listings"
  ON public.marketplace_listings FOR SELECT
  USING (seller_id = auth.uid());

CREATE POLICY "Users can create listings for own projects"
  ON public.marketplace_listings FOR INSERT
  WITH CHECK (
    seller_id = auth.uid() AND
    project_id IN (SELECT id FROM public.projects WHERE user_id = auth.uid())
  );

CREATE POLICY "Sellers can update own listings"
  ON public.marketplace_listings FOR UPDATE
  USING (seller_id = auth.uid());

CREATE POLICY "Sellers can delete own listings"
  ON public.marketplace_listings FOR DELETE
  USING (seller_id = auth.uid());
