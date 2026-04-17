import { NextRequest } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';
import { startBrowserRuntime } from '@/lib/publishing/computer-runtime';
import { runAgent, type AgentAttachment } from '@/lib/publishing/computer-agent';
import { buildRecipe } from '@/lib/publishing/computer-recipes';
import { loadActiveCredential } from '@/lib/publishing/load-credential';
import { ensurePublishingMetadata } from '@/lib/publishing/metadata';
import { buildManuscriptDocx, loadProjectForPublish } from '@/lib/publishing/draft2digital';

export const runtime = 'nodejs';
export const maxDuration = 600; // 10 minutes; Kobo uploads can take a while
export const dynamic = 'force-dynamic';

// --- In-memory registry of live sessions so the resolve-handoff + cancel
// --- endpoints can deliver messages to the right agent loop.
// --- Process-local only — if the app scales to >1 node, move to Redis pubsub.
declare global {
  // eslint-disable-next-line no-var
  var __penworthComputerControls: Map<
    string,
    { cancel: () => void; resolveHandoff: (text: string) => void }
  > | undefined;
}
const controls = (globalThis.__penworthComputerControls ??= new Map());

/**
 * GET /api/publishing/computer/[slug]/stream?sessionId=...
 *
 * Upgrades to a Server-Sent Events stream. We drive the agent here because
 * this request stays open for the life of the session, giving us a real
 * runtime to persist events without racing the start POST timeout.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  const sessionId = request.nextUrl.searchParams.get('sessionId');
  if (!sessionId) {
    return new Response('sessionId required', { status: 400 });
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return new Response('Unauthorized', { status: 401 });

  // Load the session + verify ownership + that it's in a runnable state
  const { data: session, error: sessionErr } = await supabase
    .from('computer_use_sessions')
    .select('id, user_id, project_id, platform_id, platform_slug, status')
    .eq('id', sessionId)
    .eq('user_id', user.id)
    .single();
  if (sessionErr || !session) {
    return new Response('Session not found', { status: 404 });
  }
  if (session.platform_slug !== slug) {
    return new Response('Slug mismatch', { status: 400 });
  }
  if (session.status !== 'queued') {
    return new Response(`Session already ${session.status}`, { status: 409 });
  }

  // Rebuild the recipe server-side (same logic as start — avoids trusting
  // client state and keeps credentials out of the queue row).
  const metadata = await ensurePublishingMetadata(supabase, session.project_id, user.id);
  if (!metadata) return new Response('Project not found', { status: 404 });

  const credential = await loadActiveCredential(supabase, user.id, slug);
  if (!credential) return new Response('No credentials', { status: 428 });

  const tokenShape = credential.token as unknown as Record<string, unknown>;
  const email = tokenShape.email as string | undefined;
  const password = tokenShape.password as string | undefined;
  if (!email || !password) return new Response('Missing login fields', { status: 428 });

  const recipe = buildRecipe(slug, {
    metadata,
    credentials: { email, password },
    attachmentBasename: 'manuscript',
  });
  if (!recipe) return new Response('No recipe', { status: 501 });

  const service = createServiceClient();
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (type: string, data: Record<string, unknown>) => {
        const payload = `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
        try {
          controller.enqueue(encoder.encode(payload));
        } catch {
          // client disconnected
        }
      };

      // --- Boot runtime ---
      await service
        .from('computer_use_sessions')
        .update({ status: 'starting' })
        .eq('id', sessionId);

      let runtimeHandle;
      try {
        runtimeHandle = await startBrowserRuntime();
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Runtime boot failed';
        await service
          .from('computer_use_sessions')
          .update({
            status: 'failed',
            error_message: msg,
            ended_at: new Date().toISOString(),
          })
          .eq('id', sessionId);
        send('error', { message: msg });
        controller.close();
        return;
      }

      await service
        .from('computer_use_sessions')
        .update({
          status: 'running',
          runtime_session_id: runtimeHandle.sessionId,
          runtime_live_url: runtimeHandle.liveViewUrl,
        })
        .eq('id', sessionId);

      send('booted', {
        runtimeSessionId: runtimeHandle.sessionId,
        liveViewUrl: runtimeHandle.liveViewUrl,
      });

      // Navigate to login URL before we hand over to Claude
      try {
        await runtimeHandle.page.goto(recipe.loginUrl, { waitUntil: 'domcontentloaded', timeout: 30_000 });
      } catch {
        // Claude can recover from nav errors; don't abort
      }

      // Build file attachments the agent can upload via upload_file tool
      const attachments = await buildAttachmentsForSession({
        supabase,
        userId: user.id,
        projectId: session.project_id,
        authorName: metadata.author_name,
        title: metadata.title,
      });

      // --- Run agent loop ---
      const handle = runAgent({
        runtime: runtimeHandle,
        systemPrompt: recipe.systemPrompt,
        userGoal: recipe.userGoal,
        attachments,
      });
      controls.set(sessionId, handle.control);

      let terminalStatus: 'succeeded' | 'failed' | 'cancelled' = 'failed';
      let resultUrl: string | null = null;
      let resultData: Record<string, unknown> | null = null;
      let errorMessage: string | null = null;

      try {
        for await (const ev of handle.events) {
          // Persist + forward
          let screenshotPath: string | null = null;
          if (ev.screenshot) {
            screenshotPath = `${user.id}/${sessionId}/${ev.turnIndex}.png`;
            try {
              await service.storage
                .from('computer-use-screenshots')
                .upload(screenshotPath, ev.screenshot, {
                  contentType: 'image/png',
                  upsert: true,
                });
            } catch {
              // non-fatal
            }
          }

          await service.from('computer_use_events').insert({
            session_id: sessionId,
            turn_index: ev.turnIndex,
            event_type: ev.type === 'complete' ? 'checkpoint' : ev.type,
            payload: {
              ...ev.payload,
              screenshot_path: screenshotPath,
            },
          });

          // Side-effects based on event type
          if (ev.type === 'screenshot') {
            await service
              .from('computer_use_sessions')
              .update({
                turns_count: ev.turnIndex,
                last_screenshot_url: screenshotPath,
              })
              .eq('id', sessionId);
            send('screenshot', { turnIndex: ev.turnIndex, path: screenshotPath });
          } else if (ev.type === 'action') {
            await service
              .from('computer_use_sessions')
              .update({ last_action: (ev.payload.action as string) || 'unknown' })
              .eq('id', sessionId);
            send('action', { turnIndex: ev.turnIndex, ...ev.payload });
          } else if (ev.type === 'thought') {
            send('thought', { turnIndex: ev.turnIndex, ...ev.payload });
          } else if (ev.type === 'handoff') {
            await service
              .from('computer_use_sessions')
              .update({
                status: 'awaiting_2fa',
                two_factor_request: ev.payload,
                reason_for_pause: (ev.payload.reason as string) || null,
              })
              .eq('id', sessionId);
            send('handoff', { turnIndex: ev.turnIndex, ...ev.payload });
            // Note: handle.events is still suspended; resume happens when the
            // resolve-handoff route calls handle.control.resolveHandoff(...)
          } else if (ev.type === 'complete') {
            terminalStatus = 'succeeded';
            resultUrl = (ev.payload.result_url as string) || null;
            resultData = ev.payload;
            send('complete', { turnIndex: ev.turnIndex, ...ev.payload });
          } else if (ev.type === 'error') {
            errorMessage = JSON.stringify(ev.payload).slice(0, 600);
            if (ev.payload.reason === 'cancelled_by_user') terminalStatus = 'cancelled';
            send('error', { turnIndex: ev.turnIndex, ...ev.payload });
          }
        }
      } catch (err) {
        errorMessage = err instanceof Error ? err.message : String(err);
        send('error', { fatal: true, message: errorMessage });
      } finally {
        controls.delete(sessionId);

        await service
          .from('computer_use_sessions')
          .update({
            status: terminalStatus,
            result_url: resultUrl,
            result_data: resultData,
            error_message: errorMessage,
            ended_at: new Date().toISOString(),
          })
          .eq('id', sessionId);

        try {
          await runtimeHandle.dispose();
        } catch {
          // non-fatal
        }

        send('closed', { status: terminalStatus });
        controller.close();
      }
    },
    cancel() {
      // Browser closed the stream — tell agent to stop
      const ctl = controls.get(sessionId);
      if (ctl) ctl.cancel();
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}

/**
 * Build the attachments the agent can upload into browser file inputs:
 * a DOCX manuscript of the completed chapters, plus a cover JPG if the
 * project has one. All in-memory buffers — nothing touches disk.
 */
async function buildAttachmentsForSession(args: {
  supabase: SupabaseClient;
  userId: string;
  projectId: string;
  authorName: string;
  title: string;
}): Promise<AgentAttachment[]> {
  const { supabase, userId, projectId, authorName, title } = args;

  const bundle = await loadProjectForPublish(supabase, projectId, userId);
  if (!bundle) return [];

  const docxBuffer = await buildManuscriptDocx(title, authorName, bundle.chapters);

  const attachments: AgentAttachment[] = [
    {
      name: 'manuscript',
      filename: 'manuscript.docx',
      buffer: docxBuffer,
      mimeType:
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    },
  ];

  if (bundle.coverUrl) {
    try {
      const coverResp = await fetch(bundle.coverUrl);
      if (coverResp.ok) {
        const coverBuffer = Buffer.from(await coverResp.arrayBuffer());
        attachments.push({
          name: 'cover',
          filename: 'cover.jpg',
          buffer: coverBuffer,
          mimeType: 'image/jpeg',
        });
      }
    } catch {
      // non-fatal — book uploads without cover, author can add later
    }
  }

  return attachments;
}
