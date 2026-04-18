'use client';

import { useState, Suspense, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import {
  BookOpen,
  Briefcase,
  GraduationCap,
  Scale,
  Code,
  Sparkles,
  MoreHorizontal,
  ArrowLeft,
  Loader2,
  FileText,
  Presentation,
  LineChart,
  BookMarked,
  FileCheck2,
  ShieldCheck,
  Gavel,
  Wrench,
  BookType,
  Feather,
  PenLine,
  Coffee,
  Map,
  Heart,
  User,
  Baby,
  DollarSign,
  Notebook,
  FileSearch,
  Target,
} from 'lucide-react';
import type { ContentType } from '@/types';

// =============================================================================
// CATEGORY DEFINITIONS
// Each category groups specific content types that share an author intent.
// =============================================================================

type CategoryId = 'books' | 'business' | 'academic' | 'legal' | 'technical' | 'creative' | 'other';

interface ContentOption {
  id: ContentType;
  label: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
}

interface Category {
  id: CategoryId;
  label: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
  accent: string; // tailwind colour class on the card accent
  options: ContentOption[];
}

const CATEGORIES: Category[] = [
  {
    id: 'books',
    label: 'Books',
    description: 'Full-length manuscripts, memoirs, and narrative non-fiction',
    icon: BookOpen,
    accent: 'text-blue-600',
    options: [
      { id: 'non-fiction',  label: 'Non-Fiction',        description: 'Expert guides, frameworks, or how-to books', icon: BookOpen },
      { id: 'fiction',      label: 'Fiction',            description: 'Novels and narrative storytelling',          icon: PenLine },
      { id: 'self-help',    label: 'Self-Help',          description: 'Personal growth and transformation',          icon: Heart },
      { id: 'memoir',       label: 'Memoir',             description: 'Your life story or a specific chapter',       icon: User },
      { id: 'biography',    label: 'Biography',          description: "Someone else's life story",                    icon: BookMarked },
      { id: 'children',     label: "Children's Book",    description: 'Illustrated or chapter books for kids',       icon: Baby },
      { id: 'cookbook',     label: 'Cookbook',           description: 'Recipes and culinary storytelling',            icon: Coffee },
      { id: 'travel',       label: 'Travel Guide',       description: 'Destination guides and travel narratives',    icon: Map },
    ],
  },
  {
    id: 'business',
    label: 'Business',
    description: 'Plans, proposals, reports, and business books',
    icon: Briefcase,
    accent: 'text-emerald-600',
    options: [
      { id: 'business_plan',    label: 'Business Plan',    description: 'For investors, lenders, or internal use',        icon: Target },
      { id: 'proposal',         label: 'Proposal',         description: 'Client, grant, or project proposals',            icon: FileCheck2 },
      { id: 'white_paper',      label: 'White Paper',      description: 'Industry research or thought-leadership',        icon: FileSearch },
      { id: 'pitch_deck',       label: 'Pitch Deck',       description: 'Fundraising or sales presentation',              icon: Presentation },
      { id: 'financial_model',  label: 'Financial Model',  description: 'Projections, forecasts, and analysis',           icon: LineChart },
      { id: 'report',           label: 'Report',           description: 'Market analysis, earnings, or strategy reports', icon: FileText },
      { id: 'business',         label: 'Business Book',    description: 'A full-length business or leadership book',       icon: DollarSign },
    ],
  },
  {
    id: 'academic',
    label: 'Academic',
    description: 'Theses, papers, research, and educational material',
    icon: GraduationCap,
    accent: 'text-violet-600',
    options: [
      { id: 'thesis',          label: 'Thesis',            description: "Master's thesis with full methodology",         icon: GraduationCap },
      { id: 'dissertation',    label: 'Dissertation',      description: 'Doctoral dissertation with original research',   icon: BookType },
      { id: 'research_paper',  label: 'Research Paper',    description: 'Peer-reviewed or journal-style paper',           icon: FileSearch },
      { id: 'paper',           label: 'Academic Paper',    description: 'Course paper, essay, or short-form scholarship', icon: Notebook },
      { id: 'educational',     label: 'Educational Material', description: 'Curriculum, lesson plans, or courseware',    icon: BookMarked },
      { id: 'academic',        label: 'Academic Book',     description: 'Full-length scholarly or textbook',               icon: BookOpen },
    ],
  },
  {
    id: 'legal',
    label: 'Legal',
    description: 'Contracts, policies, briefs, and governance documents',
    icon: Scale,
    accent: 'text-amber-600',
    options: [
      { id: 'contract',          label: 'Contract',           description: 'Service agreements, employment, freelance',  icon: FileCheck2 },
      { id: 'nda',               label: 'NDA',                description: 'Non-disclosure / confidentiality agreement', icon: ShieldCheck },
      { id: 'terms_of_service',  label: 'Terms of Service',   description: 'Product or SaaS terms of use',                icon: Gavel },
      { id: 'privacy_policy',    label: 'Privacy Policy',     description: 'Data collection and privacy disclosures',     icon: ShieldCheck },
      { id: 'policy_document',   label: 'Policy Document',    description: 'HR, internal, or corporate policy',           icon: FileText },
      { id: 'legal_brief',       label: 'Legal Brief',        description: 'Memoranda, briefs, or legal analysis',        icon: Scale },
    ],
  },
  {
    id: 'technical',
    label: 'Technical',
    description: 'Documentation, specifications, and technical books',
    icon: Code,
    accent: 'text-sky-600',
    options: [
      { id: 'technical_doc',  label: 'Technical Documentation', description: 'Engineering or systems documentation', icon: FileText },
      { id: 'api_docs',       label: 'API Documentation',       description: 'Reference docs for developers',          icon: Code },
      { id: 'user_manual',    label: 'User Manual',             description: 'Product or software manual',             icon: Notebook },
      { id: 'specification',  label: 'Specification',           description: 'Technical spec or RFC-style document',   icon: Wrench },
      { id: 'technical',      label: 'Technical Book',          description: 'Full-length technical book',             icon: BookOpen },
    ],
  },
  {
    id: 'creative',
    label: 'Creative',
    description: 'Poetry, short fiction, screenplays, and essays',
    icon: Sparkles,
    accent: 'text-rose-600',
    options: [
      { id: 'poetry',            label: 'Poetry Collection', description: 'Curated volume of poems',            icon: Feather },
      { id: 'short_story',       label: 'Short Story',       description: 'Single short story or novelette',    icon: PenLine },
      { id: 'screenplay',        label: 'Screenplay',        description: 'Film or TV screenplay',              icon: Presentation },
      { id: 'essay_collection',  label: 'Essay Collection',  description: 'Collection of personal essays',      icon: BookType },
    ],
  },
  {
    id: 'other',
    label: 'Other',
    description: 'Custom content that doesn\'t fit the categories above',
    icon: MoreHorizontal,
    accent: 'text-slate-600',
    options: [
      { id: 'other', label: 'Custom Document', description: 'Describe what you want to write', icon: FileText },
    ],
  },
];

// =============================================================================
// PAGE
// =============================================================================

/**
 * Maps the CategoryId (UI-layer grouping) to the Guild showcase-grant macro
 * category used by guild_showcase_grants.category. MUST stay in sync with
 * public.guild_content_type_to_category() in the database — but we don't
 * need to replicate the full content_type mapping here because the new-
 * project flow already selects the UI category first (CategoryId), and that
 * CategoryId maps cleanly to a macro.
 *
 * UI 'books'    → macro 'book'
 * UI 'business' → macro 'business'
 * UI 'academic' → macro 'academic'
 * UI 'legal'    → macro 'legal'
 * UI 'technical'→ macro 'technical'
 * UI 'creative' → no grant eligibility (DB function returns NULL for
 *                 most creative types unless they map to 'book')
 * UI 'other'    → no grant eligibility (DB function returns NULL)
 */
const CATEGORY_ID_TO_GRANT_MACRO: Partial<Record<CategoryId, string>> = {
  books: 'book',
  business: 'business',
  academic: 'academic',
  legal: 'legal',
  technical: 'technical',
};

function NewProjectContent() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [selectedCategory, setSelectedCategory] = useState<CategoryId | null>(
    (searchParams.get('cat') as CategoryId) || null
  );
  const [creatingType, setCreatingType] = useState<ContentType | null>(null);

  // Phase 1E Task 1E.3: load Guild showcase-grant availability. We fetch
  // once on mount; grants don't change mid-flow. If the user is not a
  // Guildmember, unused_categories stays empty and no banner is shown.
  const [unusedGrantCategories, setUnusedGrantCategories] = useState<string[]>([]);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/guild/my-grants');
        if (!res.ok) return;
        const json = await res.json();
        if (cancelled) return;
        if (json.is_member && Array.isArray(json.unused_categories)) {
          setUnusedGrantCategories(json.unused_categories);
        }
      } catch {
        // silent — banner is cosmetic, not a gate
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  /**
   * Whether the currently-selected UI category has an unused grant.
   * Renders the banner at the top of the Step 2 (subtype selection) view.
   * On Step 1 (category selection) we don't yet know what the user will
   * pick so we don't show a banner — the Guild dashboard card is the
   * entry point that advertises grant availability.
   */
  const hasGrantForSelected =
    selectedCategory !== null &&
    CATEGORY_ID_TO_GRANT_MACRO[selectedCategory] !== undefined &&
    unusedGrantCategories.includes(CATEGORY_ID_TO_GRANT_MACRO[selectedCategory]!);
  const grantCategoryLabel =
    selectedCategory !== null
      ? CATEGORIES.find((c) => c.id === selectedCategory)?.label ?? selectedCategory
      : '';

  /**
   * On subtype click: create a draft project immediately via /api/projects
   * (server endpoint). Routing through the server is required so the Phase
   * 1E grant-consume hook in the POST handler can attempt to consume a
   * showcase grant for this project. A direct Supabase insert from the
   * client would bypass that hook entirely.
   *
   * Then route straight to the editor (the Validate agent). No title/
   * description form in between.
   */
  const handleSelectType = async (type: ContentType, label: string) => {
    if (creatingType) return;
    setCreatingType(type);
    try {
      const res = await fetch('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: `Untitled ${label}`,        // Validate agent overrides this when idea is chosen
          description: '',
          content_type: type,
          visibility: 'private',
        }),
      });

      if (res.status === 401) {
        toast.error('Please log in to create a project');
        router.push('/auth/login');
        return;
      }

      const json = await res.json();
      if (!res.ok || !json.data) {
        console.error('Project creation error:', json);
        toast.error(json.error || 'Failed to create project');
        setCreatingType(null);
        return;
      }

      // Jump straight into the Validate agent — skip the detail page entirely.
      router.push(`/projects/${json.data.id}/editor`);
    } catch (err) {
      console.error(err);
      toast.error('Failed to create project. Please try again.');
      setCreatingType(null);
    }
  };

  // ============== STEP 1: Category cards ==============
  if (!selectedCategory) {
    return (
      <div className="p-8 max-w-6xl mx-auto">
        <div className="mb-8">
          <button
            onClick={() => router.push('/projects')}
            className="flex items-center text-sm text-muted-foreground hover:text-foreground mb-4"
          >
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to Projects
          </button>
          <h1 className="text-3xl font-bold tracking-tight">Create New Project</h1>
          <p className="text-muted-foreground mt-1">What kind of document are you writing?</p>
        </div>

        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {CATEGORIES.map((cat) => {
            const Icon = cat.icon;
            return (
              <button
                key={cat.id}
                onClick={() => setSelectedCategory(cat.id)}
                className="group text-left rounded-xl border bg-card p-6 hover:border-primary hover:shadow-md transition-all"
              >
                <div className="flex items-start gap-4">
                  <div className={`h-12 w-12 rounded-lg bg-muted flex items-center justify-center shrink-0 group-hover:bg-primary/10 transition-colors`}>
                    <Icon className={`h-6 w-6 ${cat.accent}`} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <h3 className="font-semibold text-lg mb-1">{cat.label}</h3>
                    <p className="text-sm text-muted-foreground mb-3">{cat.description}</p>
                    <p className="text-xs text-muted-foreground/80">
                      {cat.options.length} type{cat.options.length === 1 ? '' : 's'} inside →
                    </p>
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  // ============== STEP 2: Content subtype cards ==============
  const category = CATEGORIES.find((c) => c.id === selectedCategory)!;
  const CategoryIcon = category.icon;

  return (
    <div className="p-8 max-w-6xl mx-auto">
      <div className="mb-8">
        <button
          onClick={() => setSelectedCategory(null)}
          className="flex items-center text-sm text-muted-foreground hover:text-foreground mb-4"
        >
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back to categories
        </button>
        <div className="flex items-center gap-3">
          <div className="h-12 w-12 rounded-lg bg-muted flex items-center justify-center">
            <CategoryIcon className={`h-6 w-6 ${category.accent}`} />
          </div>
          <div>
            <h1 className="text-3xl font-bold tracking-tight">{category.label}</h1>
            <p className="text-muted-foreground">{category.description}</p>
          </div>
        </div>
      </div>

      {/* Phase 1E Task 1E.3: grant-available banner. Shown only when the
          current user is a Guildmember with an unused grant for this
          macro category. The grant is actually consumed server-side in
          /api/projects POST — the banner is purely informational here. */}
      {hasGrantForSelected && (
        <div className="mb-6 rounded-lg border border-[#d4af37]/40 bg-[#d4af37]/10 p-4">
          <div className="flex items-start gap-3">
            <Sparkles className="h-5 w-5 shrink-0 text-[#d4af37]" />
            <div className="min-w-0">
              <div className="font-medium text-[#d4af37]">
                Your Special Pro grant for {grantCategoryLabel} is available
              </div>
              <p className="mt-1 text-sm text-muted-foreground">
                This document will be created at no cost to your credit balance.
              </p>
            </div>
          </div>
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {category.options.map((opt) => {
          const Icon = opt.icon;
          const isCreatingThis = creatingType === opt.id;
          return (
            <button
              key={opt.id}
              onClick={() => handleSelectType(opt.id, opt.label)}
              disabled={!!creatingType}
              className="group text-left rounded-xl border bg-card p-5 hover:border-primary hover:shadow-sm transition-all disabled:opacity-50 disabled:cursor-wait"
            >
              <div className="flex items-start gap-3">
                <div className={`h-10 w-10 rounded-lg bg-muted flex items-center justify-center shrink-0 group-hover:bg-primary/10 transition-colors`}>
                  {isCreatingThis ? (
                    <Loader2 className="h-5 w-5 text-primary animate-spin" />
                  ) : (
                    <Icon className={`h-5 w-5 ${category.accent}`} />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <h3 className="font-semibold mb-1">{opt.label}</h3>
                  <p className="text-xs text-muted-foreground">{opt.description}</p>
                </div>
              </div>
            </button>
          );
        })}
      </div>

      <p className="mt-6 text-center text-xs text-muted-foreground">
        Don&apos;t worry about the title yet — you&apos;ll refine your idea with the Validate agent on the next screen.
      </p>
    </div>
  );
}

export default function NewProjectPage() {
  return (
    <Suspense
      fallback={
        <div className="p-8 max-w-4xl mx-auto flex items-center justify-center min-h-[400px]">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      }
    >
      <NewProjectContent />
    </Suspense>
  );
}
