'use client';

import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { AuthorInfo, CoverConfig, CREDIT_COSTS, KDP_SPECS } from '@/types/agent-workflow';
import { cn } from '@/lib/utils';
import {
  BookOpen,
  Upload,
  RefreshCw,
  Eye,
  Download,
  Rocket,
  User,
  ImageIcon,
  Coins,
  Sparkles,
  FileText,
  ArrowRight,
  Check,
  Linkedin
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
  onExtractFromLinkedIn: (url: string) => void;
  onViewPDF: () => void;
  onDownload: () => void;
  onPublish: () => void;
}

const COVER_SUGGESTIONS = [
  'Professional and modern with abstract shapes',
  'Elegant with subtle textures and clean typography',
  'Bold and eye-catching with vibrant colors',
  'Minimalist with focus on negative space',
  'Warm and inviting with soft gradients',
];

const DOCUMENT_STYLES = [
  { id: 'professional', name: 'Professional Report' },
  { id: 'whitepaper', name: 'White Paper' },
  { id: 'thesis', name: 'Academic Thesis' },
  { id: 'proposal', name: 'Business Proposal' },
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
  onExtractFromLinkedIn,
  onViewPDF,
  onDownload,
  onPublish
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

  // Phase 1: Author Setup
  if (phase === 'author') {
    return (
      <div className="flex-1 flex flex-col p-6 max-w-2xl mx-auto w-full overflow-y-auto">
        <div className="mb-6 text-center">
          <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-4">
            <User className="h-8 w-8 text-primary" />
          </div>
          <h1 className="text-xl font-bold">Author Information</h1>
          <p className="text-muted-foreground">
            Set up your author profile for the document
          </p>
        </div>
        
        {/* Author Name */}
        <div className="mb-4">
          <label className="block text-sm font-medium mb-2">Author Name *</label>
          <Input
            value={authorInfo.name}
            onChange={(e) => onUpdateAuthorInfo({ name: e.target.value })}
            placeholder="Your full name as it will appear on the book"
          />
        </div>
        
        {/* Title/Credentials */}
        <div className="mb-4">
          <label className="block text-sm font-medium mb-2">Title/Credentials</label>
          <Input
            value={authorInfo.title}
            onChange={(e) => onUpdateAuthorInfo({ title: e.target.value })}
            placeholder="e.g., PhD, CEO of XYZ, Bestselling Author"
          />
        </div>
        
        {/* About the Author */}
        <div className="mb-4">
          <label className="block text-sm font-medium mb-2">About the Author</label>
          <p className="text-xs text-muted-foreground mb-2">
            Write about yourself, or import from LinkedIn/CV
          </p>
          
          {/* Import Options */}
          <div className="flex gap-2 mb-3">
            <div className="flex-1 flex gap-2">
              <Input
                value={linkedInUrl}
                onChange={(e) => setLinkedInUrl(e.target.value)}
                placeholder="LinkedIn profile URL"
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
                CV
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
                placeholder="Write a compelling author bio..."
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
                  Cancel
                </Button>
                <Button 
                  size="sm"
                  onClick={() => {
                    onUpdateAuthorInfo({ aboutAuthor: aboutDraft });
                    setEditingAbout(false);
                  }}
                >
                  Save
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
                  Click to write your author bio...
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
            {needsCover ? 'Continue to Cover Design' : 'Continue to Preview'}
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
          <h1 className="text-xl font-bold">Book Cover Design</h1>
          <p className="text-sm text-muted-foreground">
            Create stunning covers with AI (First generation FREE)
          </p>
        </div>
        
        <div className="flex-1 grid grid-cols-1 lg:grid-cols-2 gap-6 overflow-y-auto">
          {/* Front Cover */}
          <div className="rounded-xl border bg-card p-4">
            <h3 className="font-semibold mb-3 flex items-center gap-2">
              <ImageIcon className="h-4 w-4" />
              Front Cover
            </h3>
            
            {coverConfig.frontCoverUrl ? (
              <div className="relative aspect-[2/3] bg-muted rounded-lg overflow-hidden mb-3">
                <img 
                  src={coverConfig.frontCoverUrl} 
                  alt="Front cover"
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
                    <p className="text-white text-sm">by {authorInfo.name}</p>
                  </div>
                </div>
              </div>
            ) : (
              <div className="aspect-[2/3] bg-muted rounded-lg flex items-center justify-center mb-3">
                <div className="text-center text-muted-foreground">
                  <ImageIcon className="h-12 w-12 mx-auto mb-2 opacity-50" />
                  <p className="text-sm">No cover generated yet</p>
                </div>
              </div>
            )}
            
            {/* Cover Prompt */}
            <div className="space-y-2 mb-3">
              <Textarea
                value={coverPrompt}
                onChange={(e) => setCoverPrompt(e.target.value)}
                placeholder="Describe your ideal cover (or leave blank for AI suggestion)..."
                className="min-h-[80px]"
              />
              <div className="flex flex-wrap gap-1">
                {COVER_SUGGESTIONS.map((suggestion, idx) => (
                  <button
                    key={idx}
                    onClick={() => setCoverPrompt(suggestion)}
                    className="text-xs px-2 py-1 rounded-full bg-muted hover:bg-muted/80 transition-colors"
                  >
                    {suggestion.split(' ').slice(0, 3).join(' ')}...
                  </button>
                ))}
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
                  Regenerate ({CREDIT_COSTS.FRONT_COVER_REGENERATE} credits)
                </>
              ) : (
                <>
                  <Sparkles className="mr-2 h-4 w-4" />
                  Generate Cover (FREE)
                </>
              )}
            </Button>
          </div>
          
          {/* Back Cover */}
          <div className="rounded-xl border bg-card p-4">
            <h3 className="font-semibold mb-3 flex items-center gap-2">
              <ImageIcon className="h-4 w-4" />
              Back Cover
            </h3>
            
            {coverConfig.backCoverUrl ? (
              <div className="relative aspect-[2/3] bg-muted rounded-lg overflow-hidden mb-3">
                <img 
                  src={coverConfig.backCoverUrl} 
                  alt="Back cover"
                  className="w-full h-full object-cover"
                />
                {/* Book Description Overlay */}
                <div className="absolute inset-0 flex flex-col justify-between p-4">
                  <div className="bg-black/50 backdrop-blur-sm p-3 rounded">
                    <p className="text-white text-xs line-clamp-6">
                      [Book description will appear here]
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
                  <p className="text-sm">Generate front cover first</p>
                </div>
              </div>
            )}
            
            {/* Author Photo Upload */}
            <div className="mb-3">
              <label className="text-sm font-medium">Author Photo (optional)</label>
              <div className="flex gap-2 mt-1">
                <Button variant="outline" size="sm" className="flex-1" asChild>
                  <label className="cursor-pointer">
                    <Upload className="mr-2 h-4 w-4" />
                    Upload Photo
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
                  Regenerate ({CREDIT_COSTS.BACK_COVER_REGENERATE} credits)
                </>
              ) : (
                <>
                  <Sparkles className="mr-2 h-4 w-4" />
                  Generate Back Cover (FREE)
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
            Continue to Preview
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
        <h1 className="text-xl font-bold">Your Document is Ready!</h1>
        <p className="text-muted-foreground">
          Final KDP-Ready Publication
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
                alt="Book cover"
                className="w-full"
              />
            </div>
          )}
          
          {/* Document Summary */}
          <div className="inline-block text-left bg-card rounded-lg border p-4 mb-6">
            <h3 className="font-semibold mb-2">Document Summary</h3>
            <ul className="text-sm space-y-1 text-muted-foreground">
              <li>• {chapterCount} Chapters | {wordCount.toLocaleString()} words | {pageCount} pages</li>
              <li>• Format: 6" × 9" (KDP Standard)</li>
              <li>• ISBN: Ready for assignment</li>
            </ul>
            
            {isFreeTier && (
              <div className="mt-3 pt-3 border-t text-xs text-amber-600 dark:text-amber-400">
                ⚠️ Free tier: Document includes "by penworth.ai" watermark
              </div>
            )}
          </div>
          
          {/* Non-book document style selector */}
          {!isBook && (
            <div className="mb-6">
              <p className="text-sm text-muted-foreground mb-2">
                Choose document style:
              </p>
              <div className="flex flex-wrap justify-center gap-2">
                {DOCUMENT_STYLES.map((style) => (
                  <button
                    key={style.id}
                    className="px-3 py-1.5 rounded-full border text-sm hover:bg-primary/10 hover:border-primary transition-colors"
                  >
                    {style.name}
                  </button>
                ))}
              </div>
            </div>
          )}
          
          {/* Action Buttons */}
          <div className="flex flex-wrap justify-center gap-3">
            <Button variant="outline" onClick={onViewPDF}>
              <Eye className="mr-2 h-4 w-4" />
              View PDF
            </Button>
            <Button variant="outline" onClick={onDownload}>
              <Download className="mr-2 h-4 w-4" />
              Download
            </Button>
            <Button onClick={onPublish}>
              <Rocket className="mr-2 h-4 w-4" />
              Publish to Platforms
            </Button>
          </div>
          
          <p className="mt-4 text-sm text-muted-foreground">
            Your document is ready to view. Click to preview the final formatted PDF with all KDP specifications.
          </p>
        </div>
      </div>
    </div>
  );
}
