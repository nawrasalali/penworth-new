'use client';

import { useState, useEffect, useCallback } from 'react';
import { createClient } from '@/lib/supabase/client';
import {
  AgentName,
  AgentStatusMap,
  InterviewSession,
  ValidationScore,
  InterviewQuestion,
  ResearchResource,
  OutlineSection,
  AuthorInfo,
  CoverConfig,
} from '@/types/agent-workflow';

interface UseAgentWorkflowOptions {
  projectId: string;
  onError?: (error: string) => void;
}

interface AgentWorkflowState {
  session: InterviewSession | null;
  loading: boolean;
  error: string | null;
  currentAgent: AgentName;
  agentStatus: AgentStatusMap;
}

export function useAgentWorkflow({ projectId, onError }: UseAgentWorkflowOptions) {
  const [state, setState] = useState<AgentWorkflowState>({
    session: null,
    loading: true,
    error: null,
    currentAgent: 'validate',
    agentStatus: {
      validate: 'active',
      interview: 'waiting',
      research: 'waiting',
      outline: 'waiting',
      writing: 'waiting',
      qa: 'waiting',
      cover: 'waiting',
      publishing: 'waiting',
    },
  });

  const supabase = createClient();

  // Load or create session
  useEffect(() => {
    const loadSession = async () => {
      try {
        const response = await fetch(`/api/interview-session?projectId=${projectId}`);
        const data = await response.json();

        if (data.error) {
          throw new Error(data.error);
        }

        setState(prev => ({
          ...prev,
          session: data.session,
          currentAgent: data.session?.current_agent || 'validate',
          agentStatus: data.session?.agent_status || prev.agentStatus,
          loading: false,
        }));
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to load session';
        setState(prev => ({ ...prev, error: message, loading: false }));
        onError?.(message);
      }
    };

    if (projectId) {
      loadSession();
    }
  }, [projectId, onError]);

  // Advance to next agent
  const advanceAgent = useCallback(async (data?: Record<string, any>) => {
    if (!state.session) return;

    setState(prev => ({ ...prev, loading: true }));

    try {
      const response = await fetch('/api/interview-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId: state.session.id,
          action: 'advance',
          data,
        }),
      });

      const result = await response.json();

      if (result.error) {
        throw new Error(result.error);
      }

      setState(prev => ({
        ...prev,
        session: result.session,
        currentAgent: result.session.current_agent,
        agentStatus: result.session.agent_status,
        loading: false,
      }));

      return result.session;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to advance';
      setState(prev => ({ ...prev, error: message, loading: false }));
      onError?.(message);
    }
  }, [state.session, onError]);

  // Save current state without advancing
  const saveState = useCallback(async (data: Record<string, any>) => {
    if (!state.session) return;

    try {
      const response = await fetch('/api/interview-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId: state.session.id,
          action: 'save',
          data,
        }),
      });

      const result = await response.json();

      if (result.error) {
        throw new Error(result.error);
      }

      setState(prev => ({
        ...prev,
        session: result.session,
      }));

      return result.session;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to save';
      onError?.(message);
    }
  }, [state.session, onError]);

  // Update session fields
  const updateSession = useCallback(async (updates: Partial<InterviewSession>) => {
    if (!state.session) return;

    try {
      const response = await fetch('/api/interview-session', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId: state.session.id,
          updates,
        }),
      });

      const result = await response.json();

      if (result.error) {
        throw new Error(result.error);
      }

      setState(prev => ({
        ...prev,
        session: result.session,
      }));

      return result.session;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to update';
      onError?.(message);
    }
  }, [state.session, onError]);

  // Validate topic
  const validateTopic = useCallback(async (topic: string): Promise<ValidationScore> => {
    const response = await fetch('/api/ai/validate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ topic }),
    });

    const data = await response.json();

    if (data.error) {
      throw new Error(data.error);
    }

    return data.score;
  }, []);

  // Generate cover
  const generateCover = useCallback(async (
    type: 'front' | 'back',
    prompt?: string
  ): Promise<string> => {
    if (!state.session) throw new Error('No session');

    const response = await fetch('/api/covers/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        projectId,
        sessionId: state.session.id,
        coverType: type,
        prompt,
        bookTitle: state.session.book_title || 'Untitled',
        authorName: state.session.author_name || 'Author',
        bookDescription: '', // Can add description
      }),
    });

    const data = await response.json();

    if (data.error) {
      throw new Error(data.error);
    }

    // Update local state
    setState(prev => {
      if (!prev.session) return prev;
      return {
        ...prev,
        session: {
          ...prev.session,
          [type === 'front' ? 'front_cover_url' : 'back_cover_url']: data.imageUrl,
        } as InterviewSession,
      };
    });

    return data.imageUrl;
  }, [state.session, projectId]);

  // Get active message for current agent
  const getActiveMessage = useCallback(() => {
    switch (state.currentAgent) {
      case 'validate':
        return { line1: 'Analyzing your idea...', line2: 'Scoring market potential' };
      case 'interview':
        return { line1: 'Gathering your vision...', line2: 'Understanding your goals' };
      case 'research':
        return { line1: 'Researching your topic...', line2: 'Finding credible sources' };
      case 'outline':
        return { line1: 'Structuring your document...', line2: 'Creating chapter flow' };
      case 'writing':
        return { line1: 'Writing your content...', line2: 'Crafting each chapter' };
      case 'qa':
        return { line1: 'Running quality checks...', line2: 'Preparing for publish' };
      case 'publishing':
        return { line1: 'Finalizing your document...', line2: 'Ready for distribution' };
      default:
        return { line1: 'Processing...', line2: '' };
    }
  }, [state.currentAgent]);

  return {
    ...state,
    advanceAgent,
    saveState,
    updateSession,
    validateTopic,
    generateCover,
    getActiveMessage,
  };
}
