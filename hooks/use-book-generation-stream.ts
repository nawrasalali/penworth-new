import { useState, useEffect, useCallback } from 'react';

export interface ChapterProgress {
  id: string;
  title: string;
  order_index: number;
  status: 'pending' | 'writing' | 'complete' | 'error';
  word_count: number;
}

export interface GenerationProgress {
  connected: boolean;
  status: 'idle' | 'writing' | 'completed' | 'error';
  chapters: ChapterProgress[];
  currentChapter: ChapterProgress | null;
  totalChapters: number;
  completedChapters: number;
  totalWords: number;
  percentage: number;
  error: string | null;
}

export function useBookGenerationStream(projectId: string | null) {
  const [progress, setProgress] = useState<GenerationProgress>({
    connected: false,
    status: 'idle',
    chapters: [],
    currentChapter: null,
    totalChapters: 0,
    completedChapters: 0,
    totalWords: 0,
    percentage: 0,
    error: null,
  });

  const connect = useCallback(() => {
    if (!projectId) return null;

    const eventSource = new EventSource(`/api/books/generate/stream?projectId=${projectId}`);

    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);

        setProgress((prev) => {
          switch (data.type) {
            case 'connected':
              return { ...prev, connected: true };

            case 'project_update':
              return {
                ...prev,
                status: data.status,
                totalChapters: data.metadata?.totalChapters || prev.totalChapters,
              };

            case 'chapter_started':
            case 'chapter_update': {
              const chapter = data.chapter as ChapterProgress;
              const chapters = [...prev.chapters];
              const existingIdx = chapters.findIndex((c) => c.id === chapter.id);

              if (existingIdx >= 0) {
                chapters[existingIdx] = chapter;
              } else {
                chapters.push(chapter);
                chapters.sort((a, b) => a.order_index - b.order_index);
              }

              const completedChapters = chapters.filter((c) => c.status === 'complete').length;
              const totalWords = chapters.reduce((sum, c) => sum + (c.word_count || 0), 0);
              const currentChapter = chapters.find((c) => c.status === 'writing') || null;

              return {
                ...prev,
                chapters,
                currentChapter,
                completedChapters,
                totalWords,
                percentage: prev.totalChapters
                  ? Math.round((completedChapters / prev.totalChapters) * 100)
                  : 0,
              };
            }

            case 'complete':
              return {
                ...prev,
                connected: false,
                status: data.status as 'completed' | 'error',
                currentChapter: null,
                percentage: data.status === 'completed' ? 100 : prev.percentage,
              };

            case 'heartbeat':
              // Just keep connection alive, no state change needed
              return prev;

            default:
              return prev;
          }
        });
      } catch (err) {
        console.error('Failed to parse SSE message:', err);
      }
    };

    eventSource.onerror = () => {
      setProgress((prev) => ({
        ...prev,
        connected: false,
        error: 'Connection lost. Will retry...',
      }));
      eventSource.close();

      // Retry after 3 seconds
      setTimeout(() => {
        const newSource = connect();
        if (newSource) {
          // Connection will be managed by the new EventSource
        }
      }, 3000);
    };

    return eventSource;
  }, [projectId]);

  useEffect(() => {
    if (!projectId) {
      setProgress((prev) => ({ ...prev, connected: false }));
      return;
    }

    const eventSource = connect();

    return () => {
      if (eventSource) {
        eventSource.close();
      }
    };
  }, [projectId, connect]);

  return progress;
}
