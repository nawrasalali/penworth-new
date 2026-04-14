import { createClient } from '@/lib/supabase/server';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  ArrowLeft,
  Edit,
  Play,
  Settings,
  FileText,
  Plus,
  MoreVertical,
  Trash2,
  GripVertical,
} from 'lucide-react';
import { formatDate, formatWordCount, CONTENT_TYPE_LABELS, STATUS_COLORS } from '@/lib/utils';

export default async function ProjectDetailPage({
  params,
}: {
  params: { id: string };
}) {
  const supabase = createClient();

  const { data: project, error } = await supabase
    .from('projects')
    .select('*, chapters(*), organizations(name, industry)')
    .eq('id', params.id)
    .single();

  if (error || !project) {
    notFound();
  }

  // Sort chapters by order_index
  const chapters = (project.chapters || []).sort(
    (a: any, b: any) => a.order_index - b.order_index
  );

  // Calculate total word count
  const totalWords = chapters.reduce((acc: number, ch: any) => acc + (ch.word_count || 0), 0);

  return (
    <div className="p-8">
      {/* Header */}
      <div className="mb-8">
        <Link
          href="/projects"
          className="flex items-center text-sm text-muted-foreground hover:text-foreground mb-4"
        >
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back to Projects
        </Link>

        <div className="flex items-start justify-between">
          <div>
            <div className="flex items-center gap-3 mb-2">
              <h1 className="text-3xl font-bold tracking-tight">{project.title}</h1>
              <span className={`text-xs px-2 py-1 rounded-full ${STATUS_COLORS[project.status]}`}>
                {project.status.replace('_', ' ')}
              </span>
            </div>
            {project.description && (
              <p className="text-muted-foreground max-w-2xl">{project.description}</p>
            )}
            <div className="flex items-center gap-4 mt-3 text-sm text-muted-foreground">
              <span>{CONTENT_TYPE_LABELS[project.content_type]}</span>
              <span>•</span>
              <span>{formatWordCount(totalWords)}</span>
              <span>•</span>
              <span>Last updated {formatDate(project.updated_at)}</span>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Link href={`/projects/${project.id}/editor`}>
              <Button>
                <Edit className="mr-2 h-4 w-4" />
                Open Editor
              </Button>
            </Link>
            <Button variant="outline" size="icon">
              <Settings className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>

      <div className="grid gap-8 lg:grid-cols-3">
        {/* Chapters List */}
        <div className="lg:col-span-2">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle>Chapters</CardTitle>
                <Link href={`/projects/${project.id}/editor?new=true`}>
                  <Button size="sm">
                    <Plus className="mr-2 h-4 w-4" />
                    Add Chapter
                  </Button>
                </Link>
              </div>
            </CardHeader>
            <CardContent>
              {chapters.length > 0 ? (
                <div className="space-y-2">
                  {chapters.map((chapter: any, index: number) => (
                    <Link
                      key={chapter.id}
                      href={`/projects/${project.id}/editor?chapter=${chapter.id}`}
                      className="flex items-center gap-3 p-3 rounded-lg border hover:bg-muted/50 transition-colors"
                    >
                      <GripVertical className="h-4 w-4 text-muted-foreground cursor-grab" />
                      <div className="h-8 w-8 rounded bg-muted flex items-center justify-center text-sm font-medium">
                        {index + 1}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-medium truncate">{chapter.title}</p>
                        <p className="text-xs text-muted-foreground">
                          {formatWordCount(chapter.word_count || 0)}
                        </p>
                      </div>
                      <span className={`text-xs px-2 py-1 rounded-full ${STATUS_COLORS[chapter.status] || STATUS_COLORS.draft}`}>
                        {chapter.status}
                      </span>
                    </Link>
                  ))}
                </div>
              ) : (
                <div className="text-center py-8">
                  <FileText className="mx-auto h-12 w-12 text-muted-foreground/50 mb-4" />
                  <p className="text-sm text-muted-foreground mb-4">
                    No chapters yet. Start writing by adding your first chapter.
                  </p>
                  <Link href={`/projects/${project.id}/editor?new=true`}>
                    <Button size="sm">
                      <Plus className="mr-2 h-4 w-4" />
                      Add First Chapter
                    </Button>
                  </Link>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Sidebar */}
        <div className="space-y-6">
          {/* AI Assistant Quick Access */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">AI Assistant</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <Link href={`/projects/${project.id}/editor?agent=interview`}>
                <Button variant="outline" className="w-full justify-start">
                  <Play className="mr-2 h-4 w-4" />
                  Start Interview
                </Button>
              </Link>
              <Link href={`/projects/${project.id}/editor?agent=outline`}>
                <Button variant="outline" className="w-full justify-start">
                  <FileText className="mr-2 h-4 w-4" />
                  Generate Outline
                </Button>
              </Link>
              <Link href={`/projects/${project.id}/editor?agent=research`}>
                <Button variant="outline" className="w-full justify-start">
                  <FileText className="mr-2 h-4 w-4" />
                  Research Mode
                </Button>
              </Link>
            </CardContent>
          </Card>

          {/* Project Stats */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Statistics</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Total Words</span>
                  <span className="font-medium">{totalWords.toLocaleString()}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Chapters</span>
                  <span className="font-medium">{chapters.length}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Created</span>
                  <span className="font-medium">{formatDate(project.created_at)}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Last Modified</span>
                  <span className="font-medium">{formatDate(project.updated_at)}</span>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Organization Info */}
          {project.organizations && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Organization</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="font-medium">{project.organizations.name}</p>
                <p className="text-sm text-muted-foreground capitalize">
                  {project.organizations.industry} Industry
                </p>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
