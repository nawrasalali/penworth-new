'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

interface Chapter {
  id: string;
  title: string;
  content: string;
  order_index: number;
  status: 'draft' | 'in_progress' | 'complete';
  word_count: number;
}

interface OutlinePanelProps {
  chapters: Chapter[];
  currentChapterId?: string;
  onChapterSelect: (chapter: Chapter) => void;
  onChapterCreate: (title: string) => Promise<void>;
  onChapterDelete: (id: string) => Promise<void>;
  onChapterReorder: (chapters: Chapter[]) => Promise<void>;
  projectTitle?: string;
}

export function OutlinePanel({
  chapters,
  currentChapterId,
  onChapterSelect,
  onChapterCreate,
  onChapterDelete,
  onChapterReorder,
  projectTitle = 'Untitled Project',
}: OutlinePanelProps) {
  const [isCreating, setIsCreating] = useState(false);
  const [newChapterTitle, setNewChapterTitle] = useState('');
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);

  const handleCreateChapter = async () => {
    if (!newChapterTitle.trim()) return;
    await onChapterCreate(newChapterTitle.trim());
    setNewChapterTitle('');
    setIsCreating(false);
  };

  const handleDragStart = (e: React.DragEvent, index: number) => {
    setDraggedIndex(index);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    if (draggedIndex === null || draggedIndex === index) return;

    const newChapters = [...chapters];
    const [draggedChapter] = newChapters.splice(draggedIndex, 1);
    newChapters.splice(index, 0, draggedChapter);

    // Update order indices
    newChapters.forEach((ch, i) => {
      ch.order_index = i;
    });

    setDraggedIndex(index);
  };

  const handleDragEnd = () => {
    if (draggedIndex !== null) {
      const newChapters = chapters.map((ch, i) => ({ ...ch, order_index: i }));
      onChapterReorder(newChapters);
    }
    setDraggedIndex(null);
  };

  const totalWords = chapters.reduce((sum, ch) => sum + ch.word_count, 0);
  const completedChapters = chapters.filter(ch => ch.status === 'complete').length;

  const getStatusColor = (status: Chapter['status']) => {
    switch (status) {
      case 'complete': return 'bg-green-500';
      case 'in_progress': return 'bg-yellow-500';
      default: return 'bg-gray-300';
    }
  };

  return (
    <div className="flex flex-col h-full border-r bg-muted/10">
      {/* Header */}
      <div className="p-4 border-b bg-background">
        <h2 className="font-semibold text-lg truncate" title={projectTitle}>
          {projectTitle}
        </h2>
        <div className="flex items-center gap-4 mt-2 text-xs text-muted-foreground">
          <span>{chapters.length} chapters</span>
          <span>{totalWords.toLocaleString()} words</span>
          <span>{completedChapters}/{chapters.length} complete</span>
        </div>
      </div>

      {/* Progress Bar */}
      <div className="px-4 py-2 border-b">
        <div className="h-2 bg-muted rounded-full overflow-hidden">
          <div 
            className="h-full bg-primary transition-all duration-300"
            style={{ width: `${chapters.length ? (completedChapters / chapters.length) * 100 : 0}%` }}
          />
        </div>
      </div>

      {/* Chapters List */}
      <div className="flex-1 overflow-auto p-2">
        {chapters.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            <p className="text-sm">No chapters yet</p>
            <p className="text-xs mt-1">Create your first chapter to get started</p>
          </div>
        ) : (
          <div className="space-y-1">
            {chapters
              .sort((a, b) => a.order_index - b.order_index)
              .map((chapter, index) => (
                <div
                  key={chapter.id}
                  draggable
                  onDragStart={(e) => handleDragStart(e, index)}
                  onDragOver={(e) => handleDragOver(e, index)}
                  onDragEnd={handleDragEnd}
                  onClick={() => onChapterSelect(chapter)}
                  className={`group flex items-center gap-2 p-2 rounded-lg cursor-pointer transition-colors ${
                    currentChapterId === chapter.id
                      ? 'bg-primary/10 border border-primary/20'
                      : 'hover:bg-muted'
                  }`}
                >
                  {/* Drag Handle */}
                  <div className="opacity-0 group-hover:opacity-50 cursor-grab">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                      <circle cx="5" cy="5" r="2" />
                      <circle cx="12" cy="5" r="2" />
                      <circle cx="5" cy="12" r="2" />
                      <circle cx="12" cy="12" r="2" />
                      <circle cx="5" cy="19" r="2" />
                      <circle cx="12" cy="19" r="2" />
                    </svg>
                  </div>

                  {/* Status Indicator */}
                  <div className={`w-2 h-2 rounded-full ${getStatusColor(chapter.status)}`} />

                  {/* Chapter Info */}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">
                      {chapter.title || `Chapter ${index + 1}`}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {chapter.word_count.toLocaleString()} words
                    </p>
                  </div>

                  {/* Delete Button */}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      if (confirm('Delete this chapter?')) {
                        onChapterDelete(chapter.id);
                      }
                    }}
                    className="opacity-0 group-hover:opacity-50 hover:opacity-100 p-1 rounded hover:bg-destructive/10 hover:text-destructive transition-all"
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" />
                    </svg>
                  </button>
                </div>
              ))}
          </div>
        )}
      </div>

      {/* Add Chapter */}
      <div className="p-3 border-t bg-background">
        {isCreating ? (
          <div className="flex gap-2">
            <Input
              value={newChapterTitle}
              onChange={(e) => setNewChapterTitle(e.target.value)}
              placeholder="Chapter title..."
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleCreateChapter();
                if (e.key === 'Escape') setIsCreating(false);
              }}
              autoFocus
              className="flex-1"
            />
            <Button size="sm" onClick={handleCreateChapter}>
              Add
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setIsCreating(false)}>
              Cancel
            </Button>
          </div>
        ) : (
          <Button
            variant="outline"
            className="w-full"
            onClick={() => setIsCreating(true)}
          >
            + Add Chapter
          </Button>
        )}
      </div>
    </div>
  );
}
