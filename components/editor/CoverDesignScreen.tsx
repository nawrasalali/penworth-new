'use client';

import { useState, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { AuthorInfo, CoverConfig, CREDIT_COSTS } from '@/types/agent-workflow';
import { cn } from '@/lib/utils';
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

const COVER_SUGGESTIONS = [
  'Professional and modern with abstract shapes',
  'Elegant with subtle textures and clean typography',
  'Bold and eye-catching with vibrant colors',
  'Minimalist with focus on negative space',
  'Warm and inviting with soft gradients',
  'Classic hardcover book design with rich colors',
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
        <h1 className="text-xl font-bold">Cover Design</h1>
        <p className="text-sm text-muted-foreground">
          Design your front and back covers — first generation is free.
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
                  <ImageIcon className="h-4 w-4" /> Front Cover
                </h3>
                {!frontIsFirstGen && (
                  <span className="text-xs text-muted-foreground flex items-center gap-1">
                    <Coins className="h-3 w-3" /> {CREDIT_COSTS.FRONT_COVER_REGENERATE} credits
                  </span>
                )}
              </div>

              {coverConfig.frontCoverUrl ? (
                <div className="relative aspect-[2/3] bg-muted rounded-lg overflow-hidden mb-3">
                  <img src={coverConfig.frontCoverUrl} alt="Front cover" className="w-full h-full object-cover" />
                  <div className="absolute inset-x-0 top-0 p-3 bg-gradient-to-b from-black/60 to-transparent">
                    <div className="bg-black/40 backdrop-blur-sm px-2 py-1 rounded text-center">
                      <h2 className="text-white font-bold text-base">{bookTitle}</h2>
                    </div>
                  </div>
                  <div className="absolute inset-x-0 bottom-0 p-3 bg-gradient-to-t from-black/60 to-transparent">
                    <div className="bg-black/40 backdrop-blur-sm px-2 py-1 rounded text-center">
                      <p className="text-white text-xs">by {authorInfo.name || 'Author'}</p>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="aspect-[2/3] bg-muted rounded-lg flex items-center justify-center mb-3">
                  <div className="text-center text-muted-foreground">
                    <ImageIcon className="h-10 w-10 mx-auto mb-2 opacity-50" />
                    <p className="text-xs">No front cover yet</p>
                  </div>
                </div>
              )}

              <Textarea
                value={frontPrompt}
                onChange={(e) => setFrontPrompt(e.target.value)}
                placeholder="Optional: describe the style you want (e.g. 'minimalist with warm gradients')"
                className="min-h-[60px] text-sm mb-2"
              />
              <div className="flex flex-wrap gap-1 mb-3">
                {COVER_SUGGESTIONS.slice(0, 3).map((s, i) => (
                  <button
                    key={i}
                    onClick={() => setFrontPrompt(s)}
                    className="text-[10px] px-2 py-0.5 rounded-full border hover:bg-primary/10 hover:border-primary transition-colors"
                  >
                    {s}
                  </button>
                ))}
              </div>

              <Button
                className="w-full"
                disabled={isGeneratingFront || !canPayFront}
                onClick={handleGenerateFront}
              >
                {isGeneratingFront ? (
                  <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Generating…</>
                ) : coverConfig.frontCoverUrl ? (
                  <><RefreshCw className="h-4 w-4 mr-2" /> Regenerate{!frontIsFirstGen ? ` (${CREDIT_COSTS.FRONT_COVER_REGENERATE} credits)` : ''}</>
                ) : (
                  <><Sparkles className="h-4 w-4 mr-2" /> Generate Front Cover (Free)</>
                )}
              </Button>
              {!canPayFront && !frontIsFirstGen && (
                <p className="text-xs text-red-500 mt-1 text-center">Not enough credits to regenerate.</p>
              )}
            </div>

            {/* BACK COVER */}
            <div className="rounded-xl border bg-card p-4">
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-semibold flex items-center gap-2">
                  <ImageIcon className="h-4 w-4" /> Back Cover
                </h3>
                {!backIsFirstGen && (
                  <span className="text-xs text-muted-foreground flex items-center gap-1">
                    <Coins className="h-3 w-3" /> {CREDIT_COSTS.BACK_COVER_REGENERATE} credits
                  </span>
                )}
              </div>

              {coverConfig.backCoverUrl ? (
                <div className="aspect-[2/3] bg-muted rounded-lg overflow-hidden mb-3">
                  <img src={coverConfig.backCoverUrl} alt="Back cover" className="w-full h-full object-cover" />
                </div>
              ) : (
                <div className="aspect-[2/3] bg-muted rounded-lg flex items-center justify-center mb-3">
                  <div className="text-center text-muted-foreground">
                    <ImageIcon className="h-10 w-10 mx-auto mb-2 opacity-50" />
                    <p className="text-xs">No back cover yet</p>
                  </div>
                </div>
              )}

              <Textarea
                value={backPrompt}
                onChange={(e) => setBackPrompt(e.target.value)}
                placeholder="Optional: back cover style preferences"
                className="min-h-[60px] text-sm mb-3"
              />

              <Button
                className="w-full"
                variant={coverConfig.backCoverUrl ? 'outline' : 'default'}
                disabled={isGeneratingBack || !canPayBack}
                onClick={handleGenerateBack}
              >
                {isGeneratingBack ? (
                  <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Generating…</>
                ) : coverConfig.backCoverUrl ? (
                  <><RefreshCw className="h-4 w-4 mr-2" /> Regenerate{!backIsFirstGen ? ` (${CREDIT_COSTS.BACK_COVER_REGENERATE} credits)` : ''}</>
                ) : (
                  <><Sparkles className="h-4 w-4 mr-2" /> Generate Back Cover (Free)</>
                )}
              </Button>
              {!canPayBack && !backIsFirstGen && (
                <p className="text-xs text-red-500 mt-1 text-center">Not enough credits to regenerate.</p>
              )}
            </div>
          </div>

          {/* AUTHOR CARD */}
          <div className="rounded-xl border bg-card p-5">
            <h3 className="font-semibold mb-3 flex items-center gap-2">
              <User className="h-4 w-4" /> Author Information
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
                    <><Loader2 className="h-3 w-3 mr-1 animate-spin" /> Uploading…</>
                  ) : (
                    <><Upload className="h-3 w-3 mr-1" /> Photo</>
                  )}
                </Button>
              </div>

              {/* Name + Bio */}
              <div className="space-y-3">
                <div>
                  <label className="block text-xs font-medium mb-1">Author Name *</label>
                  <Input
                    value={authorInfo.name}
                    onChange={(e) => onUpdateAuthorInfo({ name: e.target.value })}
                    placeholder="Your full name as it will appear on the cover"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium mb-1">About the Author</label>
                  <Textarea
                    value={aboutDraft}
                    onChange={(e) => setAboutDraft(e.target.value)}
                    onBlur={() => onUpdateAuthorInfo({ aboutAuthor: aboutDraft })}
                    placeholder="Write a short bio (appears on back cover and publishing pages)"
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
              Front cover
            </span>
            <span className="flex items-center gap-1">
              {coverConfig.backCoverUrl ? <Check className="h-3.5 w-3.5 text-green-500" /> : <span className="h-3.5 w-3.5 rounded-full border border-muted-foreground/40" />}
              Back cover
            </span>
            <span className="flex items-center gap-1">
              {authorReady ? <Check className="h-3.5 w-3.5 text-green-500" /> : <span className="h-3.5 w-3.5 rounded-full border border-muted-foreground/40" />}
              Author info
            </span>
          </div>
          <Button
            size="lg"
            disabled={!bothCoversReady || !authorReady}
            onClick={onApproveAndContinue}
          >
            Approve & Continue to Publish
            <ArrowRight className="ml-2 h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
