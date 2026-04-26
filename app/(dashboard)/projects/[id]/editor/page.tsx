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
import {
  PublishToStoreModal,
  type PublishSuccessPayload,
} from '@/components/publish/PublishToStoreModal';
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
  getAgentLabels,
} from '@/types/agent-workflow';

// Import interview system for questions
import { getRichInterviewQuestions } from '@/lib/ai/agents/interview-system';
import { fetchLegacyUiQuestions } from '@/lib/ai/interview-prompts-db';
import { t, isSupportedLocale, type Locale } from '@/lib/i18n/strings';
import { getRerunCost } from '@/lib/plans';

// CEO-108: pipeline order, used to detect backward jumps. Mirrors
// DEFAULT_AGENT_ORDER in lib/pipeline/heartbeat.ts (server-only) so we
// don't have to import a server module into a client component.
const PIPELINE_ORDER: AgentName[] = [
  'validate',
  'interview',
  'research',
  'outline',
  'writing',
  'qa',
  'cover',
  'publishing',
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
// UNIFIED LEFT PANEL (Project details + Agent Pipeline)
// =============================================================================
// Merges what used to be two separate columns (NavigationSidebar 240px +
// AgentPipeline 200px = 440px) into a single 240px panel split vertically.
// Top section: project title, type, description, chapter list.
// Bottom section: agent pipeline with live status.
// Collapsible to 12px so the user can reclaim the full horizontal width
// for the writing area when they don't need the sidebar context.

function UnifiedLeftPanel({
  project,
  chapters,
  currentAgent,
  agentStatus,
  activeMessages,
  onNavigateHome,
  onAgentClick,
  locale = 'en',
}: {
  project: Project | null;
  chapters: Chapter[];
  currentAgent: AgentName;
  agentStatus: AgentStatusMap;
  activeMessages?: { line1: string; line2: string };
  onNavigateHome: () => void;
  onAgentClick?: (agent: AgentName) => void;
  locale?: Locale;
}) {
  const [collapsed, setCollapsed] = useState(false);
  // Default to collapsed on viewports narrower than lg (1024px). Same pattern
  // as DocumentPreview — SSR renders expanded, client effect re-renders
  // collapsed if narrow. On a 390px phone: 256px dashboard drawer (off-
  // screen mobile) + 40px left rail + 40px right rail = 80px of editor
  // chrome, leaving ~310px for the writing column, which is above the
  // 280px minimum.
  //
  // The reason we check <1024 (not <768) is that on a 768-1023 tablet
  // with both editor panels fully expanded (240 + 280 = 520) plus the
  // dashboard's 256px sidebar (visible at md+) = 776px of chrome, leaving
  // only ~250px for the writing column. Too narrow. Collapsing both
  // panels to rails recovers ~440px of that, giving ~500px writing column
  // on a 768 tablet. Comfortable.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (window.innerWidth < 1024) {
      setCollapsed(true);
    }
  }, []);

  if (collapsed) {
    return (
      <div className="w-10 border-r bg-muted/20 flex flex-col items-center py-3 shrink-0">
        <button
          onClick={() => setCollapsed(false)}
          className="p-2 hover:bg-muted rounded-lg"
          aria-label={t('editor.expandSidebar', locale)}
          title={t('editor.expandSidebar', locale)}
        >
          <Menu className="h-4 w-4" />
        </button>
      </div>
    );
  }

  return (
    <div className="w-[240px] shrink-0 border-r bg-muted/20 flex flex-col overflow-hidden">
      {/* Header — back-to-projects button + collapse toggle. We don't re-render
          the project title here because the top header bar (line 1133 area)
          already displays it as part of the breadcrumb "Title âº Agent". Having
          the title in both places was visibly redundant — two truncated copies
          of a long title stacked 48px apart in the same column. The left
          back-button's job is navigation, not labelling. Keep it simple. */}
      <div className="p-3 border-b flex items-center justify-between gap-2">
        <button
          onClick={onNavigateHome}
          className="flex items-center gap-2 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors min-w-0 flex-1"
          title={t('editor.backToProjects', locale)}
        >
          <ArrowLeft className="h-4 w-4 shrink-0" />
          <span className="truncate min-w-0">{t('editor.backToProjects', locale)}</span>
        </button>
        <button
          onClick={() => setCollapsed(true)}
          className="p-1 hover:bg-muted rounded shrink-0"
          aria-label={t('editor.collapseSidebar', locale)}
          title={t('editor.collapseSidebar', locale)}
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* TOP HALF — Project details */}
      {/* min-h-0 is critical: without it, a flex child with overflow won't
          actually scroll; it will just push the lower section off-screen. */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        {/* Type + description */}
        <div className="p-3 border-b">
          <div className="flex items-center gap-2 mb-1.5">
            <BookOpen className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="text-[10px] text-muted-foreground uppercase tracking-wider font-semibold">
              {project?.content_type || t('editor.document', locale)}
            </span>
          </div>
          <p className="text-xs text-muted-foreground line-clamp-3">
            {project?.description || t('editor.noDescription', locale)}
          </p>
        </div>

        {/* Chapters list — compact rows */}
        <div className="p-3 border-b">
          <h3 className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">
            {t('editor.chapters', locale)} ({chapters.length})
          </h3>
          {chapters.length > 0 ? (
            <div className="space-y-0.5">
              {chapters.map((chapter, idx) => (
                <div
                  key={chapter.id}
                  className="flex items-center gap-1.5 px-1.5 py-1 rounded hover:bg-muted/50 cursor-pointer text-xs"
                >
                  <span className="text-muted-foreground w-4 text-[10px] shrink-0">{idx + 1}</span>
                  <span className="truncate flex-1" title={chapter.title}>
                    {chapter.title}
                  </span>
                  <span className="text-[10px] text-muted-foreground shrink-0">
                    {chapter.word_count || 0}w
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-[11px] text-muted-foreground italic">
              {t('editor.chaptersEmpty', locale)}
            </p>
          )}
        </div>

        {/* BOTTOM HALF — Agent Pipeline embedded (no separate border/chrome;
            the outer panel provides those). */}
        <AgentPipeline
          currentAgent={currentAgent}
          agentStatus={agentStatus}
          activeMessages={activeMessages}
          locale={locale}
          embedded
          onAgentClick={onAgentClick}
        />
      </div>

      {/* Footer — back to project */}
      <div className="p-2 border-t shrink-0">
        <Link
          href={`/projects/${project?.id}`}
          className="flex items-center gap-2 text-[11px] text-muted-foreground hover:text-foreground transition-colors px-1"
        >
          <Home className="h-3 w-3" />
          {t('editor.backToProject', locale)}
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
  // Locale for chrome translation — resolved from profile.preferred_language.
  // Defaults to 'en' so the first-paint shell renders in a known language
  // before the async profile fetch completes.
  const [locale, setLocale] = useState<Locale>('en');

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

  // CEO-108: backward-jump rerun confirmation. When the writer clicks
  // an earlier completed stage in the pipeline, open a modal that
  // shows the credit cost and asks them to confirm an actual re-run
  // (which fires pipeline.restart-agent on the back end). Forward
  // jumps and same-stage clicks stay free and skip the modal.
  const [rerunModal, setRerunModal] = useState<{
    target: AgentName;
    cost: number;
  } | null>(null);
  const [isRerunning, setIsRerunning] = useState(false);
  const [isCheckingQA, setIsCheckingQA] = useState(false);

  // Pipeline health — driven by SSE 'session_update' events. 'active'
  // means normal; anything else triggers a banner above the writing UI.
  // Keeping these as separate hooks rather than nesting under `session`
  // so a stale `session` object (cached from initial fetch) never
  // overrides a fresh stream event.
  const [pipelineStatus, setPipelineStatus] = useState<
    'active' | 'stuck' | 'recovering' | 'failed' | 'completed' | 'user_abandoned'
  >('active');
  const [pipelineFailureReason, setPipelineFailureReason] = useState<string | null>(null);
  const [pipelineFailureCount, setPipelineFailureCount] = useState(0);

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

  // Auto-start QA checks when the user lands on the QA step with no prior run.
  //
  // Previously startQAChecks() was invoked from exactly one place: the 'complete'
  // message of the Writing SSE stream. That meant users who reloaded mid-writing,
  // navigated away and came back after writing finished, or lost their SSE
  // connection would land on /editor at current_agent='qa' staring at six
  // pending checkboxes and a disabled "I agree & continue" button — the automatic
  // review never started because nothing triggered it.
  //
  // This effect runs once per mount, only when we're actually on the QA step
  // and haven't already kicked off or completed a run. The qaAutoStartedRef
  // guards against React Strict Mode double-invoke and against re-firing if
  // qaChecks state churns.
  const qaAutoStartedRef = useRef(false);
  useEffect(() => {
    if (loading) return;
    if (currentAgent !== 'qa') return;
    if (qaAutoStartedRef.current) return;
    if (isCheckingQA) return;
    // Only auto-start if every check is still 'pending' — i.e. we haven't
    // already completed a run in this session or hydrated passed/warning state.
    const allPending = qaChecks.length > 0 && qaChecks.every(c => c.status === 'pending');
    if (!allPending) return;
    qaAutoStartedRef.current = true;
    startQAChecks();
  }, [loading, currentAgent, qaChecks, isCheckingQA]);

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
    frontCoverSource: session?.front_cover_source || 'generated',
    frontCoverHasTypography: session?.front_cover_has_typography ?? false,
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

          // Load interview questions from the DB-backed interview_prompts
          // table. Per Founder directive 2026-04-23 (CEO-033), every interview
          // must be specific to the document type — the legacy hardcoded
          // "audience / tone / chapter_count" questions in interview-system.ts
          // are not acceptable. If the DB returns zero rows (should never
          // happen given resolve_interview_prompt's 'non-fiction' ultimate
          // fallback), we fall through to the legacy path as a hard safety
          // net rather than showing no questions at all.
          const dbQuestions = await fetchLegacyUiQuestions(projectData.content_type);
          const richQuestions = dbQuestions.length > 0
            ? dbQuestions
            : getRichInterviewQuestions(projectData.content_type);
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
          .select('full_name, email, credits_balance, credits_purchased, plan, is_admin, preferred_language')
          .eq('id', user.id)
          .single();

        // Resolve locale first so QA check names (initialized below) can be
        // translated synchronously rather than waiting for the setLocale state
        // update to propagate on the next render.
        let resolvedLocale: Locale = 'en';
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
          // Resolve the user's interface locale for chrome translation. All
          // agent pipeline labels, sidebar chrome, and toasts switch to this
          // locale on first render after data load completes.
          const rawLang = (profile.preferred_language || 'en').toLowerCase();
          if (isSupportedLocale(rawLang)) {
            resolvedLocale = rawLang as Locale;
            setLocale(resolvedLocale);
          }
        }

        // Initialize QA checks with translated names so users see check labels
        // in their locale the moment the agent advances to the QA step. These
        // labels are UI-only; the QA API keys off the check order, not name.
        setQaChecks([
          { name: t('qa.check.wordCount', resolvedLocale), status: 'pending' },
          { name: t('qa.check.fillerPhrases', resolvedLocale), status: 'pending' },
          { name: t('qa.check.readability', resolvedLocale), status: 'pending' },
          { name: t('qa.check.tonalConsistency', resolvedLocale), status: 'pending' },
          { name: t('qa.check.crossChapter', resolvedLocale), status: 'pending' },
          { name: t('qa.check.structural', resolvedLocale), status: 'pending' },
        ]);

      } catch (error) {
        console.error('Error loading data:', error);
        toast.error(t('editor.loadFailed', locale));
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
    // Mirror the chosen topic to interview_sessions.book_title so that cover
    // generation (hooks/use-agent-workflow.ts) and publishing store listings
    // read the real title instead of falling back to 'Untitled'. Historically
    // only projects.title was updated; the session column stayed NULL forever.
    if (session && session.book_title !== topic) {
      await supabase
        .from('interview_sessions')
        .update({ book_title: topic })
        .eq('id', session.id);
      setSession({ ...session, book_title: topic });
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
    // Step labels are localised to the user's interface language so the
    // "live research feed" reads naturally. These are user-visible only —
    // the server-side research call doesn't key off these strings.
    setResearchSteps([
      { text: t('research.step.reading', locale), completed: false },
      { text: t('research.step.identifying', locale), completed: false },
      { text: t('research.step.generating', locale), completed: false },
      { text: t('research.step.ranking', locale), completed: false },
      { text: t('research.step.compiling', locale), completed: false },
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
      toast.error(t('editor.researchFailed', locale));
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
    toast.info(t('editor.feedbackProcessing', locale));
    // Would call AI to regenerate outline based on feedback
    await new Promise(resolve => setTimeout(resolve, 2000));
    toast.success(t('editor.outlineUpdated', locale));
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
      // Get the full outline_data (body + templateMeta) from the session
      const sessionResp = await fetch(`/api/interview-session?projectId=${projectId}`);
      const sessionData = await sessionResp.json();
      const outlineData = sessionData?.session?.outline_data;
      const outlineBody = outlineData?.body || outlineData?.chapters;

      if (!outlineBody || outlineBody.length === 0) {
        toast.error('No outline found. Please regenerate the outline first.');
        setIsWriting(false);
        return;
      }

      // Trigger Inngest durable writing (works for any document type)
      const startResp = await fetch('/api/books/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId,
          outline: {
            body: outlineBody,
            chapters: outlineBody, // legacy alias
            frontMatter: outlineData?.frontMatter || [],
            backMatter: outlineData?.backMatter || [],
            templateMeta: outlineData?.templateMeta,
          },
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
          // Pipeline health events come from the interview_sessions
          // Realtime channel. Transitions we care about:
          //   active      — normal; clear any previous failure state
          //   stuck       — stuck detector flagged a stale heartbeat
          //   recovering  — auto-retry cron fired; counter bumped
          //   failed      — auto-recovery budget exhausted
          if (msg.type === 'session_update') {
            const status = msg.pipeline_status;
            if (
              status === 'active' ||
              status === 'stuck' ||
              status === 'recovering' ||
              status === 'failed' ||
              status === 'completed' ||
              status === 'user_abandoned'
            ) {
              setPipelineStatus(status);
            }
            setPipelineFailureReason(msg.last_failure_reason ?? null);
            setPipelineFailureCount(msg.failure_count ?? 0);
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
              currentChapter: outlineBody.length,
              totalChapters: outlineBody.length,
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
      toast.error(t('editor.writingFailed', locale));
      setIsWriting(false);
    }
  };

  // Start QA checks — real endpoint
  const startQAChecks = async () => {
    setIsCheckingQA(true);
    setQaChecks([
      { name: t('qa.check.wordCount', locale), status: 'checking' },
      { name: t('qa.check.fillerPhrases', locale), status: 'checking' },
      { name: t('qa.check.readability', locale), status: 'checking' },
      { name: t('qa.check.tonalConsistency', locale), status: 'checking' },
      { name: t('qa.check.crossChapter', locale), status: 'checking' },
      { name: t('qa.check.structural', locale), status: 'checking' },
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
      toast.error(t('editor.qaFailed', locale));
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
    toast.success(t('editor.chapterSaved', locale));
  };

  // Handler: Regenerate chapter — calls real Opus via /api/ai/regenerate-chapter
  const handleRegenerateChapter = async (chapterId: string, instructions?: string) => {
    const cost = 100;
    if (userCredits < cost && !userProfile.is_admin) {
      toast.error(`Not enough credits. Chapter regeneration costs ${cost} credits.`);
      return;
    }

    const chapter = chapters.find((ch) => ch.id === chapterId);
    toast.info(`Regenerating "${chapter?.title || 'chapter'}"… (${cost} credits)`);

    try {
      const resp = await fetch('/api/ai/regenerate-chapter', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId, chapterId, instructions }),
      });
      const data = await resp.json();
      if (data.error) {
        toast.error(data.error);
        return;
      }
      // Update the chapter in local state with the new content
      setChapters((prev) =>
        prev.map((ch) =>
          ch.id === chapterId
            ? {
                ...ch,
                content: data.chapter.content,
                word_count: data.chapter.word_count,
              }
            : ch,
        ),
      );
      setUserCredits(data.creditsRemaining ?? userCredits);
      toast.success(`Chapter regenerated — ${data.chapter.word_count} words`);
    } catch (err) {
      console.error('Regeneration failed:', err);
      toast.error(t('editor.regenFailed', locale));
    }
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
    // Wrap the whole flow so a network failure, Vercel HTML timeout page,
    // or any non-JSON response surfaces as a visible error to the user.
    // Previously handleGenerateCover had no try/catch; a thrown fetch or
    // a response.json() parse error would propagate up to the child
    // component's try/finally, flip the button back to normal in one
    // frame, and leave the user staring at a dead button with no toast.
    try {
      const response = await fetch('/api/covers/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId,
          sessionId: session?.id,
          coverType: type,
          prompt,
          bookTitle: session?.book_title || project?.title || t('editor.untitled', locale),
          authorName: session?.author_name || t('editor.author', locale),
        }),
      });

      // Read as text first so we can present a useful message even when
      // the server returned HTML (504 timeout, static 500 page, etc).
      const raw = await response.text();
      let data: { error?: string; imageUrl?: string } = {};
      try {
        data = raw ? JSON.parse(raw) : {};
      } catch {
        data = { error: `Cover service returned an unexpected response (HTTP ${response.status}). Please try again.` };
      }

      if (!response.ok || data.error) {
        const msg = data.error || `Cover generation failed (HTTP ${response.status})`;
        console.error('[cover] generate failed:', response.status, raw.slice(0, 400));
        toast.error(msg);
        return;
      }

      toast.success(`${type === 'front' ? 'Front' : 'Back'} cover generated!`);

      // Refresh session to get updated cover URL
      const sessionResponse = await fetch(`/api/interview-session?projectId=${projectId}`);
      const sessionData = await sessionResponse.json();
      if (sessionData.session) {
        setSession(sessionData.session);
      }
    } catch (err: any) {
      console.error('[cover] unexpected client error:', err);
      toast.error(err?.message || 'Could not reach cover service. Check your connection and try again.');
    }
  };

  // Handler: Upload author photo
  //
  // Posts the file to /api/author/photo which writes to the public
  // `covers` bucket under author-photos/{userId}/{sessionId}.{ext} and
  // updates interview_sessions.author_photo_url. After success we
  // refresh the session so the new URL flows into CoverDesignScreen
  // without a page reload.
  const handleUploadAuthorPhoto = async (file: File) => {
    try {
      const fd = new FormData();
      fd.append('projectId', projectId);
      fd.append('file', file);

      const resp = await fetch('/api/author/photo', { method: 'POST', body: fd });
      const data = await resp.json();
      if (!resp.ok || data.error) {
        toast.error(data.error || t('editor.photoUploadFailed', locale));
        return;
      }

      toast.success(t('editor.photoUploaded', locale));

      // Refresh session so CoverDesignScreen picks up author_photo_url.
      const sessionResponse = await fetch(`/api/interview-session?projectId=${projectId}`);
      const sessionData = await sessionResponse.json();
      if (sessionData.session) {
        setSession(sessionData.session);
      }
    } catch (err) {
      console.error('photo upload error:', err);
      toast.error(t('editor.photoUploadFailed', locale));
    }
  };

  // Handler: Extract from LinkedIn
  const handleExtractFromLinkedIn = (url: string) => {
    toast.info(t('editor.linkedinSoon', locale));
  };

  // CEO-106: Upload-your-own front cover. Posts the chosen file plus a
  // hasTypography flag to /api/projects/[id]/cover-upload, which writes
  // it to the public covers bucket under
  //   {userId}/uploaded-covers/{sessionId}.{ext}
  // and updates interview_sessions.front_cover_url + front_cover_source +
  // front_cover_has_typography. After success we refresh the session so
  // CoverDesignScreen / PublishScreen pick up the new URL without a page
  // reload.
  const handleUploadCover = async (file: File, hasTypography: boolean) => {
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('hasTypography', hasTypography ? 'true' : 'false');

      const resp = await fetch(`/api/projects/${projectId}/cover-upload`, {
        method: 'POST',
        body: fd,
      });
      const data = await resp.json();
      if (!resp.ok || data.error) {
        toast.error(data.error || t('editor.coverUploadFailed', locale));
        return;
      }

      toast.success(t('editor.coverUploaded', locale));

      const sessionResponse = await fetch(`/api/interview-session?projectId=${projectId}`);
      const sessionData = await sessionResponse.json();
      if (sessionData.session) {
        setSession(sessionData.session);
      }
    } catch (err) {
      console.error('cover upload error:', err);
      toast.error(t('editor.coverUploadFailed', locale));
    }
  };

  // Handler: View PDF — fetches a rendered PDF from /api/export and opens
  // it in a new tab via a blob URL. The export route applies v2 watermark
  // rules (free tier gets a 'by penworth.ai' footer; paid tiers are clean).
  const handleViewPDF = async () => {
    try {
      toast.info(t('editor.pdfOpening', locale));
      const resp = await fetch('/api/export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId, format: 'pdf' }),
      });
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({ error: 'Export failed' }));
        toast.error(err.error || 'Unable to render PDF');
        return;
      }
      const blob = await resp.blob();
      const url = URL.createObjectURL(blob);
      const win = window.open(url, '_blank');
      if (!win) {
        // Popup blocked — fall back to download
        const a = document.createElement('a');
        a.href = url;
        a.download = `${project?.title || 'book'}.pdf`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
      }
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (err) {
      console.error('View PDF failed:', err);
      toast.error('Unable to render PDF');
    }
  };

  // Handler: Download — fetches a DOCX from /api/export and triggers a
  // browser download. Same watermark rules as PDF.
  const handleDownload = async () => {
    try {
      toast.info(t('editor.downloadStarting', locale));
      const resp = await fetch('/api/export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId, format: 'docx' }),
      });
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({ error: 'Export failed' }));
        toast.error(err.error || 'Unable to export DOCX');
        return;
      }
      const blob = await resp.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${project?.title || 'book'}.docx`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (err) {
      console.error('Download failed:', err);
      toast.error('Unable to export DOCX');
    }
  };

  // Pre-publish modal state. handlePublish below just opens the modal; the
  // modal posts to /api/publishing/penworth-store and calls back into
  // handlePublishSuccess on success — which fires the audiobook narration
  // kickoff and redirects the author to their new Store listing.
  const [publishModalOpen, setPublishModalOpen] = useState(false);

  const handlePublish = () => {
    setPublishModalOpen(true);
  };

  const handlePublishSuccess = (result: PublishSuccessPayload) => {
    toast.success(
      `Live on Penworth Store — ${result.stats.chapterCount} chapters, ${result.stats.totalWords.toLocaleString()} words`,
    );

    // Fire-and-forget audiobook narration. Several minutes for a full book,
    // so we don't await it — the author is redirected immediately and the
    // listing's AudiobookPlayer will appear as chapters finish narrating.
    fetch('/api/publishing/penworth-store/narrate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectId }),
    })
      .then(async (r) => {
        if (r.status === 402 || r.status === 403) {
          // Gated (admin-only rollout) — silent no-op.
          return;
        }
        if (r.ok) {
          toast.success('Audio narration started — it will appear on your listing within minutes.', {
            duration: 5000,
          });
        }
      })
      .catch(() => {
        // Network or 503 (ELEVENLABS_API_KEY not set) — silent no-op.
      });

    // Open the live Store listing in a new tab. We intentionally do NOT use
    // router.push(storeUrl) because storeUrl is absolute cross-subdomain
    // (store.penworth.ai) — Next's router only handles in-app paths.
    if (typeof window !== 'undefined') {
      window.open(result.storeUrl, '_blank', 'noopener,noreferrer');
    }
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

  // Per CEO-092: founder needs to jump back to a previously-completed
  // pipeline stage (most importantly Cover and Publishing) without
  // having to redo the rest of the pipeline. UI-side this is gated by
  // AgentPipeline's isClickable rule (active or completed only); the
  // back-end /api/interview-session 'jump' action is the safety net.
  // We also do not navigate to the same stage we are already on —
  // protects against accidental double-clicks during cover regen.
  const jumpToAgent = async (target: AgentName) => {
    if (!session) return;
    if (target === currentAgent) return;
    const status = agentStatus[target];
    if (status !== 'completed' && status !== 'active') return;

    // CEO-108: detect backward jumps. A backward jump opens the rerun
    // confirmation modal and (on confirm) hits /api/projects/[id]/rerun-stage,
    // which charges per the rerun ladder and fires pipeline.restart-agent.
    // Forward / same-stage jumps stay free via the existing 'jump' action.
    const targetIdx = PIPELINE_ORDER.indexOf(target);
    const currentIdx = PIPELINE_ORDER.indexOf(currentAgent);
    const isBackward = targetIdx >= 0 && currentIdx >= 0 && targetIdx < currentIdx;

    if (isBackward) {
      const cost = getRerunCost(target);
      setRerunModal({ target, cost });
      return;
    }

    const response = await fetch('/api/interview-session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionId: session.id,
        action: 'jump',
        data: { target },
      }),
    });

    const result = await response.json();
    if (result.session) {
      setSession(result.session);
    }
  };

  // CEO-108: actually fire the paid rerun once the writer confirms.
  // Charges per the rerun ladder (PUBLISHING_CREDIT_COSTS.rerun_*),
  // flips current_agent server-side, and dispatches the
  // pipeline.restart-agent Inngest event so the stage recomputes.
  const confirmRerun = async () => {
    if (!rerunModal || !session) return;
    setIsRerunning(true);
    try {
      const resp = await fetch(`/api/projects/${projectId}/rerun-stage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agent: rerunModal.target }),
      });
      const data = await resp.json();
      if (!resp.ok) {
        if (data?.code === 'INSUFFICIENT_CREDITS') {
          toast.error(t('rerun.insufficientCredits', locale));
          router.push('/billing');
        } else {
          toast.error(data?.error || t('rerun.failed', locale));
        }
        return;
      }
      if (data.session) {
        setSession(data.session);
      }
      // Refresh the credit display via direct profile read — mirrors the
      // page-load pattern at line ~465. We catch silently because this
      // is cosmetic; the canonical balance is on the server side.
      try {
        const { data: { user: u } } = await supabase.auth.getUser();
        if (u) {
          const { data: profile } = await supabase
            .from('profiles')
            .select('credits_balance, credits_purchased')
            .eq('id', u.id)
            .single();
          if (profile) {
            setUserCredits(
              (profile.credits_balance || 0) + (profile.credits_purchased || 0),
            );
          }
        }
      } catch {
        // Non-fatal — credit refresh is cosmetic.
      }
      toast.success(t('rerun.started', locale));
      setRerunModal(null);
    } catch (err) {
      console.error('rerun error:', err);
      toast.error(t('rerun.failed', locale));
    } finally {
      setIsRerunning(false);
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
      <div className="h-[calc(100vh-3rem)] md:h-screen flex items-center justify-center">
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
            contentType={project?.content_type}
            locale={locale}
          />
        );

      case 'interview':
        return (
          <InterviewScreen
            questions={interviewQuestions}
            chosenIdea={session?.validation_data?.chosenTopic || project?.title}
            ideaPositioning={session?.validation_data?.positioning}
            projectId={projectId}
            contentType={project?.content_type}
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
            locale={locale}
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
            locale={locale}
          />
        );

      case 'outline':
        return (
          <OutlineScreen
            bookTitle={session?.book_title || project?.title || t('editor.untitled', locale)}
            authorName={session?.author_name || t('editor.author', locale)}
            sections={outlineSections}
            isGenerating={isGeneratingOutline}
            onRequestChanges={handleRequestOutlineChanges}
            onApprove={handleApproveOutline}
            locale={locale}
          />
        );

      case 'writing':
        return (
          <WritingScreen
            bookTitle={session?.book_title || project?.title || t('editor.untitled', locale)}
            chapters={outlineSections.filter(s => s.type === 'chapter')}
            currentChapterIndex={chapters.length}
            currentChapterContent={currentChapterContent}
            isWriting={isWriting}
            userCredits={userCredits}
            onEditChapter={handleEditChapter}
            onRegenerateChapter={handleRegenerateChapter}
            locale={locale}
            pipelineStatus={pipelineStatus}
            pipelineFailureReason={pipelineFailureReason}
            failureCount={pipelineFailureCount}
            onRetryWriting={startWriting}
          />
        );

      case 'qa':
        return (
          <QAScreen
            qaChecks={qaChecks}
            isChecking={isCheckingQA}
            onAcknowledge={handleQAAcknowledge}
            locale={locale}
          />
        );

      case 'cover':
        return (
          <CoverDesignScreen
            bookTitle={session?.book_title || project?.title || t('editor.untitled', locale)}
            authorInfo={authorInfo}
            coverConfig={coverConfig}
            userCredits={userCredits}
            onUpdateAuthorInfo={handleUpdateAuthorInfo}
            onGenerateCover={handleGenerateCover}
            onUploadAuthorPhoto={handleUploadAuthorPhoto}
            onUploadCover={handleUploadCover}
            onApproveAndContinue={async () => {
              await advanceToNextAgent({
                frontCoverUrl: coverConfig.frontCoverUrl,
                backCoverUrl: coverConfig.backCoverUrl,
                approved: true,
              });
            }}
            locale={locale}
          />
        );

      case 'publishing':
        return (
          <PublishScreen
            bookTitle={session?.book_title || project?.title || t('editor.untitled', locale)}
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
            onUploadCover={handleUploadCover}
            onExtractFromLinkedIn={handleExtractFromLinkedIn}
            onViewPDF={handleViewPDF}
            onDownload={handleDownload}
            onPublish={handlePublish}
            locale={locale}
          />
        );

      default:
        return <div>{t('editor.unknownAgent', locale)}</div>;
    }
  };

  return (
    // On mobile (<md) the dashboard layout adds pt-12 for the hamburger
    // top bar, so 100vh on the editor would overflow the viewport. Subtract
    // 3rem (= h-12 = 48px) on mobile; use full h-screen on md+ where no
    // mobile topbar exists.
    <div className="h-[calc(100vh-3rem)] md:h-screen flex flex-col bg-background">
      {/* Top Header Bar */}
      <div className="h-12 border-b flex items-center justify-between px-4 bg-card">
        <div className="flex items-center gap-2">
          <Link href="/projects" className="text-muted-foreground hover:text-foreground">
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <span className="text-sm font-medium truncate max-w-[200px]">
            {project?.title || t('editor.untitled', locale)}
          </span>
          <ChevronRight className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm text-muted-foreground">
            {currentAgent
              ? getAgentLabels(currentAgent, locale).shortName
              : t('editor.unknownAgent', locale)}
          </span>
        </div>
        
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">
            {userCredits} {t('editor.credits', locale)}
          </span>
          <Button variant="ghost" size="sm">
            <Settings className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Main Content — 3 columns (was 4). Left panel merges project
          details + agent pipeline; main area is the flex-1 writing surface;
          right panel is the collapsible document preview. */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left: Project + Agents (collapsible) */}
        <UnifiedLeftPanel
          project={project}
          chapters={chapters}
          currentAgent={currentAgent}
          agentStatus={agentStatus}
          activeMessages={getActiveMessage()}
          onNavigateHome={() => router.push('/projects')}
          onAgentClick={jumpToAgent}
          locale={locale}
        />

        {/* Center: Main Interaction Area */}
        <div className="flex-1 flex flex-col overflow-hidden bg-background min-w-0">
          {renderMainScreen()}
        </div>

        {/* Right: Document Preview (collapsible) */}
        <DocumentPreview
          bookTitle={session?.book_title || project?.title || t('editor.untitled', locale)}
          authorName={session?.author_name || t('editor.author', locale)}
          contentType={project?.content_type || 'book'}
          coverUrl={session?.front_cover_url || undefined}
          wordCount={wordCount}
          pageCount={pageCount}
          chapterCount={chapterCount}
          creditsUsed={1000 - userCredits}
          creditsRemaining={userCredits}
          estimatedTimeRemaining={isWriting ? t('editor.estimatedMinutes', locale) : undefined}
          currentAgent={currentAgent}
          isFreeTier={isFreeTier}
          onViewPDF={handleViewPDF}
          onExportDraft={handleDownload}
          onSharePreview={() => toast.info(t('editor.shareSoon', locale))}
          onInviteCollaborator={() => toast.info(t('editor.collabSoon', locale))}
          onTopUp={() => router.push('/billing')}
          locale={locale}
        />
      </div>

      <PublishToStoreModal
        open={publishModalOpen}
        onOpenChange={setPublishModalOpen}
        projectId={projectId}
        defaultTitle={session?.book_title || project?.title}
        defaultAuthorName={session?.author_name || authorInfo?.name}
        defaultContentType={project?.content_type}
        onSuccess={handlePublishSuccess}
      />

      {/* CEO-108: backward-jump rerun confirmation. */}
      {rerunModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="rerun-modal-title"
        >
          <div className="w-full max-w-md rounded-xl bg-background p-6 shadow-xl">
            <h2 id="rerun-modal-title" className="text-lg font-semibold mb-2">
              {t('rerun.confirmTitle', locale)}
            </h2>
            <p className="text-sm text-muted-foreground mb-1">
              {t('rerun.confirmBody', locale)
                .replace('{stage}', getAgentLabels(rerunModal.target, locale).shortName)}
            </p>
            <p className="text-sm font-medium mb-4">
              {t('rerun.cost', locale).replace('{cost}', String(rerunModal.cost))}
            </p>
            <p className="text-xs text-muted-foreground mb-5">
              {t('rerun.confirmWarning', locale)}
            </p>
            <div className="flex gap-2 justify-end">
              <Button
                type="button"
                variant="outline"
                disabled={isRerunning}
                onClick={() => setRerunModal(null)}
              >
                {t('rerun.cancel', locale)}
              </Button>
              <Button
                type="button"
                disabled={isRerunning || rerunModal.cost > userCredits}
                onClick={confirmRerun}
              >
                {isRerunning ? (
                  <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> {t('rerun.starting', locale)}</>
                ) : (
                  t('rerun.confirm', locale)
                )}
              </Button>
            </div>
            {rerunModal.cost > userCredits && (
              <p className="text-xs text-red-500 mt-3 text-right">
                {t('rerun.insufficientCredits', locale)}
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// =============================================================================
// EXPORT
// =============================================================================

export default function EditorPage() {
  return (
    <Suspense fallback={
      <div className="h-[calc(100vh-3rem)] md:h-screen flex items-center justify-center">
        <div className="text-center">
          <Loader2 className="h-8 w-8 animate-spin text-primary mx-auto mb-4" />
          <p className="text-muted-foreground">…</p>
        </div>
      </div>
    }>
      <EditorContentNew />
    </Suspense>
  );
}
