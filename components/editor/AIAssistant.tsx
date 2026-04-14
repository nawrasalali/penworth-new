'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { AgentType } from '@/types';

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
  agentType?: AgentType;
}

interface AIAssistantProps {
  projectId: string;
  agentType?: AgentType;
  onAgentChange?: (agent: AgentType) => void;
  onInsertContent?: (content: string) => void;
}

const AGENTS: { id: AgentType; name: string; icon: string; description: string }[] = [
  { id: 'interview', name: 'Interview', icon: '🎤', description: 'Gather information through questions' },
  { id: 'outline', name: 'Outline', icon: '📋', description: 'Structure your content' },
  { id: 'research', name: 'Research', icon: '🔍', description: 'Deep research and fact-finding' },
  { id: 'writing', name: 'Writing', icon: '✍️', description: 'Generate and refine content' },
  { id: 'layout', name: 'Layout', icon: '📐', description: 'Format and organize' },
  { id: 'verification', name: 'Verify', icon: '✓', description: 'Fact-check and validate' },
  { id: 'compliance', name: 'Compliance', icon: '⚖️', description: 'Regulatory compliance check' },
  { id: 'review', name: 'Review', icon: '👁️', description: 'Final review and polish' },
];

export function AIAssistant({
  projectId,
  agentType = 'writing',
  onAgentChange,
  onInsertContent,
}: AIAssistantProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [currentAgent, setCurrentAgent] = useState<AgentType>(agentType);
  const [streamingContent, setStreamingContent] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, streamingContent, scrollToBottom]);

  const handleAgentChange = (agent: AgentType) => {
    setCurrentAgent(agent);
    onAgentChange?.(agent);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isLoading) return;

    const userMessage: Message = {
      id: crypto.randomUUID(),
      role: 'user',
      content: input.trim(),
      timestamp: new Date(),
    };

    setMessages(prev => [...prev, userMessage]);
    setInput('');
    setIsLoading(true);
    setStreamingContent('');

    // Create abort controller for this request
    abortControllerRef.current = new AbortController();

    try {
      const response = await fetch('/api/ai/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: userMessage.content,
          projectId,
          agentType: currentAgent,
          conversationHistory: messages.slice(-10).map(m => ({
            role: m.role,
            content: m.content,
          })),
        }),
        signal: abortControllerRef.current.signal,
      });

      if (!response.ok) {
        throw new Error('Failed to get response');
      }

      const reader = response.body?.getReader();
      if (!reader) throw new Error('No reader available');

      const decoder = new TextDecoder();
      let fullContent = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value);
        const lines = chunk.split('\n');

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6));
              if (data.type === 'chunk') {
                fullContent += data.content;
                setStreamingContent(fullContent);
              } else if (data.type === 'complete') {
                // Streaming complete
              } else if (data.type === 'error') {
                throw new Error(data.error);
              }
            } catch (parseError) {
              // Skip invalid JSON
            }
          }
        }
      }

      // Add assistant message
      const assistantMessage: Message = {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: fullContent,
        timestamp: new Date(),
        agentType: currentAgent,
      };
      setMessages(prev => [...prev, assistantMessage]);
      setStreamingContent('');

    } catch (error) {
      if ((error as Error).name === 'AbortError') {
        // Request was cancelled
        return;
      }
      console.error('Chat error:', error);
      const errorMessage: Message = {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: 'I apologize, but I encountered an error. Please try again.',
        timestamp: new Date(),
      };
      setMessages(prev => [...prev, errorMessage]);
    } finally {
      setIsLoading(false);
      setStreamingContent('');
      abortControllerRef.current = null;
    }
  };

  const handleStop = () => {
    abortControllerRef.current?.abort();
    setIsLoading(false);
    setStreamingContent('');
  };

  const handleInsert = (content: string) => {
    onInsertContent?.(content);
  };

  const currentAgentInfo = AGENTS.find(a => a.id === currentAgent);

  return (
    <div className="flex flex-col h-full border-l bg-muted/10">
      {/* Agent Selector */}
      <div className="p-3 border-b bg-background">
        <div className="flex items-center gap-2 mb-2">
          <span className="text-lg">{currentAgentInfo?.icon}</span>
          <span className="font-medium">{currentAgentInfo?.name} Agent</span>
        </div>
        <div className="flex flex-wrap gap-1">
          {AGENTS.map(agent => (
            <button
              key={agent.id}
              onClick={() => handleAgentChange(agent.id)}
              className={`px-2 py-1 text-xs rounded-full transition-colors ${
                currentAgent === agent.id
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-muted hover:bg-muted/80'
              }`}
              title={agent.description}
            >
              {agent.icon} {agent.name}
            </button>
          ))}
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-auto p-4 space-y-4">
        {messages.length === 0 && !streamingContent && (
          <div className="text-center text-muted-foreground py-8">
            <p className="text-lg mb-2">{currentAgentInfo?.icon}</p>
            <p className="font-medium">{currentAgentInfo?.name} Agent</p>
            <p className="text-sm">{currentAgentInfo?.description}</p>
            <p className="text-xs mt-4">Ask me anything about your project!</p>
          </div>
        )}

        {messages.map(message => (
          <div
            key={message.id}
            className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
          >
            <div
              className={`max-w-[85%] rounded-lg px-4 py-2 ${
                message.role === 'user'
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-muted'
              }`}
            >
              <p className="text-sm whitespace-pre-wrap">{message.content}</p>
              {message.role === 'assistant' && onInsertContent && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="mt-2 h-6 text-xs"
                  onClick={() => handleInsert(message.content)}
                >
                  Insert into document →
                </Button>
              )}
            </div>
          </div>
        ))}

        {streamingContent && (
          <div className="flex justify-start">
            <div className="max-w-[85%] rounded-lg px-4 py-2 bg-muted">
              <p className="text-sm whitespace-pre-wrap">{streamingContent}</p>
              <span className="inline-block w-2 h-4 bg-primary animate-pulse ml-1" />
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <form onSubmit={handleSubmit} className="p-3 border-t bg-background">
        <div className="flex gap-2">
          <Input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={`Ask the ${currentAgentInfo?.name} agent...`}
            disabled={isLoading}
            className="flex-1"
          />
          {isLoading ? (
            <Button type="button" variant="destructive" onClick={handleStop}>
              Stop
            </Button>
          ) : (
            <Button type="submit" disabled={!input.trim()}>
              Send
            </Button>
          )}
        </div>
      </form>
    </div>
  );
}
