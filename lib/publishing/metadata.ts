import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Canonical publishing metadata for a project.
 * Authored once; transformed per platform at publish time.
 */
export interface PublishingMetadata {
  project_id: string;
  user_id: string;
  title: string;
  subtitle?: string | null;
  author_name: string;
  author_bio?: string | null;
  short_description?: string | null;
  long_description?: string | null;
  keywords: string[];
  bisac_codes: string[];
  price_usd?: number | null;
  currency: string;
  is_free: boolean;
  territories: 'worldwide' | 'us_only' | 'custom';
  custom_territories?: string[] | null;
  language: string;
  publication_date?: string | null;
  edition?: string | null;
  series_name?: string | null;
  series_number?: number | null;
  audience?: 'adult' | 'ya' | 'middle_grade' | 'children' | null;
  contains_explicit: boolean;
}

export async function loadPublishingMetadata(
  supabase: SupabaseClient,
  projectId: string,
  userId: string,
): Promise<PublishingMetadata | null> {
  const { data } = await supabase
    .from('publishing_metadata')
    .select('*')
    .eq('project_id', projectId)
    .eq('user_id', userId)
    .maybeSingle();
  return (data as PublishingMetadata) || null;
}

/**
 * Seed metadata from the project + interview session when the author first
 * visits the Publish tab. Uses interview answers + author name from session.
 * Idempotent — if a row already exists, returns it unchanged.
 */
export async function ensurePublishingMetadata(
  supabase: SupabaseClient,
  projectId: string,
  userId: string,
): Promise<PublishingMetadata | null> {
  const existing = await loadPublishingMetadata(supabase, projectId, userId);
  if (existing) return existing;

  // Seed from project + session
  const { data: project } = await supabase
    .from('projects')
    .select('title, description, content_type')
    .eq('id', projectId)
    .eq('user_id', userId)
    .single();

  if (!project) return null;

  const { data: session } = await supabase
    .from('interview_sessions')
    .select('author_name, about_author')
    .eq('project_id', projectId)
    .eq('user_id', userId)
    .maybeSingle();

  const { data: profile } = await supabase
    .from('profiles')
    .select('full_name, email, preferred_language')
    .eq('id', userId)
    .single();

  const seed: Omit<PublishingMetadata, 'project_id' | 'user_id'> = {
    title: project.title || 'Untitled',
    subtitle: null,
    author_name: session?.author_name || profile?.full_name || profile?.email?.split('@')[0] || 'Author',
    author_bio: session?.about_author || null,
    short_description: project.description?.slice(0, 150) || null,
    long_description: project.description || null,
    keywords: [],
    bisac_codes: [],
    price_usd: null,
    currency: 'USD',
    is_free: false,
    territories: 'worldwide',
    custom_territories: null,
    language: profile?.preferred_language || 'en',
    publication_date: null,
    edition: null,
    series_name: null,
    series_number: null,
    audience: 'adult',
    contains_explicit: false,
  };

  const { data: inserted, error } = await supabase
    .from('publishing_metadata')
    .insert({ project_id: projectId, user_id: userId, ...seed })
    .select('*')
    .single();

  if (error) {
    console.error('Failed to seed publishing metadata:', error);
    return null;
  }
  return inserted as PublishingMetadata;
}

/**
 * Validate metadata is ready for a given tier. Different platforms require
 * different minima (KDP needs 7 keywords + BISAC, Gumroad needs only price).
 */
export function validateForPublishing(
  meta: PublishingMetadata,
  tier: 'penworth_store' | 'api_auto' | 'guided_pdf',
): { ok: boolean; missing: string[] } {
  const missing: string[] = [];
  if (!meta.title?.trim()) missing.push('title');
  if (!meta.author_name?.trim()) missing.push('author name');
  if (!meta.long_description?.trim()) missing.push('description');

  if (tier === 'guided_pdf' || tier === 'api_auto') {
    if (meta.keywords.length === 0) missing.push('keywords (at least 1)');
    if (!meta.is_free && (meta.price_usd == null || meta.price_usd < 0.99)) {
      missing.push('price (min $0.99, or mark as free)');
    }
  }
  return { ok: missing.length === 0, missing };
}
