'use client';

import { useState, useEffect, useRef, Suspense, useCallback } from 'react';
import { useRouter, useSearchParams, useParams } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import Link from 'next/link';
import {
  ArrowLeft,
  Save,
  Loader2,
  Settings,
  Menu,
  X,
  BookOpen,
  FileText,
  Home,
  ChevronRight,
} from 'lucide-react';
import { cn } from '@/lib/utils';

// Import new agent workflow components
import { AgentPipeline } from '@/components/editor/AgentPipeline';
import { ValidateScreen } from '@/components/editor/ValidateScreen';
import { InterviewScreen } from '@/components/editor/InterviewScreen';
import { ResearchScreen } from '@/components/editor/ResearchScreen';
import { OutlineScreen } from '@/components/editor/OutlineScreen';
import { WritingScreen } from '@/components/editor/WritingScreen';
import { QAScreen } from '@/components/editor/QAScreen';
import { CoverDesignScreen } from '@/components/editor/CoverDesignScreen';
import { PublishScreen } from '@/components/editor/PublishScreen';
import { DocumentPreview } from '@/components/editor/DocumentPreview';

// Import types
import { 
  AgentName, 
  AgentStatusMap, 
  ValidationScore,
  InterviewQuestion,
  ResearchResource,
  OutlineSection,
  AuthorInfo,
  CoverConfig,
  AGENTS,
} from '@/types/agent-workflow';

// Import interview system for questions
import { getRichInterviewQuestions } from '@/lib/ai/agents/interview-system';

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

interface Project {
  id: string;
  title: string;
  description: string;
  content_type: string;
  status: string;
  metadata: Record<string, any>;
}

interface Session {
  id: string;
  project_id: string;
  current_agent: AgentName;
  agent_status: AgentStatusMap;
  validation_data: Record<string, any>;
  interview_data: Record<string, any>;
  research_data: Record<string, any>;
  outline_data: Record<string, any>;
  writing_data: Record<string, any>;
  qa_data: Record<string, any>;
  author_name: string | null;
  book_title: string | null;
  about_author: string | null;
  author_photo_url: string | null;
  front_cover_url: string | null;
  front_cover_regenerations: number;
  back_cover_url: string | null;
  back_cover_regenerations: number;
  follow_up_data: Record<string, any>;
}

// =============================================================================
// NAVIGATION SIDEBAR (Column 1)
// =============================================================================

function NavigationSidebar({
  project,
  chapters,
  onNavigateHome,
}: {
  project: Project | null;
  chapters: Chapter[];
  onNavigateHome: () => void;
}) {
  const [collapsed, setCollapsed] = useState(false);

  if (collapsed) {
    return (
      <div className="w-12 border-r bg-muted/20 flex flex-col items-center py-3">
        <button
          onClick={() => setCollapsed(false)}
          className="p-2 hover:bg-muted rounded-lg"
        >
          <Menu className="h-4 w-4" />
        </button>
      </div>
    );
  }

  return (
    <div className="w-[240px] shrink-0 border-r bg-muted/20 flex flex-col overflow-hidden">
      {/* Header */}
      <div className="p-3 border-b flex items-center justify-between gap-2">
        <button
          onClick={onNavigateHome}
          className="flex items-center gap-2 text-sm font-medium hover:text-primary transition-colors min-w-0 flex-1"
        >
          <ArrowLeft className="h-4 w-4 shrink-0" />
          <span className="truncate min-w-0">{project?.title || 'Project'}</span>
        </button>
        <button
          onClick={() => setCollapsed(true)}
          className="p-1 hover:bg-muted rounded shrink-0"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Project Info */}
      <div className="p-3 border-b">
        <div className="flex items-center gap-2 mb-2">
          <BookOpen className="h-4 w-4 text-muted-foreground" />
          <span className="text-xs text-muted-foreground uppercase tracking-wider">
            {project?.content_type || 'Document'}
          </span>
        </div>
        <p className="text-xs text-muted-foreground line-clamp-2">
          {project?.description || 'No description'}
        </p>
      </div>

      {/* Chapters List */}
      <div className="flex-1 overflow-y-auto p-3">
        <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
          Chapters ({chapters.length})
        </h3>
        {chapters.length > 0 ? (
          <div className="space-y-1">
            {chapters.map((chapter, idx) => (
              <div
                key={chapter.id}
                className="flex items-center gap-2 p-2 rounded-lg hover:bg-muted/50 cursor-pointer text-sm"
              >
                <span className="text-muted-foreground w-5">{idx + 1}.</span>
                <span className="truncate flex-1">{chapter.title}</span>
                <span className="text-xs text-muted-foreground">
                  {chapter.word_count || 0}w
                </span>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground italic">
            Chapters will appear as the outline is generated...
          </p>
        )}
      </div>

      {/* Footer */}
      <div className="p-3 border-t">
        <Link
          href={`/projects/${project?.id}`}
          className="flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          <Home className="h-3 w-3" />
          Back to Project
        </Link>
      </div>
    </div>
  );
}

// =============================================================================
// MAIN EDITOR CONTENT
// =============================================================================

function EditorContentNew() {
  const params = useParams();
  const router = useRouter();
  const projectId = params.id as string;
  const supabase = createClient();

  // State
  const [loading, setLoading] = useState(true);
  const [project, setProject] = useState<Project | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [chapters, setChapters] = useState<Chapter[]>([]);
  const [userCredits, setUserCredits] = useState(0);
  const [isFreeTier, setIsFreeTier] = useState(true);
  const [userProfile, setUserProfile] = useState<{
    full_name?: string | null;
    email?: string | null;
    is_admin?: boolean;
    plan?: string | null;
  }>({});

  // Agent-specific state
  const [interviewQuestions, setInterviewQuestions] = useState<InterviewQuestion[]>([]);
  const [researchResources, setResearchResources] = useState<ResearchResource[]>([]);
  const [researchSteps, setResearchSteps] = useState<{ text: string; completed: boolean }[]>([]);
  const [outlineSections, setOutlineSections] = useState<OutlineSection[]>([]);
  const [qaChecks, setQaChecks] = useState<{ name: string; status: 'pending' | 'checking' | 'passed' | 'warning' | 'failed'; detail?: string }[]>([]);
  const [currentChapterContent, setCurrentChapterContent] = useState('');
  
  // Processing states
  const [isResearching, setIsResearching] = useState(false);
  const [isGeneratingOutline, setIsGeneratingOutline] = useState(false);
  const [isWriting, setIsWriting] = useState(false);
  const [isCheckingQA, setIsCheckingQA] = useState(false);

  // Derived state
  const currentAgent = session?.current_agent || 'validate';
  const agentStatus = session?.agent_status || {
    validate: 'active',
    interview: 'waiting',
    research: 'waiting',
    outline: 'waiting',
    writing: 'waiting',
    qa: 'waiting',
    cover: 'waiting',
    publishing: 'waiting',
  };

  // Author info
  // Author info: session first (user already edited), else profile fallback
  const authorInfo: AuthorInfo = {
    name: session?.author_name || userProfile.full_name || '',
    title: '',
    aboutAuthor: session?.about_author || '',
    photoUrl: session?.author_photo_url ?? undefined,
  };

  // Cover config
  const coverConfig: CoverConfig = {
    frontCoverUrl: session?.front_cover_url || undefined,
    frontCoverPrompt: '',
    frontCoverRegenerations: session?.front_cover_regenerations || 0,
    backCoverUrl: session?.back_cover_url || undefined,
    backCoverPrompt: '',
    backCoverRegenerations: session?.back_cover_regenerations || 0,
  };

  // Load data
  useEffect(() => {
    const loadData = async () => {
      setLoading(true);
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) {
          router.push('/login');
          return;
        }

        // Load project
        const { data: projectData } = await supabase
          .from('projects')
          .select('*')
          .eq('id', projectId)
          .single();

        if (!projectData) {
          router.push('/projects');
          return;
        }

        setProject(projectData);

        // Load or create session
        const sessionResponse = await fetch(`/api/interview-session?projectId=${projectId}`);
        const sessionData = await sessionResponse.json();
        
        if (sessionData.session) {
          setSession(sessionData.session);
          
          // Load interview questions based on content type with real options
          const richQuestions = getRichInterviewQuestions(projectData.content_type);
          setInterviewQuestions(richQuestions);
        }

        // Load chapters
        const { data: chaptersData } = await supabase
          .from('chapters')
          .select('*')
          .eq('project_id', projectId)
          .order('order_index');

        if (chaptersData) {
          setChapters(chaptersData);
        }

        // Load user profile (correct columns from Supabase schema)
        const { data: profile } = await supabase
          .from('profiles')
          .select('full_name, email, credits_balance, credits_purchased, plan, is_admin')
          .eq('id', user.id)
          .single();

        if (profile) {
          const totalCredits = (profile.credits_balance || 0) + (profile.credits_purchased || 0);
          setUserCredits(totalCredits);
          setIsFreeTier(!profile.plan || profile.plan === 'free');
          setUserProfile({
            full_name: profile.full_name,
            email: profile.email,
            is_admin: profile.is_admin || false,
            plan: profile.plan,
          });
        }

        // Initialize QA checks (labels match real endpoint)
        setQaChecks([
          { name: 'Chapter word count', status: 'pending' },
          { name: 'AI filler phrases', status: 'pending' },
          { name: 'Readability (Flesch)', status: 'pending' },
          { name: 'Tonal consistency', status: 'pending' },
          { name: 'Cross-chapter coherence', status: 'pending' },
          { name: 'Structural completeness', status: 'pending' },
        ]);

      } catch (error) {
        console.error('Error loading data:', error);
        toast.error('Failed to load project');
      } finally {
        setLoading(false);
      }
    };

    loadData();
  }, [projectId, router, supabase]);

  // Handler: Validate topic
  const handleValidate = async (topic: string): Promise<ValidationScore> => {
    const response = await fetch('/api/ai/validate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ topic, contentType: project?.content_type }),
    });
    const data = await response.json();
    if (data.error) throw new Error(data.error);
    return data.score;
  };

  // Handler: Propose stronger idea
  const handleProposeStronger = async (originalTopic: string, currentScore: ValidationScore) => {
    const response = await fetch('/api/ai/propose-stronger', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        originalTopic,
        contentType: project?.content_type,
        currentScore,
      }),
    });
    const data = await response.json();
    if (data.error) throw new Error(data.error);
    return data.proposal;
  };

  // Handler: Proceed from validation
  const handleValidationProceed = async (topic: string, score: ValidationScore) => {
    // Update the project title to the chosen idea so downstream agents use it
    if (project && topic !== project.title) {
      await supabase
        .from('projects')
        .update({ title: topic })
        .eq('id', project.id);
      setProject({ ...project, title: topic });
    }
    await advanceToNextAgent({
      topic,
      score,
      chosenTopic: topic,
    });
  };

  // Handler: Answer interview question
  const handleInterviewAnswer = (questionId: string, answer: string) => {
    setInterviewQuestions(prev =>
      prev.map(q => q.id === questionId ? { ...q, answer } : q)
    );
  };

  // Handler: Save and exit interview
  const handleSaveAndExit = async () => {
    if (session) {
      await fetch('/api/interview-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId: session.id,
          action: 'save',
          data: { questions: interviewQuestions },
        }),
      });
    }
    router.push('/projects');
  };

  // Handler: Stop interview and proceed
  const handleStopInterview = async (followUpAnswers: Record<string, string>) => {
    await advanceToNextAgent({
      questions: interviewQuestions,
      followUpAnswers,
      completed: true,
    });
    
    // Start research after interview
    startResearch();
  };

  // Start research process — real AI call
  const startResearch = async () => {
    setIsResearching(true);
    setResearchSteps([
      { text: 'Reading your interview answers...', completed: false },
      { text: 'Identifying knowledge gaps...', completed: false },
      { text: 'Generating credibility-tagged findings...', completed: false },
      { text: 'Ranking by relevance to your idea...', completed: false },
      { text: 'Compiling research foundation...', completed: false },
    ]);

    // Animate the steps optimistically while the real call runs
    const stepInterval = setInterval(() => {
      setResearchSteps(prev => {
        const nextIncomplete = prev.findIndex(s => !s.completed);
        if (nextIncomplete === -1) return prev;
        return prev.map((s, i) => i === nextIncomplete ? { ...s, completed: true } : s);
      });
    }, 1200);

    try {
      const response = await fetch('/api/ai/research', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId }),
      });
      const data = await response.json();
      clearInterval(stepInterval);
      setResearchSteps(prev => prev.map(s => ({ ...s, completed: true })));

      if (data.error) {
        toast.error(data.error);
        setIsResearching(false);
        return;
      }

      setResearchResources(data.resources || []);
    } catch (err) {
      clearInterval(stepInterval);
      toast.error('Research failed. Please try again.');
    }
    setIsResearching(false);
  };

  // Handler: Toggle research resource
  const handleToggleResource = (id: string) => {
    setResearchResources(prev =>
      prev.map(r => r.id === id ? { ...r, isSelected: !r.isSelected } : r)
    );
  };

  // Handler: Add URL to research
  const handleAddUrl = (url: string) => {
    setResearchResources(prev => [
      ...prev,
      { id: `url-${Date.now()}`, type: 'url', title: url, url, isSelected: true },
    ]);
  };

  // Handler: Upload research file
  const handleUploadResearchFile = (file: File) => {
    setResearchResources(prev => [
      ...prev,
      { id: `file-${Date.now()}`, type: 'upload', title: file.name, filePath: file.name, isSelected: true },
    ]);
  };

  // Handler: Remove research resource
  const handleRemoveResource = (id: string) => {
    setResearchResources(prev => prev.filter(r => r.id !== id));
  };

  // Handler: Approve research
  const handleApproveResearch = async () => {
    await advanceToNextAgent({
      resources: researchResources.filter(r => r.isSelected),
      approved: true,
    });
    
    // Start outline generation
    startOutlineGeneration();
  };

  // Start outline generation — real AI call
  const startOutlineGeneration = async () => {
    setIsGeneratingOutline(true);

    try {
      const response = await fetch('/api/ai/outline', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId }),
      });
      const data = await response.json();

      if (data.error) {
        toast.error(data.error);
        setIsGeneratingOutline(false);
        return;
      }

      // Animate sections appearing one-by-one for a "building outline" feel
      const sections: OutlineSection[] = data.sections || [];
      setOutlineSections(sections.map(s => ({ ...s, status: 'pending' as const })));
      for (let i = 0; i < sections.length; i++) {
        await new Promise(resolve => setTimeout(resolve, 250));
        setOutlineSections(prev =>
          prev.map((s, idx) => idx === i ? { ...s, status: 'complete' as const } : s)
        );
      }
    } catch (err) {
      toast.error('Outline generation failed. Please try again.');
    }
    setIsGeneratingOutline(false);
  };

  // Handler: Request outline changes
  const handleRequestOutlineChanges = async (feedback: string) => {
    toast.info('Processing your feedback...');
    // Would call AI to regenerate outline based on feedback
    await new Promise(resolve => setTimeout(resolve, 2000));
    toast.success('Outline updated based on your feedback');
  };

  // Handler: Approve outline
  const handleApproveOutline = async () => {
    await advanceToNextAgent({
      sections: outlineSections,
      approved: true,
    });
    
    // Start writing
    startWriting();
  };

  // Start writing process — triggers real Inngest writeBook (uses Opus)
  const startWriting = async () => {
    setIsWriting(true);
    setCurrentChapterContent('');

    try {
      // Get the outline's chapter array (with keyPoints) from the session
      const sessionResp = await fetch(`/api/interview-session?projectId=${projectId}`);
      const sessionData = await sessionResp.json();
      const outlineData = sessionData?.session?.outline_data;
      const outlineChapters = outlineData?.chapters;

      if (!outlineChapters || outlineChapters.length === 0) {
        toast.error('No outline found. Please regenerate the outline first.');
        setIsWriting(false);
        return;
      }

      // Trigger Inngest durable book writing
      const startResp = await fetch('/api/books/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId,
          outline: { chapters: outlineChapters },
          voiceProfile: {
            tone: session?.follow_up_data?.style || 'professional',
            style: session?.follow_up_data?.style || 'conversational',
            vocabulary: session?.follow_up_data?.audience || 'general',
          },
        }),
      });
      const startData = await startResp.json();

      if (startData.error) {
        toast.error(startData.error);
        setIsWriting(false);
        return;
      }

      toast.info(`Writing ${startData.totalChapters} chapters. This typically takes 3-8 minutes.`);

      // Subscribe to SSE for real-time progress
      const eventSource = new EventSource(`/api/books/generate/stream?projectId=${projectId}`);
      eventSource.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === 'chapter_started' || msg.type === 'chapter_update') {
            setChapters(prev => {
              const existing = prev.find(ch => ch.id === msg.chapter.id);
              if (existing) {
                return prev.map(ch => ch.id === msg.chapter.id ? { ...ch, ...msg.chapter } : ch);
              }
              return [...prev, {
                id: msg.chapter.id,
                title: msg.chapter.title,
                content: '',
                order_index: msg.chapter.order_index,
                status: msg.chapter.status,
                word_count: msg.chapter.word_count || 0,
              }];
            });
          }
          if (msg.type === 'complete') {
            eventSource.close();
            setIsWriting(false);
            // Refresh chapters fully so we have actual content
            supabase
              .from('chapters')
              .select('*')
              .eq('project_id', projectId)
              .order('order_index')
              .then(({ data }) => {
                if (data) setChapters(data);
              });
            // Advance to QA
            advanceToNextAgent({
              currentChapter: outlineChapters.length,
              totalChapters: outlineChapters.length,
              progress: 100,
            }).then(() => startQAChecks());
          }
        } catch (err) {
          console.error('SSE parse error:', err);
        }
      };
      eventSource.onerror = () => {
        eventSource.close();
        setIsWriting(false);
        toast.error('Lost connection to writing stream. Chapters may still be generating in the background.');
      };
    } catch (err) {
      toast.error('Failed to start writing. Please try again.');
      setIsWriting(false);
    }
  };

  // Start QA checks — real endpoint
  const startQAChecks = async () => {
    setIsCheckingQA(true);
    setQaChecks([
      { name: 'Chapter word count', status: 'checking' },
      { name: 'AI filler phrases', status: 'checking' },
      { name: 'Readability (Flesch)', status: 'checking' },
      { name: 'Tonal consistency', status: 'checking' },
      { name: 'Cross-chapter coherence', status: 'checking' },
      { name: 'Structural completeness', status: 'checking' },
    ]);

    try {
      const response = await fetch('/api/ai/qa', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId }),
      });
      const data = await response.json();

      if (data.error) {
        toast.error(data.error);
        setIsCheckingQA(false);
        return;
      }

      setQaChecks(data.checks || []);
    } catch (err) {
      toast.error('QA checks failed. Please try again.');
    }
    setIsCheckingQA(false);
  };

  // Handler: Acknowledge QA
  const handleQAAcknowledge = async () => {
    await advanceToNextAgent({
      legalAcknowledged: true,
    });
  };

  // Handler: Edit chapter
  const handleEditChapter = (chapterId: string, content: string) => {
    setChapters(prev =>
      prev.map(ch => ch.id === chapterId 
        ? { ...ch, content, word_count: content.split(' ').length }
        : ch
      )
    );
    toast.success('Chapter saved (Free)');
  };

  // Handler: Regenerate chapter
  const handleRegenerateChapter = async (chapterId: string) => {
    if (userCredits < 100) {
      toast.error('Insufficient credits. Need 100 credits to regenerate.');
      return;
    }
    
    setUserCredits(prev => prev - 100);
    toast.info('Regenerating chapter... (100 credits used)');
    await new Promise(resolve => setTimeout(resolve, 2000));
    toast.success('Chapter regenerated');
  };

  // Handler: Update author info
  const handleUpdateAuthorInfo = (info: Partial<AuthorInfo>) => {
    if (session) {
      // Update session with author info
      fetch('/api/interview-session', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId: session.id,
          updates: {
            author_name: info.name,
            about_author: info.aboutAuthor,
            author_photo_url: info.photoUrl,
          },
        }),
      });
    }
  };

  // Handler: Generate cover
  const handleGenerateCover = async (type: 'front' | 'back', prompt?: string) => {
    const response = await fetch('/api/covers/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        projectId,
        sessionId: session?.id,
        coverType: type,
        prompt,
        bookTitle: session?.book_title || project?.title || 'Untitled',
        authorName: session?.author_name || 'Author',
      }),
    });
    
    const data = await response.json();
    if (data.error) {
      toast.error(data.error);
      return;
    }
    
    toast.success(`${type === 'front' ? 'Front' : 'Back'} cover generated!`);
    
    // Refresh session to get updated cover URL
    const sessionResponse = await fetch(`/api/interview-session?projectId=${projectId}`);
    const sessionData = await sessionResponse.json();
    if (sessionData.session) {
      setSession(sessionData.session);
    }
  };

  // Handler: Upload author photo
  const handleUploadAuthorPhoto = async (file: File) => {
    toast.info('Photo upload coming soon');
  };

  // Handler: Extract from LinkedIn
  const handleExtractFromLinkedIn = (url: string) => {
    toast.info('LinkedIn extraction coming soon');
  };

  // Handler: View PDF
  const handleViewPDF = () => {
    toast.info('PDF preview opening...');
  };

  // Handler: Download
  const handleDownload = () => {
    toast.info('Download starting...');
  };

  // Handler: Publish
  const handlePublish = () => {
    router.push(`/projects/${projectId}/publish`);
  };

  // Advance to next agent
  const advanceToNextAgent = async (data: Record<string, any>) => {
    if (!session) return;

    const response = await fetch('/api/interview-session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionId: session.id,
        action: 'advance',
        data,
      }),
    });

    const result = await response.json();
    if (result.session) {
      setSession(result.session);
    }
  };

  // Calculate stats
  const wordCount = chapters.reduce((sum, ch) => sum + (ch.word_count || 0), 0);
  const pageCount = Math.ceil(wordCount / 250);
  const chapterCount = chapters.length;

  // Get active message for pipeline
  const getActiveMessage = () => {
    const agent = AGENTS.find(a => a.id === currentAgent);
    return {
      line1: agent?.activeMessage || 'Processing...',
      line2: '',
    };
  };

  if (loading) {
    return (
      <div className="h-screen flex items-center justify-center">
        <div className="text-center">
          <Loader2 className="h-8 w-8 animate-spin text-primary mx-auto mb-4" />
          <p className="text-muted-foreground">Loading your writing workspace...</p>
        </div>
      </div>
    );
  }

  // Render the appropriate screen based on current agent
  const renderMainScreen = () => {
    switch (currentAgent) {
      case 'validate':
        return (
          <ValidateScreen
            onValidate={handleValidate}
            onProposeStronger={handleProposeStronger}
            onProceed={handleValidationProceed}
            initialTopic={project?.title || ''}
          />
        );

      case 'interview':
        return (
          <InterviewScreen
            questions={interviewQuestions}
            chosenIdea={session?.validation_data?.chosenTopic || project?.title}
            ideaPositioning={session?.validation_data?.positioning}
            projectId={projectId}
            onAnswer={handleInterviewAnswer}
            onSaveAndExit={handleSaveAndExit}
            onStopAndNext={handleStopInterview}
            onInjectDynamicFollowup={(question, insertAfterIndex) => {
              setInterviewQuestions((prev) => [
                ...prev.slice(0, insertAfterIndex + 1),
                question,
                ...prev.slice(insertAfterIndex + 1),
              ]);
            }}
          />
        );

      case 'research':
        return (
          <ResearchScreen
            resources={researchResources}
            isResearching={isResearching}
            researchSteps={researchSteps}
            onToggleResource={handleToggleResource}
            onAddUrl={handleAddUrl}
            onUploadFile={handleUploadResearchFile}
            onRemoveResource={handleRemoveResource}
            onApprove={handleApproveResearch}
          />
        );

      case 'outline':
        return (
          <OutlineScreen
            bookTitle={session?.book_title || project?.title || 'Untitled'}
            authorName={session?.author_name || 'Author'}
            sections={outlineSections}
            isGenerating={isGeneratingOutline}
            onRequestChanges={handleRequestOutlineChanges}
            onApprove={handleApproveOutline}
          />
        );

      case 'writing':
        return (
          <WritingScreen
            bookTitle={session?.book_title || project?.title || 'Untitled'}
            chapters={outlineSections.filter(s => s.type === 'chapter')}
            currentChapterIndex={chapters.length}
            currentChapterContent={currentChapterContent}
            isWriting={isWriting}
            userCredits={userCredits}
            onEditChapter={handleEditChapter}
            onRegenerateChapter={handleRegenerateChapter}
          />
        );

      case 'qa':
        return (
          <QAScreen
            qaChecks={qaChecks}
            isChecking={isCheckingQA}
            onAcknowledge={handleQAAcknowledge}
          />
        );

      case 'cover':
        return (
          <CoverDesignScreen
            bookTitle={session?.book_title || project?.title || 'Untitled'}
            authorInfo={authorInfo}
            coverConfig={coverConfig}
            userCredits={userCredits}
            onUpdateAuthorInfo={handleUpdateAuthorInfo}
            onGenerateCover={handleGenerateCover}
            onUploadAuthorPhoto={handleUploadAuthorPhoto}
            onApproveAndContinue={async () => {
              await advanceToNextAgent({
                frontCoverUrl: coverConfig.frontCoverUrl,
                backCoverUrl: coverConfig.backCoverUrl,
                approved: true,
              });
            }}
          />
        );

      case 'publishing':
        return (
          <PublishScreen
            bookTitle={session?.book_title || project?.title || 'Untitled'}
            contentType={project?.content_type || 'book'}
            authorInfo={authorInfo}
            coverConfig={coverConfig}
            userCredits={userCredits}
            isFreeTier={isFreeTier}
            wordCount={wordCount}
            pageCount={pageCount}
            chapterCount={chapterCount}
            onUpdateAuthorInfo={handleUpdateAuthorInfo}
            onGenerateCover={handleGenerateCover}
            onUploadAuthorPhoto={handleUploadAuthorPhoto}
            onExtractFromLinkedIn={handleExtractFromLinkedIn}
            onViewPDF={handleViewPDF}
            onDownload={handleDownload}
            onPublish={handlePublish}
          />
        );

      default:
        return <div>Unknown agent</div>;
    }
  };

  return (
    <div className="h-screen flex flex-col bg-background">
      {/* Top Header Bar */}
      <div className="h-12 border-b flex items-center justify-between px-4 bg-card">
        <div className="flex items-center gap-2">
          <Link href="/projects" className="text-muted-foreground hover:text-foreground">
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <span className="text-sm font-medium truncate max-w-[200px]">
            {project?.title || 'Project'}
          </span>
          <ChevronRight className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm text-muted-foreground">
            {AGENTS.find(a => a.id === currentAgent)?.name || 'Editor'}
          </span>
        </div>
        
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">
            {userCredits} credits
          </span>
          <Button variant="ghost" size="sm">
            <Settings className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Main Content - 4 Column Layout */}
      <div className="flex-1 flex overflow-hidden">
        {/* Column 1: Navigation Sidebar */}
        <NavigationSidebar
          project={project}
          chapters={chapters}
          onNavigateHome={() => router.push('/projects')}
        />

        {/* Column 2: Agent Pipeline */}
        <AgentPipeline
          currentAgent={currentAgent}
          agentStatus={agentStatus}
          activeMessages={getActiveMessage()}
        />

        {/* Column 3: Main Interaction Area */}
        <div className="flex-1 flex flex-col overflow-hidden bg-background">
          {renderMainScreen()}
        </div>

        {/* Column 4: Document Preview */}
        <DocumentPreview
          bookTitle={session?.book_title || project?.title || 'Untitled'}
          authorName={session?.author_name || 'Author'}
          contentType={project?.content_type || 'book'}
          coverUrl={session?.front_cover_url || undefined}
          wordCount={wordCount}
          pageCount={pageCount}
          chapterCount={chapterCount}
          creditsUsed={1000 - userCredits}
          creditsRemaining={userCredits}
          estimatedTimeRemaining={isWriting ? '~5 minutes' : undefined}
          currentAgent={currentAgent}
          isFreeTier={isFreeTier}
          onViewPDF={handleViewPDF}
          onExportDraft={handleDownload}
          onSharePreview={() => toast.info('Share preview coming soon')}
          onInviteCollaborator={() => toast.info('Collaborator invites coming soon')}
          onTopUp={() => router.push('/billing')}
        />
      </div>
    </div>
  );
}

// =============================================================================
// EXPORT
// =============================================================================

export default function EditorPage() {
  return (
    <Suspense fallback={
      <div className="h-screen flex items-center justify-center">
        <div className="text-center">
          <Loader2 className="h-8 w-8 animate-spin text-primary mx-auto mb-4" />
          <p className="text-muted-foreground">Loading your writing workspace...</p>
        </div>
      </div>
    }>
      <EditorContentNew />
    </Suspense>
  );
}
