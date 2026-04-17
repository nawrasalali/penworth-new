'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { useSearchParams, useRouter } from 'next/navigation';

type PhaseState =
  | 'idle'              // before starting
  | 'starting'          // API call to /start in flight
  | 'playing_question'  // audio of interviewer question playing
  | 'awaiting_input'    // waiting for user to start recording
  | 'recording'         // user is recording
  | 'processing'        // uploading + transcribing + generating next turn
  | 'ended'             // interview finished, scoring
  | 'complete'          // all done, redirect soon
  | 'error';

interface TurnDisplay {
  role: 'interviewer' | 'applicant';
  text: string;
}

export default function LiveInterviewPage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const applicationId = searchParams.get('application_id');

  const [phase, setPhase] = useState<PhaseState>('idle');
  const [turns, setTurns] = useState<TurnDisplay[]>([]);
  const [currentTopic, setCurrentTopic] = useState<string>('background');
  const [topicsCovered, setTopicsCovered] = useState<string[]>([]);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const interviewStartTimeRef = useRef<number | null>(null);
  const tickIntervalRef = useRef<any>(null);

  // Tick the elapsed timer
  useEffect(() => {
    if (phase === 'idle' || phase === 'starting' || phase === 'complete' || phase === 'error') {
      if (tickIntervalRef.current) {
        clearInterval(tickIntervalRef.current);
        tickIntervalRef.current = null;
      }
      return;
    }
    if (!interviewStartTimeRef.current) {
      interviewStartTimeRef.current = Date.now();
    }
    tickIntervalRef.current = setInterval(() => {
      if (interviewStartTimeRef.current) {
        setElapsedSeconds(Math.floor((Date.now() - interviewStartTimeRef.current) / 1000));
      }
    }, 1000);
    return () => {
      if (tickIntervalRef.current) clearInterval(tickIntervalRef.current);
    };
  }, [phase]);

  // Play audio helper
  const playAudio = useCallback((audioBase64: string): Promise<void> => {
    return new Promise((resolve, reject) => {
      const audio = new Audio(`data:audio/mpeg;base64,${audioBase64}`);
      audioRef.current = audio;
      audio.onended = () => resolve();
      audio.onerror = () => reject(new Error('Audio playback failed'));
      audio.play().catch(reject);
    });
  }, []);

  // Start the interview
  async function startInterview() {
    if (!applicationId) return;
    setError(null);
    setPhase('starting');
    try {
      const res = await fetch('/api/guild/interview/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ application_id: applicationId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to start interview');

      // Request mic permission early
      await requestMicrophoneAccess();

      setTurns([{ role: 'interviewer', text: data.interviewer_message }]);
      setCurrentTopic(data.topic);
      setPhase('playing_question');
      await playAudio(data.audio_base64);
      setPhase('awaiting_input');
    } catch (err: any) {
      setError(err?.message || 'Failed to start interview');
      setPhase('error');
    }
  }

  async function requestMicrophoneAccess(): Promise<MediaStream> {
    try {
      return await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (err) {
      throw new Error('Microphone permission is required for the interview.');
    }
  }

  async function startRecording() {
    try {
      const stream = await requestMicrophoneAccess();
      audioChunksRef.current = [];
      const mimeType = pickSupportedMimeType();
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      mediaRecorderRef.current = recorder;

      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) audioChunksRef.current.push(e.data);
      };
      recorder.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
      };

      recorder.start();
      setPhase('recording');
    } catch (err: any) {
      setError(err?.message || 'Microphone access failed');
      setPhase('error');
    }
  }

  async function stopRecording() {
    if (!mediaRecorderRef.current) return;
    const recorder = mediaRecorderRef.current;

    // Wait for onstop to fire after we call stop
    await new Promise<void>((resolve) => {
      recorder.onstop = () => {
        recorder.stream?.getTracks().forEach((t) => t.stop());
        resolve();
      };
      recorder.stop();
    });

    setPhase('processing');

    try {
      const mimeType = mediaRecorderRef.current?.mimeType || 'audio/webm';
      const ext = mimeType.includes('mp4') ? 'm4a' : mimeType.includes('ogg') ? 'ogg' : 'webm';
      const blob = new Blob(audioChunksRef.current, { type: mimeType });
      audioChunksRef.current = [];

      if (blob.size < 1000) {
        throw new Error('That recording was too short. Please speak your answer.');
      }

      const form = new FormData();
      form.append('application_id', applicationId!);
      form.append('audio', blob, `answer.${ext}`);

      const res = await fetch('/api/guild/interview/turn', {
        method: 'POST',
        body: form,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Turn failed');

      setTurns((prev) => [
        ...prev,
        { role: 'applicant', text: data.applicant_transcript },
        { role: 'interviewer', text: data.interviewer_message },
      ]);
      setCurrentTopic(data.topic);
      setTopicsCovered(data.topics_covered || []);

      setPhase('playing_question');
      await playAudio(data.audio_base64);

      if (data.should_end) {
        setPhase('ended');
        await completeInterview();
      } else {
        setPhase('awaiting_input');
      }
    } catch (err: any) {
      setError(err?.message || 'Something went wrong processing your answer.');
      setPhase('error');
    }
  }

  async function completeInterview() {
    try {
      await fetch('/api/guild/interview/complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ application_id: applicationId }),
      });
      setPhase('complete');
      // Redirect after a moment
      setTimeout(() => {
        router.push('/guild/status');
      }, 5000);
    } catch (err) {
      console.error('Complete error:', err);
      setPhase('complete'); // still show complete view
    }
  }

  // Early end button (for applicants who want to wrap up)
  async function endEarly() {
    if (!confirm('Are you sure you want to end the interview now?')) return;
    setPhase('ended');
    await completeInterview();
  }

  // ---------------------------------------------------------------------------
  // UI
  // ---------------------------------------------------------------------------

  if (!applicationId) {
    return (
      <div className="mx-auto max-w-xl px-6 py-24 text-center">
        <h1 className="font-serif text-3xl">No application link</h1>
        <Link href="/guild" className="mt-6 inline-block text-[#d4af37] hover:underline">
          ← Back to the Guild
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl px-6 py-12">
      {/* Header */}
      <div className="mb-8 flex items-center justify-between">
        <div>
          <div className="text-xs font-semibold uppercase tracking-widest text-[#d4af37]">
            Penworth Guild Interview
          </div>
          <div className="mt-1 font-serif text-2xl tracking-tight">Live session</div>
        </div>
        <div className="text-right">
          <div className="font-mono text-2xl tabular-nums text-[#d4af37]">
            {formatTime(elapsedSeconds)}
          </div>
          <div className="text-xs uppercase tracking-widest text-[#6b6452]">elapsed</div>
        </div>
      </div>

      {/* Topic progress */}
      <TopicProgress currentTopic={currentTopic} topicsCovered={topicsCovered} />

      {/* Conversation area */}
      <div className="mt-8 rounded-xl border border-[#1e2436] bg-[#0f1424] p-8">
        {phase === 'idle' && <IdleState onStart={startInterview} />}
        {phase === 'starting' && <StartingState />}
        {phase !== 'idle' && phase !== 'starting' && phase !== 'error' && (
          <ConversationState
            turns={turns}
            phase={phase}
            onStartRecording={startRecording}
            onStopRecording={stopRecording}
          />
        )}
        {phase === 'complete' && <CompleteState />}
        {phase === 'error' && (
          <ErrorState error={error} onRetry={() => {
            setError(null);
            setPhase('idle');
          }} />
        )}
      </div>

      {/* Controls */}
      {phase !== 'idle' && phase !== 'starting' && phase !== 'complete' && phase !== 'error' && (
        <div className="mt-6 flex items-center justify-between">
          <button
            type="button"
            onClick={endEarly}
            className="text-xs text-[#6b6452] hover:text-[#8a8370]"
            disabled={phase === 'processing' || phase === 'playing_question'}
          >
            End interview early
          </button>
          <div className="text-xs text-[#6b6452]">Soft target: 10 minutes</div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

const TOPIC_LABELS: Record<string, string> = {
  background: 'Background',
  motivation: 'Motivation',
  audience: 'Audience',
  product: 'Product',
  commitment: 'Commitment',
  objection: 'Objection',
  close: 'Close',
};

const TOPIC_ORDER = ['background', 'motivation', 'audience', 'product', 'commitment', 'objection', 'close'];

function TopicProgress({
  currentTopic,
  topicsCovered,
}: {
  currentTopic: string;
  topicsCovered: string[];
}) {
  return (
    <div className="flex gap-1 rounded-lg border border-[#1e2436] bg-[#0a0e1a] p-2">
      {TOPIC_ORDER.map((topic) => {
        const covered = topicsCovered.includes(topic);
        const active = currentTopic === topic;
        return (
          <div
            key={topic}
            className={`flex-1 rounded-md px-3 py-2 text-center text-xs transition ${
              active
                ? 'bg-[#d4af37] text-[#0a0e1a]'
                : covered
                  ? 'bg-[#d4af37]/20 text-[#d4af37]'
                  : 'text-[#6b6452]'
            }`}
          >
            {TOPIC_LABELS[topic]}
          </div>
        );
      })}
    </div>
  );
}

function IdleState({ onStart }: { onStart: () => void }) {
  return (
    <div className="py-12 text-center">
      <div className="mx-auto mb-8 flex h-24 w-24 items-center justify-center rounded-full border border-[#d4af37]/30 bg-[#d4af37]/5">
        <svg width="40" height="40" viewBox="0 0 24 24" fill="none" className="text-[#d4af37]">
          <path
            d="M12 2a3 3 0 00-3 3v6a3 3 0 006 0V5a3 3 0 00-3-3zM19 11a7 7 0 01-14 0M12 18v4m-4 0h8"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </div>
      <h2 className="font-serif text-3xl tracking-tight">Ready to begin?</h2>
      <p className="mx-auto mt-4 max-w-md text-sm text-[#8a8370]">
        When you click the button below, we&apos;ll request microphone access and the interviewer
        will greet you. You can take as long as you need between questions.
      </p>
      <button
        type="button"
        onClick={onStart}
        className="mt-8 inline-flex items-center gap-3 rounded-md bg-[#d4af37] px-10 py-4 text-base font-medium text-[#0a0e1a] transition hover:bg-[#e6c14a]"
      >
        Start Interview →
      </button>
    </div>
  );
}

function StartingState() {
  return (
    <div className="py-16 text-center">
      <div className="inline-flex items-center gap-3 text-[#d4af37]">
        <div className="h-3 w-3 animate-ping rounded-full bg-[#d4af37]" />
        <span className="text-sm">Connecting to the Guild Council interviewer…</span>
      </div>
    </div>
  );
}

function ConversationState({
  turns,
  phase,
  onStartRecording,
  onStopRecording,
}: {
  turns: TurnDisplay[];
  phase: PhaseState;
  onStartRecording: () => void;
  onStopRecording: () => void;
}) {
  const lastInterviewerMessage = [...turns].reverse().find((t) => t.role === 'interviewer');

  return (
    <div className="space-y-6">
      {/* Current interviewer message */}
      {lastInterviewerMessage && (
        <div className="rounded-lg border border-[#d4af37]/20 bg-[#d4af37]/5 p-6">
          <div className="mb-2 flex items-center gap-2 text-xs uppercase tracking-widest text-[#d4af37]">
            <span className="h-2 w-2 rounded-full bg-[#d4af37]" />
            Interviewer
          </div>
          <p className="text-base leading-relaxed text-[#e7e2d4]">{lastInterviewerMessage.text}</p>
        </div>
      )}

      {/* Recording button / status */}
      <div className="rounded-lg border border-[#1e2436] bg-[#0a0e1a] p-8 text-center">
        {phase === 'playing_question' && <PhaseLabel>Listening to the question…</PhaseLabel>}
        {phase === 'processing' && <PhaseLabel>Processing your answer…</PhaseLabel>}
        {phase === 'ended' && <PhaseLabel>Interview complete — scoring…</PhaseLabel>}

        {phase === 'awaiting_input' && (
          <div>
            <button
              type="button"
              onClick={onStartRecording}
              className="group flex h-20 w-20 items-center justify-center rounded-full bg-[#d4af37] transition hover:bg-[#e6c14a]"
              aria-label="Start recording"
            >
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none">
                <circle cx="12" cy="12" r="6" fill="#0a0e1a" />
              </svg>
            </button>
            <div className="mt-4 text-sm text-[#8a8370]">Press to speak your answer</div>
          </div>
        )}

        {phase === 'recording' && (
          <div>
            <button
              type="button"
              onClick={onStopRecording}
              className="group relative flex h-20 w-20 items-center justify-center rounded-full bg-red-500 transition hover:bg-red-600"
              aria-label="Stop recording"
            >
              <span className="absolute inset-0 animate-ping rounded-full bg-red-500 opacity-50" />
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" className="relative">
                <rect x="6" y="6" width="12" height="12" rx="2" fill="#ffffff" />
              </svg>
            </button>
            <div className="mt-4 text-sm text-red-400">Recording… press to stop</div>
          </div>
        )}
      </div>

      {/* History */}
      {turns.length > 2 && (
        <details className="group rounded-lg border border-[#1e2436] bg-[#0a0e1a]">
          <summary className="cursor-pointer px-6 py-4 text-xs uppercase tracking-widest text-[#8a8370] hover:text-[#c9c2b0]">
            Conversation history
          </summary>
          <div className="border-t border-[#1e2436] px-6 py-4">
            <div className="max-h-96 space-y-4 overflow-y-auto">
              {turns.slice(0, -1).map((t, i) => (
                <div key={i} className="text-sm">
                  <div
                    className={`mb-1 text-xs uppercase tracking-widest ${t.role === 'interviewer' ? 'text-[#d4af37]' : 'text-[#8a8370]'}`}
                  >
                    {t.role}
                  </div>
                  <div className="leading-relaxed text-[#c9c2b0]">{t.text}</div>
                </div>
              ))}
            </div>
          </div>
        </details>
      )}
    </div>
  );
}

function PhaseLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="py-8">
      <div className="inline-flex items-center gap-3 text-[#d4af37]">
        <div className="h-2 w-2 animate-pulse rounded-full bg-[#d4af37]" />
        <span className="text-sm">{children}</span>
      </div>
    </div>
  );
}

function CompleteState() {
  return (
    <div className="py-12 text-center">
      <div className="mx-auto mb-8 flex h-24 w-24 items-center justify-center rounded-full border border-[#d4af37]/30 bg-[#d4af37]/5">
        <svg width="40" height="40" viewBox="0 0 24 24" fill="none" className="text-[#d4af37]">
          <path d="M5 13l4 4L19 7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>
      <h2 className="font-serif text-3xl tracking-tight">Thank you.</h2>
      <p className="mx-auto mt-4 max-w-md text-sm text-[#c9c2b0]">
        Your interview has been submitted to the Guild Council for review. You&apos;ll hear from
        us within 48 hours.
      </p>
      <Link
        href="/guild/status"
        className="mt-8 inline-flex items-center gap-2 rounded-md border border-[#2a3149] bg-[#141a2a] px-6 py-3 text-sm text-[#e7e2d4] hover:border-[#3a4259]"
      >
        Check your status →
      </Link>
    </div>
  );
}

function ErrorState({ error, onRetry }: { error: string | null; onRetry: () => void }) {
  return (
    <div className="py-12 text-center">
      <div className="mx-auto mb-6 text-red-400">⚠</div>
      <h2 className="font-serif text-2xl tracking-tight text-red-400">Something went wrong</h2>
      <p className="mx-auto mt-4 max-w-md text-sm text-[#c9c2b0]">
        {error || 'An unexpected error occurred.'}
      </p>
      <button
        type="button"
        onClick={onRetry}
        className="mt-6 inline-flex items-center gap-2 rounded-md bg-[#d4af37] px-6 py-3 text-sm font-medium text-[#0a0e1a] hover:bg-[#e6c14a]"
      >
        Try Again
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function pickSupportedMimeType(): string | null {
  const candidates = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/ogg;codecs=opus',
    'audio/mp4',
  ];
  if (typeof MediaRecorder === 'undefined') return null;
  for (const type of candidates) {
    if (MediaRecorder.isTypeSupported(type)) return type;
  }
  return null;
}
