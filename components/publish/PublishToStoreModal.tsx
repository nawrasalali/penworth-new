'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Loader2, Rocket, X, BookOpen } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Pre-publish modal for Penworth Store one-click publish.
 *
 * Collects the small set of commercial and discovery fields the author
 * should confirm before the book goes live on store.penworth.ai:
 *   - price (USD; $0 allowed)
 *   - subtitle (optional)
 *   - categories (1-3 from a curated list; defaults seeded from project.content_type)
 *   - tags (comma-separated, optional)
 *
 * Everything else (cover, chapters, word count, author info) is derived
 * automatically from the project + interview session on the server.
 */

// Curated set — intentionally short so readers browse a coherent taxonomy.
const AVAILABLE_CATEGORIES: { id: string; label: string }[] = [
  { id: 'fiction', label: 'Fiction' },
  { id: 'non-fiction', label: 'Non-fiction' },
  { id: 'memoir', label: 'Memoir' },
  { id: 'poetry', label: 'Poetry' },
  { id: 'self-help', label: 'Self-help' },
  { id: 'business', label: 'Business' },
  { id: 'biography', label: 'Biography' },
  { id: 'essays', label: 'Essays' },
  { id: 'history', label: 'History' },
  { id: 'philosophy', label: 'Philosophy' },
  { id: 'spirituality', label: 'Spirituality' },
  { id: 'science', label: 'Science' },
  { id: 'literary', label: 'Literary' },
  { id: 'thriller', label: 'Thriller' },
  { id: 'romance', label: 'Romance' },
  { id: 'sci-fi', label: 'Science fiction' },
  { id: 'fantasy', label: 'Fantasy' },
  { id: 'young-adult', label: 'Young adult' },
  { id: 'children', label: 'Children' },
  { id: 'travel', label: 'Travel' },
];

function defaultCategoriesFor(contentType: string | null | undefined): string[] {
  if (!contentType) return [];
  const c = contentType.toLowerCase();
  if (c.includes('memoir')) return ['memoir'];
  if (c.includes('fiction') && !c.includes('non')) return ['fiction'];
  if (c.includes('poetry')) return ['poetry'];
  if (c.includes('self') && c.includes('help')) return ['self-help', 'non-fiction'];
  if (c.includes('business')) return ['business', 'non-fiction'];
  if (c.includes('biograph')) return ['biography', 'non-fiction'];
  if (c.includes('non')) return ['non-fiction'];
  return ['non-fiction'];
}

export interface PublishSuccessPayload {
  storeUrl: string;
  marketplaceUrl: string;
  slug: string;
  stats: {
    totalWords: number;
    chapterCount: number;
    priceUsd: number;
    priceCents: number;
    isFreeTier: boolean;
  };
}

interface PublishToStoreModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  defaultTitle?: string | null;
  defaultContentType?: string | null;
  onSuccess: (result: PublishSuccessPayload) => void;
}

export function PublishToStoreModal({
  open,
  onOpenChange,
  projectId,
  defaultTitle,
  defaultContentType,
  onSuccess,
}: PublishToStoreModalProps) {
  const [priceUsdInput, setPriceUsdInput] = useState<string>('0');
  const [subtitle, setSubtitle] = useState<string>('');
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
  const [tagsInput, setTagsInput] = useState<string>('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setPriceUsdInput('0');
      setSubtitle('');
      setSelectedCategories(defaultCategoriesFor(defaultContentType));
      setTagsInput('');
      setError(null);
      setSubmitting(false);
    }
  }, [open, defaultContentType]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !submitting) onOpenChange(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, submitting, onOpenChange]);

  if (!open) return null;

  const toggleCategory = (id: string) => {
    setSelectedCategories((cur) =>
      cur.includes(id) ? cur.filter((c) => c !== id) : [...cur, id].slice(0, 3),
    );
  };

  const handleSubmit = async () => {
    setError(null);

    const priceUsdNum = Number(priceUsdInput);
    const priceUsd = Number.isFinite(priceUsdNum) && priceUsdNum > 0 ? priceUsdNum : 0;
    const priceCents = Math.round(priceUsd * 100);

    if (selectedCategories.length === 0) {
      setError('Pick at least one category so readers can find your book.');
      return;
    }

    const tags = tagsInput
      .split(',')
      .map((t) => t.trim())
      .filter((t) => t.length > 0 && t.length <= 40)
      .slice(0, 20);

    setSubmitting(true);
    try {
      const resp = await fetch('/api/publishing/penworth-store', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId,
          priceCents,
          subtitle: subtitle.trim() || undefined,
          categories: selectedCategories,
          tags,
          format: 'ebook',
        }),
      });
      const data = await resp.json().catch(() => ({ error: 'Publishing failed' }));
      if (!resp.ok || data.error) {
        throw new Error(data.error || 'Publishing failed');
      }
      onSuccess({
        storeUrl: data.storeUrl,
        marketplaceUrl: data.marketplaceUrl,
        slug: data.slug,
        stats: data.stats,
      });
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Publishing failed');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
      onClick={() => {
        if (!submitting) onOpenChange(false);
      }}
    >
      <div
        className="relative w-full max-w-lg rounded-2xl border bg-background shadow-2xl max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="publish-modal-title"
      >
        <div className="flex items-center justify-between border-b px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-lg bg-gradient-to-br from-primary to-amber-500 flex items-center justify-center text-primary-foreground">
              <BookOpen className="h-5 w-5" />
            </div>
            <div>
              <h2 id="publish-modal-title" className="text-lg font-semibold">
                Publish to Penworth Store
              </h2>
              {defaultTitle && (
                <p className="text-sm text-muted-foreground truncate max-w-xs">{defaultTitle}</p>
              )}
            </div>
          </div>
          <button
            type="button"
            onClick={() => {
              if (!submitting) onOpenChange(false);
            }}
            className="rounded-md p-2 hover:bg-muted transition-colors disabled:opacity-50"
            disabled={submitting}
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="px-6 py-5 space-y-5">
          <div>
            <label htmlFor="publish-price" className="block text-sm font-medium mb-1">
              Price (USD)
            </label>
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground">$</span>
              <Input
                id="publish-price"
                type="number"
                min="0"
                step="0.01"
                inputMode="decimal"
                value={priceUsdInput}
                onChange={(e) => setPriceUsdInput(e.target.value)}
                disabled={submitting}
              />
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              Leave at $0 to publish free. You can change the price later from your Store
              dashboard.
            </p>
          </div>

          <div>
            <label htmlFor="publish-subtitle" className="block text-sm font-medium mb-1">
              Subtitle <span className="text-muted-foreground font-normal">(optional)</span>
            </label>
            <Input
              id="publish-subtitle"
              type="text"
              maxLength={140}
              value={subtitle}
              onChange={(e) => setSubtitle(e.target.value)}
              placeholder="A one-line pitch readers see on your Store listing"
              disabled={submitting}
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-2">
              Categories{' '}
              <span className="text-muted-foreground font-normal">
                (pick up to 3; readers browse by these)
              </span>
            </label>
            <div className="flex flex-wrap gap-2">
              {AVAILABLE_CATEGORIES.map((cat) => {
                const on = selectedCategories.includes(cat.id);
                const disabled = submitting || (!on && selectedCategories.length >= 3);
                return (
                  <button
                    key={cat.id}
                    type="button"
                    disabled={disabled}
                    onClick={() => toggleCategory(cat.id)}
                    className={cn(
                      'rounded-full border px-3 py-1 text-xs transition-colors',
                      on
                        ? 'border-primary bg-primary text-primary-foreground'
                        : 'border-border bg-background hover:bg-muted',
                      disabled && 'opacity-50 cursor-not-allowed',
                    )}
                  >
                    {cat.label}
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <label htmlFor="publish-tags" className="block text-sm font-medium mb-1">
              Tags <span className="text-muted-foreground font-normal">(optional)</span>
            </label>
            <Textarea
              id="publish-tags"
              rows={2}
              value={tagsInput}
              onChange={(e) => setTagsInput(e.target.value)}
              placeholder="Comma-separated — e.g. habits, focus, morning routines"
              disabled={submitting}
            />
          </div>

          {error && (
            <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </div>
          )}
        </div>

        <div className="border-t px-6 py-4 flex items-center justify-end gap-2">
          <Button
            type="button"
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={submitting}
          >
            Cancel
          </Button>
          <Button
            type="button"
            onClick={handleSubmit}
            disabled={submitting || selectedCategories.length === 0}
            className="bg-gradient-to-r from-primary to-amber-500"
          >
            {submitting ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Publishing…
              </>
            ) : (
              <>
                <Rocket className="mr-2 h-4 w-4" />
                Publish to Store
              </>
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}
