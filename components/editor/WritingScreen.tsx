'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { OutlineSection, CREDIT_COSTS } from '@/types/agent-workflow';
import { cn } from '@/lib/utils';
import {
  PenTool,
  CheckCircle2,
  Circle,
  Loader2,
  Edit3,
  RefreshCw,
  Coins
} from 'lucide-react';

interface WritingScreenProps {
  bookTitle: string;
  chapters: OutlineSection[];
  currentChapterIndex: number;
  currentChapterContent: string;
  isWriting: boolean;
  userCredits: number;
  onEditChapter: (chapterId: string, content: string) => void;
  onRegenerateChapter: (chapterId: string) => void;
}

export function WritingScreen({
  bookTitle,
  chapters,
  currentChapterIndex,
  currentChapterContent,
  isWriting,
  userCredits,
  onEditChapter,
  onRegenerateChapter
}: WritingScreenProps) {
  const [editingChapterId, setEditingChapterId] = useState<string | null>(null);
  const [editContent, setEditContent] = useState('');
  
  const completedChapters = chapters.filter(c => c.status === 'complete').length;
  const progress = (completedChapters / chapters.length) * 100;
  const totalWords = chapters.reduce((sum, c) => sum + (c.wordCount || 0), 0);
  
  const currentChapter = chapters[currentChapterIndex];
  
  const handleStartEdit = (chapter: OutlineSection) => {
    setEditingChapterId(chapter.id);
    // In real implementation, load the chapter content
    setEditContent(currentChapterContent);
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
          <h1 className="text-xl font-bold">Writing Your Book</h1>
        </div>
        <p className="text-sm text-muted-foreground">
          Watch the magic happen chapter by chapter
        </p>
      </div>
      
      {/* Progress Bar */}
      <div className="mb-4">
        <div className="flex items-center justify-between text-sm mb-2">
          <span>
            Currently writing: Chapter {currentChapterIndex + 1} of {chapters.length}
          </span>
          <span className="text-muted-foreground">
            {totalWords.toLocaleString()} words
          </span>
        </div>
        <div className="h-3 bg-muted rounded-full overflow-hidden">
          <div 
            className="h-full bg-gradient-to-r from-primary to-primary/60 transition-all duration-500"
            style={{ width: `${progress}%` }}
          />
        </div>
        <div className="text-right text-xs text-muted-foreground mt-1">
          {Math.round(progress)}% complete
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
                {currentChapter?.title || 'Writing...'}
              </h2>
            </div>
            
            {/* Chapter Content */}
            <div className="flex-1 overflow-y-auto p-6">
              {editingChapterId === currentChapter?.id ? (
                <textarea
                  value={editContent}
                  onChange={(e) => setEditContent(e.target.value)}
                  className="w-full h-full min-h-[300px] resize-none focus:outline-none text-base leading-relaxed"
                  placeholder="Edit chapter content..."
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
                      Generating content...
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
                      Cancel
                    </Button>
                    <Button size="sm" onClick={handleSaveEdit}>
                      Save Changes (Free)
                    </Button>
                  </>
                ) : (
                  <>
                    <Button 
                      variant="outline" 
                      size="sm"
                      onClick={() => handleStartEdit(currentChapter)}
                    >
                      <Edit3 className="mr-2 h-3 w-3" />
                      Manual Edit (Free)
                    </Button>
                    <Button 
                      variant="outline" 
                      size="sm"
                      onClick={() => onRegenerateChapter(currentChapter.id)}
                      disabled={!canRegenerate}
                    >
                      <RefreshCw className="mr-2 h-3 w-3" />
                      Regenerate
                      <span className="ml-1 text-xs opacity-70">
                        ({CREDIT_COSTS.CHAPTER_REGENERATE} credits)
                      </span>
                    </Button>
                  </>
                )}
              </div>
            )}
          </div>
        </div>
        
        {/* Chapter List Sidebar */}
        <div className="w-64 overflow-y-auto">
          <h3 className="font-semibold mb-3 text-sm">Chapter Progress</h3>
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
                    Ch {idx + 1}: {chapter.title}
                  </span>
                </div>
                {chapter.wordCount && (
                  <div className="text-xs text-muted-foreground mt-1 ml-6">
                    {chapter.wordCount.toLocaleString()} words
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
      
      {/* Credit Warning */}
      {!canRegenerate && (
        <div className="mt-4 p-3 rounded-lg bg-amber-500/10 border border-amber-500/30 flex items-center gap-2">
          <Coins className="h-4 w-4 text-amber-500" />
          <span className="text-sm">
            Low credits ({userCredits} remaining). Manual editing is always free!
          </span>
        </div>
      )}
    </div>
  );
}
