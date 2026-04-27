'use client';

import { useEffect, useState } from 'react';
import { Loader2, Sparkles, Check, AlertCircle, Plus, ExternalLink } from 'lucide-react';
import { t, type Locale } from '@/lib/i18n/strings';

/**
 * Livebook image library enrolment section — rendered inside
 * PublishToStoreModal (CEO-166 Phase 2).
 *
 * Author flow:
 *   1. Toggle "Enrol this book in the Livebook image library" ON
 *   2. Style picker fetches /api/livebook/styles (active styles)
 *      and renders one card per style. Author picks one.
 *   3. Balance fetched from /api/credits. If balance < cost, the
 *      "Top up credits" CTA opens /billing in a new tab.
 *   4. On submit (in the parent modal), parent calls
 *      /api/livebook/enrol BEFORE /api/publishing/penworth-store.
 *
 * The credit charge happens in the enrol RPC — atomic with job
 * creation. No partial state possible.
 *
 * State is exposed up to the parent via onChange so the parent
 * Publish button can be disabled when toggle is on but no style
 * is picked or balance is insufficient.
 */

export interface LivebookEnrolmentState {
  /** True when the author has toggled enrolment on. */
  enrolled: boolean;
  /** Selected style slug; null when no style picked. */
  style: string | null;
  /** True when toggle is on AND validations pass (style picked, balance ok). */
  ready: boolean;
}

type LivebookStyle = {
  slug: string;
  display_name: string;
  description: string;
  sample_thumbnail_urls: string[];
  price_credits: number;
  is_active: boolean;
  library_size: number;
};

interface LivebookEnrolmentSectionProps {
  open: boolean;
  disabled?: boolean;
  locale?: Locale;
  onChange: (s: LivebookEnrolmentState) => void;
}

export function LivebookEnrolmentSection({
  open,
  disabled,
  locale = 'en',
  onChange,
}: LivebookEnrolmentSectionProps) {
  const [enrolled, setEnrolled] = useState(false);
  const [styles, setStyles] = useState<LivebookStyle[] | null>(null);
  const [stylesLoading, setStylesLoading] = useState(false);
  const [stylesError, setStylesError] = useState<string | null>(null);
  const [pickedStyle, setPickedStyle] = useState<string | null>(null);
  const [balance, setBalance] = useState<number | null>(null);
  const [balanceLoading, setBalanceLoading] = useState(false);

  // Reset on modal open.
  useEffect(() => {
    if (open) {
      setEnrolled(false);
      setPickedStyle(null);
      setStyles(null);
      setStylesError(null);
      setBalance(null);
    }
  }, [open]);

  // When the toggle flips ON for the first time, lazy-load styles + balance.
  useEffect(() => {
    if (!open || !enrolled) return;
    let cancelled = false;
    if (styles === null && !stylesLoading) {
      setStylesLoading(true);
      setStylesError(null);
      fetch('/api/livebook/styles')
        .then(async (r) => {
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          return (await r.json()) as { styles: LivebookStyle[] };
        })
        .then((data) => {
          if (cancelled) return;
          setStyles(data.styles ?? []);
        })
        .catch((e) => {
          if (cancelled) return;
          setStylesError(e instanceof Error ? e.message : 'Failed to load styles');
        })
        .finally(() => !cancelled && setStylesLoading(false));
    }
    if (balance === null && !balanceLoading) {
      setBalanceLoading(true);
      fetch('/api/credits')
        .then(async (r) => (r.ok ? ((await r.json()) as { balance: number }) : null))
        .then((data) => !cancelled && setBalance(data?.balance ?? 0))
        .finally(() => !cancelled && setBalanceLoading(false));
    }
    return () => {
      cancelled = true;
    };
  }, [open, enrolled, styles, balance, stylesLoading, balanceLoading]);

  // Bubble state up to the parent.
  const requiredCost = pickedStyle
    ? styles?.find((s) => s.slug === pickedStyle)?.price_credits ?? 1000
    : 1000;
  const balanceOk = balance !== null && balance >= requiredCost;
  const ready = enrolled && pickedStyle !== null && balanceOk;

  useEffect(() => {
    onChange({ enrolled, style: pickedStyle, ready });
  }, [enrolled, pickedStyle, ready, onChange]);

  return (
    <div className="rounded-lg border bg-muted/20 px-4 py-3.5">
      {/* Toggle row */}
      <label
        className={`flex items-start gap-3 cursor-pointer ${disabled ? 'opacity-60 cursor-not-allowed' : ''}`}
      >
        <input
          type="checkbox"
          className="mt-1 h-4 w-4 rounded border-input accent-primary"
          checked={enrolled}
          onChange={(e) => setEnrolled(e.target.checked)}
          disabled={disabled}
        />
        <div className="flex-1">
          <div className="flex items-center gap-2 text-sm font-medium">
            <Sparkles className="h-4 w-4 text-amber-500" />
            {t('livebook.publish.enrol.label', locale)}
          </div>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {t('livebook.publish.enrol.cost', locale)}
          </p>
        </div>
      </label>

      {/* Body — only when toggle is on */}
      {enrolled && (
        <div className="mt-4 space-y-4 pl-7">
          {/* Style picker */}
          <div>
            <p className="text-xs font-medium mb-2">
              {t('livebook.publish.style.title', locale)}
            </p>
            <p className="text-xs text-muted-foreground mb-3">
              {t('livebook.publish.style.description', locale)}
            </p>

            {stylesLoading && (
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Loader2 className="h-3 w-3 animate-spin" />
                Loading styles…
              </div>
            )}

            {stylesError && (
              <div className="flex items-center gap-2 text-xs text-destructive">
                <AlertCircle className="h-3 w-3" />
                {stylesError}
              </div>
            )}

            {styles && styles.length === 0 && (
              <p className="text-xs text-muted-foreground">No styles available yet.</p>
            )}

            {styles && styles.length > 0 && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                {styles.map((s) => {
                  const isPicked = pickedStyle === s.slug;
                  const thumbs = s.sample_thumbnail_urls?.slice(0, 3) ?? [];
                  return (
                    <button
                      key={s.slug}
                      type="button"
                      onClick={() => setPickedStyle(s.slug)}
                      disabled={disabled}
                      className={`relative text-left rounded-md border-2 px-3 py-2.5 transition-all ${
                        isPicked
                          ? 'border-primary bg-primary/5'
                          : 'border-transparent bg-background hover:border-border'
                      } ${disabled ? 'opacity-60 cursor-not-allowed' : ''}`}
                      aria-pressed={isPicked}
                    >
                      {isPicked && (
                        <div className="absolute top-2 right-2 h-4 w-4 rounded-full bg-primary text-primary-foreground flex items-center justify-center">
                          <Check className="h-3 w-3" />
                        </div>
                      )}
                      <div className="text-sm font-medium pr-6">{s.display_name}</div>
                      <p className="mt-0.5 text-xs text-muted-foreground line-clamp-2">
                        {s.description}
                      </p>
                      {thumbs.length > 0 && (
                        <div className="mt-2 flex gap-1">
                          {thumbs.map((url, i) => (
                            // eslint-disable-next-line @next/next/no-img-element -- thumbnails are external public storage URLs; <img> is correct here, no LCP concern inside a modal
                            <img
                              key={i}
                              src={url}
                              alt=""
                              className="h-10 w-16 rounded object-cover bg-muted"
                              loading="lazy"
                            />
                          ))}
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Balance + top-up */}
          <div className="rounded-md border bg-background px-3 py-2">
            {balanceLoading || balance === null ? (
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Loader2 className="h-3 w-3 animate-spin" />
                Checking balance…
              </div>
            ) : (
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <div className="text-xs">
                  <div className="font-medium">
                    {t('livebook.publish.balance.have', locale).replace('{balance}', String(balance))}
                  </div>
                  <div className="text-muted-foreground">
                    {t('livebook.publish.balance.cost', locale).replace('{cost}', String(requiredCost))}
                  </div>
                  {!balanceOk && (
                    <div className="mt-0.5 text-destructive flex items-center gap-1">
                      <AlertCircle className="h-3 w-3" />
                      {t('livebook.publish.balance.insufficient', locale)}
                    </div>
                  )}
                </div>
                {!balanceOk && (
                  <a
                    href="/billing"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 rounded-md border border-primary/40 bg-primary/5 px-2.5 py-1 text-xs font-medium text-primary hover:bg-primary/10 transition-colors"
                  >
                    <Plus className="h-3 w-3" />
                    {t('livebook.publish.topup.cta', locale)}
                    <ExternalLink className="h-3 w-3" />
                  </a>
                )}
              </div>
            )}
          </div>

          {/* Live validation hint for the parent's submit button */}
          {pickedStyle === null && (
            <p className="text-xs text-muted-foreground italic">
              {t('livebook.publish.error.no_style', locale)}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
