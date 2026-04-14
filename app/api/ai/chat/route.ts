import { NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { orchestrateAgentStream, determineAgentType } from '@/lib/ai/orchestrator';
import { Industry, AgentType } from '@/types';

export const runtime = 'edge';

export async function POST(request: NextRequest) {
  try {
    const supabase = createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const body = await request.json();
    const {
      message,
      projectId,
      agentType: requestedAgentType,
      conversationHistory,
    } = body;

    if (!message || !projectId) {
      return new Response(JSON.stringify({ error: 'Message and projectId required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Fetch project details
    const { data: project, error: projectError } = await supabase
      .from('projects')
      .select('*, organizations(*)')
      .eq('id', projectId)
      .single();

    if (projectError || !project) {
      return new Response(JSON.stringify({ error: 'Project not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Determine industry from organization or default
    const industry: Industry = project.organizations?.industry || 'general';
    
    // Determine agent type
    const agentType: AgentType = requestedAgentType || determineAgentType(message);

    // Create streaming response
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        try {
          const generator = orchestrateAgentStream({
            projectId,
            industry,
            agentType,
            userMessage: message,
            conversationHistory,
            projectContext: {
              title: project.title,
              description: project.description,
              contentType: project.content_type,
            },
            organizationBranding: project.organizations ? {
              name: project.organizations.name,
              tone: project.organizations.settings?.tone,
              customInstructions: project.organizations.settings?.customInstructions,
            } : undefined,
          });

          let result;
          for await (const chunk of generator) {
            // Send chunk as SSE
            const data = JSON.stringify({ type: 'chunk', content: chunk });
            controller.enqueue(encoder.encode(`data: ${data}\n\n`));
          }

          // Get final result
          result = await generator.return(undefined as any);
          
          if (result.value) {
            // Log usage
            await supabase.from('usage').insert({
              user_id: user.id,
              org_id: project.org_id,
              action_type: `ai_${agentType}`,
              tokens_input: result.value.tokensUsed.input,
              tokens_output: result.value.tokensUsed.output,
              model: result.value.model,
              metadata: { project_id: projectId },
            });

            // Send completion event
            const completeData = JSON.stringify({
              type: 'complete',
              tokensUsed: result.value.tokensUsed,
              model: result.value.model,
            });
            controller.enqueue(encoder.encode(`data: ${completeData}\n\n`));
          }

          controller.close();
        } catch (error) {
          const errorData = JSON.stringify({
            type: 'error',
            error: error instanceof Error ? error.message : 'Unknown error',
          });
          controller.enqueue(encoder.encode(`data: ${errorData}\n\n`));
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      },
    });
  } catch (error) {
    console.error('AI Chat Error:', error);
    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}
