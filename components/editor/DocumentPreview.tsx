'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { CoverConfig } from '@/types/agent-workflow';
import { cn } from '@/lib/utils';
import { t, type Locale } from '@/lib/i18n/strings';
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
  Plus,
  X,
  Menu,
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
  locale?: Locale;
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
  onTopUp,
  locale = 'en',
}: DocumentPreviewProps) {
  const [collapsed, setCollapsed] = useState(false);
  const isBook = ['fiction', 'non-fiction', 'memoir', 'self-help', 'children', 'poetry', 'cookbook', 'travel', 'biography'].includes(contentType);

  // Collapsed rail — 10px wide, matches the left-panel collapsed width.
  // Shows just the expand button so the user can bring it back.
  if (collapsed) {
    return (
      <div className="w-10 shrink-0 border-l bg-muted/10 flex flex-col items-center py-3">
        <button
          onClick={() => setCollapsed(false)}
          className="p-2 hover:bg-muted rounded-lg"
          aria-label={t('preview.expand', locale)}
          title={t('preview.expand', locale)}
        >
          <Menu className="h-4 w-4" />
        </button>
      </div>
    );
  }

  return (
    <div className="w-[280px] shrink-0 border-l bg-muted/10 overflow-y-auto flex flex-col">
      {/* Header with collapse button — inline with first section so we
          don't spend vertical on a dedicated header bar. */}
      <div className="p-3 border-b flex items-center justify-between gap-2">
        <h3 className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
          {t('preview.title', locale)}
        </h3>
        <button
          onClick={() => setCollapsed(true)}
          className="p-1 hover:bg-muted rounded"
          aria-label={t('preview.collapse', locale)}
          title={t('preview.collapse', locale)}
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="p-3 flex-1 flex flex-col">
      {/* Document Preview */}
      <div className="mb-4">
        {/* Mini Cover/Document Preview — capped to 180px max-height so
            it doesn't dominate on short viewports. */}
        <div className="relative bg-white dark:bg-zinc-900 rounded-lg shadow-lg overflow-hidden aspect-[3/4] max-h-[180px] mx-auto mb-3">
          {coverUrl ? (
            <img
              src={coverUrl}
              alt="Cover preview"
              className="w-full h-full object-cover"
            />
          ) : (
            <div className="w-full h-full flex flex-col items-center justify-center p-3 text-center">
              <BookOpen className="h-8 w-8 text-muted-foreground/30 mb-2" />
              <h4 className="font-semibold text-xs line-clamp-2">
                {bookTitle || t('preview.untitledDoc', locale)}
              </h4>
              <p className="text-[10px] text-muted-foreground mt-1">
                {t('preview.byAuthor', locale)} {authorName || t('editor.author', locale)}
              </p>
            </div>
          )}

          {/* Free Tier Watermark Preview */}
          {isFreeTier && (
            <div className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-black/80 to-transparent p-1.5">
              <p className="text-[9px] text-white/80 text-center">
                {t('preview.byPenworth', locale)}
              </p>
            </div>
          )}
        </div>

        {onViewPDF && (
          <Button
            variant="outline"
            size="sm"
            className="w-full h-8 text-xs"
            onClick={onViewPDF}
          >
            <Eye className="mr-2 h-3 w-3" />
            {t('preview.previewPdf', locale)}
          </Button>
        )}
      </div>
      
      {/* Progress Stats */}
      <div className="mb-3">
        <h3 className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">
          {t('preview.progressStats', locale)}
        </h3>

        <div className="space-y-1.5">
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground flex items-center gap-1.5">
              <FileText className="h-3 w-3" />
              {t('preview.words', locale)}
            </span>
            <span className="font-medium">{wordCount.toLocaleString()}</span>
          </div>

          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground flex items-center gap-1.5">
              <BookOpen className="h-3 w-3" />
              {t('preview.pages', locale)}
            </span>
            <span className="font-medium">{pageCount}</span>
          </div>

          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground flex items-center gap-1.5">
              <TrendingUp className="h-3 w-3" />
              {t('preview.chapters', locale)}
            </span>
            <span className="font-medium">{chapterCount}</span>
          </div>
        </div>
      </div>

      {/* Credits */}
      <div className="mb-3">
        <h3 className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">
          {t('preview.credits', locale)}
        </h3>

        <div className="rounded-lg border bg-card p-2.5">
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs text-muted-foreground">{t('preview.used', locale)}</span>
            <span className="text-xs font-medium">{creditsUsed}</span>
          </div>
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs text-muted-foreground">{t('preview.remaining', locale)}</span>
            <span className={cn(
              'text-xs font-medium',
              creditsRemaining < 500 && 'text-amber-500',
              creditsRemaining < 100 && 'text-red-500'
            )}>
              {creditsRemaining}
            </span>
          </div>

          {/* Progress bar — slimmer (h-1 instead of h-2) */}
          <div className="h-1 bg-muted rounded-full overflow-hidden mb-2">
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
              className="w-full h-7 text-xs"
              onClick={onTopUp}
            >
              <Plus className="mr-1.5 h-3 w-3" />
              {t('preview.topUp', locale)}
            </Button>
          )}
        </div>
      </div>

      {/* Time Estimate */}
      {estimatedTimeRemaining && (
        <div className="mb-3">
          <div className="rounded-lg border bg-primary/5 p-2.5">
            <div className="flex items-center gap-1.5 text-xs">
              <Clock className="h-3 w-3 text-primary" />
              <span className="text-muted-foreground">{t('preview.estTimeRemaining', locale)}</span>
            </div>
            <div className="text-sm font-semibold mt-0.5">
              {estimatedTimeRemaining}
            </div>
          </div>
        </div>
      )}

      {/* Quick Actions */}
      <div className="mt-auto">
        <h3 className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">
          {t('preview.quickActions', locale)}
        </h3>

        <div className="space-y-1.5">
          {onExportDraft && (
            <Button
              variant="outline"
              size="sm"
              className="w-full h-8 text-xs justify-start"
              onClick={onExportDraft}
            >
              <Download className="mr-1.5 h-3 w-3" />
              {t('preview.exportDraft', locale)}
            </Button>
          )}

          {onSharePreview && (
            <Button
              variant="outline"
              size="sm"
              className="w-full h-8 text-xs justify-start"
              onClick={onSharePreview}
            >
              <Share2 className="mr-1.5 h-3 w-3" />
              {t('preview.sharePreview', locale)}
            </Button>
          )}

          {onInviteCollaborator && (
            <Button
              variant="outline"
              size="sm"
              className="w-full h-8 text-xs justify-start"
              onClick={onInviteCollaborator}
            >
              <Users className="mr-1.5 h-3 w-3" />
              {t('preview.inviteCollab', locale)}
            </Button>
          )}
        </div>
      </div>
      </div>
    </div>
  );
}
