import { SupabaseClient } from '@supabase/supabase-js';

/**
 * A consolidated "brief" assembled from the interview_sessions row for a project.
 * Every downstream agent (research, outline, writing, qa) needs this same bundle
 * so this loader is the single source of truth.
 */
export interface AgentBrief {
  projectId: string;
  userId: string;
  contentType: string;

  // From validate stage
  chosenIdea: string;
  positioning?: string;
  targetAudience?: string;
  uniqueAngle?: string;
  validationScore?: {
    total: number;
    verdict: string;
    breakdown: Record<string, number>;
    strengths: string[];
    weaknesses: string[];
  };

  // From interview stage
  interviewAnswers: Array<{ question: string; answer: string }>;
  followUp: {
    chapters?: string;   // e.g. "5-8 (Quick read)"
    audience?: string;   // e.g. "Professionals"
    market?: string;     // e.g. "Global audience"
    style?: string;      // e.g. "Conversational"
  };

  // From research stage (if past it)
  selectedResearch: Array<{
    id: string;
    type: string;
    title: string;
    summary?: string;
    url?: string;
  }>;

  // Author info
  authorName?: string;
  aboutAuthor?: string;
}

/**
 * Load the full brief for a project. Fails loudly if the project or session
 * doesn't exist — the caller should return a 404 or 400.
 */
export async function loadAgentBrief(
  supabase: SupabaseClient,
  projectId: string,
  userId: string
): Promise<AgentBrief> {
  // Project (gives content_type + title fallback)
  const { data: project, error: projectErr } = await supabase
    .from('projects')
    .select('id, user_id, title, description, content_type')
    .eq('id', projectId)
    .eq('user_id', userId)
    .single();

  if (projectErr || !project) {
    throw new Error('Project not found or not owned by user');
  }

  // Interview session (single row per project)
  const { data: session, error: sessionErr } = await supabase
    .from('interview_sessions')
    .select('*')
    .eq('project_id', projectId)
    .eq('user_id', userId)
    .single();

  if (sessionErr || !session) {
    throw new Error('Interview session not found');
  }

  // Pull validate data
  const v = (session.validation_data || {}) as Record<string, any>;
  const chosenIdea = v.chosenTopic || v.topic || session.book_title || project.title;
  const validationScore = v.score
    ? {
        total: v.score.total,
        verdict: v.score.verdict,
        breakdown: v.score.breakdown,
        strengths: v.score.strengths || [],
        weaknesses: v.score.weaknesses || [],
      }
    : undefined;

  // Interview answers: stored as array of { question, answer } or { questions: [...] }
  const interviewData = (session.interview_data || {}) as Record<string, any>;
  let interviewAnswers: Array<{ question: string; answer: string }> = [];
  if (Array.isArray(interviewData.questions)) {
    interviewAnswers = interviewData.questions
      .filter((q: any) => q.answer && q.answer.trim())
      .map((q: any) => ({ question: q.question, answer: q.answer }));
  }

  // Follow-up answers
  const followUp = (session.follow_up_data || {}) as Record<string, string>;

  // Selected research resources (only if research stage has run)
  const { data: researchRows } = await supabase
    .from('research_resources')
    .select('id, resource_type, title, content_summary, url')
    .eq('session_id', session.id)
    .eq('is_selected', true)
    .order('created_at');

  const selectedResearch = (researchRows || []).map((r) => ({
    id: r.id,
    type: r.resource_type,
    title: r.title,
    summary: r.content_summary || undefined,
    url: r.url || undefined,
  }));

  return {
    projectId: project.id,
    userId: project.user_id,
    contentType: project.content_type || 'book',
    chosenIdea,
    positioning: v.positioning,
    targetAudience: v.targetAudience,
    uniqueAngle: v.uniqueAngle,
    validationScore,
    interviewAnswers,
    followUp: {
      chapters: followUp.chapters,
      audience: followUp.audience,
      market: followUp.market,
      style: followUp.style,
    },
    selectedResearch,
    authorName: session.author_name || undefined,
    aboutAuthor: session.about_author || undefined,
  };
}

/**
 * Pretty-format the brief for inclusion in an AI system prompt.
 */
export function formatBriefForPrompt(brief: AgentBrief): string {
  const parts: string[] = [];

  parts.push(`## The Book Idea`);
  parts.push(`Title / Topic: ${brief.chosenIdea}`);
  if (brief.positioning) parts.push(`Positioning: ${brief.positioning}`);
  if (brief.targetAudience) parts.push(`Target audience: ${brief.targetAudience}`);
  if (brief.uniqueAngle) parts.push(`Unique angle: ${brief.uniqueAngle}`);
  parts.push(`Content type: ${brief.contentType}`);

  if (brief.validationScore) {
    parts.push(`Market evaluation score: ${brief.validationScore.total}/100 (${brief.validationScore.verdict})`);
    if (brief.validationScore.strengths.length > 0) {
      parts.push(`Strengths to preserve: ${brief.validationScore.strengths.join('; ')}`);
    }
    if (brief.validationScore.weaknesses.length > 0) {
      parts.push(`Weaknesses to mitigate: ${brief.validationScore.weaknesses.join('; ')}`);
    }
  }

  if (brief.interviewAnswers.length > 0) {
    parts.push(`\n## Author Interview Answers`);
    brief.interviewAnswers.forEach((qa, i) => {
      parts.push(`${i + 1}. ${qa.question}\n   → ${qa.answer}`);
    });
  }

  const fu = brief.followUp;
  if (fu.chapters || fu.audience || fu.market || fu.style) {
    parts.push(`\n## Author Preferences`);
    if (fu.chapters) parts.push(`Chapter count preference: ${fu.chapters}`);
    if (fu.audience) parts.push(`Primary audience: ${fu.audience}`);
    if (fu.market) parts.push(`Target market: ${fu.market}`);
    if (fu.style) parts.push(`Writing style: ${fu.style}`);
  }

  if (brief.selectedResearch.length > 0) {
    parts.push(`\n## Research Foundation (author-approved)`);
    brief.selectedResearch.forEach((r, i) => {
      parts.push(`${i + 1}. [${r.type}] ${r.title}${r.summary ? ` — ${r.summary}` : ''}${r.url ? ` (${r.url})` : ''}`);
    });
  }

  if (brief.authorName || brief.aboutAuthor) {
    parts.push(`\n## About the Author`);
    if (brief.authorName) parts.push(`Name: ${brief.authorName}`);
    if (brief.aboutAuthor) parts.push(`Bio: ${brief.aboutAuthor}`);
  }

  return parts.join('\n');
}

/**
 * Determine chapter count from author's preference string.
 */
export function resolveChapterCount(followUpChapters: string | undefined, fallback = 10): number {
  if (!followUpChapters) return fallback;
  // Pick first number in the string, or a representative count
  if (followUpChapters.includes('5-8')) return 7;
  if (followUpChapters.includes('10-15')) return 12;
  if (followUpChapters.includes('15-20')) return 17;
  if (followUpChapters.includes('20+')) return 22;
  const match = followUpChapters.match(/\d+/);
  return match ? parseInt(match[0], 10) : fallback;
}
