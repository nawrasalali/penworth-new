'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { SegmentClientPayload, CheckpointClientPayload } from './page';
import { describeVoice, type SrtCue, type VoiceKey } from '@/lib/academy/segments';

// ---- Types -----------------------------------------------------------------

export interface AttemptHistoryClient {
  attempt_number: number;
  served_question_ns: number[];
  started_at: string;
  submitted_at: string | null;
  score: number | null;
  total: number | null;
  passed: boolean | null;
}

interface QuizConfig {
  pass_threshold_pct: number;
  max_attempts: number;
  lockout_days: number;
  questions_served_per_attempt: number;
}

interface QuizCheckpoint {
  after_segment: number;
  voice: string;
  question: string;
  options: string[];
  correct_index: number;
  explanation: string;
}

interface QuizPoolQuestion {
  n: number;
  question: string;
  options: string[];
  correct_index: number;
}

interface QuizPayload {
  version: 2;
  config?: QuizConfig;
  checkpoints?: QuizCheckpoint[];
  pool?: QuizPoolQuestion[];
}

interface ProgressClient {
  alreadyCompleted: boolean;
  quizPassed: boolean;
  quizScore: number | null;
  quizAttempts: number;
  quizAttemptsLockedUntil: string | null;
  attemptHistory: AttemptHistoryClient[];
}

interface ServedQuestion {
  n: number;
  question: string;
  options: string[];
}

interface QuizStartResponse {
  attempt_number?: number;
  attempts_remaining: number;
  locked_until: string | null;
  pass_threshold_pct: number;
  questions_served: ServedQuestion[];
  already_passed?: boolean;
  locked?: boolean;
  message?: string;
}

interface CompleteResponse {
  passed: boolean;
  score: number;
  total: number;
  threshold: number;
  pass_threshold_pct: number;
  attempt_number: number;
  attempts_remaining: number;
  locked_until: string | null;
  missed_question_ns: number[];
  activation: {
    activated: boolean;
    already_activated: boolean;
    referral_code: string | null;
    certificate_code: string | null;
    certificate_pdf_url: string | null;
    email_sent: boolean;
  } | null;
  already_passed?: boolean;
  locked?: boolean;
}

// ---- Constants -------------------------------------------------------------

const SEGMENT_COMPLETION_THRESHOLD = 0.95;
const SPEED_OPTIONS = [0.75, 1, 1.25, 1.5];

// ---- Component -------------------------------------------------------------

export default function ModuleContent(props: {
  moduleId: string;
  moduleSlug: string;
  moduleTitle: string;
  category: string;
  segments: SegmentClientPayload[];
  checkpoints: CheckpointClientPayload[];
  quiz: QuizPayload | null;
  progress: ProgressClient;
  memberDisplayName: string;
  academyAlreadyComplete: boolean;
}) {
  const router = useRouter();
  const isMandatory = props.category === 'mandatory';
  const config = props.quiz?.config ?? {
    pass_threshold_pct: 0.7,
    max_attempts: 3,
    lockout_days: 7,
    questions_served_per_attempt: 15,
  };

  // Segment progression — restored from localStorage if present
  const lsKey = `academy_${props.moduleSlug}_progress_v2`;
  const initialCompleted = useMemo(() => {
    if (props.progress.alreadyCompleted) return Array(props.segments.length).fill(true);
    if (typeof window === 'undefined') return Array(props.segments.length).fill(false);
    try {
      const raw = localStorage.getItem(lsKey);
      if (raw) {
        const parsed = JSON.parse(raw) as { completed: boolean[] };
        if (Array.isArray(parsed.completed) && parsed.completed.length === props.segments.length) {
          return parsed.completed;
        }
      }
    } catch {}
    return Array(props.segments.length).fill(false);
  }, [props.moduleSlug, props.segments.length, props.progress.alreadyCompleted, lsKey]);

  const [completed, setCompleted] = useState<boolean[]>(initialCompleted);
  const [activeIdx, setActiveIdx] = useState<number>(() => {
    const firstIncomplete = initialCompleted.findIndex((c) => !c);
    return firstIncomplete === -1 ? props.segments.length - 1 : firstIncomplete;
  });

  const [checkpointAState, setCheckpointAState] = useState<'pending' | 'correct' | 'cleared'>('pending');
  const [checkpointBState, setCheckpointBState] = useState<'pending' | 'correct' | 'cleared'>('pending');
  const [openCheckpoint, setOpenCheckpoint] = useState<'A' | 'B' | null>(null);
  const [showQuiz, setShowQuiz] = useState(false);

  // Persist progression
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      localStorage.setItem(lsKey, JSON.stringify({ completed }));
    } catch {}
  }, [completed, lsKey]);

  function markSegmentComplete(idx: number) {
    setCompleted((prev) => {
      if (prev[idx]) return prev;
      const next = [...prev];
      next[idx] = true;
      return next;
    });
    // After segment 3 → checkpoint A; after 5 → checkpoint B
    const seg = props.segments[idx];
    if (seg.index === 3 && checkpointAState === 'pending') {
      setOpenCheckpoint('A');
    } else if (seg.index === 5 && checkpointBState === 'pending') {
      setOpenCheckpoint('B');
    }
  }

  function isUnlocked(idx: number): boolean {
    if (idx === 0) return true;
    // Linear: must have completed all earlier segments
    for (let i = 0; i < idx; i++) {
      if (!completed[i]) return false;
    }
    // Checkpoint gates
    const prevSeg = props.segments[idx - 1];
    if (prevSeg.index === 3 && checkpointAState === 'pending') return false;
    if (prevSeg.index === 5 && checkpointBState === 'pending') return false;
    return true;
  }

  const allSegmentsComplete = completed.every(Boolean);
  const canStartQuiz = allSegmentsComplete && !props.progress.quizPassed;

  // --- render -------------------------------------------------------------

  if (props.progress.quizPassed) {
    return (
      <PassedView
        moduleTitle={props.moduleTitle}
        score={props.progress.quizScore ?? 0}
        attempts={props.progress.attemptHistory}
        academyAlreadyComplete={props.academyAlreadyComplete}
      />
    );
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[260px_1fr]">
      <SegmentSidebar
        segments={props.segments}
        completed={completed}
        activeIdx={activeIdx}
        onSelect={(i) => {
          // Back is unlocked any time (replay); forward only if unlocked
          if (i <= activeIdx || isUnlocked(i)) setActiveIdx(i);
        }}
        canSelect={(i) => i <= activeIdx || isUnlocked(i)}
        canStartQuiz={canStartQuiz}
        showQuiz={showQuiz}
        onStartQuiz={() => setShowQuiz(true)}
      />

      <div className="space-y-4">
        {showQuiz ? (
          <QuizPanel
            moduleId={props.moduleId}
            moduleSlug={props.moduleSlug}
            isMandatory={isMandatory}
            config={config}
            initialAttempts={props.progress.quizAttempts}
            initialLockedUntil={props.progress.quizAttemptsLockedUntil}
            onActivated={() => router.refresh()}
            onBack={() => setShowQuiz(false)}
          />
        ) : (
          <PlayerStage
            segment={props.segments[activeIdx]}
            isUnlocked={isUnlocked(activeIdx)}
            onSegmentComplete={() => markSegmentComplete(activeIdx)}
            onAdvance={() => {
              if (activeIdx < props.segments.length - 1 && isUnlocked(activeIdx + 1)) {
                setActiveIdx(activeIdx + 1);
              }
            }}
            isLastSegment={activeIdx === props.segments.length - 1}
            allSegmentsComplete={allSegmentsComplete}
            onStartQuiz={() => setShowQuiz(true)}
          />
        )}
      </div>

      {openCheckpoint && (
        <CheckpointModal
          letter={openCheckpoint}
          moduleId={props.moduleId}
          checkpoint={props.checkpoints.find((c) => c.letter === openCheckpoint)!}
          quizCheckpoint={props.quiz?.checkpoints?.find((c) => c.after_segment === (openCheckpoint === 'A' ? 3 : 5)) ?? null}
          onCleared={() => {
            if (openCheckpoint === 'A') setCheckpointAState('cleared');
            else setCheckpointBState('cleared');
            setOpenCheckpoint(null);
          }}
        />
      )}
    </div>
  );
}

// ---- Sidebar ---------------------------------------------------------------

function SegmentSidebar(props: {
  segments: SegmentClientPayload[];
  completed: boolean[];
  activeIdx: number;
  onSelect: (i: number) => void;
  canSelect: (i: number) => boolean;
  canStartQuiz: boolean;
  showQuiz: boolean;
  onStartQuiz: () => void;
}) {
  return (
    <aside className="space-y-1">
      <h3 className="px-3 pb-2 text-xs font-semibold uppercase tracking-widest text-[#8a8370]">Segments</h3>
      {props.segments.map((seg, i) => {
        const isActive = i === props.activeIdx && !props.showQuiz;
        const isDone = props.completed[i];
        const canSelect = props.canSelect(i);
        return (
          <button
            key={seg.key}
            type="button"
            onClick={() => canSelect && props.onSelect(i)}
            disabled={!canSelect}
            className={
              'w-full flex items-center gap-3 rounded-md px-3 py-2.5 text-left text-sm transition-colors ' +
              (isActive
                ? 'bg-[#d4af37]/15 text-[#e7e2d4] ring-1 ring-[#d4af37]/40'
                : canSelect
                ? 'text-[#c9c2b0] hover:bg-white/5'
                : 'text-[#5a564a] cursor-not-allowed opacity-60')
            }
          >
            <span
              className={
                'flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-medium ' +
                (isDone ? 'bg-[#d4af37] text-[#1a1d2e]' : isActive ? 'border border-[#d4af37] text-[#d4af37]' : 'border border-[#3a4259] text-[#8a8370]')
              }
            >
              {isDone ? '✓' : seg.index}
            </span>
            <span className="flex-1 leading-tight">{seg.title}</span>
            {!canSelect && <LockIcon />}
          </button>
        );
      })}

      <div className="my-3 h-px bg-white/5" />

      <button
        type="button"
        onClick={() => props.canStartQuiz && props.onStartQuiz()}
        disabled={!props.canStartQuiz}
        className={
          'w-full flex items-center gap-3 rounded-md px-3 py-2.5 text-left text-sm ' +
          (props.showQuiz
            ? 'bg-[#d4af37]/15 text-[#e7e2d4] ring-1 ring-[#d4af37]/40'
            : props.canStartQuiz
            ? 'text-[#c9c2b0] hover:bg-white/5'
            : 'text-[#5a564a] cursor-not-allowed opacity-60')
        }
      >
        <span
          className={
            'flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-medium ' +
            (props.canStartQuiz ? 'border border-[#d4af37] text-[#d4af37]' : 'border border-[#3a4259] text-[#8a8370]')
          }
        >Q</span>
        <span className="flex-1 leading-tight">End-of-course quiz</span>
        {!props.canStartQuiz && <LockIcon />}
      </button>
    </aside>
  );
}

function LockIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="11" width="18" height="11" rx="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </svg>
  );
}

// ---- Player stage ----------------------------------------------------------

function PlayerStage(props: {
  segment: SegmentClientPayload;
  isUnlocked: boolean;
  onSegmentComplete: () => void;
  onAdvance: () => void;
  isLastSegment: boolean;
  allSegmentsComplete: boolean;
  onStartQuiz: () => void;
}) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [speed, setSpeed] = useState(1);
  const [showCaptions, setShowCaptions] = useState(true);
  const [completionFired, setCompletionFired] = useState(false);

  // Reset state when segment changes
  useEffect(() => {
    setCurrentTime(0);
    setDuration(0);
    setIsPlaying(false);
    setCompletionFired(false);
  }, [props.segment.key]);

  const voice = describeVoice(props.segment.voice);
  const hasAudio = !!props.segment.audioUrl;
  const cues = props.segment.srtCues ?? [];

  const currentCueIdx = useMemo(() => {
    if (!cues.length) return -1;
    let lo = 0;
    let hi = cues.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const cue = cues[mid];
      if (currentTime < cue.startSec) hi = mid - 1;
      else if (currentTime > cue.endSec) lo = mid + 1;
      else return mid;
    }
    return Math.max(0, hi);
  }, [currentTime, cues]);

  function togglePlay() {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) audio.play().catch(() => {});
    else audio.pause();
  }

  function fireCompletion() {
    if (completionFired) return;
    setCompletionFired(true);
    props.onSegmentComplete();
  }

  return (
    <section className="rounded-xl border border-[#2a3149] bg-[#0f1424] overflow-hidden">
      {/* Top strip */}
      <div className="border-b border-[#2a3149] px-5 py-3 flex items-center justify-between flex-wrap gap-2">
        <div className="text-xs uppercase tracking-widest text-[#8a8370]">
          Segment {props.segment.index} of 6
        </div>
        <VoiceBadge voice={props.segment.voice} accent={voice.accent} displayName={voice.displayName} />
      </div>

      {/* Stage */}
      <div className="bg-[#FAEEDA] px-6 sm:px-10 py-10 min-h-[260px] flex flex-col items-center justify-center text-center">
        <div className="text-[10px] tracking-[0.18em] uppercase text-[#854F0B] mb-2">Penworth · Foundations</div>
        <h2 className="font-serif text-2xl sm:text-3xl font-medium text-[#412402] leading-tight max-w-2xl">
          {props.segment.title}
        </h2>

        {!hasAudio && (
          <p className="mt-6 text-sm text-[#854F0B]/70 max-w-md">
            Audio for this segment hasn&apos;t been generated yet. Use the button below to mark it as read and continue.
          </p>
        )}
      </div>

      {/* Captions */}
      {showCaptions && hasAudio && cues.length > 0 && (
        <div className="px-5 py-4 bg-[#0a0e1a] border-t border-[#2a3149] min-h-[72px]">
          <div className="text-[10px] uppercase tracking-widest text-[#5a564a] mb-1">Captions · English</div>
          <div className="text-base leading-snug text-[#e7e2d4]">
            {currentCueIdx >= 0 ? cues[currentCueIdx].text : <span className="text-[#5a564a]">…</span>}
          </div>
        </div>
      )}

      {/* Audio element */}
      {hasAudio && (
        <audio
          ref={audioRef}
          src={props.segment.audioUrl ?? undefined}
          preload="auto"
          onPlay={() => setIsPlaying(true)}
          onPause={() => setIsPlaying(false)}
          onLoadedMetadata={(e) => setDuration(e.currentTarget.duration || 0)}
          onTimeUpdate={(e) => {
            const t = e.currentTarget.currentTime;
            setCurrentTime(t);
            const d = e.currentTarget.duration || 0;
            if (d > 0 && t / d >= SEGMENT_COMPLETION_THRESHOLD) fireCompletion();
          }}
          onEnded={() => fireCompletion()}
        />
      )}

      {/* Transport */}
      <div className="px-5 py-4 border-t border-[#2a3149]">
        {hasAudio ? (
          <div className="flex items-center gap-3 flex-wrap">
            <button
              type="button"
              onClick={togglePlay}
              className="flex h-10 w-10 items-center justify-center rounded-full bg-[#d4af37] text-[#1a1d2e] hover:bg-[#e3c360] transition"
            >
              {isPlaying ? (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>
              ) : (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
              )}
            </button>

            <div className="flex-1 min-w-[160px] flex items-center gap-2">
              <span className="text-xs text-[#8a8370] tabular-nums w-10">{formatTime(currentTime)}</span>
              <input
                type="range"
                min={0}
                max={duration || 0}
                step={0.1}
                value={currentTime}
                onChange={(e) => {
                  const a = audioRef.current;
                  if (a) a.currentTime = Number(e.target.value);
                }}
                className="flex-1 accent-[#d4af37]"
              />
              <span className="text-xs text-[#8a8370] tabular-nums w-10">{formatTime(duration)}</span>
            </div>

            <select
              value={speed}
              onChange={(e) => {
                const v = Number(e.target.value);
                setSpeed(v);
                if (audioRef.current) audioRef.current.playbackRate = v;
              }}
              className="text-xs bg-[#141a2a] border border-[#2a3149] rounded px-2 py-1 text-[#c9c2b0]"
            >
              {SPEED_OPTIONS.map((s) => (
                <option key={s} value={s}>{s}×</option>
              ))}
            </select>

            <button
              type="button"
              onClick={() => setShowCaptions((v) => !v)}
              className="text-xs px-2 py-1 rounded border border-[#2a3149] text-[#c9c2b0] hover:bg-white/5"
              title="Toggle captions"
            >
              CC {showCaptions ? 'on' : 'off'}
            </button>
          </div>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span className="text-xs text-[#8a8370]">Text-only mode</span>
            <button
              type="button"
              onClick={fireCompletion}
              className="px-4 py-2 rounded-md bg-[#d4af37] text-[#1a1d2e] text-sm font-medium hover:bg-[#e3c360]"
              disabled={completionFired}
            >
              {completionFired ? 'Marked as read ✓' : 'Mark as read'}
            </button>
          </div>
        )}
      </div>

      {/* Footer / next */}
      <div className="border-t border-[#2a3149] px-5 py-3 flex items-center justify-between text-xs">
        <span className="text-[#5a564a]">
          ← Replay any prior segment · Forward locks until segment ends
        </span>
        {props.allSegmentsComplete && props.isLastSegment ? (
          <button
            type="button"
            onClick={props.onStartQuiz}
            className="px-3 py-1.5 rounded-md bg-[#d4af37] text-[#1a1d2e] text-xs font-medium hover:bg-[#e3c360]"
          >
            Start end-of-course quiz →
          </button>
        ) : completionFired && !props.isLastSegment ? (
          <button
            type="button"
            onClick={props.onAdvance}
            className="px-3 py-1.5 rounded-md border border-[#d4af37] text-[#d4af37] text-xs font-medium hover:bg-[#d4af37]/10"
          >
            Next segment →
          </button>
        ) : null}
      </div>
    </section>
  );
}

function VoiceBadge({ voice, accent, displayName }: { voice: VoiceKey; accent: string; displayName: string }) {
  const colorMap: Record<VoiceKey, string> = {
    brian: '#185FA5',
    charlotte: '#993556',
    daniel: '#0F6E56',
    rachel: '#993C1D',
  };
  const color = colorMap[voice];
  return (
    <div className="flex items-center gap-2">
      <span
        className="inline-flex h-6 w-6 items-center justify-center rounded-full text-[10px] font-medium text-white"
        style={{ background: color }}
      >
        {displayName[0]}
      </span>
      <span className="text-xs text-[#c9c2b0]">{displayName}</span>
      <span className="text-[10px] text-[#5a564a]">· {accent}</span>
    </div>
  );
}

function formatTime(s: number): string {
  if (!Number.isFinite(s) || s < 0) return '0:00';
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${String(sec).padStart(2, '0')}`;
}

// ---- Checkpoint modal ------------------------------------------------------

function CheckpointModal(props: {
  letter: 'A' | 'B';
  moduleId: string;
  checkpoint: CheckpointClientPayload;
  quizCheckpoint: QuizCheckpoint | null;
  onCleared: () => void;
}) {
  const cp = props.quizCheckpoint;
  const [selected, setSelected] = useState<number | null>(null);
  const [phase, setPhase] = useState<'asking' | 'wrong' | 'correct'>('asking');
  const [submitting, setSubmitting] = useState(false);

  // Effect runs unconditionally — auto-clears if no checkpoint is configured
  useEffect(() => {
    if (!cp) props.onCleared();
  }, [cp]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!cp) return null;

  async function submit() {
    if (cp === null || selected === null || submitting) return;
    const correctIndex = cp.correct_index;
    setSubmitting(true);
    try {
      const res = await fetch('/api/guild/academy/checkpoint', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          module_id: props.moduleId,
          after_segment: props.letter === 'A' ? 3 : 5,
          selected_index: selected,
        }),
      });
      const body = await res.json();
      if (body.correct) setPhase('correct');
      else setPhase('wrong');
    } catch {
      // Local fallback — compare against captured correct_index
      if (selected === correctIndex) setPhase('correct');
      else setPhase('wrong');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <div className="w-full max-w-lg rounded-xl border border-[#d4af37]/40 bg-[#0f1424] p-6 sm:p-8">
        <div className="text-xs uppercase tracking-widest text-[#d4af37] mb-3">Checkpoint {props.letter}</div>
        <h3 className="font-serif text-xl text-[#e7e2d4] leading-snug mb-5">{cp.question}</h3>

        <div className="space-y-2">
          {cp.options.map((opt, i) => {
            const isSelected = selected === i;
            const isCorrect = phase !== 'asking' && i === cp.correct_index;
            const isWrong = phase === 'wrong' && isSelected && i !== cp.correct_index;
            return (
              <button
                key={i}
                type="button"
                disabled={phase !== 'asking'}
                onClick={() => setSelected(i)}
                className={
                  'w-full text-left text-sm px-4 py-3 rounded-md border transition ' +
                  (isCorrect
                    ? 'border-[#0F6E56] bg-[#0F6E56]/15 text-[#9FE1CB]'
                    : isWrong
                    ? 'border-[#A32D2D] bg-[#A32D2D]/15 text-[#F09595]'
                    : isSelected
                    ? 'border-[#d4af37] bg-[#d4af37]/10 text-[#e7e2d4]'
                    : 'border-[#2a3149] text-[#c9c2b0] hover:bg-white/5')
                }
              >
                <span className="inline-block w-6 text-[#8a8370] font-medium">
                  {String.fromCharCode(65 + i)})
                </span>
                {opt}
              </button>
            );
          })}
        </div>

        {phase === 'wrong' && (
          <div className="mt-5 rounded-md border border-[#A32D2D]/30 bg-[#A32D2D]/10 p-4 text-sm text-[#F09595] leading-relaxed">
            {cp.explanation}
          </div>
        )}

        <div className="mt-6 flex justify-end gap-2">
          {phase === 'asking' ? (
            <button
              type="button"
              onClick={submit}
              disabled={selected === null || submitting}
              className="px-4 py-2 rounded-md bg-[#d4af37] text-[#1a1d2e] text-sm font-medium hover:bg-[#e3c360] disabled:opacity-50"
            >
              {submitting ? 'Checking…' : 'Submit'}
            </button>
          ) : (
            <button
              type="button"
              onClick={props.onCleared}
              className="px-4 py-2 rounded-md bg-[#d4af37] text-[#1a1d2e] text-sm font-medium hover:bg-[#e3c360]"
            >
              Continue →
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ---- Quiz panel ------------------------------------------------------------

function QuizPanel(props: {
  moduleId: string;
  moduleSlug: string;
  isMandatory: boolean;
  config: QuizConfig;
  initialAttempts: number;
  initialLockedUntil: string | null;
  onActivated: () => void;
  onBack: () => void;
}) {
  const [phase, setPhase] = useState<'idle' | 'loading' | 'taking' | 'submitting' | 'results' | 'locked'>(
    isLocked(props.initialLockedUntil) ? 'locked' : 'idle',
  );
  const [served, setServed] = useState<ServedQuestion[]>([]);
  const [answers, setAnswers] = useState<Record<number, number>>({});
  const [attemptNumber, setAttemptNumber] = useState<number>(0);
  const [attemptsRemaining, setAttemptsRemaining] = useState<number>(props.config.max_attempts - props.initialAttempts);
  const [lockedUntil, setLockedUntil] = useState<string | null>(props.initialLockedUntil);
  const [result, setResult] = useState<CompleteResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function startQuiz() {
    setPhase('loading');
    setError(null);
    try {
      const res = await fetch('/api/guild/academy/quiz-start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ module_id: props.moduleId }),
      });
      const body = (await res.json()) as QuizStartResponse;
      if (body.locked) {
        setLockedUntil(body.locked_until);
        setPhase('locked');
        return;
      }
      setServed(body.questions_served);
      setAttemptNumber(body.attempt_number ?? 0);
      setAttemptsRemaining(body.attempts_remaining);
      setLockedUntil(body.locked_until);
      setAnswers({});
      setPhase('taking');
    } catch (e: any) {
      setError(e?.message ?? 'Failed to start quiz');
      setPhase('idle');
    }
  }

  async function submit() {
    setPhase('submitting');
    setError(null);
    try {
      const payload = {
        module_id: props.moduleId,
        answers: served.map((q) => ({ question_n: q.n, selected_index: answers[q.n] ?? -1 })),
      };
      const res = await fetch('/api/guild/academy/complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const body = (await res.json()) as CompleteResponse;
      setResult(body);
      setAttemptsRemaining(body.attempts_remaining);
      setLockedUntil(body.locked_until);
      setPhase('results');
      if (body.activation?.activated) {
        // Give the celebration UI a moment, then refresh router so dashboard reflects
        setTimeout(() => props.onActivated(), 4000);
      }
    } catch (e: any) {
      setError(e?.message ?? 'Failed to submit');
      setPhase('taking');
    }
  }

  const allAnswered = served.length > 0 && served.every((q) => answers[q.n] !== undefined);

  if (phase === 'locked') {
    const until = lockedUntil ? new Date(lockedUntil) : null;
    return (
      <section className="rounded-xl border border-[#A32D2D]/40 bg-[#A32D2D]/5 p-6 sm:p-8">
        <h3 className="font-serif text-2xl text-[#F09595] mb-3">Quiz locked</h3>
        <p className="text-sm text-[#c9c2b0] leading-relaxed mb-4">
          You used all three attempts. The course re-opens for fresh attempts on {until?.toLocaleString() ?? 'a future date'}.
        </p>
        <button type="button" onClick={props.onBack} className="text-sm text-[#d4af37] hover:underline">
          ← Back to segments
        </button>
      </section>
    );
  }

  if (phase === 'idle') {
    return (
      <section className="rounded-xl border border-[#2a3149] bg-[#0f1424] p-6 sm:p-8">
        <div className="text-xs uppercase tracking-widest text-[#d4af37] mb-2">End-of-course quiz</div>
        <h3 className="font-serif text-2xl text-[#e7e2d4] mb-4">Ready when you are.</h3>
        <ul className="space-y-2 text-sm text-[#c9c2b0] mb-6">
          <li>· {props.config.questions_served_per_attempt} questions, drawn at random from a larger pool</li>
          <li>· {Math.round(props.config.pass_threshold_pct * 100)}% to pass · {Math.ceil(props.config.questions_served_per_attempt * props.config.pass_threshold_pct)} of {props.config.questions_served_per_attempt} correct</li>
          <li>· {attemptsRemaining} of {props.config.max_attempts} attempts remaining</li>
          <li>· If you don&apos;t pass on the third attempt, the quiz locks for {props.config.lockout_days} days then resets</li>
        </ul>
        {error && <div className="text-sm text-[#F09595] mb-3">{error}</div>}
        <div className="flex gap-3">
          <button type="button" onClick={startQuiz} className="px-5 py-2.5 rounded-md bg-[#d4af37] text-[#1a1d2e] text-sm font-medium hover:bg-[#e3c360]">
            Start quiz
          </button>
          <button type="button" onClick={props.onBack} className="px-5 py-2.5 rounded-md border border-[#2a3149] text-[#c9c2b0] text-sm hover:bg-white/5">
            Back to segments
          </button>
        </div>
      </section>
    );
  }

  if (phase === 'loading') {
    return <div className="text-center py-16 text-[#8a8370]">Loading questions…</div>;
  }

  if (phase === 'results' && result) {
    return (
      <ResultsPanel
        result={result}
        config={props.config}
        attemptsRemaining={attemptsRemaining}
        onRetry={() => {
          setResult(null);
          if (attemptsRemaining > 0 && !result.passed) startQuiz();
          else props.onBack();
        }}
        onDone={props.onBack}
      />
    );
  }

  return (
    <section className="rounded-xl border border-[#2a3149] bg-[#0f1424] p-5 sm:p-7">
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <div className="text-xs uppercase tracking-widest text-[#d4af37]">Attempt {attemptNumber} of {props.config.max_attempts}</div>
        <div className="text-xs text-[#8a8370]">
          {Object.keys(answers).length} of {served.length} answered
        </div>
      </div>

      <div className="space-y-6">
        {served.map((q, i) => (
          <div key={q.n} className="space-y-2">
            <div className="text-xs text-[#5a564a]">Question {i + 1}</div>
            <div className="text-base text-[#e7e2d4] leading-snug">{q.question}</div>
            <div className="space-y-1 mt-2">
              {q.options.map((opt, j) => {
                const isSelected = answers[q.n] === j;
                return (
                  <label
                    key={j}
                    className={
                      'flex items-start gap-3 rounded-md border px-3 py-2 cursor-pointer transition ' +
                      (isSelected ? 'border-[#d4af37] bg-[#d4af37]/10 text-[#e7e2d4]' : 'border-[#2a3149] text-[#c9c2b0] hover:bg-white/5')
                    }
                  >
                    <input
                      type="radio"
                      name={`q-${q.n}`}
                      checked={isSelected}
                      onChange={() => setAnswers((a) => ({ ...a, [q.n]: j }))}
                      className="mt-1 accent-[#d4af37]"
                    />
                    <span className="text-sm leading-snug">
                      <span className="text-[#8a8370] mr-2">{String.fromCharCode(65 + j)})</span>
                      {opt}
                    </span>
                  </label>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {error && <div className="mt-5 text-sm text-[#F09595]">{error}</div>}

      <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-[#2a3149] pt-5">
        <button type="button" onClick={props.onBack} className="text-sm text-[#8a8370] hover:text-[#c9c2b0]">
          ← Back to segments
        </button>
        <button
          type="button"
          onClick={submit}
          disabled={!allAnswered || phase === 'submitting'}
          className="px-5 py-2.5 rounded-md bg-[#d4af37] text-[#1a1d2e] text-sm font-medium hover:bg-[#e3c360] disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {phase === 'submitting' ? 'Submitting…' : 'Submit answers'}
        </button>
      </div>
    </section>
  );
}

// ---- Results panel ---------------------------------------------------------

function ResultsPanel(props: {
  result: CompleteResponse;
  config: QuizConfig;
  attemptsRemaining: number;
  onRetry: () => void;
  onDone: () => void;
}) {
  const r = props.result;

  if (r.activation?.activated) {
    return <ActivationCelebration activation={r.activation} />;
  }

  const passed = r.passed;
  return (
    <section
      className={
        'rounded-xl p-6 sm:p-8 ' +
        (passed
          ? 'border border-[#0F6E56]/40 bg-[#0F6E56]/10'
          : 'border border-[#A32D2D]/40 bg-[#A32D2D]/5')
      }
    >
      <div className="text-xs uppercase tracking-widest mb-2" style={{ color: passed ? '#9FE1CB' : '#F09595' }}>
        {passed ? 'Passed' : 'Did not pass'}
      </div>
      <h3 className="font-serif text-2xl text-[#e7e2d4] mb-3">
        {r.score} of {r.total} correct
      </h3>
      <p className="text-sm text-[#c9c2b0] mb-5">
        {passed
          ? `Threshold: ${r.threshold} of ${r.total} (${Math.round(r.pass_threshold_pct * 100)}%). Course progress saved.`
          : `Threshold: ${r.threshold} of ${r.total} (${Math.round(r.pass_threshold_pct * 100)}%). ${
              props.attemptsRemaining > 0
                ? `${props.attemptsRemaining} attempt${props.attemptsRemaining === 1 ? '' : 's'} remaining.`
                : `No attempts remaining — quiz locks for ${props.config.lockout_days} days.`
            }`}
      </p>
      <div className="flex flex-wrap gap-3">
        {!passed && props.attemptsRemaining > 0 && (
          <button type="button" onClick={props.onRetry} className="px-5 py-2.5 rounded-md bg-[#d4af37] text-[#1a1d2e] text-sm font-medium hover:bg-[#e3c360]">
            Retry
          </button>
        )}
        <button type="button" onClick={props.onDone} className="px-5 py-2.5 rounded-md border border-[#2a3149] text-[#c9c2b0] text-sm hover:bg-white/5">
          Back to Academy
        </button>
      </div>
    </section>
  );
}

// ---- Activation celebration ------------------------------------------------

function ActivationCelebration(props: {
  activation: NonNullable<CompleteResponse['activation']>;
}) {
  return (
    <section className="rounded-xl border border-[#d4af37] bg-gradient-to-b from-[#0f1424] to-[#1a1d2e] p-6 sm:p-10">
      <div className="text-xs uppercase tracking-widest text-[#d4af37] mb-3">You&apos;re activated</div>
      <h2 className="font-serif text-3xl text-[#e7e2d4] mb-3">Foundations complete.</h2>
      <p className="text-base text-[#c9c2b0] leading-relaxed mb-6">
        Your seven Guild agents are unlocked. Your referral code is live. Your certificate is on the public record.
      </p>

      {props.activation.referral_code && (
        <div className="rounded-md border border-[#d4af37] bg-[#0f1424] p-5 mb-4 text-center">
          <div className="text-[10px] uppercase tracking-widest text-[#8a8370] mb-1">Your referral code</div>
          <div className="font-serif text-3xl text-[#d4af37] tracking-wider">{props.activation.referral_code}</div>
        </div>
      )}

      {props.activation.certificate_code && (
        <div className="rounded-md border border-[#2a3149] bg-[#0a0e1a] p-5 mb-6">
          <div className="text-[10px] uppercase tracking-widest text-[#8a8370] mb-2">Foundations certificate</div>
          <div className="text-sm text-[#c9c2b0] mb-3 font-mono">{props.activation.certificate_code}</div>
          <div className="flex gap-2 flex-wrap">
            {props.activation.certificate_pdf_url && (
              <a
                href={props.activation.certificate_pdf_url}
                target="_blank"
                rel="noopener noreferrer"
                className="px-4 py-2 rounded-md bg-[#d4af37] text-[#1a1d2e] text-xs font-medium hover:bg-[#e3c360]"
              >
                Download PDF
              </a>
            )}
            <Link
              href={`/verify/${props.activation.certificate_code}`}
              className="px-4 py-2 rounded-md border border-[#d4af37] text-[#d4af37] text-xs hover:bg-[#d4af37]/10"
            >
              Public verify link
            </Link>
          </div>
        </div>
      )}

      <Link
        href="/guild/dashboard"
        className="inline-flex items-center gap-2 rounded-md bg-[#d4af37] text-[#1a1d2e] px-5 py-2.5 text-sm font-medium hover:bg-[#e3c360]"
      >
        Open your dashboard →
      </Link>
    </section>
  );
}

// ---- Already-passed view ---------------------------------------------------

function PassedView(props: {
  moduleTitle: string;
  score: number;
  attempts: AttemptHistoryClient[];
  academyAlreadyComplete: boolean;
}) {
  return (
    <section className="rounded-xl border border-[#d4af37]/40 bg-[#d4af37]/5 p-8 text-center">
      <div className="font-serif text-2xl text-[#d4af37] mb-3">Module complete</div>
      <p className="text-sm text-[#c9c2b0] mb-6">
        You finished {props.moduleTitle}. Score: {props.score}.
      </p>
      <Link
        href="/guild/dashboard/academy"
        className="inline-flex items-center gap-2 rounded-md border border-[#2a3149] bg-[#141a2a] px-5 py-2 text-sm text-[#e7e2d4] hover:border-[#3a4259]"
      >
        ← Back to Academy
      </Link>
    </section>
  );
}

// ---- Helpers ---------------------------------------------------------------

function isLocked(iso: string | null): boolean {
  if (!iso) return false;
  return new Date(iso).getTime() > Date.now();
}
