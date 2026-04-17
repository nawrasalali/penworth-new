'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import {
  BookOpen,
  Sparkles,
  Globe,
  Zap,
  FileText,
  CheckCircle2,
  AlertCircle,
  ExternalLink,
  Loader2,
  ArrowRight,
  Clock,
  ChevronDown,
} from 'lucide-react';
import { MetadataEditor } from './MetadataEditor';
import { KitPanel } from './KitPanel';

interface ProjectRow {
  id: string;
  title: string | null;
  status: string;
  content_type: string | null;
  updated_at: string;
  cover_url: string | null;
}

interface Platform {
  id: string;
  slug: string;
  name: string;
  tagline: string | null;
  royalty_rate: string | null;
  reach_description: string | null;
  avg_publish_time_minutes: number | null;
  submission_url: string | null;
  publish_tier: 'penworth_store' | 'api_auto' | 'guided_pdf';
  is_connected: boolean;
  publication: {
    status: string;
    external_url: string | null;
    published_at: string | null;
  } | null;
}

export function PublishClient({
  projects,
  initialProjectId,
}: {
  projects: ProjectRow[];
  initialProjectId: string | null;
}) {
  const router = useRouter();
  const [selectedId, setSelectedId] = useState<string | null>(initialProjectId);
  const [platforms, setPlatforms] = useState<Platform[]>([]);
  const [loading, setLoading] = useState(true);
  const [metadataOpen, setMetadataOpen] = useState(false);
  const [kitOpen, setKitOpen] = useState<string | null>(null); // platform slug
  const [publishing, setPublishing] = useState<string | null>(null); // platform id in flight
  const [docDropdownOpen, setDocDropdownOpen] = useState(false);

  const selected = projects.find((p) => p.id === selectedId) || null;

  const loadPlatforms = useCallback(async () => {
    if (!selectedId) {
      setPlatforms([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const resp = await fetch(`/api/publishing/platforms?projectId=${selectedId}`);
      const data = await resp.json();
      setPlatforms(data.platforms || []);
    } catch {
      toast.error('Failed to load publishing platforms');
    } finally {
      setLoading(false);
    }
  }, [selectedId]);

  useEffect(() => {
    loadPlatforms();
  }, [loadPlatforms]);

  /**
   * Tier 1 — Penworth Store one-click publish.
   * Fires existing /api/publishing/penworth-store route, then kicks off
   * narration in the background (admin-gated; silent if non-admin).
   */
  const publishToStore = async () => {
    if (!selectedId) return;
    setPublishing('penworth');
    toast.info('Publishing to Penworth Store...');
    try {
      const resp = await fetch('/api/publishing/penworth-store', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId: selectedId, priceUsd: 0 }),
      });
      const data = await resp.json();
      if (!resp.ok || data.error) {
        toast.error(data.error || 'Publishing failed');
        return;
      }
      toast.success(`Live on Penworth Store — ${data.stats?.chapterCount || ''} chapters`);
      // Fire-and-forget narration
      fetch('/api/publishing/penworth-store/narrate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId: selectedId }),
      }).catch(() => {});
      if (data.externalUrl) router.push(data.externalUrl);
      else loadPlatforms();
    } catch {
      toast.error('Publishing failed');
    } finally {
      setPublishing(null);
    }
  };

  // --- Layout ---
  if (projects.length === 0) {
    return (
      <div className="max-w-3xl mx-auto px-6 py-20 text-center">
        <BookOpen className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
        <h1 className="text-2xl font-semibold mb-2">No completed documents yet</h1>
        <p className="text-muted-foreground mb-6">
          Finish a document in the editor first, then come back here to publish it to 17 places at once.
        </p>
        <Link
          href="/projects"
          className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-primary text-primary-foreground font-medium hover:bg-primary/90"
        >
          Go to My Projects
          <ArrowRight className="h-4 w-4" />
        </Link>
      </div>
    );
  }

  const store = platforms.find((p) => p.publish_tier === 'penworth_store');
  const autos = platforms.filter((p) => p.publish_tier === 'api_auto');
  const guided = platforms.filter((p) => p.publish_tier === 'guided_pdf');

  return (
    <div className="max-w-6xl mx-auto px-6 py-8 space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Publish</h1>
        <p className="text-muted-foreground mt-1">
          Your document. Live everywhere. Penworth Store in one click, plus 16 other platforms.
        </p>
      </div>

      {/* Document selector */}
      <div className="relative">
        <label className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">
          Publishing
        </label>
        <button
          onClick={() => setDocDropdownOpen((o) => !o)}
          className="mt-1 flex items-center justify-between gap-3 w-full max-w-xl px-4 py-3 rounded-lg border bg-card hover:border-primary/40 transition"
        >
          <div className="flex items-center gap-3 min-w-0">
            {selected?.cover_url ? (
              <img src={selected.cover_url} alt="" className="h-10 w-8 rounded object-cover" />
            ) : (
              <div className="h-10 w-8 rounded bg-primary/10 flex items-center justify-center shrink-0">
                <BookOpen className="h-4 w-4 text-primary/50" />
              </div>
            )}
            <div className="min-w-0 text-left">
              <div className="font-semibold truncate">{selected?.title || 'Untitled'}</div>
              <div className="text-xs text-muted-foreground">{selected?.content_type || 'document'}</div>
            </div>
          </div>
          <ChevronDown className={`h-4 w-4 shrink-0 transition ${docDropdownOpen ? 'rotate-180' : ''}`} />
        </button>

        {docDropdownOpen && (
          <div className="absolute z-30 mt-1 w-full max-w-xl rounded-lg border bg-popover shadow-lg max-h-80 overflow-auto">
            {projects.map((p) => (
              <button
                key={p.id}
                onClick={() => {
                  setSelectedId(p.id);
                  setDocDropdownOpen(false);
                  router.replace(`/publish?project=${p.id}`);
                }}
                className={`w-full flex items-center gap-3 px-4 py-2.5 text-left hover:bg-muted transition ${
                  p.id === selectedId ? 'bg-muted/50' : ''
                }`}
              >
                {p.cover_url ? (
                  <img src={p.cover_url} alt="" className="h-9 w-7 rounded object-cover" />
                ) : (
                  <div className="h-9 w-7 rounded bg-primary/10 flex items-center justify-center shrink-0">
                    <BookOpen className="h-3.5 w-3.5 text-primary/50" />
                  </div>
                )}
                <div className="min-w-0">
                  <div className="text-sm font-medium truncate">{p.title || 'Untitled'}</div>
                  <div className="text-xs text-muted-foreground">{p.content_type}</div>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Metadata CTA */}
      <div className="flex items-center justify-between gap-4 px-5 py-4 rounded-xl border bg-gradient-to-r from-amber-50 to-transparent dark:from-amber-950/20">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-lg bg-amber-500/10 flex items-center justify-center">
            <FileText className="h-5 w-5 text-amber-600" />
          </div>
          <div>
            <div className="font-medium">Publishing details</div>
            <div className="text-xs text-muted-foreground">
              Title, description, keywords, price — written once, applied everywhere.
            </div>
          </div>
        </div>
        <button
          onClick={() => setMetadataOpen(true)}
          className="px-4 py-2 rounded-lg text-sm font-medium bg-background hover:bg-muted border"
        >
          Edit details
        </button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <>
          {/* TIER 1 — Penworth Store hero card */}
          {store && (
            <div className="relative overflow-hidden rounded-2xl border-2 border-primary/30 bg-gradient-to-br from-primary/10 via-primary/5 to-transparent p-6">
              <div className="absolute top-0 right-0 h-40 w-40 rounded-full bg-primary/10 blur-3xl" />
              <div className="relative flex flex-col md:flex-row md:items-center md:justify-between gap-4">
                <div className="flex items-start gap-4 flex-1 min-w-0">
                  <div className="h-12 w-12 rounded-xl bg-primary text-primary-foreground flex items-center justify-center shrink-0">
                    <Sparkles className="h-6 w-6" />
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h2 className="text-xl font-bold">Penworth Store</h2>
                      <span className="px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider rounded-full bg-primary/20 text-primary">
                        Coming Soon
                      </span>
                      <span className="px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider rounded-full bg-emerald-500/20 text-emerald-700 dark:text-emerald-400">
                        One-click
                      </span>
                    </div>
                    <p className="text-sm text-muted-foreground mt-1">{store.tagline}</p>
                    <div className="flex items-center gap-4 mt-3 text-xs text-muted-foreground flex-wrap">
                      <span className="flex items-center gap-1.5">
                        <Globe className="h-3.5 w-3.5" /> {store.reach_description}
                      </span>
                      <span className="flex items-center gap-1.5">
                        <Clock className="h-3.5 w-3.5" /> ~{store.avg_publish_time_minutes}min to live
                      </span>
                      <span className="font-medium text-primary">{store.royalty_rate}</span>
                    </div>
                  </div>
                </div>
                <div className="shrink-0">
                  {store.publication?.status === 'published' ? (
                    <a
                      href={store.publication.external_url || '#'}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-2 px-5 py-3 rounded-lg text-sm font-semibold bg-emerald-600 text-white hover:bg-emerald-700 transition"
                    >
                      <CheckCircle2 className="h-4 w-4" /> Live on Store
                      <ExternalLink className="h-3.5 w-3.5" />
                    </a>
                  ) : (
                    <button
                      onClick={publishToStore}
                      disabled={!!publishing}
                      className="inline-flex items-center gap-2 px-5 py-3 rounded-lg text-sm font-bold bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-60 shadow-sm transition"
                    >
                      {publishing === 'penworth' ? (
                        <>
                          <Loader2 className="h-4 w-4 animate-spin" /> Publishing...
                        </>
                      ) : (
                        <>
                          <Zap className="h-4 w-4" /> Publish now
                        </>
                      )}
                    </button>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* TIER 2 — Auto-publish */}
          <Section
            eyebrow={`Auto-publish · ${autos.length} platforms`}
            title="Connect once. Publish forever."
            subtitle="OAuth or API — Penworth Computer fills in the forms and uploads your files."
          >
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {autos.map((p) => (
                <PlatformCard
                  key={p.id}
                  platform={p}
                  onPublish={() => toast.info(`${p.name}: auto-publish is in early access. Coming very soon.`)}
                  onConnect={() => toast.info(`${p.name}: OAuth flow coming in the next release.`)}
                />
              ))}
            </div>
          </Section>

          {/* TIER 3 — Guided publish kits */}
          <Section
            eyebrow={`Guided publish · ${guided.length} platforms`}
            title="3-minute walkthroughs"
            subtitle="We generate your files and metadata. You paste them in. The platforms don't have APIs, so this is genuinely the fastest possible path."
          >
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {guided.map((p) => (
                <PlatformCard
                  key={p.id}
                  platform={p}
                  onPublish={() => setKitOpen(p.slug)}
                  publishLabel={p.publication?.status === 'published' ? 'Live ↗' : 'Get publish kit'}
                />
              ))}
            </div>
          </Section>
        </>
      )}

      {/* Metadata editor modal */}
      {metadataOpen && selectedId && (
        <MetadataEditor
          projectId={selectedId}
          onClose={() => setMetadataOpen(false)}
          onSaved={() => {
            setMetadataOpen(false);
            toast.success('Publishing details saved');
          }}
        />
      )}

      {/* Kit panel modal */}
      {kitOpen && selectedId && (
        <KitPanel
          projectId={selectedId}
          platformSlug={kitOpen}
          onClose={() => setKitOpen(null)}
          onNeedMetadata={() => {
            setKitOpen(null);
            setMetadataOpen(true);
          }}
          onPublished={() => {
            setKitOpen(null);
            loadPlatforms();
          }}
        />
      )}
    </div>
  );
}

function Section({
  eyebrow,
  title,
  subtitle,
  children,
}: {
  eyebrow: string;
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-4">
      <div>
        <div className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">
          {eyebrow}
        </div>
        <h2 className="text-xl font-bold mt-1">{title}</h2>
        {subtitle && <p className="text-sm text-muted-foreground mt-1">{subtitle}</p>}
      </div>
      {children}
    </section>
  );
}

function PlatformCard({
  platform,
  onPublish,
  onConnect,
  publishLabel,
}: {
  platform: Platform;
  onPublish: () => void;
  onConnect?: () => void;
  publishLabel?: string;
}) {
  const pub = platform.publication;
  const isLive = pub?.status === 'published';
  const needsConnect = platform.publish_tier === 'api_auto' && !platform.is_connected;

  return (
    <div className="group rounded-xl border bg-card hover:border-primary/40 hover:shadow-sm transition p-4 flex flex-col gap-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="font-semibold truncate">{platform.name}</div>
          {platform.tagline && (
            <div className="text-xs text-muted-foreground line-clamp-2 mt-0.5">{platform.tagline}</div>
          )}
        </div>
        {isLive && (
          <span className="shrink-0 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider rounded-full bg-emerald-500/20 text-emerald-700 dark:text-emerald-400">
            Live
          </span>
        )}
      </div>

      <div className="flex items-center gap-3 text-xs text-muted-foreground flex-wrap">
        {platform.royalty_rate && <span className="font-medium">{platform.royalty_rate}</span>}
        {platform.avg_publish_time_minutes && (
          <span className="flex items-center gap-1">
            <Clock className="h-3 w-3" />~{platform.avg_publish_time_minutes}min
          </span>
        )}
      </div>

      <div className="mt-auto flex items-center gap-2">
        {needsConnect ? (
          <button
            onClick={onConnect}
            className="flex-1 px-3 py-2 rounded-lg text-xs font-semibold border hover:bg-muted transition"
          >
            Connect account
          </button>
        ) : isLive && pub?.external_url ? (
          <a
            href={pub.external_url}
            target="_blank"
            rel="noopener noreferrer"
            className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold bg-emerald-600 text-white hover:bg-emerald-700 transition"
          >
            View live <ExternalLink className="h-3 w-3" />
          </a>
        ) : (
          <button
            onClick={onPublish}
            className="flex-1 px-3 py-2 rounded-lg text-xs font-semibold bg-primary text-primary-foreground hover:bg-primary/90 transition"
          >
            {publishLabel || 'Publish'}
          </button>
        )}
      </div>
    </div>
  );
}
