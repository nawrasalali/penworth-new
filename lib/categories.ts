/**
 * Shared category taxonomy for Penworth content types.
 *
 * CEO-038 (2026-04-23): trimmed to book types only. Penworth is a book-writing
 * platform; non-book document types (business plans, legal contracts, academic
 * theses, technical docs) are no longer surfaced in the picker even though the
 * ContentType union retains them for historical project rows.
 *
 * Screenplay removed per Founder directive — a screenplay is a script, not a
 * book, and the Author pipeline's craft prompts target prose formats.
 *
 * Used by:
 *   - /projects/new   — category picker when creating a project
 *   - /projects       — grouping on the My Projects page
 *
 * Keeping this in one place means adding a new content type only requires
 * editing this file; both pages pick it up automatically.
 */

import type { ContentType } from '@/types';
import { BookOpen, MoreHorizontal } from 'lucide-react';

export type CategoryId = 'books' | 'other';

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
    description: 'Every form of book Penworth writes — fiction, non-fiction, memoir, poetry, and more',
    icon: BookOpen,
    accent: 'text-blue-600',
    contentTypes: [
      'non-fiction',
      'fiction',
      'memoir',
      'poetry',
      'self-help',
      'biography',
      'children',
      'cookbook',
      'travel',
      'short_story',
      'essay_collection',
      'book',
    ],
  },
  {
    id: 'other',
    label: 'Other',
    description: "Custom books that don't fit the categories above",
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
