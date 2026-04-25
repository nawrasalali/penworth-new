'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Loader2, Rocket, X, BookOpen } from 'lucide-react';

/**
 * Pre-publish modal for Penworth Store one-click publish.
 *
 * Per Founder directive 2026-04-25 (CEO-030) the modal is intentionally
 * minimal — the author should not have to re-enter metadata that the book
 * pipeline already produced. Only two fields are presented:
 *
 *   1. Price (USD)        — commercial decision the author must own
 *   2. Author display name — the only piece of cover/listing metadata the
 *                            author may want to render in a different script
 *                            or transliteration than what the interview
 *                            captured (e.g. native script vs. Latin)
 *
 * Everything else (cover, chapters, word count, subtitle, categories, tags,
 * format) is derived automatically server-side from the project +
 * interview_sessions. See app/api/publishing/penworth-store/route.ts.
 *
 * Close behavior is also intentionally restrictive: only the explicit X /
 * Cancel buttons close the modal. Backdrop clicks and the Escape key are
 * ignored so the author cannot accidentally drop their entered author name
 * or price.
 */

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
  defaultAuthorName?: string | null;
  /** Reserved for backward compatibility — accepted but no longer rendered. */
  defaultContentType?: string | null;
  onSuccess: (result: PublishSuccessPayload) => void;
}

export function PublishToStoreModal({
  open,
  onOpenChange,
  projectId,
  defaultTitle,
  defaultAuthorName,
  onSuccess,
}: PublishToStoreModalProps) {
  const [priceUsdInput, setPriceUsdInput] = useState<string>('0');
  const [authorNameInput, setAuthorNameInput] = useState<string>('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setPriceUsdInput('0');
      setAuthorNameInput((defaultAuthorName || '').trim());
      setError(null);
      setSubmitting(false);
    }
  }, [open, defaultAuthorName]);

  // Intentional: no Escape-to-close listener. Per CEO-030 the only way to
  // dismiss the modal is the explicit close affordances (X button or Cancel).

  if (!open) return null;

  const handleSubmit = async () => {
    setError(null);

    const priceUsdNum = Number(priceUsdInput);
    const priceUsd = Number.isFinite(priceUsdNum) && priceUsdNum > 0 ? priceUsdNum : 0;
    const priceCents = Math.round(priceUsd * 100);

    setSubmitting(true);
    try {
      const resp = await fetch('/api/publishing/penworth-store', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId,
          priceCents,
          authorName: authorNameInput.trim() || undefined,
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
      // No onClick handler — backdrop clicks intentionally do not close.
    >
      <div
        className="relative w-full max-w-lg rounded-2xl border bg-background shadow-2xl max-h-[90vh] overflow-y-auto"
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
            <label htmlFor="publish-author-name" className="block text-sm font-medium mb-1">
              Author display name
            </label>
            <Input
              id="publish-author-name"
              type="text"
              maxLength={120}
              value={authorNameInput}
              onChange={(e) => setAuthorNameInput(e.target.value)}
              placeholder="Your name as it should appear — any language or script"
              disabled={submitting}
              // dir='auto' lets the browser choose LTR/RTL from the first
              // strong-direction character so Arabic/Hebrew names render
              // correctly without a manual toggle.
              dir="auto"
            />
            <p className="mt-1 text-xs text-muted-foreground">
              Everything else (cover, categories, format, word count) is taken
              automatically from your book.
            </p>
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
            disabled={submitting}
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
