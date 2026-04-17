import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

// Tailwind class name utility
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// Count words in text
export function countWords(text: string): number {
  if (!text) return 0;
  return text.trim().split(/\s+/).filter(Boolean).length;
}

// Format date for display
export function formatDate(date: string | Date): string {
  const d = new Date(date);
  return d.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

// Format word count with commas
export function formatWordCount(count: number): string {
  return count.toLocaleString();
}

// Format relative time (e.g., "2 hours ago")
export function formatRelativeTime(date: string | Date): string {
  const now = new Date();
  const d = new Date(date);
  const diffMs = now.getTime() - d.getTime();
  const diffSecs = Math.floor(diffMs / 1000);
  const diffMins = Math.floor(diffSecs / 60);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);
  const diffWeeks = Math.floor(diffDays / 7);
  const diffMonths = Math.floor(diffDays / 30);

  if (diffSecs < 60) return 'just now';
  if (diffMins < 60) return `${diffMins} minute${diffMins === 1 ? '' : 's'} ago`;
  if (diffHours < 24) return `${diffHours} hour${diffHours === 1 ? '' : 's'} ago`;
  if (diffDays < 7) return `${diffDays} day${diffDays === 1 ? '' : 's'} ago`;
  if (diffWeeks < 4) return `${diffWeeks} week${diffWeeks === 1 ? '' : 's'} ago`;
  if (diffMonths < 12) return `${diffMonths} month${diffMonths === 1 ? '' : 's'} ago`;
  
  return formatDate(date);
}

// Content type labels for projects
export const CONTENT_TYPE_LABELS: Record<string, string> = {
  // Books
  'non-fiction': 'Non-Fiction',
  'fiction': 'Fiction',
  'memoir': 'Memoir',
  'self-help': 'Self-Help',
  'biography': 'Biography',
  'children': "Children's Book",
  'poetry': 'Poetry',
  'cookbook': 'Cookbook',
  'travel': 'Travel Guide',
  'book': 'Book',
  // Business
  'business': 'Business Book',
  'business_plan': 'Business Plan',
  'proposal': 'Proposal',
  'white_paper': 'White Paper',
  'pitch_deck': 'Pitch Deck',
  'financial_model': 'Financial Model',
  'report': 'Report',
  // Academic
  'academic': 'Academic Book',
  'paper': 'Academic Paper',
  'thesis': 'Thesis',
  'dissertation': 'Dissertation',
  'research_paper': 'Research Paper',
  'educational': 'Educational Material',
  // Legal
  'contract': 'Contract',
  'nda': 'NDA',
  'terms_of_service': 'Terms of Service',
  'privacy_policy': 'Privacy Policy',
  'policy_document': 'Policy Document',
  'policy': 'Policy',
  'legal_brief': 'Legal Brief',
  // Technical
  'technical': 'Technical Book',
  'technical_doc': 'Technical Documentation',
  'api_docs': 'API Documentation',
  'user_manual': 'User Manual',
  'specification': 'Specification',
  // Creative
  'screenplay': 'Screenplay',
  'short_story': 'Short Story',
  'essay_collection': 'Essay Collection',
  // Fallback
  'other': 'Other',
};

// Industry labels for targeting
export const INDUSTRY_LABELS: Record<string, string> = {
  'general': 'General',
  'business': 'Business & Finance',
  'technology': 'Technology',
  'health': 'Health & Wellness',
  'education': 'Education',
  'creative': 'Creative Writing',
  'professional': 'Professional Services',
  'real-estate': 'Real Estate',
  'marketing': 'Marketing & Sales',
  'legal': 'Legal',
  'consulting': 'Consulting',
  'coaching': 'Coaching',
  'spiritual': 'Spiritual & Religious',
};

// Project status colors
export const STATUS_COLORS: Record<string, { bg: string; text: string; dot: string }> = {
  'draft': {
    bg: 'bg-neutral-100 dark:bg-neutral-800',
    text: 'text-neutral-600 dark:text-neutral-400',
    dot: 'bg-neutral-400',
  },
  'outline': {
    bg: 'bg-blue-50 dark:bg-blue-900/20',
    text: 'text-blue-600 dark:text-blue-400',
    dot: 'bg-blue-500',
  },
  'writing': {
    bg: 'bg-amber-50 dark:bg-amber-900/20',
    text: 'text-amber-600 dark:text-amber-400',
    dot: 'bg-amber-500',
  },
  'review': {
    bg: 'bg-purple-50 dark:bg-purple-900/20',
    text: 'text-purple-600 dark:text-purple-400',
    dot: 'bg-purple-500',
  },
  'complete': {
    bg: 'bg-emerald-50 dark:bg-emerald-900/20',
    text: 'text-emerald-600 dark:text-emerald-400',
    dot: 'bg-emerald-500',
  },
  'published': {
    bg: 'bg-green-50 dark:bg-green-900/20',
    text: 'text-green-600 dark:text-green-400',
    dot: 'bg-green-500',
  },
  'archived': {
    bg: 'bg-neutral-100 dark:bg-neutral-800',
    text: 'text-neutral-500 dark:text-neutral-500',
    dot: 'bg-neutral-400',
  },
};
