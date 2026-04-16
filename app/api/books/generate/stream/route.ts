import { NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// SSE endpoint for real-time book generation progress
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const projectId = searchParams.get('projectId');

  if (!projectId) {
    return new Response('projectId required', { status: 400 });
  }

  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();

  if (authError || !user) {
    return new Response('Unauthorized', { status: 401 });
  }

  // Verify project ownership
  const { data: project, error: projectError } = await supabase
    .from('projects')
    .select('id, user_id, status, metadata')
    .eq('id', projectId)
    .eq('user_id', user.id)
    .single();

  if (projectError || !project) {
    return new Response('Project not found', { status: 404 });
  }

  // Create readable stream for SSE
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      // Send initial connection message
      controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'connected', projectId })}\n\n`));

      // Subscribe to project updates
      const projectChannel = supabase
        .channel(`project-${projectId}`)
        .on(
          'postgres_changes',
          {
            event: 'UPDATE',
            schema: 'public',
            table: 'projects',
            filter: `id=eq.${projectId}`,
          },
          (payload) => {
            const data = {
              type: 'project_update',
              status: payload.new.status,
              metadata: payload.new.metadata,
            };
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));

            // Close stream when project is complete or errored
            if (payload.new.status === 'completed' || payload.new.status === 'error') {
              controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'complete', status: payload.new.status })}\n\n`));
              controller.close();
              projectChannel.unsubscribe();
              chapterChannel.unsubscribe();
            }
          }
        )
        .subscribe();

      // Subscribe to chapter updates
      const chapterChannel = supabase
        .channel(`chapters-${projectId}`)
        .on(
          'postgres_changes',
          {
            event: '*', // INSERT and UPDATE
            schema: 'public',
            table: 'chapters',
            filter: `project_id=eq.${projectId}`,
          },
          (payload) => {
            const newRecord = payload.new as Record<string, unknown>;
            const data = {
              type: payload.eventType === 'INSERT' ? 'chapter_started' : 'chapter_update',
              chapter: {
                id: newRecord.id,
                title: newRecord.title,
                order_index: newRecord.order_index,
                status: newRecord.status,
                word_count: newRecord.word_count,
              },
            };
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
          }
        )
        .subscribe();

      // Send heartbeat every 30 seconds to keep connection alive
      const heartbeat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'heartbeat', timestamp: Date.now() })}\n\n`));
        } catch {
          clearInterval(heartbeat);
        }
      }, 30000);

      // Handle client disconnect
      request.signal.addEventListener('abort', () => {
        clearInterval(heartbeat);
        projectChannel.unsubscribe();
        chapterChannel.unsubscribe();
        try {
          controller.close();
        } catch {
          // Already closed
        }
      });
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
