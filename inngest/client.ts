import { Inngest } from 'inngest';

// ============================================================================
// Shared writing-pipeline types
// ----------------------------------------------------------------------------
// These shapes are referenced by both the orchestrator (write-book.ts) and
// the per-chapter worker (write-chapter.ts). They live here so the worker
// does not have to depend on the orchestrator for plain type definitions
// (which would create an awkward circular import once writeSection is also
// imported worker-side).
// ============================================================================

/**
 * Template flavor + label vocabulary that drives writing-prompt construction.
 */
export interface TemplateMeta {
  flavor:
    | 'narrative'
    | 'instructional'
    | 'academic'
    | 'business'
    | 'legal'
    | 'technical'
    | 'reference'
    | 'short_form';
  bodyLabelSingular: string;
  bodyLabelPlural: string;
  bodyIsVariable: boolean;
  requiresCitations: boolean;
  writingStyleGuide: string;
  citationStyle?: string;
}

/**
 * Voice profile derived from the interview agent. Persisted on
 * interview_sessions.voice_profile (migration 024) and re-passed into every
 * writing step so retries and fan-out workers see the same voice.
 */
export interface VoiceProfile {
  tone: string;
  style: string;
  vocabulary: string;
}

// ============================================================================
// Event payload types
// ============================================================================

export interface BookWriteEventData {
  projectId: string;
  userId: string;
  title: string;
  description: string;
  outline: {
    chapters: Array<{
      title: string;
      description: string;
      keyPoints: string[];
    }>;
  };
  industry: string;
  voiceProfile?: VoiceProfile;
}

export interface ChapterRegenerateEventData {
  projectId: string;
  chapterId: string;
  userId: string;
  instructions?: string;
}

export interface BookExportEventData {
  projectId: string;
  userId: string;
  format: 'pdf' | 'docx' | 'epub';
}

/**
 * Payload for `chapter/write` events.
 *
 * One emitted per body section by the writeBook orchestrator when the
 * CHAPTER_FANOUT_ENABLED feature flag is on. The orchestrator serialises
 * everything writeSection needs into this shape so each fan-out worker is
 * self-contained — no shared in-process context survives across Inngest
 * function boundaries.
 *
 * `prior` is intentionally empty in the fan-out path: chapters fan out
 * concurrently, so there is no chronological "previously written" handoff
 * to pass. Pre-computing chapter summaries before fan-out is scoped as a
 * follow-up task (see docs/briefs/2026-04-26-ceo-051-chapter-fanout.md,
 * Out of scope #2).
 */
export interface ChapterWriteEventData {
  // Identity
  projectId: string;
  userId: string;
  sessionId: string | null;
  // Slot
  orderIndex: number;
  bodyNumber: number;
  // Content
  title: string;
  description: string;
  keyPoints: string[];
  targetWords: number;
  // Shared book context (passed verbatim from orchestrator)
  docTitle: string;
  industry: string;
  meta: TemplateMeta;
  voiceProfile?: VoiceProfile;
  projectCtx: {
    chosenIdea: string;
    authorName?: string;
    aboutAuthor?: string;
    citationStyle?: string;
    research: Array<{
      title: string;
      url?: string | null;
      content_summary?: string | null;
      resource_type?: string;
    }>;
    language: string;
  };
  prior: string;
}

/**
 * Payload for `chapter/completed` events.
 *
 * Emitted by the per-chapter worker after writeSection returns. The
 * orchestrator's step.waitForEvent matches on data.projectId AND
 * data.orderIndex to identify which slot this completion fills, so both
 * fields must be present and accurate.
 */
export interface ChapterCompletedEventData {
  projectId: string;
  sessionId: string | null;
  orderIndex: number;
  chapterId: string;
  wordCount: number;
}

// Create Inngest client
export const inngest = new Inngest({
  id: 'penworth',
});
