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
import { getInterviewQuestions } from '@/lib/ai/agents/interview-system';

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
    <div className="w-[240px] border-r bg-muted/20 flex flex-col">
      {/* Header */}
      <div className="p-3 border-b flex items-center justify-between">
        <button
          onClick={onNavigateHome}
          className="flex items-center gap-2 text-sm font-medium hover:text-primary transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          <span className="truncate">{project?.title || 'Project'}</span>
        </button>
        <button
          onClick={() => setCollapsed(true)}
          className="p-1 hover:bg-muted rounded"
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
  const [userCredits, setUserCredits] = useState(1000);
  const [isFreeTier, setIsFreeTier] = useState(true);

  // Agent-specific state
  const [interviewQuestions, setInterviewQuestions] = useState<InterviewQuestion[]>([]);
  const [researchResources, setResearchResources] = useState<ResearchResource[]>([]);
  const [researchSteps, setResearchSteps] = useState<{ text: string; completed: boolean }[]>([]);
  const [outlineSections, setOutlineSections] = useState<OutlineSection[]>([]);
  const [qaChecks, setQaChecks] = useState<{ name: string; status: 'pending' | 'checking' | 'passed' | 'warning' }[]>([]);
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
    publishing: 'waiting',
  };

  // Author info
  const authorInfo: AuthorInfo = {
    name: session?.author_name || '',
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
          
          // Load interview questions based on content type
          const questions = getInterviewQuestions(projectData.content_type);
          setInterviewQuestions(questions.map((q, idx) => ({
            id: `q-${idx}`,
            question: q,
            type: idx < 3 ? 'multiple_choice' : 'open',
            options: idx < 3 ? ['Option A', 'Option B', 'Option C', 'Something else...'] : undefined,
          })));
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

        // Load user profile for credits
        const { data: profile } = await supabase
          .from('profiles')
          .select('credits, subscription_tier')
          .eq('id', user.id)
          .single();

        if (profile) {
          setUserCredits(profile.credits || 0);
          setIsFreeTier(!profile.subscription_tier || profile.subscription_tier === 'free');
        }

        // Initialize QA checks
        setQaChecks([
          { name: 'Spell check', status: 'pending' },
          { name: 'Grammar check', status: 'pending' },
          { name: 'Plagiarism scan', status: 'pending' },
          { name: 'Readability score', status: 'pending' },
          { name: 'Formatting consistency', status: 'pending' },
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

  // Start research process
  const startResearch = async () => {
    setIsResearching(true);
    setResearchSteps([
      { text: 'Searching academic databases...', completed: false },
      { text: 'Finding relevant articles...', completed: false },
      { text: 'Analyzing existing books...', completed: false },
      { text: 'Gathering statistics...', completed: false },
      { text: 'Compiling sources...', completed: false },
    ]);

    // Simulate research steps
    for (let i = 0; i < 5; i++) {
      await new Promise(resolve => setTimeout(resolve, 1500));
      setResearchSteps(prev => 
        prev.map((step, idx) => idx <= i ? { ...step, completed: true } : step)
      );
    }

    // Generate mock research resources
    setResearchResources([
      { id: 'r1', type: 'generated', title: 'Market Analysis Report 2024', summary: 'Comprehensive market trends...', isSelected: true },
      { id: 'r2', type: 'generated', title: 'Industry Best Practices', summary: 'Key strategies for...', isSelected: true },
      { id: 'r3', type: 'generated', title: 'Expert Interviews Compilation', summary: 'Insights from industry leaders...', isSelected: true },
    ]);

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

  // Start outline generation
  const startOutlineGeneration = async () => {
    setIsGeneratingOutline(true);
    
    // Generate mock outline sections
    const sections: OutlineSection[] = [
      { id: 'fm1', type: 'front_matter', title: 'Introduction', status: 'pending' },
      { id: 'fm2', type: 'front_matter', title: 'Preface', status: 'pending' },
      { id: 'ch1', type: 'chapter', title: 'Chapter 1: Getting Started', description: 'Foundation concepts', status: 'pending' },
      { id: 'ch2', type: 'chapter', title: 'Chapter 2: Core Principles', description: 'Key fundamentals', status: 'pending' },
      { id: 'ch3', type: 'chapter', title: 'Chapter 3: Advanced Techniques', description: 'Expert strategies', status: 'pending' },
      { id: 'ch4', type: 'chapter', title: 'Chapter 4: Real-World Applications', description: 'Practical examples', status: 'pending' },
      { id: 'ch5', type: 'chapter', title: 'Chapter 5: Future Outlook', description: 'Emerging trends', status: 'pending' },
      { id: 'bm1', type: 'back_matter', title: 'Conclusion', status: 'pending' },
      { id: 'bm2', type: 'back_matter', title: 'References', status: 'pending' },
    ];

    setOutlineSections(sections);

    // Simulate section generation
    for (let i = 0; i < sections.length; i++) {
      await new Promise(resolve => setTimeout(resolve, 800));
      setOutlineSections(prev =>
        prev.map((s, idx) => idx === i ? { ...s, status: 'generating' } : s)
      );
      await new Promise(resolve => setTimeout(resolve, 500));
      setOutlineSections(prev =>
        prev.map((s, idx) => idx === i ? { ...s, status: 'complete' } : s)
      );
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

  // Start writing process
  const startWriting = async () => {
    setIsWriting(true);
    
    // Create chapters from outline
    const chapterSections = outlineSections.filter(s => s.type === 'chapter');
    
    for (let i = 0; i < chapterSections.length; i++) {
      setCurrentChapterContent('');
      
      // Simulate streaming content
      const sampleContent = `This is the beginning of ${chapterSections[i].title}. The content explores ${chapterSections[i].description || 'important topics'}...`;
      
      for (let j = 0; j < sampleContent.length; j++) {
        await new Promise(resolve => setTimeout(resolve, 20));
        setCurrentChapterContent(prev => prev + sampleContent[j]);
      }
      
      // Update chapters list
      setChapters(prev => [
        ...prev,
        {
          id: `ch-${i}`,
          title: chapterSections[i].title.replace(/Chapter \d+: /, ''),
          content: sampleContent,
          order_index: i,
          status: 'complete',
          word_count: sampleContent.split(' ').length,
        },
      ]);
    }

    setIsWriting(false);
    
    // Advance to QA
    await advanceToNextAgent({
      currentChapter: chapterSections.length,
      totalChapters: chapterSections.length,
      progress: 100,
    });
    
    // Start QA checks
    startQAChecks();
  };

  // Start QA checks
  const startQAChecks = async () => {
    setIsCheckingQA(true);
    
    for (let i = 0; i < qaChecks.length; i++) {
      setQaChecks(prev =>
        prev.map((check, idx) => idx === i ? { ...check, status: 'checking' } : check)
      );
      await new Promise(resolve => setTimeout(resolve, 1000));
      setQaChecks(prev =>
        prev.map((check, idx) => idx === i ? { ...check, status: 'passed' } : check)
      );
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
  const handleUploadAuthorPhoto = (file: File) => {
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
            onAnswer={handleInterviewAnswer}
            onSaveAndExit={handleSaveAndExit}
            onStopAndNext={handleStopInterview}
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
