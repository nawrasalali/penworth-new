/**
 * Shared category taxonomy for Penworth content types.
 *
 * Used by:
 *   - /projects/new   — category picker when creating a project
 *   - /projects       — grouping on the My Projects page
 *
 * Keeping this in one place means adding a new content type only requires
 * editing this file; both pages pick it up automatically.
 */

import type { ContentType } from '@/types';
import {
  BookOpen,
  Briefcase,
  GraduationCap,
  Scale,
  Code,
  Sparkles,
  MoreHorizontal,
} from 'lucide-react';

export type CategoryId =
  | 'books'
  | 'business'
  | 'academic'
  | 'legal'
  | 'technical'
  | 'creative'
  | 'other';

export interface CategoryDef {
  id: CategoryId;
  label: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
  accent: string;
  // content_type values that belong to this category
  contentTypes: ContentType[];
}

export const CATEGORIES: CategoryDef[] = [
  {
    id: 'books',
    label: 'Books',
    description: 'Full-length manuscripts, memoirs, and narrative non-fiction',
    icon: BookOpen,
    accent: 'text-blue-600',
    contentTypes: [
      'non-fiction',
      'fiction',
      'self-help',
      'memoir',
      'biography',
      'children',
      'cookbook',
      'travel',
      'book',
    ],
  },
  {
    id: 'business',
    label: 'Business',
    description: 'Plans, proposals, reports, and business books',
    icon: Briefcase,
    accent: 'text-emerald-600',
    contentTypes: [
      'business_plan',
      'proposal',
      'white_paper',
      'pitch_deck',
      'financial_model',
      'report',
      'business',
    ],
  },
  {
    id: 'academic',
    label: 'Academic',
    description: 'Theses, papers, research, and educational material',
    icon: GraduationCap,
    accent: 'text-violet-600',
    contentTypes: [
      'thesis',
      'dissertation',
      'research_paper',
      'paper',
      'educational',
      'academic',
    ],
  },
  {
    id: 'legal',
    label: 'Legal',
    description: 'Contracts, policies, briefs, and governance documents',
    icon: Scale,
    accent: 'text-amber-600',
    contentTypes: [
      'contract',
      'nda',
      'terms_of_service',
      'privacy_policy',
      'policy_document',
      'policy',
      'legal_brief',
    ],
  },
  {
    id: 'technical',
    label: 'Technical',
    description: 'Documentation, specifications, and technical books',
    icon: Code,
    accent: 'text-sky-600',
    contentTypes: [
      'technical_doc',
      'api_docs',
      'user_manual',
      'specification',
      'technical',
    ],
  },
  {
    id: 'creative',
    label: 'Creative',
    description: 'Poetry, short fiction, screenplays, and essays',
    icon: Sparkles,
    accent: 'text-rose-600',
    contentTypes: ['poetry', 'short_story', 'screenplay', 'essay_collection'],
  },
  {
    id: 'other',
    label: 'Other',
    description: "Custom content that doesn't fit the categories above",
    icon: MoreHorizontal,
    accent: 'text-slate-600',
    contentTypes: ['other'],
  },
];

/** Map content_type → category id (O(1) lookup). */
export const CONTENT_TYPE_TO_CATEGORY: Record<string, CategoryId> = (() => {
  const map: Record<string, CategoryId> = {};
  for (const cat of CATEGORIES) {
    for (const ct of cat.contentTypes) {
      map[ct] = cat.id;
    }
  }
  return map;
})();

export function getCategoryForContentType(contentType?: string | null): CategoryId {
  if (!contentType) return 'other';
  return CONTENT_TYPE_TO_CATEGORY[contentType] || 'other';
}
