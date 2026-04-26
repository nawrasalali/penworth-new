/**
 * Agent Workflow Types
 * Defines the 7-agent pipeline for document creation
 */

export type AgentName = 
  | 'validate' 
  | 'interview' 
  | 'research' 
  | 'outline' 
  | 'writing' 
  | 'qa' 
  | 'cover'
  | 'publishing';

export type AgentStatus = 'waiting' | 'active' | 'completed';

export interface AgentStatusMap {
  validate: AgentStatus;
  interview: AgentStatus;
  research: AgentStatus;
  outline: AgentStatus;
  writing: AgentStatus;
  qa: AgentStatus;
  cover: AgentStatus;
  publishing: AgentStatus;
}

export interface AgentInfo {
  id: AgentName;
  number: number;
  name: string;
  shortName: string;
  activeMessage: string;
  completedMessage: string;
}

export const AGENTS: AgentInfo[] = [
  {
    id: 'validate',
    number: 1,
    name: 'Validate Topic Agent',
    shortName: 'Validate',
    activeMessage: 'Analyzing your idea...',
    completedMessage: 'Topic validated',
  },
  {
    id: 'interview',
    number: 2,
    name: 'Interview Agent',
    shortName: 'Interview',
    activeMessage: 'Gathering your vision...',
    completedMessage: 'Interview complete',
  },
  {
    id: 'research',
    number: 3,
    name: 'Research Agent',
    shortName: 'Research',
    activeMessage: 'Researching your topic...',
    completedMessage: 'Research compiled',
  },
  {
    id: 'outline',
    number: 4,
    name: 'Outline Agent',
    shortName: 'Outline',
    activeMessage: 'Structuring your document...',
    completedMessage: 'Outline approved',
  },
  {
    id: 'writing',
    number: 5,
    name: 'Writing Agent',
    shortName: 'Writing',
    activeMessage: 'Writing your content...',
    completedMessage: 'Content written',
  },
  {
    id: 'qa',
    number: 6,
    name: 'Quality Assurance Agent',
    shortName: 'QA',
    activeMessage: 'Reviewing quality...',
    completedMessage: 'QA complete',
  },
  {
    id: 'cover',
    number: 7,
    name: 'Cover Design Agent',
    shortName: 'Cover',
    activeMessage: 'Designing your cover...',
    completedMessage: 'Cover approved',
  },
  {
    id: 'publishing',
    number: 8,
    name: 'Publishing Agent',
    shortName: 'Publishing',
    activeMessage: 'Preparing for publish...',
    completedMessage: 'Document ready to view',
  },
];

/**
 * Returns the translated short-name, active-message, and completed-message for
 * an agent, for the given locale. Import `t` lazily here rather than at module
 * scope so this file can be consumed by any caller without pulling the whole
 * i18n bundle unless the helper is actually used.
 *
 * The English strings in AGENTS above are kept as the source-of-truth fallback
 * and for any consumer that hasn't been converted to locale-aware rendering.
 */
export function getAgentLabels(agentId: AgentName, locale: string = 'en'): {
  shortName: string;
  activeMessage: string;
  completedMessage: string;
} {
  // Lazy import to avoid circular-ish issues when types are pulled into server
  // components or build-time tooling.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { t, isSupportedLocale } = require('@/lib/i18n/strings');
  const safeLocale = isSupportedLocale(locale) ? locale : 'en';
  return {
    shortName: t(`agent.${agentId}.name`, safeLocale),
    activeMessage: t(`agent.${agentId}.active`, safeLocale),
    completedMessage: t(`agent.${agentId}.done`, safeLocale),
  };
}

// Validation types
export interface ValidationScore {
  total: number;
  breakdown: {
    marketDemand: number;
    targetAudience: number;
    uniqueValue: number;
    authorCredibility: number;
    commercialViability: number;
    executionFeasibility: number;
  };
  verdict: 'STRONG' | 'PROMISING' | 'RISKY' | 'RECONSIDER';
  summary: string;
  strengths: string[];
  weaknesses: string[];
  alternatives?: {
    title: string;
    estimatedScore: number;
    reason: string;
  }[];
}

// Interview types
export interface InterviewQuestion {
  id: string;
  question: string;
  type: 'open' | 'multiple_choice';
  options?: string[]; // Always includes "Something else..." as last option
  answer?: string;
  /**
   * When true, multiple_choice renders as checkboxes and accepts 1+ selections.
   * The stored `answer` is a comma-separated string of the chosen labels
   * (plus any free-text from 'Something else...').
   */
  multi?: boolean;
  /** Optional sub-prompt shown in muted text under the question. */
  helpText?: string;
}

export interface FollowUpQuestion {
  id: string;
  title: string;
  question: string;
  options: string[];
  answer?: string;
}

export const FOLLOW_UP_QUESTIONS: FollowUpQuestion[] = [
  {
    id: 'chapters',
    title: '📚 CHAPTERS',
    question: 'How many chapters?',
    options: [
      '5-8 (Quick read)',
      '10-15 (Standard)',
      '15-20 (Comprehensive)',
      '20+ (Reference)',
    ],
  },
  {
    id: 'audience',
    title: '👥 AUDIENCE',
    question: 'Primary audience?',
    options: [
      'General public',
      'Professionals',
      'Students/Academics',
      'Niche enthusiasts',
    ],
  },
  {
    id: 'market',
    title: '🌍 TARGET MARKET',
    question: 'Where are your readers?',
    options: [
      'Global audience',
      'USA/Canada',
      'UK/Europe',
      'Asia Pacific',
      'Middle East',
    ],
  },
  {
    id: 'style',
    title: '📖 WRITING STYLE',
    question: 'Tone of the document?',
    options: [
      'Conversational',
      'Challenging/Bold',
      'Story-driven',
      'Academic/Formal',
      'Inspirational',
    ],
  },
];

/**
 * Shown only for document types that require citations (research papers,
 * theses, white papers, business plans). Merged into the follow-up questions
 * by InterviewScreen when the template declares requiresCitations.
 *
 * The stored answer is an option label; the writing agent reads the id from
 * follow_up_data.citationStyle where the id is apa/vancouver/mla/chicago/harvard/ieee.
 */
export const CITATION_STYLE_QUESTION: FollowUpQuestion = {
  id: 'citationStyle',
  title: '📑 CITATION STYLE',
  question: 'How should sources be cited?',
  options: [
    'APA 7th (most common in social sciences)',
    'Vancouver (medicine, life sciences)',
    'MLA 9th (humanities)',
    'Chicago (history, arts)',
    'Harvard (general academic)',
    'IEEE (engineering, computer science)',
  ],
};

/**
 * Maps a CITATION_STYLE_QUESTION option label back to its short id for the
 * backend (keeps follow_up_data.citationStyle a stable key like "apa").
 */
export function extractCitationStyleId(label: string | undefined): string | undefined {
  if (!label) return undefined;
  const lower = label.toLowerCase();
  if (lower.startsWith('apa')) return 'apa';
  if (lower.startsWith('vancouver')) return 'vancouver';
  if (lower.startsWith('mla')) return 'mla';
  if (lower.startsWith('chicago')) return 'chicago';
  if (lower.startsWith('harvard')) return 'harvard';
  if (lower.startsWith('ieee')) return 'ieee';
  return undefined;
}

// Research types
export interface ResearchResource {
  id: string;
  type: 'url' | 'upload' | 'generated';
  title: string;
  url?: string;
  filePath?: string;
  summary?: string;
  isSelected: boolean;
}

// Outline types
export interface OutlineSection {
  id: string;
  type: 'front_matter' | 'chapter' | 'back_matter';
  title: string;
  description?: string;
  status: 'pending' | 'generating' | 'complete';
  wordCount?: number;
}

// Author info types
export interface AuthorInfo {
  name: string;
  title: string;
  aboutAuthor: string;
  photoUrl?: string;
}

// Cover types
export interface CoverConfig {
  frontCoverUrl?: string;
  frontCoverPrompt?: string;
  frontCoverRegenerations: number;
  /**
   * 'generated' (default — AI-produced art that needs the title/author
   * overlay) or 'uploaded' (writer brought their own art via
   * /api/projects/[id]/cover-upload).
   */
  frontCoverSource?: 'generated' | 'uploaded';
  /**
   * Set on uploaded covers. When true, downstream renderers (PDF, Visual
   * Audiobook, Cinematic Livebook) skip the title/author overlay because
   * the uploaded artwork already includes it.
   */
  frontCoverHasTypography?: boolean;
  backCoverUrl?: string;
  backCoverPrompt?: string;
  backCoverRegenerations: number;
}

// Full session state
export interface InterviewSession {
  id: string;
  projectId: string;
  userId: string;
  currentAgent: AgentName;
  agentStatus: AgentStatusMap;
  
  // Agent data
  validationData: {
    topic?: string;
    score?: ValidationScore;
    chosenTopic?: string;
  };
  interviewData: {
    questions: InterviewQuestion[];
    currentQuestionIndex: number;
    completed: boolean;
  };
  researchData: {
    resources: ResearchResource[];
    approved: boolean;
  };
  outlineData: {
    sections: OutlineSection[];
    approved: boolean;
  };
  writingData: {
    currentChapter: number;
    totalChapters: number;
    progress: number;
  };
  qaData: {
    legalAcknowledged: boolean;
    acknowledgedAt?: string;
  };
  
  // Author & Cover (structured)
  authorInfo: AuthorInfo;
  coverConfig: CoverConfig;
  followUpData: Record<string, string>;
  
  // Database fields (direct from DB)
  book_title?: string | null;
  author_name?: string | null;
  about_author?: string | null;
  author_photo_url?: string | null;
  front_cover_url?: string | null;
  front_cover_prompt?: string | null;
  front_cover_regenerations?: number;
  front_cover_source?: 'generated' | 'uploaded';
  front_cover_has_typography?: boolean;
  back_cover_url?: string | null;
  back_cover_prompt?: string | null;
  back_cover_regenerations?: number;
  
  createdAt: string;
  updatedAt: string;
}

// Credit costs
export const CREDIT_COSTS = {
  CHAPTER_REGENERATE: 100,
  FRONT_COVER_REGENERATE: 200,
  BACK_COVER_REGENERATE: 200,
  MANUAL_EDIT: 0, // FREE
  FIRST_COVER_GENERATION: 0, // FREE
} as const;

// KDP specifications
export const KDP_SPECS = {
  // Standard trim sizes
  TRIM_SIZES: {
    '5x8': { width: 5, height: 8, bleed: 0.125 },
    '5.5x8.5': { width: 5.5, height: 8.5, bleed: 0.125 },
    '6x9': { width: 6, height: 9, bleed: 0.125 }, // Most common
    '7x10': { width: 7, height: 10, bleed: 0.125 },
  },
  // Cover dimensions (in pixels at 300 DPI)
  COVER: {
    FRONT: { width: 1800, height: 2700 }, // 6x9 at 300 DPI
    SPINE_PER_PAGE: 0.002252, // inches per page
    SAFE_ZONE: 0.25, // inches from edge for text
  },
} as const;
