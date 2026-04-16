'use client';

import { Button } from '@/components/ui/button';
import { CoverConfig } from '@/types/agent-workflow';
import { cn } from '@/lib/utils';
import {
  FileText,
  Eye,
  Download,
  Share2,
  Users,
  Coins,
  Clock,
  BookOpen,
  TrendingUp,
  Plus
} from 'lucide-react';

interface DocumentPreviewProps {
  bookTitle: string;
  authorName: string;
  contentType: string;
  coverUrl?: string;
  wordCount: number;
  pageCount: number;
  chapterCount: number;
  creditsUsed: number;
  creditsRemaining: number;
  estimatedTimeRemaining?: string;
  currentAgent: string;
  isFreeTier: boolean;
  onViewPDF?: () => void;
  onExportDraft?: () => void;
  onSharePreview?: () => void;
  onInviteCollaborator?: () => void;
  onTopUp?: () => void;
}

export function DocumentPreview({
  bookTitle,
  authorName,
  contentType,
  coverUrl,
  wordCount,
  pageCount,
  chapterCount,
  creditsUsed,
  creditsRemaining,
  estimatedTimeRemaining,
  currentAgent,
  isFreeTier,
  onViewPDF,
  onExportDraft,
  onSharePreview,
  onInviteCollaborator,
  onTopUp
}: DocumentPreviewProps) {
  const isBook = ['fiction', 'non-fiction', 'memoir', 'self-help', 'children', 'poetry', 'cookbook', 'travel', 'biography'].includes(contentType);
  
  return (
    <div className="w-[300px] border-l bg-muted/10 p-4 overflow-y-auto flex flex-col">
      {/* Document Preview */}
      <div className="mb-4">
        <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">
          Document Preview
        </h3>
        
        {/* Mini Cover/Document Preview */}
        <div className="relative bg-white dark:bg-zinc-900 rounded-lg shadow-lg overflow-hidden aspect-[3/4] mb-3">
          {coverUrl ? (
            <img 
              src={coverUrl} 
              alt="Cover preview"
              className="w-full h-full object-cover"
            />
          ) : (
            <div className="w-full h-full flex flex-col items-center justify-center p-4 text-center">
              <BookOpen className="h-12 w-12 text-muted-foreground/30 mb-3" />
              <h4 className="font-semibold text-sm line-clamp-2">
                {bookTitle || 'Untitled Document'}
              </h4>
              <p className="text-xs text-muted-foreground mt-1">
                by {authorName || 'Author'}
              </p>
            </div>
          )}
          
          {/* Free Tier Watermark Preview */}
          {isFreeTier && (
            <div className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-black/80 to-transparent p-2">
              <p className="text-[10px] text-white/80 text-center">
                by penworth.ai
              </p>
            </div>
          )}
        </div>
        
        {onViewPDF && (
          <Button 
            variant="outline" 
            size="sm" 
            className="w-full"
            onClick={onViewPDF}
          >
            <Eye className="mr-2 h-3 w-3" />
            Preview PDF
          </Button>
        )}
      </div>
      
      {/* Progress Stats */}
      <div className="mb-4">
        <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">
          Progress Stats
        </h3>
        
        <div className="space-y-2">
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground flex items-center gap-1.5">
              <FileText className="h-3.5 w-3.5" />
              Words
            </span>
            <span className="font-medium">{wordCount.toLocaleString()}</span>
          </div>
          
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground flex items-center gap-1.5">
              <BookOpen className="h-3.5 w-3.5" />
              Pages
            </span>
            <span className="font-medium">{pageCount}</span>
          </div>
          
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground flex items-center gap-1.5">
              <TrendingUp className="h-3.5 w-3.5" />
              Chapters
            </span>
            <span className="font-medium">{chapterCount}</span>
          </div>
        </div>
      </div>
      
      {/* Credits */}
      <div className="mb-4">
        <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">
          Credits
        </h3>
        
        <div className="rounded-lg border bg-card p-3">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm text-muted-foreground">Used</span>
            <span className="text-sm font-medium">{creditsUsed}</span>
          </div>
          <div className="flex items-center justify-between mb-3">
            <span className="text-sm text-muted-foreground">Remaining</span>
            <span className={cn(
              'text-sm font-medium',
              creditsRemaining < 500 && 'text-amber-500',
              creditsRemaining < 100 && 'text-red-500'
            )}>
              {creditsRemaining}
            </span>
          </div>
          
          {/* Progress bar */}
          <div className="h-2 bg-muted rounded-full overflow-hidden mb-3">
            <div 
              className={cn(
                'h-full transition-all',
                creditsRemaining > 500 && 'bg-green-500',
                creditsRemaining <= 500 && creditsRemaining > 100 && 'bg-amber-500',
                creditsRemaining <= 100 && 'bg-red-500'
              )}
              style={{ 
                width: `${Math.min(100, (creditsRemaining / (creditsUsed + creditsRemaining)) * 100)}%` 
              }}
            />
          </div>
          
          {onTopUp && (
            <Button 
              variant="outline" 
              size="sm" 
              className="w-full"
              onClick={onTopUp}
            >
              <Plus className="mr-2 h-3 w-3" />
              Top Up Credits
            </Button>
          )}
        </div>
      </div>
      
      {/* Time Estimate */}
      {estimatedTimeRemaining && (
        <div className="mb-4">
          <div className="rounded-lg border bg-primary/5 p-3">
            <div className="flex items-center gap-2 text-sm">
              <Clock className="h-4 w-4 text-primary" />
              <span className="text-muted-foreground">Est. time remaining:</span>
            </div>
            <div className="text-lg font-semibold mt-1">
              {estimatedTimeRemaining}
            </div>
          </div>
        </div>
      )}
      
      {/* Quick Actions */}
      <div className="mt-auto">
        <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">
          Quick Actions
        </h3>
        
        <div className="space-y-2">
          {onExportDraft && (
            <Button 
              variant="outline" 
              size="sm" 
              className="w-full justify-start"
              onClick={onExportDraft}
            >
              <Download className="mr-2 h-3.5 w-3.5" />
              Export Draft
            </Button>
          )}
          
          {onSharePreview && (
            <Button 
              variant="outline" 
              size="sm" 
              className="w-full justify-start"
              onClick={onSharePreview}
            >
              <Share2 className="mr-2 h-3.5 w-3.5" />
              Share Preview
            </Button>
          )}
          
          {onInviteCollaborator && (
            <Button 
              variant="outline" 
              size="sm" 
              className="w-full justify-start"
              onClick={onInviteCollaborator}
            >
              <Users className="mr-2 h-3.5 w-3.5" />
              Invite Collaborator
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
