import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { AgentName, AgentStatusMap } from '@/types/agent-workflow';

// GET - Fetch or create interview session for a project
export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { searchParams } = new URL(request.url);
    const projectId = searchParams.get('projectId');

    if (!projectId) {
      return NextResponse.json({ error: 'Project ID required' }, { status: 400 });
    }

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Try to get existing session
    let { data: session } = await supabase
      .from('interview_sessions')
      .select('*')
      .eq('project_id', projectId)
      .eq('user_id', user.id)
      .single();

    // Create new session if none exists
    if (!session) {
      const defaultStatus: AgentStatusMap = {
        validate: 'active',
        interview: 'waiting',
        research: 'waiting',
        outline: 'waiting',
        writing: 'waiting',
        qa: 'waiting',
        cover: 'waiting',
        publishing: 'waiting',
      };

      const { data: newSession, error } = await supabase
        .from('interview_sessions')
        .insert({
          project_id: projectId,
          user_id: user.id,
          current_agent: 'validate',
          agent_status: defaultStatus,
          // Seed the heartbeat on session creation so the stuck detector
          // doesn't false-positive on a brand-new session during the
          // 3-minute validate window.
          pipeline_status: 'active',
          agent_started_at: new Date().toISOString(),
          agent_heartbeat_at: new Date().toISOString(),
        })
        .select()
        .single();

      if (error) {
        console.error('Error creating session:', error);
        return NextResponse.json({ error: 'Failed to create session' }, { status: 500 });
      }

      session = newSession;
    }

    return NextResponse.json({ session });

  } catch (error) {
    console.error('Session fetch error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// PUT - Update interview session
export async function PUT(request: NextRequest) {
  try {
    const supabase = await createClient();
    const body = await request.json();
    const { sessionId, updates } = body;

    if (!sessionId) {
      return NextResponse.json({ error: 'Session ID required' }, { status: 400 });
    }

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Verify ownership
    const { data: existing } = await supabase
      .from('interview_sessions')
      .select('id')
      .eq('id', sessionId)
      .eq('user_id', user.id)
      .single();

    if (!existing) {
      return NextResponse.json({ error: 'Session not found' }, { status: 404 });
    }

    // Update session
    const { data: session, error } = await supabase
      .from('interview_sessions')
      .update({
        ...updates,
        updated_at: new Date().toISOString(),
      })
      .eq('id', sessionId)
      .select()
      .single();

    if (error) {
      console.error('Error updating session:', error);
      return NextResponse.json({ error: 'Failed to update session' }, { status: 500 });
    }

    return NextResponse.json({ session });

  } catch (error) {
    console.error('Session update error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// POST - Advance to next agent
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const body = await request.json();
    const { sessionId, action, data } = body;

    if (!sessionId) {
      return NextResponse.json({ error: 'Session ID required' }, { status: 400 });
    }

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Get current session
    const { data: session } = await supabase
      .from('interview_sessions')
      .select('*')
      .eq('id', sessionId)
      .eq('user_id', user.id)
      .single();

    if (!session) {
      return NextResponse.json({ error: 'Session not found' }, { status: 404 });
    }

    const agentOrder: AgentName[] = [
      'validate', 'interview', 'research', 'outline', 'writing', 'qa', 'cover', 'publishing'
    ];

    if (action === 'advance') {
      // Find current agent index
      const currentIndex = agentOrder.indexOf(session.current_agent as AgentName);
      
      if (currentIndex === -1 || currentIndex >= agentOrder.length - 1) {
        return NextResponse.json({ error: 'Cannot advance further' }, { status: 400 });
      }

      const nextAgent = agentOrder[currentIndex + 1];
      const newStatus = { ...session.agent_status };
      newStatus[session.current_agent] = 'completed';
      newStatus[nextAgent] = 'active';

      const updateData: Record<string, any> = {
        current_agent: nextAgent,
        agent_status: newStatus,
        updated_at: new Date().toISOString(),
        // Transition = fresh heartbeat. Also flips pipeline_status back
        // to 'active' in case the previous agent had been marked
        // 'stuck' or 'recovering' before advancing.
        agent_heartbeat_at: new Date().toISOString(),
        agent_started_at: new Date().toISOString(),
        pipeline_status: 'active',
        // Reset failure counter on a clean transition — we're moving
        // into a new agent; whatever went wrong in the previous one is
        // no longer the active concern.
        failure_count: 0,
        last_failure_reason: null,
        last_failure_at: null,
      };

      // Store agent-specific data
      if (data) {
        switch (session.current_agent) {
          case 'validate':
            updateData.validation_data = data;
            break;
          case 'interview':
            updateData.interview_data = data;
            updateData.follow_up_data = data.followUpAnswers || {};
            break;
          case 'research':
            updateData.research_data = data;
            break;
          case 'outline':
            updateData.outline_data = data;
            break;
          case 'writing':
            updateData.writing_data = data;
            break;
          case 'qa':
            updateData.qa_data = data;
            if (data.legalAcknowledged) {
              updateData.legal_acknowledged_at = new Date().toISOString();
              updateData.legal_acknowledged_by = user.id;
            }
            break;
        }
      }

      const { data: updatedSession, error } = await supabase
        .from('interview_sessions')
        .update(updateData)
        .eq('id', sessionId)
        .select()
        .single();

      if (error) {
        console.error('Error advancing session:', error);
        return NextResponse.json({ error: 'Failed to advance session' }, { status: 500 });
      }

      return NextResponse.json({ session: updatedSession });
    }

    if (action === 'save') {
      // Just save current state without advancing
      const updateData: Record<string, any> = {
        updated_at: new Date().toISOString(),
      };

      if (data) {
        const agentDataKey = `${session.current_agent}_data`;
        updateData[agentDataKey] = data;
      }

      const { data: updatedSession, error } = await supabase
        .from('interview_sessions')
        .update(updateData)
        .eq('id', sessionId)
        .select()
        .single();

      if (error) {
        console.error('Error saving session:', error);
        return NextResponse.json({ error: 'Failed to save session' }, { status: 500 });
      }

      return NextResponse.json({ session: updatedSession });
    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 });

  } catch (error) {
    console.error('Session action error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
