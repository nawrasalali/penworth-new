'use client';

import { useState, useCallback, useEffect } from 'react';
import { Button } from '@/components/ui/button';

interface EditorProps {
  initialContent?: string;
  onChange?: (content: string) => void;
  onSave?: (content: string) => void;
  placeholder?: string;
  readOnly?: boolean;
}

export function Editor({
  initialContent = '',
  onChange,
  onSave,
  placeholder = 'Start writing your masterpiece...',
  readOnly = false,
}: EditorProps) {
  const [content, setContent] = useState(initialContent);
  const [wordCount, setWordCount] = useState(0);
  const [isSaving, setIsSaving] = useState(false);
  const [lastSaved, setLastSaved] = useState<Date | null>(null);

  useEffect(() => {
    const words = content.trim().split(/\s+/).filter(Boolean).length;
    setWordCount(words);
  }, [content]);

  const handleChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newContent = e.target.value;
    setContent(newContent);
    onChange?.(newContent);
  }, [onChange]);

  const handleSave = useCallback(async () => {
    if (!onSave) return;
    setIsSaving(true);
    try {
      await onSave(content);
      setLastSaved(new Date());
    } finally {
      setIsSaving(false);
    }
  }, [content, onSave]);

  // Auto-save every 30 seconds
  useEffect(() => {
    if (!onSave || readOnly) return;
    const interval = setInterval(() => {
      if (content !== initialContent) {
        handleSave();
      }
    }, 30000);
    return () => clearInterval(interval);
  }, [content, initialContent, onSave, readOnly, handleSave]);

  // Keyboard shortcut for save
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault();
        handleSave();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleSave]);

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="flex items-center justify-between px-4 py-2 border-b bg-muted/30">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" className="text-xs">
            <span className="font-bold">B</span>
          </Button>
          <Button variant="ghost" size="sm" className="text-xs">
            <span className="italic">I</span>
          </Button>
          <Button variant="ghost" size="sm" className="text-xs">
            <span className="underline">U</span>
          </Button>
          <div className="w-px h-4 bg-border mx-1" />
          <Button variant="ghost" size="sm" className="text-xs">
            H1
          </Button>
          <Button variant="ghost" size="sm" className="text-xs">
            H2
          </Button>
          <Button variant="ghost" size="sm" className="text-xs">
            H3
          </Button>
          <div className="w-px h-4 bg-border mx-1" />
          <Button variant="ghost" size="sm" className="text-xs">
            • List
          </Button>
          <Button variant="ghost" size="sm" className="text-xs">
            1. List
          </Button>
          <Button variant="ghost" size="sm" className="text-xs">
            " Quote
          </Button>
        </div>
        <div className="flex items-center gap-4 text-xs text-muted-foreground">
          <span>{wordCount.toLocaleString()} words</span>
          {lastSaved && (
            <span>Saved {lastSaved.toLocaleTimeString()}</span>
          )}
          {onSave && (
            <Button 
              size="sm" 
              onClick={handleSave} 
              disabled={isSaving}
              className="h-7"
            >
              {isSaving ? 'Saving...' : 'Save'}
            </Button>
          )}
        </div>
      </div>

      {/* Editor Area */}
      <div className="flex-1 overflow-auto">
        <textarea
          value={content}
          onChange={handleChange}
          placeholder={placeholder}
          readOnly={readOnly}
          className="w-full h-full min-h-[500px] p-8 text-lg leading-relaxed resize-none focus:outline-none bg-background font-serif"
          style={{ lineHeight: '1.8' }}
        />
      </div>
    </div>
  );
}
