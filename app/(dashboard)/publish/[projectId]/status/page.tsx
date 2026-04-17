import { redirect, notFound } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { StatusClient } from '@/components/publish/StatusClient';
import { ArrowLeft } from 'lucide-react';

/**
 * /publish/[projectId]/status — mission control for a single project.
 *
 * One screen, all 17 platforms, live status per platform. This is the
 * investor-deck screenshot: "publish to 17 places and see every step".
 */
export default async function PublishStatusPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { data: project } = await supabase
    .from('projects')
    .select('id, title, status, content_type, user_id')
    .eq('id', projectId)
    .eq('user_id', user.id)
    .is('deleted_at', null)
    .single();

  if (!project) notFound();

  const { data: session } = await supabase
    .from('interview_sessions')
    .select('front_cover_url')
    .eq('project_id', projectId)
    .eq('user_id', user.id)
    .maybeSingle();

  return (
    <div className="max-w-6xl mx-auto px-6 py-8 space-y-6">
      <Link
        href="/publish"
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to Publish
      </Link>

      <div className="flex items-start gap-4">
        {session?.front_cover_url ? (
          <img
            src={session.front_cover_url}
            alt=""
            className="h-24 w-16 rounded object-cover shadow-sm shrink-0"
          />
        ) : null}
        <div className="min-w-0">
          <div className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">
            Publication status
          </div>
          <h1 className="text-3xl font-bold tracking-tight mt-1 truncate">
            {project.title || 'Untitled'}
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Every platform. Every status. Live.
          </p>
        </div>
      </div>

      <StatusClient projectId={projectId} />
    </div>
  );
}
