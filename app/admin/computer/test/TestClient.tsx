'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Loader2, Bot, FlaskConical, CheckCircle2, AlertTriangle } from 'lucide-react';
import { ComputerSessionPanel } from '@/components/publish/ComputerSessionPanel';

/**
 * Admin-only test harness for Penworth Computer.
 *
 * Flow:
 *   1. Seed (or reuse) a stub project via /api/publishing/computer/test/seed
 *   2. Show which platforms are connected for this admin
 *   3. Launch a real Computer session against the stub project via the
 *      normal /api/publishing/computer/[slug]/start endpoint
 *   4. Render the live ComputerSessionPanel so the admin sees every turn
 */

interface PlatformRow {
  slug: string;
  name: string;
  oauth_provider: string | null;
  is_connected: boolean;
}

const TESTABLE_SLUGS = ['kobo', 'google_play', 'publishdrive', 'streetlib'] as const;

export function TestClient() {
  const [projectId, setProjectId] = useState<string | null>(null);
  const [seeding, setSeeding] = useState(true);
  const [platforms, setPlatforms] = useState<PlatformRow[]>([]);
  const [launching, setLaunching] = useState<string | null>(null);
  const [activeSession, setActiveSession] = useState<{
    sessionId: string;
    slug: string;
    displayName: string;
  } | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        // Seed stub project
        const seedResp = await fetch('/api/publishing/computer/test/seed', { method: 'POST' });
        const seedData = await seedResp.json();
        if (!seedResp.ok) {
          toast.error(seedData.error || 'Seed failed');
          return;
        }
        if (!cancelled) setProjectId(seedData.projectId);

        // Pull platforms to show connection status for testable slugs
        const platResp = await fetch(
          `/api/publishing/platforms?projectId=${seedData.projectId}`,
        );
        const platData = await platResp.json();
        if (!cancelled && platData.platforms) {
          const filtered = (platData.platforms as PlatformRow[]).filter((p) =>
            TESTABLE_SLUGS.includes(p.slug as (typeof TESTABLE_SLUGS)[number]),
          );
          setPlatforms(filtered);
        }
      } catch {
        toast.error('Seed or platform load failed');
      } finally {
        if (!cancelled) setSeeding(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const launch = async (slug: string, displayName: string) => {
    if (!projectId) return;
    setLaunching(slug);
    try {
      const resp = await fetch(`/api/publishing/computer/${slug}/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId }),
      });
      const data = await resp.json();
      if (resp.status === 428 || data.code === 'not_connected') {
        toast.error(`Connect ${displayName} first on the main Publish page`);
        return;
      }
      if (data.code === 'INSUFFICIENT_CREDITS') {
        toast.error(
          `Not enough credits (${data.required} required, ${data.available} available)`,
        );
        return;
      }
      if (!resp.ok || data.error) {
        toast.error(data.error || 'Launch failed');
        return;
      }
      setActiveSession({ sessionId: data.sessionId, slug, displayName });
    } catch {
      toast.error('Launch failed');
    } finally {
      setLaunching(null);
    }
  };

  if (seeding) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground py-12">
        <Loader2 className="h-4 w-4 animate-spin" />
        Preparing stub book...
      </div>
    );
  }

  return (
    <>
      <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-4 flex items-start gap-3">
        <AlertTriangle className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" />
        <div className="text-sm">
          <div className="font-semibold text-amber-800 dark:text-amber-400">
            Real third-party services
          </div>
          <div className="text-muted-foreground mt-1">
            These launches hit live Browserbase + Claude API + the target
            publishing platform. A successful run will actually upload a stub
            book and may submit it for review. Clean up on the retailer side
            afterward if the session reaches the publish step.
          </div>
        </div>
      </div>

      <div className="rounded-xl border bg-card p-5 flex items-center gap-4">
        <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
          <FlaskConical className="h-5 w-5 text-primary" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="font-semibold truncate">Stub project ready</div>
          <div className="text-xs text-muted-foreground mt-0.5 font-mono truncate">
            {projectId}
          </div>
        </div>
        <CheckCircle2 className="h-5 w-5 text-emerald-600 shrink-0" />
      </div>

      <div>
        <h2 className="text-sm font-bold uppercase tracking-wider text-muted-foreground mb-3">
          Choose a platform to test
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {platforms.length === 0 && (
            <div className="col-span-full text-sm text-muted-foreground italic">
              No testable platforms found.
            </div>
          )}
          {platforms.map((p) => (
            <button
              key={p.slug}
              onClick={() => {
                if (!p.is_connected) {
                  toast.error(`Connect ${p.name} on the main Publish page first`);
                  return;
                }
                launch(p.slug, p.name);
              }}
              disabled={launching !== null || !p.is_connected}
              className="group text-left rounded-xl border bg-card p-4 hover:border-primary/40 hover:shadow-sm transition disabled:opacity-60 disabled:cursor-not-allowed"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="font-semibold truncate">{p.name}</div>
                  <div className="text-xs text-muted-foreground mt-0.5 font-mono">
                    {p.slug}
                  </div>
                </div>
                {p.is_connected ? (
                  <span className="shrink-0 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider rounded-full bg-emerald-500/15 text-emerald-700 dark:text-emerald-400">
                    Connected
                  </span>
                ) : (
                  <span className="shrink-0 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider rounded-full bg-muted text-muted-foreground">
                    Not connected
                  </span>
                )}
              </div>
              <div className="mt-3 inline-flex items-center gap-1.5 text-xs font-semibold">
                {launching === p.slug ? (
                  <>
                    <Loader2 className="h-3 w-3 animate-spin" /> Launching...
                  </>
                ) : (
                  <>
                    <Bot className="h-3 w-3" /> Launch test session
                  </>
                )}
              </div>
            </button>
          ))}
        </div>
      </div>

      {activeSession && (
        <ComputerSessionPanel
          sessionId={activeSession.sessionId}
          slug={activeSession.slug}
          platformName={activeSession.displayName}
          onClose={() => setActiveSession(null)}
          onComplete={() => undefined}
        />
      )}
    </>
  );
}
