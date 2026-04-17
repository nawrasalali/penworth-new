'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import {
  CheckCircle2,
  Clock,
  Loader2,
  AlertCircle,
  ExternalLink,
  FileDown,
  RefreshCw,
  Sparkles,
  Zap,
  BookMarked,
} from 'lucide-react';

interface Platform {
  id: string;
  slug: string;
  name: string;
  tagline: string | null;
  royalty_rate: string | null;
  reach_description: string | null;
  avg_publish_time_minutes: number | null;
  publish_tier: 'penworth_store' | 'api_auto' | 'guided_pdf';
  oauth_provider: string | null;
  is_connected: boolean;
  publication: {
    status: string;
    external_url: string | null;
    published_at: string | null;
    guide_generated_at: string | null;
    error_message?: string | null;
    retry_count?: number;
  } | null;
}

export function StatusClient({ projectId }: { projectId: string }) {
  const [platforms, setPlatforms] = useState<Platform[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const resp = await fetch(`/api/publishing/platforms?projectId=${projectId}`);
      const data = await resp.json();
      setPlatforms(data.platforms || []);
    } catch {
      toast.error('Failed to load publication status');
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  // Stats for the summary bar
  const liveCount = platforms.filter((p) => p.publication?.status === 'published').length;
  const inProgressCount = platforms.filter(
    (p) => p.publication?.status === 'in_progress' || p.publication?.status === 'guide_generated',
  ).length;
  const failedCount = platforms.filter((p) => p.publication?.status === 'failed').length;
  const pendingCount = platforms.length - liveCount - inProgressCount - failedCount;

  return (
    <>
      {/* Summary bar */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard label="Live" count={liveCount} tone="emerald" icon={CheckCircle2} />
        <StatCard label="In progress" count={inProgressCount} tone="sky" icon={Loader2} />
        <StatCard label="Pending" count={pendingCount} tone="muted" icon={Clock} />
        <StatCard label="Failed" count={failedCount} tone="red" icon={AlertCircle} />
      </div>

      <div className="flex items-center justify-between pt-2">
        <div className="text-sm text-muted-foreground">
          {platforms.length} platforms · updated just now
        </div>
        <button
          onClick={load}
          className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-semibold border hover:bg-muted"
        >
          <RefreshCw className="h-3.5 w-3.5" /> Refresh
        </button>
      </div>

      {/* Status list */}
      <div className="mt-4 rounded-xl border overflow-hidden">
        {platforms.map((p, i) => (
          <StatusRow
            key={p.id}
            platform={p}
            projectId={projectId}
            isFirst={i === 0}
          />
        ))}
      </div>

      <div className="pt-2">
        <Link
          href="/publish"
          className="text-sm text-primary hover:underline inline-flex items-center gap-1"
        >
          Back to Publish landing
        </Link>
      </div>
    </>
  );
}

function StatCard({
  label,
  count,
  tone,
  icon: Icon,
}: {
  label: string;
  count: number;
  tone: 'emerald' | 'sky' | 'muted' | 'red';
  icon: React.ElementType;
}) {
  const tones = {
    emerald: 'from-emerald-500/10 border-emerald-500/30 text-emerald-700 dark:text-emerald-400',
    sky: 'from-sky-500/10 border-sky-500/30 text-sky-700 dark:text-sky-400',
    muted: 'from-muted/50 border-border text-muted-foreground',
    red: 'from-red-500/10 border-red-500/30 text-red-700 dark:text-red-400',
  };
  return (
    <div className={`rounded-xl border bg-gradient-to-br to-transparent p-4 ${tones[tone]}`}>
      <div className="flex items-center justify-between">
        <div className="text-3xl font-bold tabular-nums text-foreground">{count}</div>
        <Icon className="h-5 w-5 opacity-60" />
      </div>
      <div className="text-xs uppercase tracking-wider font-semibold mt-1">{label}</div>
    </div>
  );
}

function StatusRow({
  platform,
  projectId,
  isFirst,
}: {
  platform: Platform;
  projectId: string;
  isFirst: boolean;
}) {
  const pub = platform.publication;
  const status = pub?.status || 'pending';

  const tierIcon =
    platform.publish_tier === 'penworth_store' ? Sparkles :
    platform.publish_tier === 'api_auto' ? Zap :
    BookMarked;
  const TierIcon = tierIcon;

  // Small status pill
  const statusBadge = (() => {
    if (status === 'published') {
      return <StatusPill tone="emerald" label="Live" />;
    }
    if (status === 'failed') {
      return <StatusPill tone="red" label={`Failed${pub?.retry_count ? ` · ${pub.retry_count} attempts` : ''}`} />;
    }
    if (status === 'in_progress') {
      return <StatusPill tone="sky" label="Publishing..." spinning />;
    }
    if (status === 'guide_generated') {
      return <StatusPill tone="amber" label="Kit ready" />;
    }
    if (platform.publish_tier === 'api_auto' && !platform.is_connected) {
      return <StatusPill tone="muted" label="Not connected" />;
    }
    return <StatusPill tone="muted" label="Not started" />;
  })();

  return (
    <div className={`flex items-center gap-4 px-4 py-3 ${isFirst ? '' : 'border-t'} hover:bg-muted/30 transition`}>
      {/* Tier icon column */}
      <div className="h-9 w-9 rounded-lg bg-muted flex items-center justify-center shrink-0">
        <TierIcon className="h-4 w-4 text-muted-foreground" />
      </div>

      {/* Name + tagline */}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <div className="font-semibold text-sm">{platform.name}</div>
          {statusBadge}
        </div>
        <div className="text-xs text-muted-foreground truncate mt-0.5">
          {platform.tagline}
        </div>
        {pub?.error_message && (
          <div className="text-xs text-red-600 mt-1 truncate">{pub.error_message}</div>
        )}
      </div>

      {/* Meta */}
      <div className="hidden md:flex flex-col items-end shrink-0 text-xs text-muted-foreground gap-0.5">
        {platform.royalty_rate && <span className="font-medium">{platform.royalty_rate}</span>}
        {pub?.published_at && (
          <span>Published {relativeTime(pub.published_at)}</span>
        )}
      </div>

      {/* Action */}
      <div className="shrink-0">
        {status === 'published' && pub?.external_url ? (
          <a
            href={pub.external_url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold bg-emerald-600 text-white hover:bg-emerald-700"
          >
            View <ExternalLink className="h-3 w-3" />
          </a>
        ) : platform.publish_tier === 'guided_pdf' && status === 'guide_generated' ? (
          <Link
            href={`/publish?project=${projectId}`}
            className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold border hover:bg-muted"
          >
            <FileDown className="h-3 w-3" /> Get kit
          </Link>
        ) : (
          <Link
            href={`/publish?project=${projectId}`}
            className="inline-flex items-center px-3 py-1.5 rounded-lg text-xs font-semibold border hover:bg-muted"
          >
            Open
          </Link>
        )}
      </div>
    </div>
  );
}

function StatusPill({
  tone,
  label,
  spinning,
}: {
  tone: 'emerald' | 'sky' | 'amber' | 'red' | 'muted';
  label: string;
  spinning?: boolean;
}) {
  const tones = {
    emerald: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400',
    sky: 'bg-sky-500/15 text-sky-700 dark:text-sky-400',
    amber: 'bg-amber-500/15 text-amber-700 dark:text-amber-500',
    red: 'bg-red-500/15 text-red-700 dark:text-red-400',
    muted: 'bg-muted text-muted-foreground',
  };
  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider rounded-full ${tones[tone]}`}
    >
      {spinning && <Loader2 className="h-2.5 w-2.5 animate-spin" />}
      {label}
    </span>
  );
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const s = Math.floor(diff / 1000);
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(iso).toLocaleDateString();
}
