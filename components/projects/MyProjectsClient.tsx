'use client';

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  FileText,
  BookOpen,
  Trash2,
  RotateCcw,
  AlertTriangle,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import { CATEGORIES, type CategoryId } from '@/lib/categories';
import type { ProjectRow } from '@/app/(dashboard)/projects/page';

type StatusFilter = 'all' | 'draft' | 'writing' | 'complete' | 'published';
type View = 'active' | 'bin';

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

export function MyProjectsClient({
  projects,
  trashed,
}: {
  projects: ProjectRow[];
  trashed: ProjectRow[];
}) {
  const router = useRouter();
  const [view, setView] = useState<View>('active');
  const [activeCategory, setActiveCategory] = useState<'all' | CategoryId>('all');
  const [activeStatus, setActiveStatus] = useState<StatusFilter>('all');
  const [isPending, startTransition] = useTransition();
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [confirmTitle, setConfirmTitle] = useState<string>('');

  const source = view === 'active' ? projects : trashed;

  const categoryCounts = useMemo(() => {
    const statusFiltered = activeStatus === 'all'
      ? source
      : source.filter((p) => p.ui_status === activeStatus);
    const counts: Record<string, number> = { all: statusFiltered.length };
    for (const cat of CATEGORIES) {
      counts[cat.id] = statusFiltered.filter((p) => p.category_id === cat.id).length;
    }
    return counts;
  }, [source, activeStatus]);

  const statusCounts = useMemo(() => {
    const catFiltered = activeCategory === 'all'
      ? source
      : source.filter((p) => p.category_id === activeCategory);
    return {
      all: catFiltered.length,
      draft: catFiltered.filter((p) => p.ui_status === 'draft').length,
      writing: catFiltered.filter((p) => p.ui_status === 'writing').length,
      complete: catFiltered.filter((p) => p.ui_status === 'complete').length,
      published: catFiltered.filter((p) => p.ui_status === 'published').length,
    };
  }, [source, activeCategory]);

  const filtered = useMemo(() => {
    return source.filter((p) => {
      if (activeCategory !== 'all' && p.category_id !== activeCategory) return false;
      if (activeStatus !== 'all' && p.ui_status !== activeStatus) return false;
      return true;
    });
  }, [source, activeCategory, activeStatus]);

  const callAction = async (
    projectId: string,
    action: 'soft_delete' | 'restore' | 'permanent_delete',
    messages: { ok: string; fail: string },
  ) => {
    const resp = await fetch(`/api/projects/${projectId}/trash`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action }),
    });
    const data = await resp.json();
    if (!resp.ok || data.error) {
      toast.error(data.error || messages.fail);
      return false;
    }
    toast.success(messages.ok);
    startTransition(() => router.refresh());
    return true;
  };

  const handleSoftDelete = (p: ProjectRow) => {
    callAction(p.id, 'soft_delete', {
      ok: `Moved "${p.title || 'Untitled'}" to the recycle bin`,
      fail: 'Failed to move to recycle bin',
    });
  };

  const handleRestore = (p: ProjectRow) => {
    callAction(p.id, 'restore', {
      ok: `Restored "${p.title || 'Untitled'}"`,
      fail: 'Failed to restore project',
    });
  };

  const askPermanentDelete = (p: ProjectRow) => {
    setConfirmId(p.id);
    setConfirmTitle(p.title || 'Untitled');
  };

  const confirmPermanentDelete = async () => {
    if (!confirmId) return;
    const ok = await callAction(confirmId, 'permanent_delete', {
      ok: 'Permanently deleted',
      fail: 'Failed to permanently delete',
    });
    if (ok) {
      setConfirmId(null);
      setConfirmTitle('');
    }
  };

  return (
    <>
      {/* View tabs */}
      <div className="flex items-center gap-2 mb-4">
        <button
          onClick={() => {
            setView('active');
            setActiveCategory('all');
            setActiveStatus('all');
          }}
          className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
            view === 'active'
              ? 'bg-primary/10 text-primary'
              : 'text-muted-foreground hover:bg-muted'
          }`}
        >
          Active <span className="opacity-70 ml-1">{projects.length}</span>
        </button>
        <button
          onClick={() => {
            setView('bin');
            setActiveCategory('all');
            setActiveStatus('all');
          }}
          className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors flex items-center gap-2 ${
            view === 'bin'
              ? 'bg-red-500/10 text-red-600 dark:text-red-400'
              : 'text-muted-foreground hover:bg-muted'
          }`}
        >
          <Trash2 className="h-3.5 w-3.5" />
          Recycle Bin
          <span className="opacity-70">{trashed.length}</span>
        </button>
      </div>

      {source.length > 0 && (
        <>
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
        </>
      )}

      {filtered.length === 0 ? (
        <div className="rounded-xl border bg-card py-12 text-center">
          {view === 'bin' ? (
            <>
              <Trash2 className="h-10 w-10 text-muted-foreground/40 mx-auto mb-3" />
              <p className="text-muted-foreground">The recycle bin is empty.</p>
            </>
          ) : (
            <>
              <FileText className="h-10 w-10 text-muted-foreground/40 mx-auto mb-3" />
              <p className="text-muted-foreground">No projects match the current filter.</p>
            </>
          )}
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((p) => (
            <ProjectCard
              key={p.id}
              project={p}
              view={view}
              disabled={isPending}
              onSoftDelete={handleSoftDelete}
              onRestore={handleRestore}
              onPermanentDelete={askPermanentDelete}
            />
          ))}
        </div>
      )}

      {confirmId && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={() => setConfirmId(null)}
        >
          <div
            className="bg-card rounded-xl border shadow-2xl max-w-md w-full p-6 relative"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              onClick={() => setConfirmId(null)}
              className="absolute top-3 right-3 text-muted-foreground hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>
            <div className="flex items-start gap-3 mb-4">
              <div className="h-10 w-10 rounded-lg bg-red-100 dark:bg-red-900/20 flex items-center justify-center shrink-0">
                <AlertTriangle className="h-5 w-5 text-red-600 dark:text-red-400" />
              </div>
              <div className="min-w-0">
                <h3 className="font-semibold">Permanently delete this project?</h3>
                <p className="text-sm text-muted-foreground mt-1">
                  <strong className="text-foreground">"{confirmTitle}"</strong> and
                  all its chapters, covers, research, and publishing history will
                  be deleted forever.{' '}
                  <strong className="text-foreground">This cannot be undone.</strong>
                </p>
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setConfirmId(null)}
                className="px-4 py-2 rounded-lg text-sm font-medium border hover:bg-muted transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={confirmPermanentDelete}
                disabled={isPending}
                className="px-4 py-2 rounded-lg text-sm font-medium bg-red-600 text-white hover:bg-red-700 disabled:opacity-50 transition-colors"
              >
                {isPending ? 'Deleting…' : 'Delete forever'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function ProjectCard({
  project,
  view,
  disabled,
  onSoftDelete,
  onRestore,
  onPermanentDelete,
}: {
  project: ProjectRow;
  view: View;
  disabled: boolean;
  onSoftDelete: (p: ProjectRow) => void;
  onRestore: (p: ProjectRow) => void;
  onPermanentDelete: (p: ProjectRow) => void;
}) {
  const timeAgo = formatRelative(new Date(project.updated_at));
  const deletedAgo = project.deleted_at ? formatRelative(new Date(project.deleted_at)) : null;
  const isTrashed = view === 'bin';

  return (
    <div className="group rounded-xl border bg-card hover:border-primary/40 hover:shadow-sm transition-all overflow-hidden flex flex-col relative">
      <Link
        href={isTrashed ? '#' : `/projects/${project.id}/editor`}
        onClick={(e) => { if (isTrashed) e.preventDefault(); }}
        className="flex-1 flex flex-col"
      >
        <div className="aspect-[5/3] relative bg-gradient-to-br from-primary/10 to-primary/5 overflow-hidden">
          {project.cover_url ? (
            <img
              src={project.cover_url}
              alt={project.title || 'Cover'}
              className="w-full h-full object-cover"
              loading="lazy"
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
            <span>
              {isTrashed && deletedAgo ? `Deleted ${deletedAgo}` : timeAgo}
            </span>
          </div>
        </div>
      </Link>

      <div
        className={`absolute top-2 left-2 flex gap-1 transition-opacity ${
          isTrashed ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
        }`}
      >
        {isTrashed ? (
          <>
            <IconButton
              title="Restore"
              onClick={() => onRestore(project)}
              disabled={disabled}
              className="bg-white/90 dark:bg-neutral-800/90 hover:bg-emerald-50 hover:text-emerald-600 dark:hover:bg-emerald-900/30"
            >
              <RotateCcw className="h-3.5 w-3.5" />
            </IconButton>
            <IconButton
              title="Delete forever"
              onClick={() => onPermanentDelete(project)}
              disabled={disabled}
              className="bg-white/90 dark:bg-neutral-800/90 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-900/30"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </IconButton>
          </>
        ) : (
          <IconButton
            title="Move to recycle bin"
            onClick={() => onSoftDelete(project)}
            disabled={disabled}
            className="bg-white/90 dark:bg-neutral-800/90 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-900/30"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </IconButton>
        )}
      </div>
    </div>
  );
}

function IconButton({
  children,
  onClick,
  disabled,
  title,
  className,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  title: string;
  className?: string;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-label={title}
      className={`h-7 w-7 rounded-md border shadow-sm flex items-center justify-center transition-colors disabled:opacity-50 ${className || ''}`}
    >
      {children}
    </button>
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
