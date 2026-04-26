'use client';

import { useState, useEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { AuthorInfo, CoverConfig, CREDIT_COSTS, KDP_SPECS } from '@/types/agent-workflow';
import { cn } from '@/lib/utils';
import { t, type Locale, type StringKey } from '@/lib/i18n/strings';
import {
  BookOpen,
  Upload,
  RefreshCw,
  Eye,
  Rocket,
  User,
  ImageIcon,
  Coins,
  Sparkles,
  FileText,
  ArrowRight,
  Check,
  Linkedin,
  Globe,
  Loader2,
} from 'lucide-react';

interface PublishScreenProps {
  bookTitle: string;
  contentType: string;
  authorInfo: AuthorInfo;
  coverConfig: CoverConfig;
  userCredits: number;
  isFreeTier: boolean;
  wordCount: number;
  pageCount: number;
  chapterCount: number;
  onUpdateAuthorInfo: (info: Partial<AuthorInfo>) => void;
  onGenerateCover: (type: 'front' | 'back', prompt?: string) => Promise<void>;
  onUploadAuthorPhoto: (file: File) => void;
  /**
   * CEO-106: lets the writer skip AI generation for the front cover and
   * bring their own artwork. `hasTypography=true` tells downstream
   * renderers to skip the title/author overlay because the uploaded file
   * already includes typography. Optional so older callers compile.
   */
  onUploadCover?: (file: File, hasTypography: boolean) => Promise<void>;
  onExtractFromLinkedIn: (url: string) => void;
  onViewPDF: () => void;
  onDownload: () => void;
  onPublish: () => void;
  locale?: Locale;
}

// Re-uses the same suggestion keys as CoverDesignScreen so translators only
// maintain one set. The prompt text sent to Ideogram is the localised string,
// which Ideogram handles across all 11 languages.
const COVER_SUGGESTION_KEYS: StringKey[] = [
  'cover.suggestion.professional',
  'cover.suggestion.elegant',
  'cover.suggestion.bold',
  'cover.suggestion.minimalist',
  'cover.suggestion.warm',
];

const DOCUMENT_STYLE_KEYS: { id: string; labelKey: StringKey }[] = [
  { id: 'professional', labelKey: 'pubScreen.preview.docStyle.professional' },
  { id: 'whitepaper', labelKey: 'pubScreen.preview.docStyle.whitepaper' },
  { id: 'thesis', labelKey: 'pubScreen.preview.docStyle.thesis' },
  { id: 'proposal', labelKey: 'pubScreen.preview.docStyle.proposal' },
];

export function PublishScreen({
  bookTitle,
  contentType,
  authorInfo,
  coverConfig,
  userCredits,
  isFreeTier,
  wordCount,
  pageCount,
  chapterCount,
  onUpdateAuthorInfo,
  onGenerateCover,
  onUploadAuthorPhoto,
  onUploadCover,
  onExtractFromLinkedIn,
  onViewPDF,
  onDownload,
  onPublish,
  locale = 'en',
}: PublishScreenProps) {
  // If the author info was already collected (e.g. in the Cover Design agent
  // step), skip the author phase — no one should have to fill it in twice.
  const authorAlreadyFilled = !!authorInfo.name && !!authorInfo.aboutAuthor;
  const isBook = ['fiction', 'non-fiction', 'memoir', 'self-help', 'children', 'poetry', 'cookbook', 'travel', 'biography'].includes(contentType);
  const isBusinessPlan = contentType === 'business' || contentType === 'business_plan';
  const needsCover = isBook || isBusinessPlan;
  const coversAlreadyReady =
    (!needsCover) || (!!coverConfig.frontCoverUrl && (!isBook || !!coverConfig.backCoverUrl));

  const [phase, setPhase] = useState<'author' | 'cover' | 'preview'>(
    authorAlreadyFilled
      ? (coversAlreadyReady ? 'preview' : (needsCover ? 'cover' : 'preview'))
      : 'author'
  );
  const [coverPrompt, setCoverPrompt] = useState('');
  const [linkedInUrl, setLinkedInUrl] = useState('');
  const [isGeneratingCover, setIsGeneratingCover] = useState(false);
  const [editingAbout, setEditingAbout] = useState(false);
  const [aboutDraft, setAboutDraft] = useState(authorInfo.aboutAuthor || '');
  // CEO-106: upload-your-own front cover (mirrors CoverDesignScreen state).
  const [isUploadingCover, setIsUploadingCover] = useState(false);
  const [uploadHasTypography, setUploadHasTypography] = useState<boolean>(
    coverConfig.frontCoverHasTypography ?? false,
  );
  const coverInputRef = useRef<HTMLInputElement>(null);

  // Keep aboutDraft in sync with the prop when it arrives from the session
  // (author info is saved in the Cover Design step before Publish loads).
  useEffect(() => {
    if (!editingAbout) setAboutDraft(authorInfo.aboutAuthor || '');
  }, [authorInfo.aboutAuthor, editingAbout]);

  const canRegenerateFront = userCredits >= CREDIT_COSTS.FRONT_COVER_REGENERATE;
  const canRegenerateBack = userCredits >= CREDIT_COSTS.BACK_COVER_REGENERATE;
  
  const handleGenerateFrontCover = async () => {
    setIsGeneratingCover(true);
    try {
      await onGenerateCover('front', coverPrompt || undefined);
    } finally {
      setIsGeneratingCover(false);
    }
  };
  
  const handleGenerateBackCover = async () => {
    setIsGeneratingCover(true);
    try {
      await onGenerateCover('back');
    } finally {
      setIsGeneratingCover(false);
    }
  };

  // CEO-106: handler for the upload-your-own front cover input.
  const handleCoverFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !onUploadCover) return;
    setIsUploadingCover(true);
    try {
      await onUploadCover(file, uploadHasTypography);
    } finally {
      setIsUploadingCover(false);
      if (coverInputRef.current) coverInputRef.current.value = '';
    }
  };

  // Phase 1: Author Setup
  if (phase === 'author') {
    return (
      <div className="flex-1 flex flex-col p-6 max-w-2xl mx-auto w-full overflow-y-auto">
        <div className="mb-6 text-center">
          <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-4">
            <User className="h-8 w-8 text-primary" />
          </div>
          <h1 className="text-xl font-bold">{t('pubScreen.author.title', locale)}</h1>
          <p className="text-muted-foreground">
            {t('pubScreen.author.subtitle', locale)}
          </p>
        </div>
        
        {/* Author Name */}
        <div className="mb-4">
          <label className="block text-sm font-medium mb-2">{t('pubScreen.author.nameLabel', locale)}</label>
          <Input
            value={authorInfo.name}
            onChange={(e) => onUpdateAuthorInfo({ name: e.target.value })}
            placeholder={t('pubScreen.author.namePlaceholder', locale)}
          />
        </div>
        
        {/* Title/Credentials */}
        <div className="mb-4">
          <label className="block text-sm font-medium mb-2">{t('pubScreen.author.titleLabel', locale)}</label>
          <Input
            value={authorInfo.title}
            onChange={(e) => onUpdateAuthorInfo({ title: e.target.value })}
            placeholder={t('pubScreen.author.titlePlaceholder', locale)}
          />
        </div>
        
        {/* About the Author */}
        <div className="mb-4">
          <label className="block text-sm font-medium mb-2">{t('pubScreen.author.aboutLabel', locale)}</label>
          <p className="text-xs text-muted-foreground mb-2">
            {t('pubScreen.author.aboutHelp', locale)}
          </p>
          
          {/* Import Options */}
          <div className="flex gap-2 mb-3">
            <div className="flex-1 flex gap-2">
              <Input
                value={linkedInUrl}
                onChange={(e) => setLinkedInUrl(e.target.value)}
                placeholder={t('pubScreen.author.linkedinPlaceholder', locale)}
                className="flex-1"
              />
              <Button 
                variant="outline" 
                size="sm"
                onClick={() => onExtractFromLinkedIn(linkedInUrl)}
                disabled={!linkedInUrl}
              >
                <Linkedin className="h-4 w-4" />
              </Button>
            </div>
            <Button variant="outline" size="sm" asChild>
              <label className="cursor-pointer">
                <Upload className="h-4 w-4 mr-1" />
                {t('pubScreen.author.cvButton', locale)}
                <input
                  type="file"
                  className="hidden"
                  accept=".pdf,.doc,.docx"
                  onChange={(e) => {
                    // Handle CV upload
                  }}
                />
              </label>
            </Button>
          </div>
          
          {editingAbout ? (
            <div className="space-y-2">
              <Textarea
                value={aboutDraft}
                onChange={(e) => setAboutDraft(e.target.value)}
                placeholder={t('pubScreen.author.bioPlaceholder', locale)}
                className="min-h-[150px]"
              />
              <div className="flex gap-2">
                <Button 
                  variant="outline" 
                  size="sm"
                  onClick={() => {
                    setEditingAbout(false);
                    setAboutDraft(authorInfo.aboutAuthor || '');
                  }}
                >
                  {t('pubScreen.author.cancel', locale)}
                </Button>
                <Button 
                  size="sm"
                  onClick={() => {
                    onUpdateAuthorInfo({ aboutAuthor: aboutDraft });
                    setEditingAbout(false);
                  }}
                >
                  {t('pubScreen.author.save', locale)}
                </Button>
              </div>
            </div>
          ) : (
            <div 
              className="min-h-[100px] p-3 rounded-lg border bg-muted/30 cursor-pointer hover:bg-muted/50 transition-colors"
              onClick={() => setEditingAbout(true)}
            >
              {authorInfo.aboutAuthor ? (
                <p className="text-sm">{authorInfo.aboutAuthor}</p>
              ) : (
                <p className="text-sm text-muted-foreground italic">
                  {t('pubScreen.author.clickToWrite', locale)}
                </p>
              )}
            </div>
          )}
        </div>
        
        {/* Continue Button */}
        <div className="mt-6 flex justify-center">
          <Button
            onClick={() => setPhase(needsCover ? 'cover' : 'preview')}
            disabled={!authorInfo.name}
            size="lg"
          >
            {needsCover ? t('pubScreen.author.continueToCover', locale) : t('pubScreen.author.continueToPreview', locale)}
            <ArrowRight className="ml-2 h-4 w-4" />
          </Button>
        </div>
      </div>
    );
  }
  
  // Phase 2: Cover Design (only for books and business plans)
  if (phase === 'cover' && needsCover) {
    return (
      <div className="flex-1 flex flex-col p-6 overflow-hidden">
        <div className="mb-4 text-center">
          <h1 className="text-xl font-bold">{t('pubScreen.cover.title', locale)}</h1>
          <p className="text-sm text-muted-foreground">
            {t('pubScreen.cover.subtitle', locale)}
          </p>
        </div>
        
        <div className="flex-1 grid grid-cols-1 lg:grid-cols-2 gap-6 overflow-y-auto">
          {/* Front Cover */}
          <div className="rounded-xl border bg-card p-4">
            <h3 className="font-semibold mb-3 flex items-center gap-2">
              <ImageIcon className="h-4 w-4" />
              {t('pubScreen.cover.front', locale)}
            </h3>
            
            {coverConfig.frontCoverUrl ? (
              <div className="relative aspect-[2/3] bg-muted rounded-lg overflow-hidden mb-3">
                <img 
                  src={coverConfig.frontCoverUrl} 
                  alt={t('pubScreen.cover.front', locale)}
                  className="w-full h-full object-cover"
                />
                {/* Title Overlay */}
                <div className="absolute inset-x-0 top-0 p-4 bg-gradient-to-b from-black/60 to-transparent">
                  <div className="bg-black/40 backdrop-blur-sm px-3 py-2 rounded text-center">
                    <h2 className="text-white font-bold text-lg">{bookTitle}</h2>
                  </div>
                </div>
                {/* Author Overlay */}
                <div className="absolute inset-x-0 bottom-0 p-4 bg-gradient-to-t from-black/60 to-transparent">
                  <div className="bg-black/40 backdrop-blur-sm px-3 py-1 rounded text-center">
                    <p className="text-white text-sm">{t('pubScreen.cover.byByline', locale)} {authorInfo.name}</p>
                  </div>
                </div>
              </div>
            ) : (
              <div className="aspect-[2/3] bg-muted rounded-lg flex items-center justify-center mb-3">
                <div className="text-center text-muted-foreground">
                  <ImageIcon className="h-12 w-12 mx-auto mb-2 opacity-50" />
                  <p className="text-sm">{t('pubScreen.cover.noCoverYet', locale)}</p>
                </div>
              </div>
            )}
            
            {/* Cover Prompt */}
            <div className="space-y-2 mb-3">
              <Textarea
                value={coverPrompt}
                onChange={(e) => setCoverPrompt(e.target.value)}
                placeholder={t('pubScreen.cover.promptPlaceholder', locale)}
                className="min-h-[80px]"
              />
              <div className="flex flex-wrap gap-1">
                {COVER_SUGGESTION_KEYS.map((key, idx) => {
                  const suggestion = t(key, locale);
                  return (
                    <button
                      key={idx}
                      onClick={() => setCoverPrompt(suggestion)}
                      className="text-xs px-2 py-1 rounded-full bg-muted hover:bg-muted/80 transition-colors"
                    >
                      {suggestion.split(' ').slice(0, 3).join(' ')}…
                    </button>
                  );
                })}
              </div>
            </div>
            
            <Button
              onClick={handleGenerateFrontCover}
              disabled={isGeneratingCover}
              className="w-full"
            >
              {isGeneratingCover ? (
                <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
              ) : coverConfig.frontCoverUrl ? (
                <>
                  <RefreshCw className="mr-2 h-4 w-4" />
                  {t('pubScreen.cover.regenerate', locale)} ({CREDIT_COSTS.FRONT_COVER_REGENERATE} {t('pubScreen.cover.credits', locale)})
                </>
              ) : (
                <>
                  <Sparkles className="mr-2 h-4 w-4" />
                  {t('pubScreen.cover.generateFree', locale)}
                </>
              )}
            </Button>

            {/* CEO-106: Upload your own front cover. */}
            {onUploadCover && (
              <div className="mt-3 pt-3 border-t space-y-2">
                <input
                  ref={coverInputRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  className="hidden"
                  onChange={handleCoverFileChange}
                />
                <Button
                  type="button"
                  variant="outline"
                  className="w-full"
                  disabled={isUploadingCover}
                  onClick={() => coverInputRef.current?.click()}
                >
                  {isUploadingCover ? (
                    <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> {t('cover.uploading', locale)}</>
                  ) : (
                    <><Upload className="h-4 w-4 mr-2" /> {t('cover.uploadOwn', locale)}</>
                  )}
                </Button>
                <label className="flex items-start gap-2 text-xs text-muted-foreground cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={uploadHasTypography}
                    onChange={(e) => setUploadHasTypography(e.target.checked)}
                    className="mt-0.5"
                  />
                  <span>{t('cover.uploadHasTypography', locale)}</span>
                </label>
              </div>
            )}
          </div>
          
          {/* Back Cover */}
          <div className="rounded-xl border bg-card p-4">
            <h3 className="font-semibold mb-3 flex items-center gap-2">
              <ImageIcon className="h-4 w-4" />
              {t('pubScreen.cover.back', locale)}
            </h3>
            
            {coverConfig.backCoverUrl ? (
              <div className="relative aspect-[2/3] bg-muted rounded-lg overflow-hidden mb-3">
                <img 
                  src={coverConfig.backCoverUrl} 
                  alt={t('pubScreen.cover.back', locale)}
                  className="w-full h-full object-cover"
                />
                {/* Book Description Overlay */}
                <div className="absolute inset-0 flex flex-col justify-between p-4">
                  <div className="bg-black/50 backdrop-blur-sm p-3 rounded">
                    <p className="text-white text-xs line-clamp-6">
                      {t('pubScreen.cover.descriptionPlaceholder', locale)}
                    </p>
                  </div>
                  
                  {/* Author Section */}
                  <div className="flex items-center gap-3 bg-black/50 backdrop-blur-sm p-2 rounded">
                    {authorInfo.photoUrl ? (
                      <img 
                        src={authorInfo.photoUrl}
                        alt={authorInfo.name}
                        className="w-12 h-12 rounded-full object-cover"
                      />
                    ) : (
                      <div className="w-12 h-12 rounded-full bg-white/20 flex items-center justify-center">
                        <User className="h-6 w-6 text-white" />
                      </div>
                    )}
                    <div className="text-white">
                      <p className="font-medium text-sm">{authorInfo.name}</p>
                      {authorInfo.title && (
                        <p className="text-xs opacity-80">{authorInfo.title}</p>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <div className="aspect-[2/3] bg-muted rounded-lg flex items-center justify-center mb-3">
                <div className="text-center text-muted-foreground">
                  <ImageIcon className="h-12 w-12 mx-auto mb-2 opacity-50" />
                  <p className="text-sm">{t('pubScreen.cover.generateFrontFirst', locale)}</p>
                </div>
              </div>
            )}
            
            {/* Author Photo Upload */}
            <div className="mb-3">
              <label className="text-sm font-medium">{t('pubScreen.cover.authorPhotoLabel', locale)}</label>
              <div className="flex gap-2 mt-1">
                <Button variant="outline" size="sm" className="flex-1" asChild>
                  <label className="cursor-pointer">
                    <Upload className="mr-2 h-4 w-4" />
                    {t('pubScreen.cover.uploadPhoto', locale)}
                    <input
                      type="file"
                      className="hidden"
                      accept="image/*"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) onUploadAuthorPhoto(file);
                      }}
                    />
                  </label>
                </Button>
              </div>
            </div>
            
            <Button
              onClick={handleGenerateBackCover}
              disabled={isGeneratingCover || !coverConfig.frontCoverUrl}
              className="w-full"
            >
              {isGeneratingCover ? (
                <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
              ) : coverConfig.backCoverUrl ? (
                <>
                  <RefreshCw className="mr-2 h-4 w-4" />
                  {t('pubScreen.cover.regenerate', locale)} ({CREDIT_COSTS.BACK_COVER_REGENERATE} {t('pubScreen.cover.credits', locale)})
                </>
              ) : (
                <>
                  <Sparkles className="mr-2 h-4 w-4" />
                  {t('pubScreen.cover.generateBackFree', locale)}
                </>
              )}
            </Button>
          </div>
        </div>
        
        {/* Continue Button */}
        <div className="mt-4 flex justify-center">
          <Button
            onClick={() => setPhase('preview')}
            disabled={!coverConfig.frontCoverUrl}
            size="lg"
          >
            {t('pubScreen.cover.continueToPreview', locale)}
            <ArrowRight className="ml-2 h-4 w-4" />
          </Button>
        </div>
      </div>
    );
  }
  
  // Phase 3: Final Preview
  return (
    <div className="flex-1 flex flex-col p-6 overflow-hidden">
      <div className="mb-4 text-center">
        <div className="w-16 h-16 rounded-full bg-green-500/10 flex items-center justify-center mx-auto mb-4">
          <BookOpen className="h-8 w-8 text-green-500" />
        </div>
        <h1 className="text-xl font-bold">{t('pubScreen.preview.title', locale)}</h1>
        <p className="text-muted-foreground">
          {t('pubScreen.preview.subtitle', locale)}
        </p>
      </div>
      
      {/* Preview Card */}
      <div className="flex-1 flex items-center justify-center overflow-y-auto">
        <div className="text-center">
          {/* Book Cover Preview */}
          {coverConfig.frontCoverUrl && (
            <div className="w-48 mx-auto mb-6 shadow-2xl rounded-lg overflow-hidden">
              <img 
                src={coverConfig.frontCoverUrl}
                alt={t('pubScreen.cover.front', locale)}
                className="w-full"
              />
            </div>
          )}
          
          {/* Document Summary */}
          <div className="inline-block text-left bg-card rounded-lg border p-4 mb-6">
            <h3 className="font-semibold mb-2">{t('pubScreen.preview.summaryHeader', locale)}</h3>
            <ul className="text-sm space-y-1 text-muted-foreground">
              <li>• {t('pubScreen.preview.chaptersWordsPages', locale)
                .replace('{chapters}', String(chapterCount))
                .replace('{words}', wordCount.toLocaleString())
                .replace('{pages}', String(pageCount))}</li>
              <li>• {t('pubScreen.preview.formatLine', locale)}</li>
              <li>• {t('pubScreen.preview.isbnLine', locale)}</li>
            </ul>
            
            {isFreeTier && (
              <div className="mt-3 pt-3 border-t text-xs text-amber-600 dark:text-amber-400">
                {t('pubScreen.preview.watermarkWarning', locale)}
              </div>
            )}
          </div>
          
          {/* Non-book document style selector */}
          {!isBook && (
            <div className="mb-6">
              <p className="text-sm text-muted-foreground mb-2">
                {t('pubScreen.preview.styleChooseHeader', locale)}
              </p>
              <div className="flex flex-wrap justify-center gap-2">
                {DOCUMENT_STYLE_KEYS.map((style) => (
                  <button
                    key={style.id}
                    className="px-3 py-1.5 rounded-full border text-sm hover:bg-primary/10 hover:border-primary transition-colors"
                  >
                    {t(style.labelKey, locale)}
                  </button>
                ))}
              </div>
            </div>
          )}
          
          {/* ==========================================================
               PRIMARY ACTION — One-click publish to Penworth Store.
               This is the moment the book goes live worldwide.
             ========================================================== */}
          <div className="rounded-xl border-2 border-primary bg-primary/5 p-5 mb-4 max-w-md mx-auto">
            <div className="flex items-start gap-3 mb-4">
              <div className="h-10 w-10 rounded-lg bg-primary/15 flex items-center justify-center shrink-0">
                <Globe className="h-5 w-5 text-primary" />
              </div>
              <div className="text-left flex-1 min-w-0">
                <h3 className="font-semibold">{t('pubScreen.preview.storeCardTitle', locale)}</h3>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {t('pubScreen.preview.storeCardBody', locale)}
                </p>
              </div>
            </div>
            <Button onClick={onPublish} size="lg" className="w-full">
              <Rocket className="mr-2 h-4 w-4" />
              {t('pubScreen.preview.publishNow', locale)}
            </Button>
            <p className="text-[10px] text-muted-foreground text-center mt-2">
              {t('pubScreen.preview.storeCardFooter', locale)}
            </p>
          </div>

          {/* Secondary — preview only. Per CEO-029 the Download button
              was removed: it duplicated browser PDF-viewer save and was
              flagged as low-value clutter on the launch screen. */}
          <div className="flex flex-wrap justify-center gap-2">
            <Button variant="outline" size="sm" onClick={onViewPDF}>
              <Eye className="mr-2 h-3.5 w-3.5" />
              {t('pubScreen.preview.viewPdf', locale)}
            </Button>
          </div>

          <p className="mt-4 text-xs text-muted-foreground">
            {t('pubScreen.preview.externalCaption', locale)}
          </p>
        </div>
      </div>
    </div>
  );
}
