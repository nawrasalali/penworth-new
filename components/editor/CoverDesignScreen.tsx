'use client';

import { useState, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { AuthorInfo, CoverConfig, CREDIT_COSTS } from '@/types/agent-workflow';
import { cn } from '@/lib/utils';
import { t, type Locale, type StringKey } from '@/lib/i18n/strings';
import {
  ImageIcon,
  Upload,
  RefreshCw,
  ArrowRight,
  User,
  Coins,
  Loader2,
  Check,
  Sparkles,
} from 'lucide-react';

// The six style-prompt chips are also used as the *text sent to the image
// model*, so they must be real prompts in the user's language. We key them
// by id and translate each.
const COVER_SUGGESTION_KEYS: StringKey[] = [
  'cover.suggestion.professional',
  'cover.suggestion.elegant',
  'cover.suggestion.bold',
  'cover.suggestion.minimalist',
  'cover.suggestion.warm',
  'cover.suggestion.classic',
];

interface CoverDesignScreenProps {
  bookTitle: string;
  authorInfo: AuthorInfo;
  coverConfig: CoverConfig;
  userCredits: number;
  onUpdateAuthorInfo: (info: Partial<AuthorInfo>) => void;
  onGenerateCover: (type: 'front' | 'back', prompt?: string) => Promise<void>;
  onUploadAuthorPhoto: (file: File) => Promise<void>;
  onApproveAndContinue: () => void;
  locale?: Locale;
}

export function CoverDesignScreen({
  bookTitle,
  authorInfo,
  coverConfig,
  userCredits,
  onUpdateAuthorInfo,
  onGenerateCover,
  onUploadAuthorPhoto,
  onApproveAndContinue,
  locale = 'en',
}: CoverDesignScreenProps) {
  const [frontPrompt, setFrontPrompt] = useState('');
  const [backPrompt, setBackPrompt] = useState('');
  const [isGeneratingFront, setIsGeneratingFront] = useState(false);
  const [isGeneratingBack, setIsGeneratingBack] = useState(false);
  const [isUploadingPhoto, setIsUploadingPhoto] = useState(false);
  const [aboutDraft, setAboutDraft] = useState(authorInfo.aboutAuthor || '');
  const photoInputRef = useRef<HTMLInputElement>(null);

  const frontRegens = coverConfig.frontCoverRegenerations ?? 0;
  const backRegens = coverConfig.backCoverRegenerations ?? 0;
  const frontIsFirstGen = frontRegens === 0;
  const backIsFirstGen = backRegens === 0;
  const frontCost = frontIsFirstGen ? 0 : CREDIT_COSTS.FRONT_COVER_REGENERATE;
  const backCost = backIsFirstGen ? 0 : CREDIT_COSTS.BACK_COVER_REGENERATE;
  const canPayFront = userCredits >= frontCost;
  const canPayBack = userCredits >= backCost;

  const handleGenerateFront = async () => {
    setIsGeneratingFront(true);
    try {
      await onGenerateCover('front', frontPrompt || undefined);
    } finally {
      setIsGeneratingFront(false);
    }
  };

  const handleGenerateBack = async () => {
    setIsGeneratingBack(true);
    try {
      await onGenerateCover('back', backPrompt || undefined);
    } finally {
      setIsGeneratingBack(false);
    }
  };

  const handlePhotoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setIsUploadingPhoto(true);
    try {
      await onUploadAuthorPhoto(file);
    } finally {
      setIsUploadingPhoto(false);
    }
  };

  const bothCoversReady = !!coverConfig.frontCoverUrl && !!coverConfig.backCoverUrl;
  const authorReady = !!authorInfo.name && !!authorInfo.aboutAuthor;

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="p-6 pb-2 text-center shrink-0">
        <div className="w-14 h-14 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-3">
          <ImageIcon className="h-7 w-7 text-primary" />
        </div>
        <h1 className="text-xl font-bold">{t('cover.title', locale)}</h1>
        <p className="text-sm text-muted-foreground">
          {t('cover.subtitle', locale)}
        </p>
      </div>

      <div className="flex-1 overflow-y-auto px-6 pb-4">
        <div className="max-w-5xl mx-auto space-y-6">
          {/* COVERS ROW */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* FRONT COVER */}
            <div className="rounded-xl border bg-card p-4">
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-semibold flex items-center gap-2">
                  <ImageIcon className="h-4 w-4" /> {t('cover.front', locale)}
                </h3>
                {!frontIsFirstGen && (
                  <span className="text-xs text-muted-foreground flex items-center gap-1">
                    <Coins className="h-3 w-3" /> {CREDIT_COSTS.FRONT_COVER_REGENERATE} {t('cover.credits', locale)}
                  </span>
                )}
              </div>

              {coverConfig.frontCoverUrl ? (
                <div className="relative aspect-[2/3] bg-muted rounded-lg overflow-hidden mb-3">
                  {/* Per CEO-099 the editor preview shows the cover
                      image ALONE — no title overlay, no byline overlay.
                      The PDF export adds typography during render
                      (drawFrontCoverOverlay in app/api/export/route.ts).
                      Stamping the title here distorted the author's
                      judgment of the artwork and was misread as the
                      cover itself having text on it. */}
                  <img src={coverConfig.frontCoverUrl} alt={t('cover.front', locale)} className="w-full h-full object-cover" />
                </div>
              ) : (
                <div className="aspect-[2/3] bg-muted rounded-lg flex items-center justify-center mb-3">
                  <div className="text-center text-muted-foreground">
                    <ImageIcon className="h-10 w-10 mx-auto mb-2 opacity-50" />
                    <p className="text-xs">{t('cover.noFrontYet', locale)}</p>
                  </div>
                </div>
              )}

              <Textarea
                value={frontPrompt}
                onChange={(e) => setFrontPrompt(e.target.value)}
                placeholder={t('cover.frontPromptPlaceholder', locale)}
                className="min-h-[60px] text-sm mb-2"
              />
              <div className="flex flex-wrap gap-1 mb-3">
                {COVER_SUGGESTION_KEYS.slice(0, 3).map((k, i) => {
                  const s = t(k, locale);
                  return (
                    <button
                      key={i}
                      onClick={() => setFrontPrompt(s)}
                      className="text-[10px] px-2 py-0.5 rounded-full border hover:bg-primary/10 hover:border-primary transition-colors"
                    >
                      {s}
                    </button>
                  );
                })}
              </div>

              <Button
                className="w-full"
                disabled={isGeneratingFront || !canPayFront}
                onClick={handleGenerateFront}
              >
                {isGeneratingFront ? (
                  <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> {t('cover.generating', locale)}</>
                ) : coverConfig.frontCoverUrl ? (
                  <><RefreshCw className="h-4 w-4 mr-2" /> {t('cover.regenerate', locale)}{!frontIsFirstGen ? ` (${CREDIT_COSTS.FRONT_COVER_REGENERATE} ${t('cover.credits', locale)})` : ''}</>
                ) : (
                  <><Sparkles className="h-4 w-4 mr-2" /> {t('cover.generateFrontFree', locale)}</>
                )}
              </Button>
              {!canPayFront && !frontIsFirstGen && (
                <p className="text-xs text-red-500 mt-1 text-center">{t('cover.notEnoughCredits', locale)}</p>
              )}
            </div>

            {/* BACK COVER */}
            <div className="rounded-xl border bg-card p-4">
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-semibold flex items-center gap-2">
                  <ImageIcon className="h-4 w-4" /> {t('cover.back', locale)}
                </h3>
                {!backIsFirstGen && (
                  <span className="text-xs text-muted-foreground flex items-center gap-1">
                    <Coins className="h-3 w-3" /> {CREDIT_COSTS.BACK_COVER_REGENERATE} {t('cover.credits', locale)}
                  </span>
                )}
              </div>

              {coverConfig.backCoverUrl ? (
                <div className="aspect-[2/3] bg-muted rounded-lg overflow-hidden mb-3">
                  <img src={coverConfig.backCoverUrl} alt={t('cover.back', locale)} className="w-full h-full object-cover" />
                </div>
              ) : (
                <div className="aspect-[2/3] bg-muted rounded-lg flex items-center justify-center mb-3">
                  <div className="text-center text-muted-foreground">
                    <ImageIcon className="h-10 w-10 mx-auto mb-2 opacity-50" />
                    <p className="text-xs">{t('cover.noBackYet', locale)}</p>
                  </div>
                </div>
              )}

              <Textarea
                value={backPrompt}
                onChange={(e) => setBackPrompt(e.target.value)}
                placeholder={t('cover.backPromptPlaceholder', locale)}
                className="min-h-[60px] text-sm mb-3"
              />

              <Button
                className="w-full"
                variant={coverConfig.backCoverUrl ? 'outline' : 'default'}
                disabled={isGeneratingBack || !canPayBack}
                onClick={handleGenerateBack}
              >
                {isGeneratingBack ? (
                  <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> {t('cover.generating', locale)}</>
                ) : coverConfig.backCoverUrl ? (
                  <><RefreshCw className="h-4 w-4 mr-2" /> {t('cover.regenerate', locale)}{!backIsFirstGen ? ` (${CREDIT_COSTS.BACK_COVER_REGENERATE} ${t('cover.credits', locale)})` : ''}</>
                ) : (
                  <><Sparkles className="h-4 w-4 mr-2" /> {t('cover.generateBackFree', locale)}</>
                )}
              </Button>
              {!canPayBack && !backIsFirstGen && (
                <p className="text-xs text-red-500 mt-1 text-center">{t('cover.notEnoughCredits', locale)}</p>
              )}
            </div>
          </div>

          {/* AUTHOR CARD */}
          <div className="rounded-xl border bg-card p-5">
            <h3 className="font-semibold mb-3 flex items-center gap-2">
              <User className="h-4 w-4" /> {t('cover.authorInfoTitle', locale)}
            </h3>

            <div className="grid grid-cols-1 md:grid-cols-[120px_1fr] gap-4">
              {/* Photo */}
              <div className="space-y-2">
                <div className="w-24 h-24 mx-auto rounded-full bg-muted overflow-hidden border-2 border-dashed border-muted-foreground/30 flex items-center justify-center">
                  {authorInfo.photoUrl ? (
                    <img src={authorInfo.photoUrl} alt={authorInfo.name} className="w-full h-full object-cover" />
                  ) : (
                    <User className="h-8 w-8 text-muted-foreground/50" />
                  )}
                </div>
                <input
                  ref={photoInputRef}
                  type="file"
                  accept="image/*"
                  onChange={handlePhotoUpload}
                  className="hidden"
                />
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full"
                  disabled={isUploadingPhoto}
                  onClick={() => photoInputRef.current?.click()}
                >
                  {isUploadingPhoto ? (
                    <><Loader2 className="h-3 w-3 mr-1 animate-spin" /> {t('cover.uploading', locale)}</>
                  ) : (
                    <><Upload className="h-3 w-3 mr-1" /> {t('cover.photoButton', locale)}</>
                  )}
                </Button>
              </div>

              {/* Name + Bio */}
              <div className="space-y-3">
                <div>
                  <label className="block text-xs font-medium mb-1">{t('cover.authorNameLabel', locale)}</label>
                  <Input
                    value={authorInfo.name}
                    onChange={(e) => onUpdateAuthorInfo({ name: e.target.value })}
                    placeholder={t('cover.authorNamePlaceholder', locale)}
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium mb-1">{t('cover.aboutAuthorLabel', locale)}</label>
                  <Textarea
                    value={aboutDraft}
                    onChange={(e) => setAboutDraft(e.target.value)}
                    onBlur={() => onUpdateAuthorInfo({ aboutAuthor: aboutDraft })}
                    placeholder={t('cover.aboutAuthorPlaceholder', locale)}
                    className="min-h-[80px]"
                  />
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* STICKY FOOTER */}
      <div className="border-t bg-background p-4 shrink-0">
        <div className="max-w-5xl mx-auto flex items-center justify-between gap-4">
          <div className="flex items-center gap-4 text-xs text-muted-foreground">
            <span className="flex items-center gap-1">
              {coverConfig.frontCoverUrl ? <Check className="h-3.5 w-3.5 text-green-500" /> : <span className="h-3.5 w-3.5 rounded-full border border-muted-foreground/40" />}
              {t('cover.footerFront', locale)}
            </span>
            <span className="flex items-center gap-1">
              {coverConfig.backCoverUrl ? <Check className="h-3.5 w-3.5 text-green-500" /> : <span className="h-3.5 w-3.5 rounded-full border border-muted-foreground/40" />}
              {t('cover.footerBack', locale)}
            </span>
            <span className="flex items-center gap-1">
              {authorReady ? <Check className="h-3.5 w-3.5 text-green-500" /> : <span className="h-3.5 w-3.5 rounded-full border border-muted-foreground/40" />}
              {t('cover.footerAuthor', locale)}
            </span>
          </div>
          <Button
            size="lg"
            disabled={!bothCoversReady || !authorReady}
            onClick={onApproveAndContinue}
          >
            {t('cover.approveContinue', locale)}
            <ArrowRight className="ml-2 h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
