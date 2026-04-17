import { createClient } from '@/lib/supabase/server';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Plus, FileText } from 'lucide-react';
import { CONTENT_TYPE_LABELS } from '@/lib/utils';
import { CATEGORIES, getCategoryForContentType, type CategoryId } from '@/lib/categories';
import { MyProjectsClient } from '@/components/projects/MyProjectsClient';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

type UIStatus = 'draft' | 'writing' | 'complete' | 'published';

/**
 * Map the 5 DB statuses onto the 4 simpler UI buckets the user sees.
 *   DB:    draft | in_progress | review | approved | published
 *   UI:    draft | writing     | complete         | published
 */
function toUIStatus(dbStatus: string): UIStatus {
  switch (dbStatus) {
    case 'draft': return 'draft';
    case 'in_progress': return 'writing';
    case 'review':
    case 'approved': return 'complete';
    case 'published': return 'published';
    default: return 'draft';
  }
}

export interface ProjectRow {
  id: string;
  title: string;
  description: string | null;
  content_type: string;
  status: string;
  ui_status: UIStatus;
  category_id: CategoryId;
  category_label: string;
  content_type_label: string;
  cover_url: string | null;
  word_count: number;
  chapter_count: number;
  updated_at: string;
  created_at: string;
}

export default async function ProjectsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return (
      <div className="p-8">
        <p className="text-muted-foreground">Please log in to view your projects.</p>
      </div>
    );
  }

  const { data: rawProjects, error } = await supabase
    .from('projects')
    .select(`
      id, title, description, content_type, status, updated_at, created_at,
      chapters(word_count, status),
      interview_sessions(front_cover_url)
    `)
    .eq('user_id', user.id)
    .order('updated_at', { ascending: false });

  if (error) {
    console.error('Projects query error:', error);
    return (
      <div className="p-8">
        <p className="text-red-600">Failed to load projects. Please try again.</p>
      </div>
    );
  }

  const projects: ProjectRow[] = (rawProjects || []).map((p: any) => {
    const completedChapters = (p.chapters || []).filter((c: any) => c.status === 'complete');
    const wordCount = completedChapters.reduce((s: number, c: any) => s + (c.word_count || 0), 0);
    const categoryId = getCategoryForContentType(p.content_type);
    const categoryLabel = CATEGORIES.find((c) => c.id === categoryId)?.label || 'Other';
    return {
      id: p.id,
      title: p.title,
      description: p.description,
      content_type: p.content_type,
      status: p.status,
      ui_status: toUIStatus(p.status),
      category_id: categoryId,
      category_label: categoryLabel,
      content_type_label: CONTENT_TYPE_LABELS[p.content_type] || p.content_type,
      cover_url: p.interview_sessions?.[0]?.front_cover_url || null,
      word_count: wordCount,
      chapter_count: completedChapters.length,
      updated_at: p.updated_at,
      created_at: p.created_at,
    };
  });

  return (
    <div className="p-6 md:p-8 max-w-7xl mx-auto">
      <div className="flex items-start justify-between mb-6 gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">My Projects</h1>
          <p className="text-muted-foreground mt-1">
            Everything you've created, grouped by category.
          </p>
        </div>
        <Link href="/projects/new">
          <Button>
            <Plus className="mr-2 h-4 w-4" />
            New Project
          </Button>
        </Link>
      </div>

      {projects.length === 0 ? (
        <div className="rounded-xl border bg-card py-16 flex flex-col items-center justify-center">
          <FileText className="h-16 w-16 text-muted-foreground/40 mb-4" />
          <h3 className="font-semibold text-lg mb-2">No projects yet</h3>
          <p className="text-muted-foreground text-center mb-6 max-w-sm px-4">
            Create your first project to start generating verified, publication-ready content.
          </p>
          <Link href="/projects/new">
            <Button>
              <Plus className="mr-2 h-4 w-4" />
              Create Your First Project
            </Button>
          </Link>
        </div>
      ) : (
        <MyProjectsClient projects={projects} />
      )}
    </div>
  );
}
