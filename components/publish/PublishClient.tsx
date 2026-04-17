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
  Unlink,
  Coins,
} from 'lucide-react';
import { MetadataEditor } from './MetadataEditor';
import { KitPanel } from './KitPanel';
import { ComputerSessionPanel } from './ComputerSessionPanel';
import { t, type Locale } from '@/lib/i18n/strings';

/**
 * Platforms whose Tier 2 auto-publish is powered by Penworth Computer
 * (Claude drives a real browser) rather than a direct API call. These
 * branch into the computer-use connect dialog (email + password) and
 * the live session panel.
 */
const COMPUTER_USE_SLUGS = new Set(['kobo', 'google_play', 'publishdrive', 'streetlib', 'kdp']);

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
  oauth_provider: string | null;
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
  locale = 'en',
}: {
  projects: ProjectRow[];
  initialProjectId: string | null;
  locale?: Locale;
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

  // When returning from an OAuth round-trip, the callback redirects to
  // /publish?connected=<slug> or /publish?oauth_error=<code>. Surface a
  // toast for either and scrub the URL so refresh doesn't re-fire it.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const connected = params.get('connected');
    const oauthError = params.get('oauth_error');
    const provider = params.get('provider');

    if (connected) {
      toast.success(`Connected to ${prettyProvider(connected)}`);
    } else if (oauthError) {
      toast.error(oauthErrorMessage(oauthError, provider));
    }
    if (connected || oauthError) {
      // Strip the query so a refresh doesn't re-toast
      params.delete('connected');
      params.delete('oauth_error');
      params.delete('provider');
      params.delete('detail');
      const qs = params.toString();
      router.replace(qs ? `/publish?${qs}` : '/publish');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * Kick off the OAuth flow for a Tier 2 platform. The server-side start
   * endpoint signs a state token and redirects to the provider; we use a
   * full-page navigation because OAuth requires an HTTP redirect chain.
   */
  /**
   * Tier 2 auto-publish. Platform card's Publish button for connected
   * api_auto platforms routes here. Long-running — D2D can take 30-60s.
   */
  const publishTier2 = async (slug: string, displayName: string) => {
    if (!selectedId) return;
    setPublishing(slug);
    toast.info(`Publishing to ${displayName}...`);
    try {
      const resp = await fetch(`/api/publishing/tier2/${slug}/publish`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId: selectedId }),
      });
      const data = await resp.json();
      if (resp.status === 422 && data.missing) {
        toast.error(`Complete publishing details first: ${data.missing.join(', ')}`);
        setMetadataOpen(true);
        return;
      }
      if (resp.status === 428 || data.code === 'not_connected') {
        toast.error(`Connect your ${displayName} account first`);
        return;
      }
      if (data.code === 'INSUFFICIENT_CREDITS') {
        toast.error(
          `Not enough credits — this publish costs ${data.required}. You have ${data.available}. Top up in Billing.`,
        );
        return;
      }
      if (!resp.ok || data.error) {
        toast.error(data.error || 'Publishing failed');
        return;
      }
      toast.success(`Live on ${displayName}`);
      loadPlatforms();
    } catch {
      toast.error('Publishing failed');
    } finally {
      setPublishing(null);
    }
  };

  const [apiKeyDialog, setApiKeyDialog] = useState<{ slug: string; displayName: string } | null>(null);
  const [apiKeyInput, setApiKeyInput] = useState('');
  const [apiKeyBusy, setApiKeyBusy] = useState(false);

  // Computer-use (email+password) connect dialog
  const [computerConnectDialog, setComputerConnectDialog] = useState<{ slug: string; displayName: string } | null>(null);
  const [computerEmail, setComputerEmail] = useState('');
  const [computerPassword, setComputerPassword] = useState('');
  const [computerConnectBusy, setComputerConnectBusy] = useState(false);

  // Active Penworth Computer session (live panel)
  const [activeComputerSession, setActiveComputerSession] = useState<{
    sessionId: string;
    slug: string;
    displayName: string;
  } | null>(null);

  const connectPlatform = (slug: string) => {
    const projectParam = selectedId ? `?projectId=${selectedId}` : '';
    window.location.href = `/api/publishing/oauth/${slug}/start${projectParam}`;
  };

  /**
   * Submit an API key for a platform that uses api_key auth (Payhip).
   * Encrypted server-side, never logged.
   */
  const submitApiKey = async () => {
    if (!apiKeyDialog || !apiKeyInput.trim()) return;
    setApiKeyBusy(true);
    try {
      const resp = await fetch(`/api/publishing/apikey/${apiKeyDialog.slug}/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKey: apiKeyInput.trim() }),
      });
      const data = await resp.json();
      if (!resp.ok || data.error) {
        toast.error(data.error || 'Connect failed');
        return;
      }
      toast.success(`Connected to ${apiKeyDialog.displayName}`);
      setApiKeyDialog(null);
      setApiKeyInput('');
      loadPlatforms();
    } catch {
      toast.error('Connect failed');
    } finally {
      setApiKeyBusy(false);
    }
  };

  /**
   * Submit email + password for a computer-use platform (Kobo, etc.).
   * Stored encrypted under auth_type='computer_use'. Decrypted only in
   * agent memory at login time.
   */
  const submitComputerConnect = async () => {
    if (!computerConnectDialog || !computerEmail.trim() || !computerPassword) return;
    setComputerConnectBusy(true);
    try {
      const resp = await fetch(`/api/publishing/computer/${computerConnectDialog.slug}/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: computerEmail.trim(), password: computerPassword }),
      });
      const data = await resp.json();
      if (!resp.ok || data.error) {
        toast.error(data.error || 'Connect failed');
        return;
      }
      toast.success(`Connected to ${computerConnectDialog.displayName}`);
      setComputerConnectDialog(null);
      setComputerEmail('');
      setComputerPassword('');
      loadPlatforms();
    } catch {
      toast.error('Connect failed');
    } finally {
      setComputerConnectBusy(false);
    }
  };

  /**
   * Kick off a Penworth Computer session — Claude drives a real browser to
   * publish the book. Returns immediately with a sessionId; the UI then
   * opens the live panel which subscribes to the SSE stream to actually
   * run the agent.
   */
  const launchComputer = async (slug: string, displayName: string) => {
    if (!selectedId) return;
    try {
      const resp = await fetch(`/api/publishing/computer/${slug}/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId: selectedId }),
      });
      const data = await resp.json();
      if (resp.status === 422 && data.missing) {
        toast.error(`Complete publishing details first: ${data.missing.join(', ')}`);
        setMetadataOpen(true);
        return;
      }
      if (resp.status === 428 || data.code === 'not_connected') {
        toast.error(`Connect your ${displayName} account first`);
        setComputerConnectDialog({ slug, displayName });
        return;
      }
      if (data.code === 'INSUFFICIENT_CREDITS') {
        toast.error(
          `Not enough credits — Penworth Computer costs ${data.required}. You have ${data.available}. Top up in Billing.`,
        );
        return;
      }
      if (!resp.ok || data.error) {
        toast.error(data.error || 'Failed to launch');
        return;
      }
      setActiveComputerSession({ sessionId: data.sessionId, slug, displayName });
    } catch {
      toast.error('Failed to launch');
    }
  };

  /**
   * Revoke an OAuth connection. Optimistic local update, then refresh
   * platforms to get canonical state.
   */
  const disconnectPlatform = async (slug: string, displayName: string) => {
    if (!confirm(`Disconnect ${displayName}? You'll need to reconnect before publishing again.`)) return;
    try {
      const resp = await fetch(`/api/publishing/oauth/${slug}/disconnect`, { method: 'POST' });
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        toast.error(err.error || 'Disconnect failed');
        return;
      }
      toast.success(`Disconnected from ${displayName}`);
      loadPlatforms();
    } catch {
      toast.error('Disconnect failed');
    }
  };

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
    return <PublishShowcase locale={locale} />;
  }

  const store = platforms.find((p) => p.publish_tier === 'penworth_store');
  const autos = platforms.filter((p) => p.publish_tier === 'api_auto');
  const guided = platforms.filter((p) => p.publish_tier === 'guided_pdf');

  return (
    <div className="max-w-6xl mx-auto px-6 py-8 space-y-8">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Publish</h1>
          <p className="text-muted-foreground mt-1">
            Your document. Live everywhere. Penworth Store in one click, plus 16 other platforms.
          </p>
        </div>
        {selectedId && (
          <Link
            href={`/publish/${selectedId}/status`}
            className="shrink-0 inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-semibold border hover:bg-muted"
          >
            Mission control <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        )}
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
                  busy={publishing === p.oauth_provider}
                  onPublish={() => {
                    if (!p.is_connected) {
                      toast.info(`Connect ${p.name} first`);
                      return;
                    }
                    if (!p.oauth_provider) return;
                    // Computer-use platforms launch a live session instead of
                    // the request/response Tier 2 adapter
                    if (COMPUTER_USE_SLUGS.has(p.oauth_provider)) {
                      launchComputer(p.oauth_provider, p.name);
                      return;
                    }
                    publishTier2(p.oauth_provider, p.name);
                  }}
                  onConnect={() => {
                    if (!p.oauth_provider) {
                      toast.info(`${p.name}: connector coming soon.`);
                      return;
                    }
                    // Payhip uses an API-key paste rather than OAuth round-trip
                    if (p.oauth_provider === 'payhip') {
                      setApiKeyDialog({ slug: 'payhip', displayName: p.name });
                      return;
                    }
                    // Kobo/etc use Penworth Computer with email+password
                    if (COMPUTER_USE_SLUGS.has(p.oauth_provider)) {
                      setComputerConnectDialog({ slug: p.oauth_provider, displayName: p.name });
                      return;
                    }
                    connectPlatform(p.oauth_provider);
                  }}
                  onDisconnect={() => {
                    if (!p.oauth_provider) return;
                    disconnectPlatform(p.oauth_provider, p.name);
                  }}
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

      {/* API-key connect dialog (Payhip and other api_key platforms) */}
      {apiKeyDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-background rounded-2xl shadow-xl max-w-md w-full p-6 space-y-4">
            <div>
              <h2 className="text-lg font-bold">Connect {apiKeyDialog.displayName}</h2>
              <p className="text-sm text-muted-foreground mt-1">
                {apiKeyDialog.slug === 'payhip'
                  ? 'Get your API key from Payhip → Account Settings → API.'
                  : 'Paste your API key from your account settings.'}
                {' '}We encrypt it with AES-256 and never log it.
              </p>
            </div>
            <input
              type="password"
              value={apiKeyInput}
              onChange={(e) => setApiKeyInput(e.target.value)}
              placeholder="Paste API key"
              className="w-full px-3 py-2 border rounded-lg bg-background text-sm font-mono"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === 'Enter' && apiKeyInput.trim() && !apiKeyBusy) {
                  submitApiKey();
                }
              }}
            />
            <div className="flex items-center justify-end gap-2">
              <button
                onClick={() => {
                  setApiKeyDialog(null);
                  setApiKeyInput('');
                }}
                className="px-4 py-2 rounded-lg text-sm hover:bg-muted"
              >
                Cancel
              </button>
              <button
                onClick={submitApiKey}
                disabled={apiKeyBusy || !apiKeyInput.trim()}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
              >
                {apiKeyBusy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                {apiKeyBusy ? 'Connecting...' : 'Connect'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Computer-use connect dialog — email + password for platforms
          Penworth Computer drives via browser automation (Kobo, etc.) */}
      {computerConnectDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-background rounded-2xl shadow-xl max-w-md w-full p-6 space-y-4">
            <div>
              <h2 className="text-lg font-bold">Connect {computerConnectDialog.displayName}</h2>
              <p className="text-sm text-muted-foreground mt-1">
                {computerConnectDialog.displayName} doesn't have a public API, so Penworth Computer
                (our Claude-powered agent) will log in on your behalf and fill in the publishing form.
                Credentials are encrypted with AES-256 and only decrypted in memory during a session.
              </p>
            </div>
            <div className="space-y-3">
              <div>
                <label className="text-xs font-semibold text-muted-foreground">Email</label>
                <input
                  type="email"
                  value={computerEmail}
                  onChange={(e) => setComputerEmail(e.target.value)}
                  placeholder="you@example.com"
                  className="mt-1 w-full px-3 py-2 border rounded-lg bg-background text-sm"
                  autoFocus
                />
              </div>
              <div>
                <label className="text-xs font-semibold text-muted-foreground">Password</label>
                <input
                  type="password"
                  value={computerPassword}
                  onChange={(e) => setComputerPassword(e.target.value)}
                  placeholder="Account password"
                  className="mt-1 w-full px-3 py-2 border rounded-lg bg-background text-sm"
                  onKeyDown={(e) => {
                    if (
                      e.key === 'Enter' &&
                      computerEmail.trim() &&
                      computerPassword &&
                      !computerConnectBusy
                    ) {
                      submitComputerConnect();
                    }
                  }}
                />
              </div>
            </div>
            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                onClick={() => {
                  setComputerConnectDialog(null);
                  setComputerEmail('');
                  setComputerPassword('');
                }}
                className="px-4 py-2 rounded-lg text-sm hover:bg-muted"
              >
                Cancel
              </button>
              <button
                onClick={submitComputerConnect}
                disabled={computerConnectBusy || !computerEmail.trim() || !computerPassword}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
              >
                {computerConnectBusy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                {computerConnectBusy ? 'Connecting...' : 'Connect securely'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Live Penworth Computer session panel */}
      {activeComputerSession && (
        <ComputerSessionPanel
          sessionId={activeComputerSession.sessionId}
          slug={activeComputerSession.slug}
          platformName={activeComputerSession.displayName}
          onClose={() => setActiveComputerSession(null)}
          onComplete={loadPlatforms}
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
  onDisconnect,
  publishLabel,
  busy,
}: {
  platform: Platform;
  onPublish: () => void;
  onConnect?: () => void;
  onDisconnect?: () => void;
  publishLabel?: string;
  busy?: boolean;
}) {
  const pub = platform.publication;
  const isLive = pub?.status === 'published';
  const needsConnect = platform.publish_tier === 'api_auto' && !platform.is_connected;
  const isConnectedAuto = platform.publish_tier === 'api_auto' && platform.is_connected;

  return (
    <div className="group rounded-xl border bg-card hover:border-primary/40 hover:shadow-sm transition p-4 flex flex-col gap-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="font-semibold truncate">{platform.name}</div>
          {platform.tagline && (
            <div className="text-xs text-muted-foreground line-clamp-2 mt-0.5">{platform.tagline}</div>
          )}
        </div>
        {isLive ? (
          <span className="shrink-0 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider rounded-full bg-emerald-500/20 text-emerald-700 dark:text-emerald-400">
            Live
          </span>
        ) : isConnectedAuto ? (
          <span className="shrink-0 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider rounded-full bg-sky-500/20 text-sky-700 dark:text-sky-400">
            Connected
          </span>
        ) : null}
      </div>

      <div className="flex items-center gap-3 text-xs text-muted-foreground flex-wrap">
        {platform.royalty_rate && <span className="font-medium">{platform.royalty_rate}</span>}
        {platform.avg_publish_time_minutes && (
          <span className="flex items-center gap-1">
            <Clock className="h-3 w-3" />~{platform.avg_publish_time_minutes}min
          </span>
        )}
        {platform.publish_tier === 'api_auto' && (
          <span
            className="flex items-center gap-1"
            title={
              platform.oauth_provider && COMPUTER_USE_SLUGS.has(platform.oauth_provider)
                ? 'Penworth Computer session — Claude drives the browser for you.'
                : 'One-click auto-publish via API.'
            }
          >
            <Coins className="h-3 w-3" />
            {platform.oauth_provider && COMPUTER_USE_SLUGS.has(platform.oauth_provider)
              ? '500 credits'
              : '50 credits'}
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
            disabled={busy}
            className="flex-1 px-3 py-2 rounded-lg text-xs font-semibold bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-60 transition inline-flex items-center justify-center gap-1.5"
          >
            {busy ? (
              <>
                <Loader2 className="h-3 w-3 animate-spin" /> Publishing...
              </>
            ) : (
              publishLabel || 'Publish'
            )}
          </button>
        )}
        {isConnectedAuto && onDisconnect && (
          <button
            onClick={onDisconnect}
            title="Disconnect account"
            className="p-2 rounded-lg text-muted-foreground hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30 transition"
          >
            <Unlink className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
    </div>
  );
}

// ============================================================================
// OAuth UX helpers — translate internal slugs/errors into human-readable text
// ============================================================================

function prettyProvider(slug: string): string {
  const map: Record<string, string> = {
    draft2digital: 'Draft2Digital',
    gumroad: 'Gumroad',
    payhip: 'Payhip',
    kobo: 'Kobo Writing Life',
    google_play: 'Google Play Books',
    publishdrive: 'PublishDrive',
    streetlib: 'StreetLib',
  };
  return map[slug] || slug;
}

function oauthErrorMessage(code: string, provider?: string | null): string {
  const who = provider ? prettyProvider(provider) : 'the platform';
  switch (code) {
    case 'preview_only':
      return 'Account connections are in limited preview. Contact support for early access.';
    case 'not_configured':
      return `${who} connection is not yet configured on this server. Contact support.`;
    case 'provider_denied':
      return `${who} denied the connection request. You can try again.`;
    case 'token_exchange_failed':
      return `Could not finalise your ${who} connection. Please try again.`;
    case 'invalid_state':
    case 'slug_mismatch':
    case 'session_mismatch':
      return 'The connection attempt expired or was tampered with. Please try again.';
    case 'encryption_unavailable':
      return 'Secure credential storage is not available right now. Contact support.';
    default:
      return `${who} connection failed (${code}).`;
  }
}

// ---------------------------------------------------------------------------
// PublishShowcase — rendered when the user has no completed documents yet.
// Turns an empty state into a marketing moment: shows exactly what publishing
// unlocks (17 platforms, 3 mechanisms, global reach) so first-time visitors
// understand the value prop before they've even finished their first book.
// ---------------------------------------------------------------------------

interface ShowcasePlatform {
  slug: string;
  name: string;
  tagline: string;
  royalty: string;
  reach: string;
}

const SHOWCASE_MARKETPLACE: ShowcasePlatform = {
  slug: 'penworth',
  name: 'Penworth Publishing Marketplace',
  tagline: 'Free global audience. AI audiobook. Visual chapters.',
  royalty: '70% to author',
  reach: 'Global · ebook + audiobook',
};

const SHOWCASE_AUTO: ShowcasePlatform[] = [
  { slug: 'kdp',           name: 'Amazon Kindle Direct Publishing', tagline: 'Largest ebook marketplace globally. Driven by Penworth Computer.', royalty: '35–70% depending on pricing', reach: '13 global marketplaces, 90%+ ebook market' },
  { slug: 'draft2digital', name: 'Draft2Digital', tagline: 'Distributes to Apple, Kobo, B&N, libraries, and more.', royalty: '60% (Apple/Kobo) + aggregator cut', reach: 'Aggregator — 10+ retailers in one click' },
  { slug: 'kobo',          name: 'Kobo Writing Life', tagline: 'Strong in Canada, Europe, Japan.', royalty: '70%', reach: 'Kobo readers + OverDrive libraries' },
  { slug: 'google_play',   name: 'Google Play Books', tagline: 'Worldwide via Penworth Computer.', royalty: '52% (Google share)', reach: 'Android + Google Play Books' },
  { slug: 'publishdrive',  name: 'PublishDrive', tagline: 'Aggregator to 400+ stores.', royalty: 'Varies by retailer', reach: '400+ retailers worldwide' },
  { slug: 'streetlib',     name: 'StreetLib', tagline: 'Europe + multilingual reach.', royalty: 'Varies by retailer', reach: 'European libraries + retailers' },
  { slug: 'gumroad',       name: 'Gumroad', tagline: 'Sell direct to your audience.', royalty: '~95% after fees', reach: 'Your audience, direct' },
  { slug: 'payhip',        name: 'Payhip', tagline: 'Direct digital sales.', royalty: '~95% after fees', reach: 'Your audience, direct' },
];

const SHOWCASE_GUIDED: ShowcasePlatform[] = [
  { slug: 'apple_books',  name: 'Apple Books', tagline: 'Apple Books global store.', royalty: '70%', reach: 'Apple Books in 50+ countries' },
  { slug: 'ingram_spark', name: 'IngramSpark', tagline: 'Distribution to libraries and bookstores.', royalty: 'Author sets price', reach: 'Global libraries + bookstore wholesale' },
  { slug: 'smashwords',   name: 'Smashwords', tagline: 'Large indie ebook distribution.', royalty: '60%', reach: 'Smashwords store + partner retailers' },
  { slug: 'bn_press',     name: 'Barnes & Noble Press', tagline: 'Barnes & Noble ebook store direct.', royalty: '40–65%', reach: 'Barnes & Noble + Nook readers' },
  { slug: 'lulu',         name: 'Lulu', tagline: 'Print-on-demand + ebook distribution.', royalty: '80% ebook / varies print', reach: 'Lulu bookstore + global retailers' },
  { slug: 'bookbaby',     name: 'BookBaby', tagline: 'Hybrid publishing + distribution.', royalty: '100% minus fees', reach: 'Full-service ebook distribution' },
  { slug: 'blurb',        name: 'Blurb', tagline: 'Premium photobook & ebook platform.', royalty: 'Author sets markup', reach: 'Blurb bookstore + Amazon + Apple' },
  { slug: 'wattpad',      name: 'Wattpad Paid Stories', tagline: 'Serialised paid fiction audience.', royalty: 'Revenue share', reach: 'Wattpad Paid Stories readers' },
];

function PublishShowcase({ locale = 'en' }: { locale?: Locale }) {
  return (
    <div className="max-w-6xl mx-auto px-6 py-10 space-y-10">
      {/* Hero */}
      <div className="text-center space-y-4 max-w-3xl mx-auto">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-primary/10 text-primary text-xs font-semibold">
          <Sparkles className="h-3.5 w-3.5" />
          {t('publish.showcase.badge', locale)}
        </div>
        <h1 className="text-4xl font-bold tracking-tight">
          {t('publish.showcase.hero', locale)}
        </h1>
        <p className="text-lg text-muted-foreground">
          {t('publish.showcase.subhero', locale)}
        </p>
        <div className="flex items-center justify-center gap-3 pt-2">
          <Link
            href="/projects"
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-primary text-primary-foreground font-medium hover:bg-primary/90"
          >
            {t('publish.startFirstDoc', locale)}
            <ArrowRight className="h-4 w-4" />
          </Link>
          <Link
            href="/pricing"
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg border bg-background font-medium hover:bg-muted"
          >
            {t('publish.showcase.seePricing', locale)}
          </Link>
        </div>
      </div>

      {/* Three mechanisms */}
      <div className="grid md:grid-cols-3 gap-4">
        <MechanismCard
          icon={<Zap className="h-5 w-5" />}
          title={t('publish.showcase.mech1Title', locale)}
          subtitle={t('publish.showcase.mech1Subtitle', locale)}
          body="Penworth's own storefront publishes your ebook and AI-narrated audiobook the moment you're done. 70% royalty, no gatekeeper."
          count={t('publish.showcase.mech1Count', locale)}
        />
        <MechanismCard
          icon={<Globe className="h-5 w-5" />}
          title={t('publish.showcase.mech2Title', locale)}
          subtitle={t('publish.showcase.mech2Subtitle', locale)}
          body="Eight platforms published automatically — including Amazon KDP. Some via direct API, some via Penworth Computer (Claude drives a real browser). You connect once, we handle every submission."
          count={t('publish.showcase.mech2Count', locale)}
        />
        <MechanismCard
          icon={<FileText className="h-5 w-5" />}
          title={t('publish.showcase.mech3Title', locale)}
          subtitle={t('publish.showcase.mech3Subtitle', locale)}
          body="For platforms that don't accept automation: we generate platform-specific files (formatted PDF, DOCX, cover) plus a walkthrough so submission takes minutes, not hours."
          count={t('publish.showcase.mech3Count', locale)}
        />
      </div>

      {/* Flagship marketplace */}
      <section className="space-y-4">
        <div className="flex items-center gap-3">
          <Zap className="h-5 w-5 text-primary" />
          <h2 className="text-xl font-semibold">{t('publish.showcase.marketplace', locale)}</h2>
          <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-primary/10 text-primary">
            {t('publish.showcase.marketplaceTag', locale)}
          </span>
        </div>
        <div className="rounded-xl border bg-gradient-to-br from-primary/5 to-background p-6 md:p-8">
          <div className="flex flex-col md:flex-row items-start md:items-center gap-6">
            <div className="h-16 w-16 rounded-xl bg-primary/10 flex items-center justify-center flex-shrink-0">
              <BookOpen className="h-8 w-8 text-primary" />
            </div>
            <div className="flex-1 space-y-2">
              <h3 className="text-lg font-semibold">{SHOWCASE_MARKETPLACE.name}</h3>
              <p className="text-sm text-muted-foreground">{SHOWCASE_MARKETPLACE.tagline}</p>
              <div className="flex flex-wrap gap-2 pt-1">
                <Chip icon={<Coins className="h-3 w-3" />} label={SHOWCASE_MARKETPLACE.royalty} />
                <Chip icon={<Globe className="h-3 w-3" />} label={SHOWCASE_MARKETPLACE.reach} />
                <Chip icon={<Clock className="h-3 w-3" />} label="~1 min" />
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Auto-publish lineup */}
      <section className="space-y-4">
        <div className="flex items-center gap-3">
          <Globe className="h-5 w-5 text-blue-500" />
          <h2 className="text-xl font-semibold">{t('publish.showcase.autoPublish', locale)}</h2>
          <span className="text-xs text-muted-foreground">{t('publish.showcase.autoPublishTag', locale)}</span>
        </div>
        <div className="grid md:grid-cols-2 gap-3">
          {SHOWCASE_AUTO.map((p) => (
            <PlatformShowcaseCard key={p.slug} platform={p} />
          ))}
        </div>
      </section>

      {/* Guided kits */}
      <section className="space-y-4">
        <div className="flex items-center gap-3">
          <FileText className="h-5 w-5 text-amber-500" />
          <h2 className="text-xl font-semibold">{t('publish.showcase.guidedKits', locale)}</h2>
          <span className="text-xs text-muted-foreground">{t('publish.showcase.guidedKitsTag', locale)}</span>
        </div>
        <div className="grid md:grid-cols-3 gap-3">
          {SHOWCASE_GUIDED.map((p) => (
            <PlatformShowcaseCard key={p.slug} platform={p} compact />
          ))}
        </div>
      </section>

      {/* CTA footer */}
      <div className="rounded-xl border-2 border-dashed p-8 text-center space-y-3">
        <h3 className="text-xl font-semibold">{t('publish.showcase.footerTitle', locale)}</h3>
        <p className="text-sm text-muted-foreground max-w-xl mx-auto">
          {t('publish.noDocsBody', locale)}
        </p>
        <Link
          href="/projects"
          className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-primary text-primary-foreground font-medium hover:bg-primary/90 mt-2"
        >
          {t('publish.startFirstDoc', locale)}
          <ArrowRight className="h-4 w-4" />
        </Link>
      </div>
    </div>
  );
}

function MechanismCard({
  icon,
  title,
  subtitle,
  body,
  count,
}: {
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  body: string;
  count: string;
}) {
  return (
    <div className="rounded-xl border bg-card p-5 space-y-3">
      <div className="flex items-center justify-between">
        <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center text-primary">
          {icon}
        </div>
        <span className="text-xs font-semibold text-muted-foreground">{count}</span>
      </div>
      <div>
        <h3 className="font-semibold">{title}</h3>
        <p className="text-xs text-muted-foreground">{subtitle}</p>
      </div>
      <p className="text-sm text-muted-foreground leading-relaxed">{body}</p>
    </div>
  );
}

function PlatformShowcaseCard({
  platform,
  compact,
}: {
  platform: ShowcasePlatform;
  compact?: boolean;
}) {
  return (
    <div className="rounded-lg border bg-card p-4 space-y-2 hover:border-primary/40 transition-colors">
      <div className="flex items-start justify-between gap-2">
        <h4 className="font-semibold text-sm leading-tight">{platform.name}</h4>
      </div>
      <p className="text-xs text-muted-foreground leading-relaxed line-clamp-2">
        {platform.tagline}
      </p>
      {!compact && (
        <div className="flex flex-wrap gap-1.5 pt-1">
          <Chip icon={<Coins className="h-3 w-3" />} label={platform.royalty} size="xs" />
        </div>
      )}
      <p className="text-[11px] text-muted-foreground/80 pt-1">{platform.reach}</p>
    </div>
  );
}

function Chip({
  icon,
  label,
  size = 'sm',
}: {
  icon: React.ReactNode;
  label: string;
  size?: 'xs' | 'sm';
}) {
  const sizeCls = size === 'xs' ? 'text-[10px] px-1.5 py-0.5' : 'text-xs px-2 py-1';
  return (
    <span className={`inline-flex items-center gap-1 rounded-md bg-muted ${sizeCls} font-medium`}>
      {icon}
      {label}
    </span>
  );
}
