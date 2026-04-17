import { notFound } from 'next/navigation';
import Link from 'next/link';
import { createServiceClient } from '@/lib/supabase/service';
import { ArrowLeft, Bot, ExternalLink, AlertCircle, CheckCircle2 } from 'lucide-react';

export const dynamic = 'force-dynamic';

interface EventRow {
  turn_index: number;
  event_type: string;
  payload: Record<string, unknown>;
  created_at: string;
}

/**
 * /admin/computer/[id] — deep-dive on a single Penworth Computer session.
 * Shows every turn's screenshot, thought, and action in chronological
 * order. Signed URLs for private screenshots so this doesn't leak if
 * someone shoulder-surfs an admin's URL.
 */
export default async function AdminSessionDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const service = createServiceClient();

  const { data: session } = await service
    .from('computer_use_sessions')
    .select('*')
    .eq('id', id)
    .single();

  if (!session) notFound();

  const { data: events } = await service
    .from('computer_use_events')
    .select('turn_index, event_type, payload, created_at')
    .eq('session_id', id)
    .order('turn_index', { ascending: true })
    .order('created_at', { ascending: true });

  const { data: user } = await service
    .from('profiles')
    .select('email, full_name')
    .eq('id', session.user_id)
    .single();

  const { data: project } = await service
    .from('projects')
    .select('title')
    .eq('id', session.project_id)
    .single();

  // Bucket events by turn so screenshot + action + thought for the same
  // turn render together
  const turns = new Map<number, EventRow[]>();
  for (const ev of events || []) {
    const arr = turns.get(ev.turn_index) || [];
    arr.push(ev);
    turns.set(ev.turn_index, arr);
  }
  const orderedTurns = Array.from(turns.entries()).sort((a, b) => a[0] - b[0]);

  // Pre-sign all screenshot URLs in parallel
  const screenshotCache = new Map<string, string>();
  const allPaths: string[] = [];
  for (const [, evs] of orderedTurns) {
    for (const ev of evs) {
      const path = (ev.payload as { screenshot_path?: string }).screenshot_path;
      if (path && !screenshotCache.has(path)) allPaths.push(path);
    }
  }
  if (allPaths.length) {
    const { data: signed } = await service.storage
      .from('computer-use-screenshots')
      .createSignedUrls(allPaths, 3600);
    for (const s of signed || []) {
      if (s.path && s.signedUrl) screenshotCache.set(s.path, s.signedUrl);
    }
  }

  const duration = session.ended_at
    ? Math.round((new Date(session.ended_at).getTime() - new Date(session.started_at).getTime()) / 1000)
    : null;

  return (
    <div className="max-w-6xl mx-auto px-6 py-8 space-y-6">
      <Link
        href="/admin/computer"
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" />
        All sessions
      </Link>

      {/* Header */}
      <div className="flex items-start gap-4">
        <div className="h-12 w-12 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
          <Bot className="h-6 w-6 text-primary" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">
            {session.platform_slug} · session
          </div>
          <h1 className="text-2xl font-bold tracking-tight mt-0.5 truncate">
            {project?.title || 'Untitled'}
          </h1>
          <div className="text-sm text-muted-foreground mt-1">
            {user?.full_name || user?.email || session.user_id.slice(0, 8)} ·{' '}
            {new Date(session.started_at).toLocaleString()}
            {duration != null && ` · ${duration}s`}
          </div>
        </div>
      </div>

      {/* Meta card */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <MetaCard label="Status" value={session.status} />
        <MetaCard label="Turns" value={String(session.turns_count || 0)} />
        <MetaCard label="Runtime" value={session.runtime} />
        <MetaCard
          label="Result"
          value={
            session.result_url ? (
              <a
                href={session.result_url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-primary hover:underline"
              >
                View <ExternalLink className="h-3 w-3" />
              </a>
            ) : '—'
          }
        />
      </div>

      {session.error_message && (
        <div className="rounded-xl border border-red-500/30 bg-red-500/5 p-4 flex items-start gap-2">
          <AlertCircle className="h-5 w-5 text-red-600 shrink-0 mt-0.5" />
          <div>
            <div className="font-semibold text-sm text-red-700 dark:text-red-400">
              Session error
            </div>
            <div className="text-sm text-muted-foreground mt-1 font-mono whitespace-pre-wrap break-words">
              {session.error_message}
            </div>
          </div>
        </div>
      )}

      {session.status === 'succeeded' && (
        <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-4 flex items-center gap-2">
          <CheckCircle2 className="h-5 w-5 text-emerald-600 shrink-0" />
          <div className="text-sm font-semibold text-emerald-700 dark:text-emerald-400">
            Session succeeded
          </div>
        </div>
      )}

      {/* Turn-by-turn timeline */}
      <div className="space-y-4">
        <h2 className="text-sm font-bold uppercase tracking-wider text-muted-foreground">
          Turn-by-turn timeline · {orderedTurns.length} turns
        </h2>
        {orderedTurns.length === 0 && (
          <div className="text-sm text-muted-foreground italic">No events recorded yet.</div>
        )}
        {orderedTurns.map(([turnIndex, evs]) => (
          <TurnCard
            key={turnIndex}
            turnIndex={turnIndex}
            events={evs}
            screenshotCache={screenshotCache}
          />
        ))}
      </div>
    </div>
  );
}

function MetaCard({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-lg border bg-card px-4 py-3">
      <div className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">
        {label}
      </div>
      <div className="text-sm font-semibold mt-1 break-words">{value}</div>
    </div>
  );
}

function TurnCard({
  turnIndex,
  events,
  screenshotCache,
}: {
  turnIndex: number;
  events: EventRow[];
  screenshotCache: Map<string, string>;
}) {
  const screenshotEvent = events.find((e) => e.event_type === 'screenshot');
  const thoughts = events.filter((e) => e.event_type === 'thought');
  const actions = events.filter((e) => e.event_type === 'action');
  const errors = events.filter((e) => e.event_type === 'error');
  const handoffs = events.filter((e) => e.event_type === 'handoff');
  const checkpoints = events.filter((e) => e.event_type === 'checkpoint');

  const shotPath = screenshotEvent
    ? (screenshotEvent.payload as { screenshot_path?: string }).screenshot_path
    : undefined;
  const shotUrl = shotPath ? screenshotCache.get(shotPath) : undefined;

  return (
    <div className="rounded-xl border overflow-hidden">
      <div className="bg-muted/40 px-4 py-2 flex items-center justify-between">
        <div className="font-mono text-xs font-semibold">Turn #{turnIndex}</div>
      </div>
      <div className="grid md:grid-cols-[280px_1fr] gap-4 p-4">
        {/* Screenshot */}
        <div className="bg-black/80 rounded-lg overflow-hidden aspect-[16/10] flex items-center justify-center">
          {shotUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={shotUrl} alt={`Turn ${turnIndex}`} className="w-full h-full object-contain" />
          ) : (
            <span className="text-xs text-muted-foreground">No screenshot</span>
          )}
        </div>

        {/* Events */}
        <div className="space-y-2 text-sm min-w-0">
          {thoughts.map((e, i) => (
            <div key={`t${i}`} className="flex items-start gap-2">
              <span className="text-xs text-muted-foreground shrink-0 mt-0.5">thought</span>
              <span className="min-w-0 text-foreground">
                {(e.payload as { text?: string }).text || ''}
              </span>
            </div>
          ))}
          {actions.map((e, i) => (
            <div key={`a${i}`} className="flex items-start gap-2">
              <span className="text-xs text-sky-700 dark:text-sky-400 shrink-0 mt-0.5 font-semibold">
                action
              </span>
              <span className="font-mono text-xs text-sky-700 dark:text-sky-400 min-w-0 break-words">
                {JSON.stringify(e.payload).slice(0, 300)}
              </span>
            </div>
          ))}
          {handoffs.map((e, i) => (
            <div key={`h${i}`} className="flex items-start gap-2">
              <span className="text-xs text-amber-700 dark:text-amber-500 shrink-0 mt-0.5 font-semibold">
                handoff
              </span>
              <span className="min-w-0">
                {(e.payload as { reason?: string }).reason || 'user input requested'}
              </span>
            </div>
          ))}
          {checkpoints.map((e, i) => (
            <div key={`c${i}`} className="flex items-start gap-2">
              <span className="text-xs text-emerald-700 dark:text-emerald-400 shrink-0 mt-0.5 font-semibold">
                complete
              </span>
              <span className="min-w-0">
                {(e.payload as { summary?: string }).summary || 'task complete'}
              </span>
            </div>
          ))}
          {errors.map((e, i) => (
            <div key={`e${i}`} className="flex items-start gap-2">
              <span className="text-xs text-red-700 dark:text-red-400 shrink-0 mt-0.5 font-semibold">
                error
              </span>
              <span className="min-w-0 text-red-700 dark:text-red-400 break-words">
                {JSON.stringify(e.payload).slice(0, 300)}
              </span>
            </div>
          ))}
          {events.length === 1 && screenshotEvent && (
            <div className="text-xs text-muted-foreground italic">Screenshot only.</div>
          )}
        </div>
      </div>
    </div>
  );
}
