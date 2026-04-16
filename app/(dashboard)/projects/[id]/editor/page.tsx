'use client';

import { useState, useEffect, useRef, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { toast } from 'sonner';
import {
  ArrowLeft,
  Save,
  Settings,
  Sparkles,
  Send,
  Plus,
  FileText,
  MessageSquare,
  X,
  Loader2,
  CheckCircle2,
  Bot,
  User,
} from 'lucide-react';
import { cn, countWords } from '@/lib/utils';
import type { AgentType } from '@/types';

interface Chapter {
  id: string;
  title: string;
  content: string;
  order_index: number;
  status: string;
  word_count: number;
}

interface Message {
  role: 'user' | 'assistant';
  content: string;
}

function EditorContent({ params }: { params: { id: string } }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const [project, setProject] = useState<any>(null);
  const [chapters, setChapters] = useState<Chapter[]>([]);
  const [activeChapterId, setActiveChapterId] = useState<string | null>(null);
  const [content, setContent] = useState('');
  const [title, setTitle] = useState('');
  const [saving, setSaving] = useState(false);
  const [lastSaved, setLastSaved] = useState<Date | null>(null);

  // AI Assistant state
  const [showAI, setShowAI] = useState(true);
  const [aiMessages, setAiMessages] = useState<Message[]>([]);
  const [aiInput, setAiInput] = useState('');
  const [aiLoading, setAiLoading] = useState(false);
  const [activeAgent, setActiveAgent] = useState<AgentType>('writing');
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Load project and chapters
  useEffect(() => {
    loadProject();
  }, [params.id]);

  // Handle URL params for chapter/agent selection
  useEffect(() => {
    const chapterId = searchParams.get('chapter');
    const agent = searchParams.get('agent') as AgentType;
    const isNew = searchParams.get('new');

    if (chapterId && chapters.length > 0) {
      const chapter = chapters.find(c => c.id === chapterId);
      if (chapter) {
        setActiveChapterId(chapter.id);
        setContent(chapter.content);
        setTitle(chapter.title);
      }
    } else if (isNew) {
      createNewChapter();
    } else if (chapters.length > 0 && !activeChapterId) {
      // Default to first chapter
      setActiveChapterId(chapters[0].id);
      setContent(chapters[0].content);
      setTitle(chapters[0].title);
    }

    if (agent) {
      setActiveAgent(agent);
      setShowAI(true);
    }
  }, [searchParams, chapters]);

  // Auto-scroll AI messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [aiMessages]);

  const loadProject = async () => {
    const supabase = createClient();
    const { data, error } = await supabase
      .from('projects')
      .select('*, chapters(*)')
      .eq('id', params.id)
      .single();

    if (error) {
      toast.error('Failed to load project');
      router.push('/projects');
      return;
    }

    setProject(data);
    const sortedChapters = (data.chapters || []).sort(
      (a: Chapter, b: Chapter) => a.order_index - b.order_index
    );
    setChapters(sortedChapters);
  };

  const createNewChapter = async () => {
    const supabase = createClient();
    const newOrder = chapters.length > 0 
      ? Math.max(...chapters.map(c => c.order_index)) + 1 
      : 0;

    const { data, error } = await supabase
      .from('chapters')
      .insert({
        project_id: params.id,
        title: 'Untitled Chapter',
        content: '',
        order_index: newOrder,
        status: 'draft',
        word_count: 0,
      })
      .select()
      .single();

    if (error) {
      toast.error('Failed to create chapter');
      return;
    }

    setChapters([...chapters, data]);
    setActiveChapterId(data.id);
    setContent('');
    setTitle('Untitled Chapter');
  };

  const saveChapter = async () => {
    if (!activeChapterId) return;

    setSaving(true);
    const supabase = createClient();
    const wordCount = countWords(content);

    const { error } = await supabase
      .from('chapters')
      .update({
        title,
        content,
        word_count: wordCount,
      })
      .eq('id', activeChapterId);

    if (error) {
      toast.error('Failed to save');
    } else {
      setLastSaved(new Date());
      // Update local state
      setChapters(chapters.map(c => 
        c.id === activeChapterId 
          ? { ...c, title, content, word_count: wordCount }
          : c
      ));
    }
    setSaving(false);
  };

  // Auto-save on content change (debounced)
  useEffect(() => {
    const timer = setTimeout(() => {
      if (activeChapterId && content) {
        saveChapter();
      }
    }, 2000);

    return () => clearTimeout(timer);
  }, [content, title]);

  const handleAISubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!aiInput.trim() || aiLoading) return;

    const userMessage = aiInput.trim();
    setAiInput('');
    setAiMessages(prev => [...prev, { role: 'user', content: userMessage }]);
    setAiLoading(true);

    try {
      const response = await fetch('/api/ai/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: userMessage,
          projectId: params.id,
          agentType: activeAgent,
          conversationHistory: aiMessages,
        }),
      });

      if (!response.ok) throw new Error('AI request failed');

      const reader = response.body?.getReader();
      if (!reader) throw new Error('No response body');

      let assistantMessage = '';
      setAiMessages(prev => [...prev, { role: 'assistant', content: '' }]);

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const text = new TextDecoder().decode(value);
        const lines = text.split('\n').filter(line => line.startsWith('data: '));

        for (const line of lines) {
          const jsonStr = line.replace('data: ', '');
          try {
            const data = JSON.parse(jsonStr);
            if (data.type === 'chunk') {
              assistantMessage += data.content;
              setAiMessages(prev => {
                const newMessages = [...prev];
                newMessages[newMessages.length - 1] = {
                  role: 'assistant',
                  content: assistantMessage,
                };
                return newMessages;
              });
            }
          } catch (e) {
            // Ignore parse errors for incomplete chunks
          }
        }
      }
    } catch (error) {
      console.error('AI error:', error);
      toast.error('Failed to get AI response');
      setAiMessages(prev => prev.slice(0, -1)); // Remove empty assistant message
    } finally {
      setAiLoading(false);
    }
  };

  const insertAIContent = (content: string) => {
    if (textareaRef.current) {
      const start = textareaRef.current.selectionStart;
      const end = textareaRef.current.selectionEnd;
      const newContent = 
        textareaRef.current.value.substring(0, start) +
        content +
        textareaRef.current.value.substring(end);
      setContent(newContent);
      toast.success('Content inserted');
    }
  };

  const agents: { type: AgentType; label: string }[] = [
    { type: 'interview', label: 'Interview' },
    { type: 'outline', label: 'Outline' },
    { type: 'research', label: 'Research' },
    { type: 'writing', label: 'Write' },
    { type: 'review', label: 'Review' },
    { type: 'verification', label: 'Verify' },
  ];

  return (
    <div className="h-screen flex flex-col">
      {/* Top Bar */}
      <div className="h-14 border-b flex items-center justify-between px-4 bg-background">
        <div className="flex items-center gap-4">
          <button
            onClick={() => router.push(`/projects/${params.id}`)}
            className="p-2 hover:bg-muted rounded-lg"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
          <div>
            <h1 className="font-semibold truncate max-w-[300px]">
              {project?.title || 'Loading...'}
            </h1>
            <p className="text-xs text-muted-foreground">
              {countWords(content).toLocaleString()} words
              {lastSaved && ` • Saved ${lastSaved.toLocaleTimeString()}`}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setShowAI(!showAI)}
          >
            <Sparkles className="h-4 w-4 mr-2" />
            AI Assistant
          </Button>
          <Button size="sm" onClick={saveChapter} disabled={saving}>
            {saving ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Save className="h-4 w-4" />
            )}
          </Button>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex overflow-hidden">
        {/* Chapters Sidebar */}
        <div className="w-64 border-r bg-muted/30 overflow-y-auto">
          <div className="p-3">
            <Button
              size="sm"
              variant="outline"
              className="w-full"
              onClick={createNewChapter}
            >
              <Plus className="h-4 w-4 mr-2" />
              New Chapter
            </Button>
          </div>
          <div className="px-2">
            {chapters.map((chapter, index) => (
              <button
                key={chapter.id}
                onClick={() => {
                  setActiveChapterId(chapter.id);
                  setContent(chapter.content);
                  setTitle(chapter.title);
                }}
                className={cn(
                  'w-full text-left px-3 py-2 rounded-lg mb-1 transition-colors',
                  activeChapterId === chapter.id
                    ? 'bg-primary text-primary-foreground'
                    : 'hover:bg-muted'
                )}
              >
                <div className="flex items-center gap-2">
                  <span className="text-xs opacity-60">{index + 1}</span>
                  <span className="truncate text-sm">{chapter.title}</span>
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* Editor */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {activeChapterId ? (
            <>
              <div className="p-4 border-b">
                <Input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="Chapter Title"
                  className="text-xl font-semibold border-none shadow-none focus-visible:ring-0 px-0"
                />
              </div>
              <textarea
                ref={textareaRef}
                value={content}
                onChange={(e) => setContent(e.target.value)}
                placeholder="Start writing..."
                className="flex-1 w-full p-6 resize-none focus:outline-none text-lg leading-relaxed"
              />
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center">
              <div className="text-center">
                <FileText className="h-16 w-16 mx-auto text-muted-foreground/50 mb-4" />
                <p className="text-muted-foreground mb-4">
                  Select a chapter or create a new one to start writing
                </p>
                <Button onClick={createNewChapter}>
                  <Plus className="h-4 w-4 mr-2" />
                  Create Chapter
                </Button>
              </div>
            </div>
          )}
        </div>

        {/* AI Assistant Panel */}
        {showAI && (
          <div className="w-96 border-l flex flex-col bg-muted/30">
            <div className="p-3 border-b flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Bot className="h-4 w-4 text-primary" />
                <span className="font-medium">AI Assistant</span>
              </div>
              <button onClick={() => setShowAI(false)} className="p-1 hover:bg-muted rounded">
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Agent Selector */}
            <div className="p-2 border-b flex flex-wrap gap-1">
              {agents.map((agent) => (
                <button
                  key={agent.type}
                  onClick={() => setActiveAgent(agent.type)}
                  className={cn(
                    'px-2 py-1 text-xs rounded-full transition-colors',
                    activeAgent === agent.type
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-muted hover:bg-muted/80'
                  )}
                >
                  {agent.label}
                </button>
              ))}
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              {aiMessages.length === 0 && (
                <div className="text-center text-sm text-muted-foreground py-8">
                  <Sparkles className="h-8 w-8 mx-auto mb-3 opacity-50" />
                  <p>Ask the AI assistant for help with your writing.</p>
                  <p className="mt-2">Current mode: <strong>{activeAgent}</strong></p>
                </div>
              )}
              {aiMessages.map((message, index) => (
                <div
                  key={index}
                  className={cn(
                    'flex gap-3',
                    message.role === 'user' ? 'justify-end' : 'justify-start'
                  )}
                >
                  {message.role === 'assistant' && (
                    <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                      <Bot className="h-4 w-4 text-primary" />
                    </div>
                  )}
                  <div
                    className={cn(
                      'rounded-lg px-3 py-2 max-w-[80%]',
                      message.role === 'user'
                        ? 'bg-primary text-primary-foreground'
                        : 'bg-card border'
                    )}
                  >
                    <p className="text-sm whitespace-pre-wrap">{message.content}</p>
                    {message.role === 'assistant' && message.content && (
                      <button
                        onClick={() => insertAIContent(message.content)}
                        className="mt-2 text-xs text-primary hover:underline"
                      >
                        Insert into editor
                      </button>
                    )}
                  </div>
                  {message.role === 'user' && (
                    <div className="h-8 w-8 rounded-full bg-muted flex items-center justify-center flex-shrink-0">
                      <User className="h-4 w-4" />
                    </div>
                  )}
                </div>
              ))}
              {aiLoading && (
                <div className="flex gap-3">
                  <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center">
                    <Loader2 className="h-4 w-4 text-primary animate-spin" />
                  </div>
                  <div className="bg-card border rounded-lg px-3 py-2">
                    <p className="text-sm text-muted-foreground">Thinking...</p>
                  </div>
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>

            {/* Input */}
            <form onSubmit={handleAISubmit} className="p-3 border-t">
              <div className="flex gap-2">
                <Input
                  value={aiInput}
                  onChange={(e) => setAiInput(e.target.value)}
                  placeholder={`Ask the ${activeAgent} agent...`}
                  disabled={aiLoading}
                />
                <Button type="submit" size="icon" disabled={aiLoading || !aiInput.trim()}>
                  <Send className="h-4 w-4" />
                </Button>
              </div>
            </form>
          </div>
        )}
      </div>
    </div>
  );
}

export default function EditorPage({ params }: { params: { id: string } }) {
  return (
    <Suspense fallback={
      <div className="h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    }>
      <EditorContent params={params} />
    </Suspense>
  );
}
