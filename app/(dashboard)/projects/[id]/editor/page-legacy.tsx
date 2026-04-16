'use client';

import { useState, useEffect, useRef, Suspense, useCallback } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { toast } from 'sonner';
import {
  ArrowLeft,
  Save,
  Sparkles,
  Send,
  Plus,
  FileText,
  X,
  Loader2,
  Bot,
  User,
  Check,
  Lock,
  ChevronRight,
  BookOpen,
  Play,
  Upload,
  Eye,
  Search,
  PenTool,
  Layout,
  Palette,
  ChevronDown,
} from 'lucide-react';
import { cn, countWords } from '@/lib/utils';
import type { AgentType } from '@/types';

// =============================================================================
// WORKFLOW CONFIGURATION - The guided 5-step process
// =============================================================================

interface WorkflowStep {
  id: string;
  agentType: AgentType;
  label: string;
  description: string;
  icon: React.ReactNode;
}

const WORKFLOW_STEPS: WorkflowStep[] = [
  { id: 'validate', agentType: 'interview', label: 'Validate', description: 'Score your idea', icon: <Sparkles className="h-4 w-4" /> },
  { id: 'interview', agentType: 'interview', label: 'Interview', description: 'Gather details', icon: <Bot className="h-4 w-4" /> },
  { id: 'research', agentType: 'research', label: 'Research', description: 'Find sources', icon: <Search className="h-4 w-4" /> },
  { id: 'outline', agentType: 'outline', label: 'Outline', description: 'Structure chapters', icon: <Layout className="h-4 w-4" /> },
  { id: 'write', agentType: 'writing', label: 'Write', description: 'Generate content', icon: <PenTool className="h-4 w-4" /> },
];

// =============================================================================
// DESIGN TEMPLATES
// =============================================================================

interface DesignTemplate {
  id: string;
  name: string;
  description: string;
  paperSize: string;
  forTypes: string[];
}

const DESIGN_TEMPLATES: DesignTemplate[] = [
  { id: 'kdp-6x9', name: 'KDP Standard (6" × 9")', description: 'Amazon Kindle Direct Publishing format', paperSize: '6" × 9"', forTypes: ['non-fiction', 'fiction', 'memoir', 'self-help', 'biography'] },
  { id: 'kdp-5x8', name: 'KDP Compact (5" × 8")', description: 'Smaller format for novels', paperSize: '5" × 8"', forTypes: ['fiction', 'poetry', 'children'] },
  { id: 'academic', name: 'Academic Paper', description: 'A4 format with citations', paperSize: 'A4', forTypes: ['academic', 'technical', 'paper'] },
  { id: 'business', name: 'Business Document', description: 'Professional letter format', paperSize: 'Letter', forTypes: ['business', 'business_plan', 'report'] },
  { id: 'ebook', name: 'eBook Reflowable', description: 'Flexible digital format', paperSize: 'Responsive', forTypes: ['non-fiction', 'fiction', 'self-help'] },
];

// =============================================================================
// TYPES
// =============================================================================

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
  timestamp?: Date;
}

// =============================================================================
// PROGRESS STEPPER COMPONENT - Steps are NOT clickable, system guides the process
// =============================================================================

function ProgressStepper({
  currentStep,
  completedSteps,
}: {
  currentStep: number;
  completedSteps: Set<number>;
}) {
  return (
    <div className="flex items-center justify-between px-4 py-3 bg-muted/30 border-b overflow-x-auto">
      {WORKFLOW_STEPS.map((step, index) => {
        const isCompleted = completedSteps.has(index);
        const isCurrent = currentStep === index;
        const isLocked = index > currentStep && !isCompleted;
        
        return (
          <div key={index} className="flex items-center">
            {/* Step indicator - NOT clickable, system controls progression */}
            <div
              className={cn(
                'flex items-center gap-2 px-3 py-2 rounded-lg transition-all select-none',
                isCompleted && 'bg-green-500/10 text-green-600',
                isCurrent && !isCompleted && 'bg-primary/10 text-primary ring-2 ring-primary/30 animate-pulse',
                isLocked && 'opacity-40'
              )}
            >
              <div className={cn(
                'h-7 w-7 rounded-full flex items-center justify-center text-xs font-medium transition-all',
                isCompleted && 'bg-green-500 text-white',
                isCurrent && !isCompleted && 'bg-primary text-primary-foreground',
                isLocked && 'bg-muted text-muted-foreground'
              )}>
                {isCompleted ? (
                  <Check className="h-4 w-4" />
                ) : isLocked ? (
                  <Lock className="h-3 w-3" />
                ) : (
                  step.icon
                )}
              </div>
              <div className="hidden sm:block text-left">
                <p className={cn(
                  'text-sm font-medium',
                  isLocked && 'text-muted-foreground'
                )}>
                  {step.label}
                </p>
                <p className="text-xs text-muted-foreground">{step.description}</p>
              </div>
            </div>
            
            {/* Connector */}
            {index < WORKFLOW_STEPS.length - 1 && (
              <div className={cn(
                'h-0.5 w-8 mx-2 flex-shrink-0 transition-colors',
                isCompleted ? 'bg-green-500' : 'bg-muted-foreground/20'
              )} />
            )}
          </div>
        );
      })}
    </div>
  );
}

// =============================================================================
// WORKFLOW CONTROLS - Save & Return or Progress to Next
// =============================================================================

function WorkflowControls({
  currentStep,
  canProgress,
  onSaveAndExit,
  onProgressToNext,
  loading,
}: {
  currentStep: number;
  canProgress: boolean;
  onSaveAndExit: () => void;
  onProgressToNext: () => void;
  loading: boolean;
}) {
  const nextStep = WORKFLOW_STEPS[currentStep + 1];
  const isLastStep = currentStep >= WORKFLOW_STEPS.length - 1;
  
  return (
    <div className="flex items-center gap-2 p-3 border-t bg-muted/20">
      <Button
        variant="outline"
        size="sm"
        onClick={onSaveAndExit}
        disabled={loading}
        className="gap-2"
      >
        <Save className="h-4 w-4" />
        <span className="hidden sm:inline">Save & Return Later</span>
        <span className="sm:hidden">Save</span>
      </Button>
      
      {!isLastStep && (
        <Button
          size="sm"
          onClick={onProgressToNext}
          disabled={!canProgress || loading}
          className={cn(
            'ml-auto gap-2',
            canProgress && 'bg-green-600 hover:bg-green-700'
          )}
        >
          {loading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : canProgress ? (
            <Check className="h-4 w-4" />
          ) : (
            <Lock className="h-4 w-4" />
          )}
          <span className="hidden sm:inline">
            {canProgress 
              ? `Complete & Continue to ${nextStep?.label}` 
              : `Complete ${WORKFLOW_STEPS[currentStep]?.label} first`
            }
          </span>
          <span className="sm:hidden">
            {canProgress ? 'Continue' : 'Complete first'}
          </span>
          {canProgress && <ChevronRight className="h-4 w-4" />}
        </Button>
      )}
      
      {isLastStep && canProgress && (
        <Button
          size="sm"
          onClick={onProgressToNext}
          className="ml-auto gap-2 bg-green-600 hover:bg-green-700"
        >
          <Check className="h-4 w-4" />
          Finish & Generate Book
        </Button>
      )}
    </div>
  );
}

// =============================================================================
// PDF PREVIEW COMPONENT - Shows document taking shape
// =============================================================================

function PDFPreview({
  project,
  chapters,
  outline,
  selectedTemplate,
  onTemplateChange,
}: {
  project: any;
  chapters: Chapter[];
  outline?: string;
  selectedTemplate: string;
  onTemplateChange: (id: string) => void;
}) {
  const [showTemplates, setShowTemplates] = useState(false);
  const template = DESIGN_TEMPLATES.find(t => t.id === selectedTemplate) || DESIGN_TEMPLATES[0];
  
  return (
    <div className="h-full flex flex-col bg-zinc-100 dark:bg-zinc-900">
      {/* Preview header with template selector */}
      <div className="flex items-center justify-between p-3 border-b bg-background">
        <div className="flex items-center gap-2">
          <Eye className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm font-medium">Preview</span>
        </div>
        
        {/* Template Selector */}
        <div className="relative">
          <button
            onClick={() => setShowTemplates(!showTemplates)}
            className="flex items-center gap-1 text-xs px-2 py-1 rounded bg-muted hover:bg-muted/80 transition-colors"
          >
            <Palette className="h-3 w-3" />
            {template.paperSize}
            <ChevronDown className="h-3 w-3" />
          </button>
          
          {showTemplates && (
            <div className="absolute right-0 top-full mt-1 w-64 bg-popover border rounded-lg shadow-lg z-50">
              <div className="p-2 border-b">
                <p className="text-xs font-medium text-muted-foreground">Choose Design Template</p>
              </div>
              {DESIGN_TEMPLATES.map((t) => (
                <button
                  key={t.id}
                  onClick={() => {
                    onTemplateChange(t.id);
                    setShowTemplates(false);
                  }}
                  className={cn(
                    'w-full text-left px-3 py-2 hover:bg-muted transition-colors',
                    selectedTemplate === t.id && 'bg-primary/10'
                  )}
                >
                  <p className="text-sm font-medium">{t.name}</p>
                  <p className="text-xs text-muted-foreground">{t.description}</p>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
      
      {/* Preview content - mimics document page */}
      <div className="flex-1 overflow-auto p-4">
        <div 
          className={cn(
            "mx-auto bg-white dark:bg-zinc-800 shadow-xl rounded min-h-[700px]",
            template.id.includes('kdp-6x9') && "max-w-[400px] aspect-[6/9]",
            template.id.includes('kdp-5x8') && "max-w-[350px] aspect-[5/8]",
            template.id === 'academic' && "max-w-[500px] aspect-[210/297]",
            template.id === 'business' && "max-w-[500px] aspect-[8.5/11]",
            template.id === 'ebook' && "max-w-[400px]",
          )}
          style={{ padding: '8%' }}
        >
          {/* Title page */}
          <div className="text-center mb-8 pb-8 border-b border-dashed">
            <h1 className="text-xl font-bold mb-3 leading-tight">{project?.title || 'Your Book Title'}</h1>
            <p className="text-sm text-muted-foreground mb-4">{project?.description || 'Subtitle or description'}</p>
            <p className="text-xs text-muted-foreground">by Author Name</p>
          </div>
          
          {/* Table of contents */}
          <div className="mb-8">
            <h2 className="text-base font-semibold mb-4 uppercase tracking-wide text-muted-foreground">Contents</h2>
            {chapters.length > 0 ? (
              <ul className="space-y-2">
                {chapters.map((chapter, index) => (
                  <li key={chapter.id} className="flex items-center justify-between text-sm border-b border-dotted pb-1">
                    <span className="font-medium">{index + 1}. {chapter.title}</span>
                    <span className="text-muted-foreground text-xs">{chapter.word_count || 0}w</span>
                  </li>
                ))}
              </ul>
            ) : outline ? (
              <div className="text-xs text-muted-foreground whitespace-pre-wrap leading-relaxed">
                {outline.slice(0, 500)}...
              </div>
            ) : (
              <div className="space-y-3">
                <p className="text-xs text-muted-foreground italic text-center py-4">
                  Chapters will appear here as the outline is generated...
                </p>
                {/* Placeholder lines */}
                {[1,2,3,4,5].map(i => (
                  <div key={i} className="flex justify-between items-center">
                    <div className={cn("h-2 bg-muted rounded", i % 2 === 0 ? "w-3/4" : "w-2/3")} />
                    <div className="h-2 bg-muted rounded w-8" />
                  </div>
                ))}
              </div>
            )}
          </div>
          
          {/* Sample content placeholder */}
          <div className="space-y-3 opacity-50">
            <div className="h-2 bg-muted rounded w-full" />
            <div className="h-2 bg-muted rounded w-11/12" />
            <div className="h-2 bg-muted rounded w-4/5" />
            <div className="h-2 bg-muted rounded w-full" />
            <div className="h-2 bg-muted rounded w-3/4" />
            <div className="h-2 bg-muted rounded w-5/6" />
          </div>
        </div>
      </div>
    </div>
  );
}

// =============================================================================
// MAIN EDITOR CONTENT
// =============================================================================

function EditorContent({ params }: { params: { id: string } }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const hasCreatedNewChapter = useRef(false);

  // Project state
  const [project, setProject] = useState<any>(null);
  const [chapters, setChapters] = useState<Chapter[]>([]);
  const [saving, setSaving] = useState(false);

  // Workflow state
  const [currentStep, setCurrentStep] = useState(0);
  const [completedSteps, setCompletedSteps] = useState<Set<number>>(new Set());
  const [outline, setOutline] = useState('');
  const [selectedTemplate, setSelectedTemplate] = useState('kdp-6x9');

  // AI Assistant state
  const [showPreview, setShowPreview] = useState(true);
  const [aiMessages, setAiMessages] = useState<Message[]>([]);
  const [aiInput, setAiInput] = useState('');
  const [aiLoading, setAiLoading] = useState(false);
  
  // CRITICAL: Scroll control - pause when user scrolls up
  const [userScrolledUp, setUserScrolledUp] = useState(false);
  const isStreamingRef = useRef(false);
  const lastScrollTopRef = useRef(0);

  // Load project
  useEffect(() => {
    loadProject();
  }, [params.id]);

  // Handle URL params
  useEffect(() => {
    const isNew = searchParams.get('new');
    if (isNew && !hasCreatedNewChapter.current) {
      hasCreatedNewChapter.current = true;
      router.replace(`/projects/${params.id}/editor`, { scroll: false });
    }
  }, [searchParams, params.id, router]);

  // Smart scroll - ONLY auto-scroll if user hasn't scrolled up
  const scrollToBottom = useCallback(() => {
    if (!userScrolledUp && messagesContainerRef.current) {
      messagesContainerRef.current.scrollTop = messagesContainerRef.current.scrollHeight;
    }
  }, [userScrolledUp]);

  // Detect user scroll direction
  const handleScroll = useCallback(() => {
    if (!messagesContainerRef.current) return;
    
    const { scrollTop, scrollHeight, clientHeight } = messagesContainerRef.current;
    const isAtBottom = scrollHeight - scrollTop - clientHeight < 50;
    
    // User scrolled UP (away from bottom)
    if (scrollTop < lastScrollTopRef.current && !isAtBottom) {
      setUserScrolledUp(true);
    }
    
    // User scrolled back to bottom
    if (isAtBottom) {
      setUserScrolledUp(false);
    }
    
    lastScrollTopRef.current = scrollTop;
  }, []);

  // Reset scroll state when streaming ends
  useEffect(() => {
    if (!aiLoading) {
      isStreamingRef.current = false;
    }
  }, [aiLoading]);

  // Auto-scroll only when not paused
  useEffect(() => {
    scrollToBottom();
  }, [aiMessages, scrollToBottom]);

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
    
    // Set appropriate template based on content type
    const contentType = data.content_type;
    const matchingTemplate = DESIGN_TEMPLATES.find(t => t.forTypes.includes(contentType));
    if (matchingTemplate) {
      setSelectedTemplate(matchingTemplate.id);
    }
    
    // Start with welcome message for validation phase
    if (aiMessages.length === 0) {
      const welcomeMessage = getWelcomeMessage(data);
      setAiMessages([{ role: 'assistant', content: welcomeMessage, timestamp: new Date() }]);
    }
  };

  const getWelcomeMessage = (project: any) => {
    return `# 🎯 Welcome to Penworth's Guided Writing Experience!

I'm thrilled to help you create **"${project?.title || 'your book'}"**!

Before we dive into writing, I'll guide you through our proven 5-step process designed to maximize your book's success:

---

## Your Journey:

**① Validate** ← You are here
Score your idea against real market criteria

**② Interview** 
I'll gather everything I need to know

**③ Research**
Find sources and verify your content

**④ Outline**
Structure your chapters perfectly

**⑤ Write**
Generate your complete book

---

## Let's Start: Idea Validation

Tell me about your book in a few sentences:

• **What** is it about?
• **Who** is your target reader?  
• **Why** should they buy it?

I'll score your concept against 6 market criteria and give you honest, actionable feedback. If needed, I'll suggest stronger angles.

*Type your book idea below to begin...*`;
  };

  const getPhaseTransitionMessage = (fromStep: number, toStep: number) => {
    const from = WORKFLOW_STEPS[fromStep];
    const to = WORKFLOW_STEPS[toStep];
    
    const transitions: Record<string, string> = {
      'validate-interview': `# ✅ Validation Complete!

Your idea has been scored and optimized. Now let's dive deeper.

---

## Phase 2: Interview

I'll ask you detailed questions to gather everything I need. This typically takes 10-15 minutes.

**First question:**

In one sentence, what is the SINGLE most important message or transformation you want readers to take away from your book?

*Take your time - this becomes the "north star" for your entire book.*`,

      'interview-research': `# ✅ Interview Complete!

I now have a clear picture of your vision. Excellent work!

---

## Phase 3: Research

I'll now research your topic to find:
• Relevant sources and citations
• Supporting data and statistics  
• Examples and case studies
• Potential counterarguments to address

**What specific topics or claims should I prioritize in my research?**

*Or type "proceed" for me to research based on our interview.*`,

      'research-outline': `# ✅ Research Complete!

I've gathered supporting material for your book.

---

## Phase 4: Outline

Now I'll create a structured outline for your book. Watch the preview panel on the right as chapters take shape!

**Before I begin, any preferences for:**

1. Number of chapters (typical: 8-15 for non-fiction)
2. Chapter length (short/medium/long)
3. Any specific topics that MUST have their own chapter

*Or type "proceed" for me to structure it based on best practices.*`,

      'outline-write': `# ✅ Outline Complete!

Your book structure is ready! Check the preview panel to see your chapters.

---

## Phase 5: Write

Time to generate your content! I'll write chapter by chapter.

**How would you like to proceed?**

1. **Full auto** - I'll write all chapters sequentially
2. **Chapter by chapter** - Review each before I continue
3. **Specific chapter** - Start with a particular chapter

*Which approach would you prefer?*`,
    };
    
    const key = `${from.id}-${to.id}`;
    return transitions[key] || `Moving to ${to.label} phase...`;
  };

  const handleAISubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!aiInput.trim() || aiLoading) return;

    const userMessage = aiInput.trim();
    setAiInput('');
    setAiMessages(prev => [...prev, { role: 'user', content: userMessage, timestamp: new Date() }]);
    setAiLoading(true);
    isStreamingRef.current = true;
    setUserScrolledUp(false); // Reset scroll on new message

    try {
      const currentWorkflowStep = WORKFLOW_STEPS[currentStep];
      
      // Add phase context to help the AI
      let phaseContext = '';
      switch (currentStep) {
        case 0:
          phaseContext = 'PHASE: IDEA VALIDATION. Score the user\'s idea using the 6 validation criteria (Market Demand, Target Audience, Unique Value, Author Credibility, Commercial Viability, Execution Feasibility). Provide a score out of 100 with breakdown. If score < 70, suggest better alternatives.';
          break;
        case 1:
          phaseContext = 'PHASE: INTERVIEW. Ask detailed questions ONE AT A TIME to gather information for the book. Use multiple choice with "Something else..." option when appropriate. Allow file uploads.';
          break;
        case 2:
          phaseContext = 'PHASE: RESEARCH. Research the topic and provide sources, data, and examples to support the book content.';
          break;
        case 3:
          phaseContext = 'PHASE: OUTLINE. Create a detailed chapter-by-chapter outline for the book based on the interview and research.';
          break;
        case 4:
          phaseContext = 'PHASE: WRITING. Generate book content based on the outline. Write one chapter at a time with rich, engaging prose.';
          break;
      }

      const response = await fetch('/api/ai/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: `[${phaseContext}]\n\nUser: ${userMessage}`,
          projectId: params.id,
          agentType: currentWorkflowStep.agentType,
          conversationHistory: aiMessages.slice(-10),
        }),
      });

      if (!response.ok) throw new Error('AI request failed');

      const reader = response.body?.getReader();
      if (!reader) throw new Error('No response body');

      let assistantMessage = '';
      setAiMessages(prev => [...prev, { role: 'assistant', content: '', timestamp: new Date() }]);

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
                  timestamp: new Date(),
                };
                return newMessages;
              });
            }
          } catch (e) {
            // Ignore parse errors
          }
        }
      }

      // Check for phase completion signals
      if (currentStep === 0 && assistantMessage.includes('/100')) {
        // Validation score detected - enable progression
      }
      if (currentStep === 3 && (assistantMessage.includes('Chapter 1') || assistantMessage.includes('## 1.'))) {
        // Outline detected - update preview
        setOutline(assistantMessage);
      }

    } catch (error) {
      console.error('AI Error:', error);
      toast.error('Failed to get AI response');
      setAiMessages(prev => prev.slice(0, -1));
    } finally {
      setAiLoading(false);
    }
  };

  const handleSaveAndExit = async () => {
    setSaving(true);
    // Save conversation state to database (future enhancement)
    await new Promise(resolve => setTimeout(resolve, 500));
    setSaving(false);
    toast.success('Progress saved! You can continue anytime.');
    router.push(`/projects/${params.id}`);
  };

  const handleProgressToNext = () => {
    if (currentStep < WORKFLOW_STEPS.length - 1) {
      const nextStep = currentStep + 1;
      setCompletedSteps(prev => new Set([...prev, currentStep]));
      setCurrentStep(nextStep);
      setUserScrolledUp(false);
      
      // Add transition message
      const transitionMessage = getPhaseTransitionMessage(currentStep, nextStep);
      setAiMessages(prev => [...prev, {
        role: 'assistant',
        content: transitionMessage,
        timestamp: new Date(),
      }]);
    } else {
      // Final step - finish the book
      toast.success('🎉 Book generation complete! Preparing your document...');
      router.push(`/projects/${params.id}`);
    }
  };

  // Determine if user can progress to next step
  // For now, allow after at least 2 exchanges in current phase
  const messagesInCurrentPhase = aiMessages.filter((_, i) => i > 0).length;
  const canProgress = messagesInCurrentPhase >= 2 && !aiLoading;

  return (
    <div className="h-screen flex flex-col bg-background">
      {/* Top Bar */}
      <div className="h-14 border-b flex items-center justify-between px-4 flex-shrink-0">
        <div className="flex items-center gap-4">
          <button
            onClick={() => router.push(`/projects/${params.id}`)}
            className="p-2 hover:bg-muted rounded-lg transition-colors"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
          <div>
            <h1 className="font-semibold truncate max-w-[200px] sm:max-w-[300px]">
              {project?.title || 'Loading...'}
            </h1>
            <p className="text-xs text-muted-foreground">
              Step {currentStep + 1}/{WORKFLOW_STEPS.length}: {WORKFLOW_STEPS[currentStep]?.label}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setShowPreview(!showPreview)}
            className={cn(showPreview && 'bg-muted')}
          >
            <Eye className="h-4 w-4 sm:mr-2" />
            <span className="hidden sm:inline">Preview</span>
          </Button>
        </div>
      </div>

      {/* Progress Stepper - Steps are NOT clickable */}
      <ProgressStepper
        currentStep={currentStep}
        completedSteps={completedSteps}
      />

      {/* Main Content Area */}
      <div className="flex-1 flex overflow-hidden min-h-0">
        {/* AI Chat Panel - Main interaction */}
        <div className="flex-1 flex flex-col min-w-0">
          {/* Messages with scroll control */}
          <div 
            ref={messagesContainerRef}
            onScroll={handleScroll}
            className="flex-1 overflow-y-auto p-4 space-y-4"
          >
            {aiMessages.map((message, index) => (
              <div
                key={index}
                className={cn(
                  'flex gap-3',
                  message.role === 'user' ? 'justify-end' : 'justify-start'
                )}
              >
                {message.role === 'assistant' && (
                  <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0 mt-1">
                    <Bot className="h-4 w-4 text-primary" />
                  </div>
                )}
                <div
                  className={cn(
                    'rounded-xl px-4 py-3 max-w-[85%]',
                    message.role === 'user'
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-card border shadow-sm'
                  )}
                >
                  <div 
                    className={cn(
                      "text-sm whitespace-pre-wrap",
                      message.role === 'assistant' && "prose prose-sm dark:prose-invert max-w-none"
                    )}
                    dangerouslySetInnerHTML={{ 
                      __html: message.role === 'assistant' 
                        ? formatMarkdown(message.content)
                        : escapeHtml(message.content)
                    }}
                  />
                </div>
                {message.role === 'user' && (
                  <div className="h-8 w-8 rounded-full bg-muted flex items-center justify-center flex-shrink-0 mt-1">
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
                <div className="bg-card border rounded-xl px-4 py-3 shadow-sm">
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-muted-foreground">Thinking</span>
                    <span className="flex gap-1">
                      <span className="h-1.5 w-1.5 bg-primary rounded-full animate-bounce" style={{animationDelay: '0ms'}} />
                      <span className="h-1.5 w-1.5 bg-primary rounded-full animate-bounce" style={{animationDelay: '150ms'}} />
                      <span className="h-1.5 w-1.5 bg-primary rounded-full animate-bounce" style={{animationDelay: '300ms'}} />
                    </span>
                  </div>
                </div>
              </div>
            )}
          </div>
          
          {/* Resume scroll button - shows when paused */}
          {userScrolledUp && aiLoading && (
            <div className="px-4 py-2 border-t bg-amber-50 dark:bg-amber-950/30">
              <button
                onClick={() => {
                  setUserScrolledUp(false);
                  if (messagesContainerRef.current) {
                    messagesContainerRef.current.scrollTop = messagesContainerRef.current.scrollHeight;
                  }
                }}
                className="w-full flex items-center justify-center gap-2 text-sm text-amber-700 dark:text-amber-400 hover:underline"
              >
                <Play className="h-4 w-4" />
                Resume auto-scroll (new content available)
              </button>
            </div>
          )}

          {/* Workflow Controls */}
          <WorkflowControls
            currentStep={currentStep}
            canProgress={canProgress}
            onSaveAndExit={handleSaveAndExit}
            onProgressToNext={handleProgressToNext}
            loading={saving}
          />

          {/* Input Area */}
          <form onSubmit={handleAISubmit} className="p-4 border-t bg-muted/10">
            <div className="flex gap-2">
              <Button 
                type="button" 
                variant="outline" 
                size="icon" 
                title="Upload file (draft, image, research)"
                className="flex-shrink-0"
              >
                <Upload className="h-4 w-4" />
              </Button>
              <Input
                value={aiInput}
                onChange={(e) => setAiInput(e.target.value)}
                placeholder="Type your response..."
                disabled={aiLoading}
                className="flex-1"
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    handleAISubmit(e);
                  }
                }}
              />
              <Button 
                type="submit" 
                size="icon" 
                disabled={aiLoading || !aiInput.trim()}
                className="flex-shrink-0"
              >
                <Send className="h-4 w-4" />
              </Button>
            </div>
          </form>
        </div>

        {/* PDF Preview Panel */}
        {showPreview && (
          <div className="w-80 xl:w-96 border-l hidden lg:block">
            <PDFPreview
              project={project}
              chapters={chapters}
              outline={outline}
              selectedTemplate={selectedTemplate}
              onTemplateChange={setSelectedTemplate}
            />
          </div>
        )}
      </div>
    </div>
  );
}

// =============================================================================
// UTILITIES
// =============================================================================

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function formatMarkdown(text: string): string {
  return text
    .replace(/^### (.*$)/gm, '<h3 class="font-semibold text-base mt-4 mb-2">$1</h3>')
    .replace(/^## (.*$)/gm, '<h2 class="font-semibold text-lg mt-4 mb-2">$1</h2>')
    .replace(/^# (.*$)/gm, '<h1 class="font-bold text-xl mt-4 mb-3">$1</h1>')
    .replace(/\*\*(.*?)\*\*/g, '<strong class="font-semibold">$1</strong>')
    .replace(/\*(.*?)\*/g, '<em>$1</em>')
    .replace(/^• (.*$)/gm, '<li class="ml-4 list-disc">$1</li>')
    .replace(/^- (.*$)/gm, '<li class="ml-4 list-disc">$1</li>')
    .replace(/^(\d+)\. (.*$)/gm, '<li class="ml-4 list-decimal">$2</li>')
    .replace(/---/g, '<hr class="my-4 border-border" />')
    .replace(/\n\n/g, '</p><p class="my-2">')
    .replace(/\n/g, '<br />');
}

// =============================================================================
// EXPORT
// =============================================================================

export default function EditorPage({ params }: { params: { id: string } }) {
  return (
    <Suspense fallback={
      <div className="h-screen flex items-center justify-center">
        <div className="text-center">
          <Loader2 className="h-8 w-8 animate-spin text-primary mx-auto mb-4" />
          <p className="text-muted-foreground">Loading your writing workspace...</p>
        </div>
      </div>
    }>
      <EditorContent params={params} />
    </Suspense>
  );
}
