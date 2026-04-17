'use client';

import { useEffect, useRef, useState } from 'react';
import { Play, Pause, SkipBack, SkipForward, Headphones, Loader2 } from 'lucide-react';

interface AudiobookChapter {
  chapter_id: string;
  order_index: number;
  status: string;
  audio_url: string | null;
  duration_s: number | null;
  error: string | null;
}

interface Manifest {
  chapters: AudiobookChapter[];
  completeCount: number;
  totalCount: number;
  totalDurationSeconds: number;
  hasAudio: boolean;
}

export function AudiobookPlayer({ projectId }: { projectId: string }) {
  const [manifest, setManifest] = useState<Manifest | null>(null);
  const [loading, setLoading] = useState(true);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [progress, setProgress] = useState(0); // 0..1 for current track
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const resp = await fetch(`/api/publishing/penworth-store/narrate?projectId=${projectId}`);
        const data = await resp.json();
        if (!cancelled) setManifest(data);
      } catch {
        // Silently ignore — the card just won't render
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  // Wire up audio element events
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const onTime = () => {
      if (audio.duration > 0) setProgress(audio.currentTime / audio.duration);
    };
    const onEnd = () => {
      // Auto-advance to next chapter
      if (manifest && currentIndex < manifest.chapters.length - 1) {
        setCurrentIndex((i) => i + 1);
      } else {
        setIsPlaying(false);
      }
    };

    audio.addEventListener('timeupdate', onTime);
    audio.addEventListener('ended', onEnd);
    return () => {
      audio.removeEventListener('timeupdate', onTime);
      audio.removeEventListener('ended', onEnd);
    };
  }, [manifest, currentIndex]);

  // Play/pause sync on state changes
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    if (isPlaying) {
      audio.play().catch(() => setIsPlaying(false));
    } else {
      audio.pause();
    }
  }, [isPlaying, currentIndex]);

  if (loading) return null;
  if (!manifest || !manifest.hasAudio) return null;

  const completeChapters = manifest.chapters.filter(
    (c) => c.status === 'complete' && c.audio_url,
  );
  if (completeChapters.length === 0) return null;

  const current = completeChapters[currentIndex];

  const fmt = (s: number | null) => {
    if (!s) return '0:00';
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${sec.toString().padStart(2, '0')}`;
  };

  return (
    <div className="rounded-xl border bg-gradient-to-br from-primary/5 to-primary/0 p-5">
      <div className="flex items-center gap-2 mb-4">
        <div className="h-9 w-9 rounded-lg bg-primary/10 flex items-center justify-center">
          <Headphones className="h-4 w-4 text-primary" />
        </div>
        <div className="min-w-0">
          <h3 className="font-semibold">Listen to this book</h3>
          <p className="text-xs text-muted-foreground">
            {completeChapters.length} of {manifest.totalCount} chapters narrated ·{' '}
            {fmt(manifest.totalDurationSeconds)} total
          </p>
        </div>
      </div>

      <audio
        ref={audioRef}
        src={current?.audio_url || undefined}
        preload="metadata"
        className="hidden"
      />

      {/* Progress bar */}
      <div className="h-1.5 rounded-full bg-muted overflow-hidden mb-3">
        <div
          className="h-full bg-primary transition-[width]"
          style={{ width: `${progress * 100}%` }}
        />
      </div>

      <div className="flex items-center justify-between gap-3">
        <div className="text-xs text-muted-foreground tabular-nums shrink-0">
          Chapter {currentIndex + 1} / {completeChapters.length}
        </div>

        <div className="flex items-center gap-1">
          <IconBtn
            onClick={() => setCurrentIndex((i) => Math.max(0, i - 1))}
            disabled={currentIndex === 0}
            ariaLabel="Previous chapter"
          >
            <SkipBack className="h-4 w-4" />
          </IconBtn>
          <button
            onClick={() => setIsPlaying((p) => !p)}
            className="h-10 w-10 rounded-full bg-primary text-primary-foreground flex items-center justify-center hover:bg-primary/90 transition-colors"
            aria-label={isPlaying ? 'Pause' : 'Play'}
          >
            {isPlaying ? <Pause className="h-5 w-5" /> : <Play className="h-5 w-5 ml-0.5" />}
          </button>
          <IconBtn
            onClick={() => setCurrentIndex((i) => Math.min(completeChapters.length - 1, i + 1))}
            disabled={currentIndex >= completeChapters.length - 1}
            ariaLabel="Next chapter"
          >
            <SkipForward className="h-4 w-4" />
          </IconBtn>
        </div>

        <div className="text-xs text-muted-foreground tabular-nums shrink-0">
          {fmt((current?.duration_s || 0) * progress)} / {fmt(current?.duration_s || 0)}
        </div>
      </div>

      {completeChapters.length < manifest.totalCount && (
        <p className="text-xs text-muted-foreground mt-3 flex items-center gap-1.5">
          <Loader2 className="h-3 w-3 animate-spin" />
          Remaining chapters are still being narrated.
        </p>
      )}
    </div>
  );
}

function IconBtn({
  children,
  onClick,
  disabled,
  ariaLabel,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  ariaLabel: string;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      aria-label={ariaLabel}
      className="h-8 w-8 rounded-full flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
    >
      {children}
    </button>
  );
}
