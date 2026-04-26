'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { OutlineSection, CREDIT_COSTS } from '@/types/agent-workflow';
import { cn } from '@/lib/utils';
import { t, type Locale } from '@/lib/i18n/strings';
import {
  PenTool,
  CheckCircle2,
  Circle,
  Loader2,
  Edit3,
  RefreshCw,
  Coins,
  AlertTriangle,
  AlertOctagon,
} from 'lucide-react';

/**
 * Pipeline health states surfaced to the user.
 *
 * active     — normal operation; no banner
 * stuck      — stuck-detector flagged a stale heartbeat; auto-recovery
 *              cron hasn't picked it up yet, or it's in-flight
 * recovering — retry fired; waiting for the restart consumer to
 *              make progress
 * failed     — auto-recovery budget exhausted; session is dead; user
 *              needs the resume affordance
 * completed  — writing done; shouldn't render here but typed for
 *              completeness
 * user_abandoned — user walked away; not relevant to the writing UI
 */
export type PipelineStatus =
  | 'active'
  | 'stuck'
  | 'recovering'
  | 'failed'
  | 'completed'
  | 'user_abandoned';

interface WritingScreenProps {
  bookTitle: string;
  chapters: OutlineSection[];
  currentChapterIndex: number;
  currentChapterContent: string;
  isWriting: boolean;
  userCredits: number;
  onEditChapter: (chapterId: string, content: string) => void;
  onRegenerateChapter: (chapterId: string, instructions?: string) => void;
  locale?: Locale;
  // Pipeline health — all optional; absent means 'active'. Supplied by
  // the editor page from the SSE session_update payload.
  pipelineStatus?: PipelineStatus;
  pipelineFailureReason?: string | null;
  failureCount?: number;
  onRetryWriting?: () => void;
  // CEO-060 — manual advance to QA. Used when the user landed on the
  // writing screen with the run already finished (closed tab mid-write,
  // SSE 'complete' event missed). When absent, the recovery banner is
  // not shown — the editor page is the source of truth for whether
  // advance is wired.
  onContinueToQA?: () => void;
}

export function WritingScreen({
  bookTitle,
  chapters,
  currentChapterIndex,
  currentChapterContent,
  isWriting,
  userCredits,
  onEditChapter,
  onRegenerateChapter,
  locale = 'en',
  pipelineStatus = 'active',
  pipelineFailureReason = null,
  failureCount = 0,
  onRetryWriting,
  onContinueToQA,
}: WritingScreenProps) {
  const [editingChapterId, setEditingChapterId] = useState<string | null>(null);
  const [editContent, setEditContent] = useState('');
  const [regenChapterId, setRegenChapterId] = useState<string | null>(null);
  const [regenInstructions, setRegenInstructions] = useState('');

  const completedChapters = chapters.filter(c => c.status === 'complete').length;
  // Guard: when chapters haven't been populated yet (outline still generating,
  // SSE stream hasn't delivered the first chapter row, etc.) we'd otherwise
  // produce 0/0 = NaN → render as "NaN% complete" and a broken progress bar.
  // A 0% value is the correct representation of "nothing done yet".
  const progress = chapters.length > 0
    ? (completedChapters / chapters.length) * 100
    : 0;
  const totalWords = chapters.reduce((sum, c) => sum + (c.wordCount || 0), 0);
  // Guard the chapter counter display the same way. Before the outline
  // populates, chapters.length is 0 and currentChapterIndex defaults to 0,
  // which would render "Currently writing: Chapter 1 / 0" — nonsense to the
  // author. Show "Chapter 0 / 0" until real chapters arrive; the header
  // message is suppressed further down when the count is 0.
  const hasChapters = chapters.length > 0;
  const displayChapterCount = hasChapters ? currentChapterIndex + 1 : 0;

  const currentChapter = chapters[currentChapterIndex];

  const handleStartEdit = (chapter: OutlineSection) => {
    setEditingChapterId(chapter.id);
    // In real implementation, load the chapter content
    setEditContent(currentChapterContent);
  };

  const handleStartRegenerate = (chapterId: string) => {
    setRegenChapterId(chapterId);
    setRegenInstructions('');
  };

  const handleConfirmRegenerate = () => {
    if (!regenChapterId) return;
    onRegenerateChapter(regenChapterId, regenInstructions.trim() || undefined);
    setRegenChapterId(null);
    setRegenInstructions('');
  };
  
  const handleSaveEdit = () => {
    if (editingChapterId) {
      onEditChapter(editingChapterId, editContent);
      setEditingChapterId(null);
      setEditContent('');
    }
  };
  
  const canRegenerate = userCredits >= CREDIT_COSTS.CHAPTER_REGENERATE;

  return (
    <div className="flex-1 flex flex-col p-6 overflow-hidden">
      {/* Header */}
      <div className="mb-4">
        <div className="flex items-center gap-2 mb-2">
          <PenTool className="h-5 w-5 text-primary" />
          <h1 className="text-xl font-bold">{t('writing.title', locale)}</h1>
        </div>
        <p className="text-sm text-muted-foreground">
          {t('writing.subtitle', locale)}
        </p>
      </div>

      {/* CEO-060 — Writing-complete recovery CTA.

          Bug being fixed: when the writing run finishes, the editor's
          SSE 'complete' handler auto-advances to QA. But if the user
          closed their tab mid-write (or just lost connection at the
          wrong moment) they come back to a screen that says "100%
          complete" with no obvious way forward and the book FEELS
          stuck. Founder hit this on his own book "The Rewired Self"
          on 2026-04-24 — chapters were all written but the UI offered
          no advance control.

          The banner only renders when we KNOW the run is done AND
          the parent has wired `onContinueToQA`. Two completion
          signals satisfy "done": (a) pipelineStatus === 'completed'
          (server-authoritative — the inngest writing function flips
          this when the last chapter lands), or (b) every chapter row
          we know about is in 'complete' status AND we are not still
          actively writing (so we ignore the transient pre-status-
          flip moment). hasChapters guards the empty-outline edge
          case; without it a 0/0 ratio would also satisfy condition
          (b) and we'd flash the banner before any work has happened. */}
      {onContinueToQA && hasChapters && !isWriting && (
        pipelineStatus === 'completed' ||
        completedChapters === chapters.length
      ) && (
        <div className="mb-4 rounded-xl border border-emerald-200 bg-emerald-50 p-4 dark:border-emerald-900/50 dark:bg-emerald-950/30">
          <div className="flex items-start gap-3">
            <div className="mt-0.5 flex-shrink-0 rounded-full bg-emerald-100 p-1.5 dark:bg-emerald-900/50">
              <CheckCircle2 className="h-4 w-4 text-emerald-700 dark:text-emerald-300" />
            </div>
            <div className="flex-1 min-w-0">
              <h3 className="text-sm font-semibold text-emerald-900 dark:text-emerald-100">
                {t('writing.allDoneHeading', locale)}
              </h3>
              <p className="mt-1 text-sm text-emerald-800/90 dark:text-emerald-200/80">
                {t('writing.allDoneBody', locale)}
              </p>
            </div>
            <Button
              size="sm"
              onClick={onContinueToQA}
              className="flex-shrink-0 bg-emerald-600 hover:bg-emerald-700 text-white"
            >
              {t('writing.continueToQA', locale)}
            </Button>
          </div>
        </div>
      )}

      {/* Pipeline health banner — shown only when the run is in a
          non-happy state. Drives the founder's P0 fix: before this
          landed, a silently-dead writing agent produced a spinner
          forever. Now the banner reflects real session state as the
          stuck detector and auto-recovery cron update it. */}
      <PipelineHealthBanner
        status={pipelineStatus}
        failureReason={pipelineFailureReason}
        failureCount={failureCount}
        onRetry={onRetryWriting}
      />
      
      {/* Progress Bar — single row: "Chapter X/Y · N words" on left,
          "N% complete" on right, slim 1.5px bar underneath. Was three
          stacked rows (label, bar, %age) = 3× vertical spend.

          When chapters.length === 0 (outline still generating, or the
          writing agent entered before chapter rows streamed in) we render
          a neutral "preparing" state instead of "Chapter 1 / 0 · NaN%". */}
      <div className="mb-4">
        <div className="flex items-center justify-between text-xs mb-1.5">
          <span className="text-muted-foreground">
            {hasChapters ? (
              <>
                {t('writing.currentlyWriting', locale)} {displayChapterCount} / {chapters.length}
                {totalWords > 0 && (
                  <span className="ml-2 text-muted-foreground/70">
                    · {totalWords.toLocaleString()} {t('writing.words', locale)}
                  </span>
                )}
              </>
            ) : (
              <span className="italic">{t('writing.preparing', locale)}</span>
            )}
          </span>
          <span className="text-muted-foreground">
            {Math.round(progress)}% {t('writing.complete', locale)}
          </span>
        </div>
        <div className="h-1.5 bg-muted rounded-full overflow-hidden">
          <div
            className="h-full bg-primary/80 transition-all duration-700 ease-out"
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>
      
      {/* Main Content Area */}
      <div className="flex-1 flex gap-4 overflow-hidden">
        {/* Live Writing View */}
        <div className="flex-1 overflow-hidden flex flex-col">
          <div className="flex-1 rounded-xl border bg-white dark:bg-zinc-900 shadow-lg overflow-hidden flex flex-col">
            {/* Chapter Header */}
            <div className="p-4 border-b">
              <h2 className="text-lg font-semibold">
                {currentChapter?.title || t('writing.writing', locale)}
              </h2>
            </div>
            
            {/* Chapter Content */}
            <div className="flex-1 overflow-y-auto p-6">
              {editingChapterId === currentChapter?.id ? (
                <textarea
                  value={editContent}
                  onChange={(e) => setEditContent(e.target.value)}
                  className="w-full h-full min-h-[300px] resize-none focus:outline-none text-base leading-relaxed"
                  placeholder={t('writing.editPlaceholder', locale)}
                />
              ) : (
                <div className="prose dark:prose-invert max-w-none">
                  {currentChapterContent ? (
                    <>
                      {currentChapterContent}
                      {isWriting && (
                        <span className="inline-block w-2 h-5 bg-primary animate-pulse ml-1" />
                      )}
                    </>
                  ) : (
                    <div className="flex items-center justify-center h-32 text-muted-foreground">
                      <Loader2 className="h-6 w-6 animate-spin mr-2" />
                      {t('writing.generating', locale)}
                    </div>
                  )}
                </div>
              )}
            </div>
            
            {/* Chapter Actions */}
            {currentChapter?.status === 'complete' && (
              <div className="p-3 border-t bg-muted/30 flex gap-2">
                {editingChapterId === currentChapter.id ? (
                  <>
                    <Button 
                      variant="outline" 
                      size="sm"
                      onClick={() => setEditingChapterId(null)}
                    >
                      {t('writing.cancel', locale)}
                    </Button>
                    <Button size="sm" onClick={handleSaveEdit}>
                      {t('writing.saveFree', locale)}
                    </Button>
                  </>
                ) : regenChapterId === currentChapter.id ? (
                  <div className="w-full space-y-2">
                    <div className="flex items-center justify-between">
                      <label className="text-xs font-medium text-muted-foreground">
                        {t('writing.rewriteHint', locale)}
                      </label>
                      <button
                        onClick={() => setRegenChapterId(null)}
                        className="text-xs text-muted-foreground hover:text-foreground"
                      >
                        {t('writing.cancel', locale)}
                      </button>
                    </div>
                    <Textarea
                      value={regenInstructions}
                      onChange={(e) => setRegenInstructions(e.target.value)}
                      placeholder={t('writing.rewritePlaceholder', locale)}
                      className="min-h-[60px] text-sm"
                    />
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        onClick={handleConfirmRegenerate}
                        disabled={!canRegenerate}
                      >
                        <RefreshCw className="mr-2 h-3 w-3" />
                        {t('writing.regenerate', locale)} ({CREDIT_COSTS.CHAPTER_REGENERATE} {t('writing.credits', locale)})
                      </Button>
                    </div>
                  </div>
                ) : (
                  <>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleStartEdit(currentChapter)}
                    >
                      <Edit3 className="mr-2 h-3 w-3" />
                      {t('writing.manualEditFree', locale)}
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleStartRegenerate(currentChapter.id)}
                      disabled={!canRegenerate}
                    >
                      <RefreshCw className="mr-2 h-3 w-3" />
                      {t('writing.regenerate', locale)}
                      <span className="ml-1 text-xs opacity-70">
                        ({CREDIT_COSTS.CHAPTER_REGENERATE} {t('writing.credits', locale)})
                      </span>
                    </Button>
                  </>
                )}
              </div>
            )}
          </div>
        </div>
        
        {/* Chapter List Sidebar — hidden entirely when no chapters yet.
            During the first write, chapters.length is 0 and this column
            would render as a 256px dark void. Reclaim the space for the
            writing surface until chapters actually exist. */}
        {chapters.length > 0 && (
        <div className="w-64 overflow-y-auto shrink-0">
          <h3 className="font-semibold mb-3 text-sm">{t('writing.chapterProgress', locale)}</h3>
          <div className="space-y-2">
            {chapters.map((chapter, idx) => (
              <div
                key={chapter.id}
                className={cn(
                  'rounded-lg border p-3 transition-colors',
                  idx === currentChapterIndex && 'border-primary bg-primary/5',
                  chapter.status === 'complete' && idx !== currentChapterIndex && 'bg-muted/30'
                )}
              >
                <div className="flex items-center gap-2">
                  {chapter.status === 'complete' ? (
                    <CheckCircle2 className="h-4 w-4 text-green-500 flex-shrink-0" />
                  ) : chapter.status === 'generating' ? (
                    <Loader2 className="h-4 w-4 text-primary animate-spin flex-shrink-0" />
                  ) : (
                    <Circle className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                  )}
                  <span className={cn(
                    'text-sm truncate',
                    chapter.status === 'pending' && 'text-muted-foreground'
                  )}>
                    {t('writing.chapterPrefix', locale)} {idx + 1}: {chapter.title}
                  </span>
                </div>
                {chapter.wordCount && (
                  <div className="text-xs text-muted-foreground mt-1 ml-6">
                    {chapter.wordCount.toLocaleString()} {t('writing.wordsSuffix', locale)}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
        )}
      </div>
      
      {/* Credit Warning */}
      {!canRegenerate && (
        <div className="mt-4 p-3 rounded-lg bg-amber-500/10 border border-amber-500/30 flex items-center gap-2">
          <Coins className="h-4 w-4 text-amber-500" />
          <span className="text-sm">
            {t('writing.lowCredits', locale)} ({userCredits})
          </span>
        </div>
      )}
    </div>
  );
}

/**
 * PipelineHealthBanner
 *
 * Renders above the writing UI when the session is in a non-happy
 * pipeline_status. Silent during normal writing.
 *
 * Copy is deliberately warm and concrete rather than technical: an
 * author watching their book get written doesn't care that "agent_heartbeat_at
 * exceeded the 15-minute threshold." They care that something's off
 * and that someone's on it.
 *
 * For 'failed' we render an actionable retry button. For 'stuck' and
 * 'recovering' we render reassurance only — the auto-recovery cron is
 * already acting; there's nothing for the user to do.
 */
function PipelineHealthBanner({
  status,
  failureReason,
  failureCount,
  onRetry,
}: {
  status: PipelineStatus;
  failureReason: string | null;
  failureCount: number;
  onRetry?: () => void;
}) {
  if (status === 'active' || status === 'completed' || status === 'user_abandoned') {
    return null;
  }

  if (status === 'stuck') {
    return (
      <div className="mb-4 p-4 rounded-lg bg-amber-500/10 border border-amber-500/40">
        <div className="flex items-start gap-3">
          <AlertTriangle className="h-5 w-5 text-amber-500 shrink-0 mt-0.5" />
          <div className="flex-1">
            <p className="text-sm font-semibold text-amber-200">
              Taking longer than usual
            </p>
            <p className="text-sm text-amber-100/80 mt-1 leading-relaxed">
              Our team is already looking into it. Your progress is saved —
              you don&apos;t need to do anything. We&apos;ll email you the moment
              it&apos;s ready.
            </p>
          </div>
        </div>
      </div>
    );
  }

  if (status === 'recovering') {
    const attemptLabel =
      failureCount > 0 ? ` (attempt ${failureCount})` : '';
    return (
      <div className="mb-4 p-4 rounded-lg bg-sky-500/10 border border-sky-500/40">
        <div className="flex items-start gap-3">
          <Loader2 className="h-5 w-5 text-sky-400 shrink-0 mt-0.5 animate-spin" />
          <div className="flex-1">
            <p className="text-sm font-semibold text-sky-200">
              Retrying your last step{attemptLabel}
            </p>
            <p className="text-sm text-sky-100/80 mt-1 leading-relaxed">
              We hit a bump and we&apos;re picking things back up. Stay on the
              page — this usually resolves within a minute or two.
            </p>
          </div>
        </div>
      </div>
    );
  }

  // status === 'failed'
  return (
    <div className="mb-4 p-4 rounded-lg bg-red-500/10 border border-red-500/40">
      <div className="flex items-start gap-3">
        <AlertOctagon className="h-5 w-5 text-red-400 shrink-0 mt-0.5" />
        <div className="flex-1">
          <p className="text-sm font-semibold text-red-200">
            We hit a problem writing your book
          </p>
          <p className="text-sm text-red-100/80 mt-1 leading-relaxed">
            Your progress is saved. You can resume from the last completed
            step, or reach out to support if this keeps happening.
          </p>
          {failureReason && (
            <details className="mt-2 text-xs text-red-100/60">
              <summary className="cursor-pointer hover:text-red-100/90">
                Show technical details
              </summary>
              <pre className="mt-2 p-2 rounded bg-red-950/30 font-mono whitespace-pre-wrap break-words">
                {failureReason}
              </pre>
            </details>
          )}
          <div className="mt-3 flex items-center gap-2">
            {onRetry && (
              <Button
                size="sm"
                onClick={onRetry}
                className="bg-red-500 hover:bg-red-600 text-white"
              >
                <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
                Resume from last step
              </Button>
            )}
            <a
              href="mailto:support@penworth.ai?subject=Document%20generation%20problem"
              className="text-xs text-red-200 hover:text-red-100 underline underline-offset-2"
            >
              Contact support
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}
