import { createClient } from '@/lib/supabase/server';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  Plus,
  FileText,
  Search,
  Filter,
  MoreVertical,
  Trash2,
  Edit,
  Eye,
} from 'lucide-react';
import { formatRelativeTime, CONTENT_TYPE_LABELS, STATUS_COLORS } from '@/lib/utils';

export default async function ProjectsPage({
  searchParams,
}: {
  searchParams: { status?: string; type?: string; q?: string };
}) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  // Build query
  let query = supabase
    .from('projects')
    .select('*, organizations(name, industry)')
    .or(`user_id.eq.${user?.id},org_id.in.(select org_id from org_members where user_id = '${user?.id}')`)
    .order('updated_at', { ascending: false });

  // Apply filters
  if (searchParams.status) {
    query = query.eq('status', searchParams.status);
  }
  if (searchParams.type) {
    query = query.eq('content_type', searchParams.type);
  }
  if (searchParams.q) {
    query = query.ilike('title', `%${searchParams.q}%`);
  }

  const { data: projects } = await query;

  const statusOptions = ['draft', 'in_progress', 'review', 'approved', 'published'];
  const typeOptions = Object.keys(CONTENT_TYPE_LABELS);

  return (
    <div className="p-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Projects</h1>
          <p className="text-muted-foreground mt-1">
            Manage all your knowledge projects
          </p>
        </div>
        <Link href="/projects/new">
          <Button>
            <Plus className="mr-2 h-4 w-4" />
            New Project
          </Button>
        </Link>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-4 mb-6">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <form>
            <Input
              name="q"
              placeholder="Search projects..."
              defaultValue={searchParams.q}
              className="pl-9"
            />
          </form>
        </div>
        <div className="flex items-center gap-2">
          <select
            name="status"
            defaultValue={searchParams.status || ''}
            className="h-10 rounded-md border border-input bg-background px-3 py-2 text-sm"
            onChange={(e) => {
              const url = new URL(window.location.href);
              if (e.target.value) {
                url.searchParams.set('status', e.target.value);
              } else {
                url.searchParams.delete('status');
              }
              window.location.href = url.toString();
            }}
          >
            <option value="">All Statuses</option>
            {statusOptions.map((status) => (
              <option key={status} value={status}>
                {status.replace('_', ' ')}
              </option>
            ))}
          </select>
          <select
            name="type"
            defaultValue={searchParams.type || ''}
            className="h-10 rounded-md border border-input bg-background px-3 py-2 text-sm"
            onChange={(e) => {
              const url = new URL(window.location.href);
              if (e.target.value) {
                url.searchParams.set('type', e.target.value);
              } else {
                url.searchParams.delete('type');
              }
              window.location.href = url.toString();
            }}
          >
            <option value="">All Types</option>
            {typeOptions.map((type) => (
              <option key={type} value={type}>
                {CONTENT_TYPE_LABELS[type]}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Projects Grid */}
      {projects && projects.length > 0 ? (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {projects.map((project) => (
            <Link key={project.id} href={`/projects/${project.id}`}>
              <Card className="h-full hover:border-primary/50 transition-colors cursor-pointer">
                <CardContent className="p-6">
                  <div className="flex items-start justify-between mb-4">
                    <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center">
                      <FileText className="h-5 w-5 text-primary" />
                    </div>
                    <span className={`text-xs px-2 py-1 rounded-full ${STATUS_COLORS[project.status]?.bg || 'bg-neutral-100'} ${STATUS_COLORS[project.status]?.text || 'text-neutral-600'}`}>
                      {project.status.replace('_', ' ')}
                    </span>
                  </div>
                  <h3 className="font-semibold mb-1 line-clamp-1">{project.title}</h3>
                  <p className="text-sm text-muted-foreground mb-4 line-clamp-2">
                    {project.description || 'No description'}
                  </p>
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span>{CONTENT_TYPE_LABELS[project.content_type]}</span>
                    <span>{formatRelativeTime(project.updated_at)}</span>
                  </div>
                  {project.organizations && (
                    <div className="mt-3 pt-3 border-t">
                      <span className="text-xs text-muted-foreground">
                        {project.organizations.name}
                      </span>
                    </div>
                  )}
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      ) : (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16">
            <FileText className="h-16 w-16 text-muted-foreground/50 mb-4" />
            <h3 className="font-semibold text-lg mb-2">No projects yet</h3>
            <p className="text-muted-foreground text-center mb-6 max-w-sm">
              Create your first project to start generating verified, publication-ready content.
            </p>
            <Link href="/projects/new">
              <Button>
                <Plus className="mr-2 h-4 w-4" />
                Create Your First Project
              </Button>
            </Link>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
