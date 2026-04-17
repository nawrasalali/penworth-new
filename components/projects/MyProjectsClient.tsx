'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { FileText, BookOpen } from 'lucide-react';
import { CATEGORIES, type CategoryId } from '@/lib/categories';
import type { ProjectRow } from '@/app/(dashboard)/projects/page';

type StatusFilter = 'all' | 'draft' | 'writing' | 'complete' | 'published';

const STATUS_FILTERS: { id: StatusFilter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'draft', label: 'Draft' },
  { id: 'writing', label: 'Writing' },
  { id: 'complete', label: 'Complete' },
  { id: 'published', label: 'Published' },
];

const STATUS_STYLES: Record<string, string> = {
  draft: 'bg-muted text-muted-foreground',
  writing: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
  complete: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
  published: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
};

export function MyProjectsClient({ projects }: { projects: ProjectRow[] }) {
  const [activeCategory, setActiveCategory] = useState<'all' | CategoryId>('all');
  const [activeStatus, setActiveStatus] = useState<StatusFilter>('all');

  // Count per category (based on current status filter)
  const categoryCounts = useMemo(() => {
    const statusFiltered = activeStatus === 'all'
      ? projects
      : projects.filter((p) => p.ui_status === activeStatus);
    const counts: Record<string, number> = { all: statusFiltered.length };
    for (const cat of CATEGORIES) {
      counts[cat.id] = statusFiltered.filter((p) => p.category_id === cat.id).length;
    }
    return counts;
  }, [projects, activeStatus]);

  // Count per status (based on current category filter)
  const statusCounts = useMemo(() => {
    const catFiltered = activeCategory === 'all'
      ? projects
      : projects.filter((p) => p.category_id === activeCategory);
    return {
      all: catFiltered.length,
      draft: catFiltered.filter((p) => p.ui_status === 'draft').length,
      writing: catFiltered.filter((p) => p.ui_status === 'writing').length,
      complete: catFiltered.filter((p) => p.ui_status === 'complete').length,
      published: catFiltered.filter((p) => p.ui_status === 'published').length,
    };
  }, [projects, activeCategory]);

  // Final filtered set
  const filtered = useMemo(() => {
    return projects.filter((p) => {
      if (activeCategory !== 'all' && p.category_id !== activeCategory) return false;
      if (activeStatus !== 'all' && p.ui_status !== activeStatus) return false;
      return true;
    });
  }, [projects, activeCategory, activeStatus]);

  return (
    <>
      {/* Category pills */}
      <div className="flex flex-wrap gap-2 mb-3">
        <button
          onClick={() => setActiveCategory('all')}
          className={`px-3 py-1.5 rounded-full text-sm font-medium border transition-colors ${
            activeCategory === 'all'
              ? 'bg-foreground text-background border-foreground'
              : 'bg-background hover:bg-muted border-border'
          }`}
        >
          All <span className="opacity-70 ml-1">{categoryCounts.all}</span>
        </button>
        {CATEGORIES.map((cat) => {
          const count = categoryCounts[cat.id] || 0;
          const isActive = activeCategory === cat.id;
          const isEmpty = count === 0;
          return (
            <button
              key={cat.id}
              onClick={() => setActiveCategory(cat.id)}
              disabled={isEmpty && !isActive}
              className={`px-3 py-1.5 rounded-full text-sm font-medium border transition-colors flex items-center gap-1.5 ${
                isActive
                  ? 'bg-foreground text-background border-foreground'
                  : isEmpty
                  ? 'bg-background border-border text-muted-foreground/50 cursor-not-allowed'
                  : 'bg-background hover:bg-muted border-border'
              }`}
            >
              <cat.icon className={`h-3.5 w-3.5 ${isActive ? '' : cat.accent}`} />
              {cat.label}
              <span className="opacity-70">{count}</span>
            </button>
          );
        })}
      </div>

      {/* Status row */}
      <div className="flex flex-wrap items-center gap-2 mb-6 pb-4 border-b">
        <span className="text-xs uppercase tracking-wider text-muted-foreground font-semibold mr-1">
          Status
        </span>
        {STATUS_FILTERS.map((s) => {
          const count = statusCounts[s.id as keyof typeof statusCounts];
          const isActive = activeStatus === s.id;
          return (
            <button
              key={s.id}
              onClick={() => setActiveStatus(s.id)}
              className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${
                isActive
                  ? 'bg-primary/10 text-primary'
                  : 'text-muted-foreground hover:bg-muted'
              }`}
            >
              {s.label}
              <span className="opacity-60 ml-1">{count}</span>
            </button>
          );
        })}
      </div>

      {/* Results */}
      {filtered.length === 0 ? (
        <div className="rounded-xl border bg-card py-12 text-center">
          <FileText className="h-10 w-10 text-muted-foreground/40 mx-auto mb-3" />
          <p className="text-muted-foreground">
            No projects match the current filter.
          </p>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((p) => (
            <ProjectCard key={p.id} project={p} />
          ))}
        </div>
      )}
    </>
  );
}

function ProjectCard({ project }: { project: ProjectRow }) {
  const updated = new Date(project.updated_at);
  const timeAgo = formatRelative(updated);

  return (
    <Link
      href={`/projects/${project.id}/editor`}
      className="group rounded-xl border bg-card hover:border-primary/40 hover:shadow-sm transition-all overflow-hidden flex flex-col"
    >
      {/* Cover thumbnail or gradient header */}
      <div className="aspect-[5/3] relative bg-gradient-to-br from-primary/10 to-primary/5">
        {project.cover_url ? (
          <img
            src={project.cover_url}
            alt={project.title}
            className="w-full h-full object-cover"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <BookOpen className="h-10 w-10 text-primary/30" />
          </div>
        )}
        <span
          className={`absolute top-2 right-2 text-[10px] uppercase tracking-wider font-semibold px-2 py-0.5 rounded ${
            STATUS_STYLES[project.ui_status] || STATUS_STYLES.draft
          }`}
        >
          {project.ui_status}
        </span>
      </div>

      {/* Body */}
      <div className="p-4 flex-1 flex flex-col">
        <h3 className="font-semibold line-clamp-1 group-hover:text-primary transition-colors">
          {project.title || 'Untitled'}
        </h3>
        <p className="text-xs text-muted-foreground mt-0.5">
          {project.content_type_label}
        </p>

        {project.description && (
          <p className="text-sm text-muted-foreground mt-2 line-clamp-2 flex-1">
            {project.description}
          </p>
        )}

        <div className="flex items-center justify-between text-xs text-muted-foreground mt-3 pt-3 border-t">
          <span>
            {project.chapter_count > 0
              ? `${project.chapter_count} ch · ${project.word_count.toLocaleString()} words`
              : 'Not started'}
          </span>
          <span>{timeAgo}</span>
        </div>
      </div>
    </Link>
  );
}

function formatRelative(date: Date): string {
  const now = Date.now();
  const diffSec = Math.floor((now - date.getTime()) / 1000);
  if (diffSec < 60) return 'just now';
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay < 7) return `${diffDay}d ago`;
  const diffWk = Math.floor(diffDay / 7);
  if (diffWk < 5) return `${diffWk}w ago`;
  const diffMo = Math.floor(diffDay / 30);
  if (diffMo < 12) return `${diffMo}mo ago`;
  return date.toLocaleDateString();
}
