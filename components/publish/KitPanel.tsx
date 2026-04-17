'use client';

import { useEffect, useState } from 'react';
import {
  X,
  Loader2,
  ExternalLink,
  Copy,
  Check,
  Download,
  FileText,
  Image as ImageIcon,
  BookOpen,
  Clock,
  AlertCircle,
  ArrowRight,
} from 'lucide-react';
import { toast } from 'sonner';

interface PublishKit {
  platformSlug: string;
  platformName: string;
  estimatedMinutes: number;
  deepLink: string;
  summary: string;
  steps: Array<{ number: number; title: string; detail: string }>;
  fields: Array<{ label: string; value: string; note?: string; maxChars?: number }>;
  files: Array<{ name: string; format: string; description: string }>;
}

/**
 * Tier 3 guided publishing panel.
 *
 * Fetches /api/publishing/kit and walks the author through a 3–5 minute
 * manual publish on platforms that have no usable self-serve API. We
 * generate the exact files + metadata, the author copy-pastes and uploads.
 *
 * If /api/publishing/kit returns 422 (publishing metadata incomplete), we
 * route the author back to the MetadataEditor via onNeedMetadata().
 */
export function KitPanel({
  projectId,
  platformSlug,
  onClose,
  onNeedMetadata,
  onPublished,
}: {
  projectId: string;
  platformSlug: string;
  onClose: () => void;
  onNeedMetadata: () => void;
  onPublished: () => void;
}) {
  const [loading, setLoading] = useState(true);
  const [kit, setKit] = useState<PublishKit | null>(null);
  const [missing, setMissing] = useState<string[] | null>(null);
  const [externalUrl, setExternalUrl] = useState('');
  const [marking, setMarking] = useState(false);
  const [copied, setCopied] = useState<number | null>(null);
  const [downloading, setDownloading] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const resp = await fetch(
          `/api/publishing/kit?projectId=${projectId}&platformSlug=${platformSlug}`,
        );
        const data = await resp.json();
        if (resp.status === 422 && data.missing) {
          setMissing(data.missing);
          return;
        }
        if (!resp.ok || data.error) {
          toast.error(data.error || 'Failed to build publish kit');
          onClose();
          return;
        }
        setKit(data.kit);
      } catch {
        toast.error('Failed to build publish kit');
        onClose();
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, platformSlug]);

  const copyField = async (index: number, value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(index);
      setTimeout(() => setCopied(null), 1400);
    } catch {
      toast.error('Copy failed — select and copy manually');
    }
  };

  const copyAll = async () => {
    if (!kit) return;
    const blob = kit.fields
      .filter((f) => f.value)
      .map((f) => `${f.label}:\n${f.value}`)
      .join('\n\n');
    try {
      await navigator.clipboard.writeText(blob);
      toast.success('All fields copied');
    } catch {
      toast.error('Copy failed');
    }
  };

  const downloadBundle = async () => {
    if (!kit) return;
    setDownloading(true);
    try {
      const resp = await fetch(
        `/api/publishing/bundle?projectId=${projectId}&platformSlug=${platformSlug}`,
      );
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        toast.error(err.error || 'Download failed');
        return;
      }
      const blob = await resp.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${kit.platformSlug}-publish-kit.zip`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch {
      toast.error('Download failed');
    } finally {
      setDownloading(false);
    }
  };

  const markPublished = async () => {
    if (!externalUrl.trim()) {
      toast.error('Paste the live URL of your book first');
      return;
    }
    setMarking(true);
    try {
      const resp = await fetch('/api/publishing/mark-published', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId,
          platformSlug,
          externalUrl: externalUrl.trim(),
        }),
      });
      const data = await resp.json();
      if (!resp.ok || data.error) {
        toast.error(data.error || 'Failed to mark published');
        return;
      }
      toast.success(`Marked live on ${kit?.platformName || 'the platform'}`);
      onPublished();
    } catch {
      toast.error('Failed to mark published');
    } finally {
      setMarking(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-background rounded-2xl shadow-xl max-w-3xl w-full max-h-[92vh] flex flex-col">
        {/* Header */}
        <div className="flex items-start justify-between gap-4 p-5 border-b">
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="text-lg font-bold">
                {kit?.platformName || 'Publish kit'}
              </h2>
              {kit && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider rounded-full bg-primary/10 text-primary">
                  <Clock className="h-3 w-3" /> ~{kit.estimatedMinutes}min
                </span>
              )}
            </div>
            {kit && <p className="text-sm text-muted-foreground mt-1">{kit.summary}</p>}
          </div>
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-muted shrink-0">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-auto p-5 space-y-6">
          {loading && (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          )}

          {/* 422: metadata incomplete */}
          {!loading && missing && (
            <div className="rounded-xl border border-amber-300 bg-amber-50 dark:bg-amber-950/20 dark:border-amber-900 p-5">
              <div className="flex items-start gap-3">
                <AlertCircle className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" />
                <div className="min-w-0">
                  <div className="font-semibold">Complete your publishing details first</div>
                  <p className="text-sm text-muted-foreground mt-1">
                    Before we can build your publish kit, we need a few more things:
                  </p>
                  <ul className="mt-2 space-y-1 text-sm">
                    {missing.map((m) => (
                      <li key={m} className="flex items-center gap-2">
                        <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
                        {m}
                      </li>
                    ))}
                  </ul>
                  <button
                    onClick={onNeedMetadata}
                    className="mt-4 inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold bg-primary text-primary-foreground hover:bg-primary/90"
                  >
                    Edit publishing details <ArrowRight className="h-4 w-4" />
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Kit content */}
          {kit && !missing && (
            <>
              {/* Step 0: Open platform */}
              <div className="flex items-center justify-between gap-3 p-4 rounded-xl bg-gradient-to-r from-primary/10 to-transparent border">
                <div className="min-w-0">
                  <div className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">
                    Start here
                  </div>
                  <div className="font-semibold mt-0.5">Open {kit.platformName}</div>
                </div>
                <a
                  href={kit.deepLink}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold bg-primary text-primary-foreground hover:bg-primary/90 shrink-0"
                >
                  Open ↗
                  <ExternalLink className="h-3.5 w-3.5" />
                </a>
              </div>

              {/* Steps */}
              <section>
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-sm font-bold uppercase tracking-wider text-muted-foreground">
                    Walkthrough
                  </h3>
                </div>
                <ol className="space-y-3">
                  {kit.steps.map((s) => (
                    <li key={s.number} className="flex gap-3">
                      <div className="h-7 w-7 shrink-0 rounded-full bg-primary/10 text-primary font-bold text-sm flex items-center justify-center">
                        {s.number}
                      </div>
                      <div className="min-w-0 pt-0.5">
                        <div className="font-semibold text-sm">{s.title}</div>
                        <p className="text-sm text-muted-foreground mt-0.5">{s.detail}</p>
                      </div>
                    </li>
                  ))}
                </ol>
              </section>

              {/* Files */}
              {kit.files.length > 0 && (
                <section>
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="text-sm font-bold uppercase tracking-wider text-muted-foreground">
                      Files to upload
                    </h3>
                    <button
                      onClick={downloadBundle}
                      disabled={downloading}
                      className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-semibold border hover:bg-muted disabled:opacity-50"
                    >
                      {downloading ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Download className="h-3.5 w-3.5" />
                      )}
                      Download all as ZIP
                    </button>
                  </div>
                  <div className="grid gap-2">
                    {kit.files.map((f, i) => (
                      <div key={i} className="flex items-center gap-3 p-3 rounded-lg border bg-muted/30">
                        <FileTypeIcon format={f.format} />
                        <div className="min-w-0 flex-1">
                          <div className="font-mono text-xs font-semibold">{f.name}</div>
                          <div className="text-xs text-muted-foreground">{f.description}</div>
                        </div>
                        <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                          {f.format}
                        </span>
                      </div>
                    ))}
                  </div>
                </section>
              )}

              {/* Fields */}
              <section>
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-sm font-bold uppercase tracking-wider text-muted-foreground">
                    Copy-paste fields
                  </h3>
                  <button
                    onClick={copyAll}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border hover:bg-muted"
                  >
                    <Copy className="h-3.5 w-3.5" /> Copy all
                  </button>
                </div>
                <div className="space-y-2">
                  {kit.fields.map((f, i) => (
                    <div
                      key={i}
                      className="group rounded-lg border bg-card hover:border-primary/40 transition"
                    >
                      <div className="flex items-center justify-between px-3 py-2 border-b">
                        <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                          {f.label}
                          {f.note && <span className="ml-2 normal-case text-[10px] text-muted-foreground/70">({f.note})</span>}
                        </div>
                        <button
                          onClick={() => copyField(i, f.value)}
                          disabled={!f.value}
                          className="inline-flex items-center gap-1 px-2 py-1 rounded text-xs font-semibold hover:bg-muted disabled:opacity-50"
                        >
                          {copied === i ? (
                            <>
                              <Check className="h-3 w-3 text-emerald-600" /> Copied
                            </>
                          ) : (
                            <>
                              <Copy className="h-3 w-3" /> Copy
                            </>
                          )}
                        </button>
                      </div>
                      <div className="px-3 py-2 text-sm whitespace-pre-wrap break-words font-mono max-h-40 overflow-auto">
                        {f.value || <span className="text-muted-foreground italic font-sans">(empty — edit publishing details)</span>}
                      </div>
                    </div>
                  ))}
                </div>
              </section>

              {/* Mark published */}
              <section className="rounded-xl border-2 border-dashed p-5">
                <h3 className="font-semibold flex items-center gap-2">
                  <Check className="h-4 w-4 text-emerald-600" /> I've published it
                </h3>
                <p className="text-sm text-muted-foreground mt-1 mb-3">
                  Once your book is live, paste the URL here so we can track it.
                </p>
                <div className="flex gap-2">
                  <input
                    type="url"
                    value={externalUrl}
                    onChange={(e) => setExternalUrl(e.target.value)}
                    placeholder="https://www.amazon.com/dp/..."
                    className="flex-1 px-3 py-2 border rounded-lg bg-background text-sm"
                  />
                  <button
                    onClick={markPublished}
                    disabled={marking || !externalUrl.trim()}
                    className="px-4 py-2 rounded-lg text-sm font-semibold bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50 inline-flex items-center gap-2"
                  >
                    {marking ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                    Mark live
                  </button>
                </div>
              </section>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function FileTypeIcon({ format }: { format: string }) {
  const cls = 'h-5 w-5 text-muted-foreground';
  if (format === 'jpg' || format === 'png') return <ImageIcon className={cls} />;
  if (format === 'epub') return <BookOpen className={cls} />;
  return <FileText className={cls} />;
}
