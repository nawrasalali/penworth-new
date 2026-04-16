// ===========================================
// PENWORTH TYPE DEFINITIONS
// ===========================================

// Industry types supported by the platform
export type Industry = 
  | 'healthcare'
  | 'education'
  | 'finance'
  | 'legal'
  | 'mining'
  | 'government'
  | 'technology'
  | 'publishing'
  | 'general';

// Content types that can be created
export type ContentType =
  // Book-specific content types (primary - used by Penworth)
  | 'non-fiction'
  | 'fiction'
  | 'memoir'
  | 'self-help'
  | 'business'
  | 'technical'
  | 'academic'
  | 'children'
  | 'poetry'
  | 'cookbook'
  | 'travel'
  | 'biography'
  // Legacy content types (for backwards compatibility)
  | 'book'
  | 'paper'
  | 'business_plan'
  | 'financial_model'
  | 'educational'
  | 'policy'
  | 'technical_doc'
  | 'report'
  | 'other';

// Project status
export type ProjectStatus = 
  | 'draft'
  | 'in_progress'
  | 'review'
  | 'approved'
  | 'published';

// Content visibility
export type Visibility = 'private' | 'org' | 'public';

// Organization roles
export type OrgRole = 'owner' | 'admin' | 'editor' | 'viewer';

// Subscription tiers
export type SubscriptionTier = 'free' | 'pro' | 'team' | 'enterprise';

// AI Agent types
export type AgentType =
  | 'interview'
  | 'outline'
  | 'research'
  | 'writing'
  | 'layout'
  | 'verification'
  | 'compliance'
  | 'review';

// AI Model tiers
export type ModelTier = 'opus' | 'sonnet' | 'haiku';

// ===========================================
// DATABASE TYPES
// ===========================================

export interface Profile {
  id: string;
  email: string;
  full_name: string | null;
  avatar_url: string | null;
  created_at: string;
  updated_at: string;
}

export interface Organization {
  id: string;
  name: string;
  slug: string;
  industry: Industry;
  logo_url: string | null;
  brand_colors: {
    primary: string;
    secondary: string;
  };
  settings: Record<string, unknown>;
  subscription_tier: SubscriptionTier;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface OrgMember {
  id: string;
  org_id: string;
  user_id: string;
  role: OrgRole;
  created_at: string;
  // Joined data
  profile?: Profile;
  organization?: Organization;
}

export interface Project {
  id: string;
  org_id: string | null;
  user_id: string | null;
  title: string;
  description: string | null;
  content_type: ContentType;
  status: ProjectStatus;
  visibility: Visibility;
  metadata: ProjectMetadata;
  created_at: string;
  updated_at: string;
  // Joined data
  chapters?: Chapter[];
  organization?: Organization;
  user?: Profile;
}

export interface ProjectMetadata {
  word_count?: number;
  target_word_count?: number;
  genre?: string;
  audience?: string;
  tone?: string;
  custom_instructions?: string;
}

export interface Chapter {
  id: string;
  project_id: string;
  title: string;
  content: string;
  order_index: number;
  status: string;
  word_count: number;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface AISession {
  id: string;
  project_id: string;
  user_id: string | null;
  agent_type: AgentType;
  messages: AIMessage[];
  status: 'active' | 'completed' | 'error';
  tokens_used: number;
  model_used: string | null;
  created_at: string;
  updated_at: string;
}

export interface AIMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: string;
  model?: string;
  tokens?: number;
}

export interface Source {
  id: string;
  project_id: string;
  title: string;
  url: string | null;
  content: string | null;
  source_type: 'web' | 'pdf' | 'manual' | 'api';
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface Usage {
  id: string;
  user_id: string;
  org_id: string | null;
  action_type: string;
  tokens_input: number;
  tokens_output: number;
  model: string;
  cost_usd: number;
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface MarketplaceListing {
  id: string;
  project_id: string;
  seller_id: string;
  org_id: string | null;
  title: string;
  description: string | null;
  price_cents: number;
  license_type: 'personal' | 'commercial' | 'enterprise';
  status: 'pending' | 'approved' | 'rejected' | 'active' | 'archived';
  downloads: number;
  rating: number | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  // Joined data
  project?: Project;
  seller?: Profile;
}

// ===========================================
// API TYPES
// ===========================================

export interface APIResponse<T> {
  data?: T;
  error?: string;
  message?: string;
}

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  per_page: number;
  total_pages: number;
}

// ===========================================
// AI TYPES
// ===========================================

export interface AgentConfig {
  type: AgentType;
  industry: Industry;
  systemPrompt: string;
  modelTier: ModelTier;
  maxTokens: number;
  temperature: number;
}

export interface GenerationRequest {
  project_id: string;
  chapter_id?: string;
  agent_type: AgentType;
  prompt: string;
  context?: string;
  options?: {
    tone?: string;
    length?: 'short' | 'medium' | 'long';
    format?: string;
  };
}

export interface GenerationResponse {
  content: string;
  citations?: Citation[];
  confidence?: number;
  tokens_used: number;
  model: string;
}

export interface Citation {
  text: string;
  source: string;
  url?: string;
  confidence: number;
}

// ===========================================
// UI TYPES
// ===========================================

export interface SidebarItem {
  label: string;
  href: string;
  icon: string;
  badge?: string | number;
  children?: SidebarItem[];
}

export interface BreadcrumbItem {
  label: string;
  href?: string;
}

export interface Tab {
  id: string;
  label: string;
  content: React.ReactNode;
}

// ===========================================
// FORM TYPES
// ===========================================

export interface CreateProjectForm {
  title: string;
  description?: string;
  content_type: ContentType;
  visibility: Visibility;
  org_id?: string;
}

export interface CreateOrgForm {
  name: string;
  industry: Industry;
}

export interface InviteMemberForm {
  email: string;
  role: OrgRole;
}
