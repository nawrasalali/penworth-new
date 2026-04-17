'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { OutlineSection } from '@/types/agent-workflow';
import { cn } from '@/lib/utils';
import { t, type Locale } from '@/lib/i18n/strings';
import {
  FileText,
  CheckCircle2,
  Circle,
  Loader2,
  Edit3,
  ArrowRight,
  BookOpen
} from 'lucide-react';

interface OutlineScreenProps {
  bookTitle: string;
  authorName: string;
  sections: OutlineSection[];
  isGenerating: boolean;
  onRequestChanges: (feedback: string) => void;
  onApprove: () => void;
  locale?: Locale;
}

export function OutlineScreen({
  bookTitle,
  authorName,
  sections,
  isGenerating,
  onRequestChanges,
  onApprove,
  locale = 'en',
}: OutlineScreenProps) {
  const [showFeedback, setShowFeedback] = useState(false);
  const [feedback, setFeedback] = useState('');
  
  const frontMatter = sections.filter(s => s.type === 'front_matter');
  const chapters = sections.filter(s => s.type === 'chapter');
  const backMatter = sections.filter(s => s.type === 'back_matter');
  
  const completedCount = sections.filter(s => s.status === 'complete').length;
  const progress = (completedCount / sections.length) * 100;
  
  const handleSubmitFeedback = () => {
    if (!feedback.trim()) return;
    onRequestChanges(feedback);
    setFeedback('');
    setShowFeedback(false);
  };

  const getStatusIcon = (status: OutlineSection['status']) => {
    switch (status) {
      case 'complete':
        return <CheckCircle2 className="h-4 w-4 text-green-500" />;
      case 'generating':
        return <Loader2 className="h-4 w-4 text-primary animate-spin" />;
      default:
        return <Circle className="h-4 w-4 text-muted-foreground" />;
    }
  };

  return (
    <div className="flex-1 flex flex-col p-6 overflow-hidden">
      {/* Header */}
      <div className="mb-4">
        <div className="flex items-center gap-2 mb-2">
          <FileText className="h-5 w-5 text-primary" />
          <h1 className="text-xl font-bold">{t('outline.title', locale)}</h1>
        </div>
        <p className="text-sm text-muted-foreground">
          {t('outline.subtitle', locale)}
        </p>
      </div>
      
      {/* PDF-Style Preview */}
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-2xl mx-auto bg-white dark:bg-zinc-900 rounded-lg shadow-lg border">
          {/* Cover Page */}
          <div className="border-b p-8 text-center">
            <div className="border-4 border-double border-primary/20 p-8">
              <div className="text-3xl font-bold text-primary mb-4 uppercase tracking-wider">
                {bookTitle || t('outline.untitledBook', locale)}
              </div>
              <div className="text-lg text-muted-foreground">
                {t('outline.byByline', locale)} {authorName || t('outline.authorName', locale)}
              </div>
            </div>
          </div>
          
          {/* Content */}
          <div className="p-6">
            {/* Front Matter */}
            {frontMatter.length > 0 && (
              <div className="mb-6">
                <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">
                  {t('outline.frontMatter', locale)}
                </h3>
                <div className="space-y-1 ml-4">
                  {frontMatter.map((section) => (
                    <div 
                      key={section.id}
                      className="flex items-center gap-2 text-sm"
                    >
                      {getStatusIcon(section.status)}
                      <span className={cn(
                        section.status === 'complete' && 'text-foreground',
                        section.status === 'pending' && 'text-muted-foreground'
                      )}>
                        {section.title}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
            
            {/* Chapters */}
            <div className="mb-6">
              <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">
                {t('outline.chaptersHeading', locale)}
              </h3>
              <div className="space-y-2 ml-4">
                {chapters.map((section, idx) => (
                  <div 
                    key={section.id}
                    className="flex items-start gap-2"
                  >
                    {getStatusIcon(section.status)}
                    <div className="flex-1">
                      <div className={cn(
                        'text-sm font-medium',
                        section.status === 'complete' && 'text-foreground',
                        section.status === 'pending' && 'text-muted-foreground'
                      )}>
                        {t('outline.chapterPrefix', locale)} {idx + 1}: {section.title}
                      </div>
                      {section.description && (
                        <div className="text-xs text-muted-foreground mt-0.5">
                          {section.description}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
            
            {/* Back Matter */}
            {backMatter.length > 0 && (
              <div>
                <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">
                  {t('outline.backMatter', locale)}
                </h3>
                <div className="space-y-1 ml-4">
                  {backMatter.map((section) => (
                    <div 
                      key={section.id}
                      className="flex items-center gap-2 text-sm"
                    >
                      {getStatusIcon(section.status)}
                      <span className={cn(
                        section.status === 'complete' && 'text-foreground',
                        section.status === 'pending' && 'text-muted-foreground'
                      )}>
                        {section.title}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
      
      {/* Feedback Panel */}
      {showFeedback && (
        <div className="mt-4 p-4 border rounded-lg bg-muted/30">
          <h4 className="font-medium mb-2">{t('outline.requestChanges', locale)}</h4>
          <Textarea
            value={feedback}
            onChange={(e) => setFeedback(e.target.value)}
            placeholder={t('outline.feedbackPlaceholder', locale)}
            className="min-h-[80px] mb-3"
          />
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setShowFeedback(false)}>
              {t('outline.cancel', locale)}
            </Button>
            <Button onClick={handleSubmitFeedback} disabled={!feedback.trim()}>
              {t('outline.submitFeedback', locale)}
            </Button>
          </div>
        </div>
      )}
      
      {/* Actions */}
      {!showFeedback && (
        <div className="flex gap-3 mt-4 justify-center">
          <Button 
            variant="outline" 
            onClick={() => setShowFeedback(true)}
            disabled={isGenerating}
          >
            <Edit3 className="mr-2 h-4 w-4" />
            {t('outline.requestChanges', locale)}
          </Button>
          <Button 
            onClick={onApprove}
            disabled={isGenerating || completedCount < sections.length}
          >
            <CheckCircle2 className="mr-2 h-4 w-4" />
            {t('outline.approve', locale)}
            <ArrowRight className="ml-2 h-4 w-4" />
          </Button>
        </div>
      )}
      
      {isGenerating && (
        <p className="text-center text-sm text-muted-foreground mt-3">
          <Loader2 className="inline h-4 w-4 animate-spin mr-2" />
          {t('outline.generating', locale)} {Math.round(progress)}%
        </p>
      )}
    </div>
  );
}
