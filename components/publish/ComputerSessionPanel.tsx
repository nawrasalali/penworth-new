'use client';

import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import {
  X,
  Loader2,
  AlertCircle,
  CheckCircle2,
  KeyRound,
  Bot,
  MousePointer,
  Monitor,
  XCircle,
} from 'lucide-react';

interface Props {
  sessionId: string;
  slug: string;
  platformName: string;
  onClose: () => void;
  onComplete: () => void;
}

type StreamEvent =
  | { type: 'booted'; liveViewUrl?: string; runtimeSessionId?: string }
  | { type: 'screenshot'; turnIndex: number; path?: string }
  | { type: 'action'; turnIndex: number; [k: string]: unknown }
  | { type: 'thought'; turnIndex: number; text?: string }
  | { type: 'handoff'; turnIndex: number; reason?: string; hint?: string }
  | { type: 'complete'; turnIndex: number; summary?: string; result_url?: string }
  | { type: 'error'; turnIndex?: number; message?: string; reason?: string }
  | { type: 'closed'; status?: string };

interface LogEntry {
  kind: 'thought' | 'action' | 'error' | 'system';
  text: string;
  turnIndex?: number;
  timestamp: number;
}

/**
 * Live modal for a running Penworth Computer session. Subscribes to the SSE
 * stream, renders Browserbase's live-view iframe, scrolling event log, and
 * handles the 2FA handoff flow.
 */
export function ComputerSessionPanel({
  sessionId,
  slug,
  platformName,
  onClose,
  onComplete,
}: Props) {
  const [status, setStatus] = useState<
    'connecting' | 'running' | 'awaiting_input' | 'succeeded' | 'failed' | 'cancelled'
  >('connecting');
  const [liveViewUrl, setLiveViewUrl] = useState<string | null>(null);
  const [log, setLog] = useState<LogEntry[]>([]);
  const [handoff, setHandoff] = useState<{ reason: string; hint?: string } | null>(null);
  const [handoffInput, setHandoffInput] = useState('');
  const [handoffBusy, setHandoffBusy] = useState(false);
  const [resultUrl, setResultUrl] = useState<string | null>(null);
  const [finalSummary, setFinalSummary] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const logEndRef = useRef<HTMLDivElement | null>(null);

  // --- Connect SSE on mount ---
  useEffect(() => {
    const source = new EventSource(
      `/api/publishing/computer/${slug}/stream?sessionId=${sessionId}`,
    );

    const appendLog = (entry: Omit<LogEntry, 'timestamp'>) => {
      setLog((prev) => [...prev, { ...entry, timestamp: Date.now() }]);
    };

    const handle = (ev: MessageEvent, type: string) => {
      try {
        const data = JSON.parse(ev.data) as StreamEvent;
        const withType = { ...data, type } as StreamEvent;

        if (withType.type === 'booted') {
          setStatus('running');
          if (withType.liveViewUrl) setLiveViewUrl(withType.liveViewUrl);
          appendLog({ kind: 'system', text: 'Browser launched. Agent warming up...' });
        } else if (withType.type === 'screenshot') {
          // Pure signal — don't clutter the log with every screenshot
        } else if (withType.type === 'action') {
          const act = (withType as unknown as { action?: string }).action;
          const coord = (withType as unknown as { coordinate?: [number, number] }).coordinate;
          const text = (withType as unknown as { text?: string }).text;
          appendLog({
            kind: 'action',
            turnIndex: withType.turnIndex,
            text: [
              act || 'action',
              coord ? `(${coord[0]},${coord[1]})` : '',
              text ? `"${text.slice(0, 60)}"` : '',
            ].filter(Boolean).join(' '),
          });
        } else if (withType.type === 'thought') {
          appendLog({
            kind: 'thought',
            turnIndex: withType.turnIndex,
            text: (withType.text || '').slice(0, 500),
          });
        } else if (withType.type === 'handoff') {
          setStatus('awaiting_input');
          setHandoff({ reason: withType.reason || 'Input needed', hint: withType.hint });
          appendLog({
            kind: 'system',
            turnIndex: withType.turnIndex,
            text: `Agent paused: ${withType.reason}`,
          });
        } else if (withType.type === 'complete') {
          setStatus('succeeded');
          if (withType.result_url) setResultUrl(withType.result_url);
          if (withType.summary) setFinalSummary(withType.summary);
          appendLog({
            kind: 'system',
            turnIndex: withType.turnIndex,
            text: `Done: ${withType.summary || 'task complete'}`,
          });
          onComplete();
        } else if (withType.type === 'error') {
          const msg = withType.message || withType.reason || 'unknown error';
          setErrorMessage(msg);
          appendLog({
            kind: 'error',
            turnIndex: withType.turnIndex,
            text: msg,
          });
        } else if (withType.type === 'closed') {
          const s = withType.status;
          if (s === 'succeeded') setStatus('succeeded');
          else if (s === 'cancelled') setStatus('cancelled');
          else setStatus((prev) => (prev === 'succeeded' ? 'succeeded' : 'failed'));
          source.close();
        }
      } catch (err) {
        console.error('Bad SSE payload', err);
      }
    };

    // EventSource delivers each named event on its own listener
    for (const t of ['booted', 'screenshot', 'action', 'thought', 'handoff', 'complete', 'error', 'closed']) {
      source.addEventListener(t, (e) => handle(e as MessageEvent, t));
    }
    source.onerror = () => {
      // If we got a terminal event first, status already reflects it; else mark failed
      setStatus((prev) => (prev === 'succeeded' || prev === 'cancelled' ? prev : 'failed'));
      source.close();
    };

    return () => {
      source.close();
    };
  }, [sessionId, slug, onComplete]);

  // Autoscroll the log
  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [log]);

  const submitHandoff = async () => {
    if (!handoffInput.trim()) return;
    setHandoffBusy(true);
    try {
      const resp = await fetch(`/api/publishing/computer/session/${sessionId}/resolve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ response: handoffInput.trim() }),
      });
      const data = await resp.json();
      if (!resp.ok) {
        toast.error(data.error || 'Failed to send');
        return;
      }
      setHandoff(null);
      setHandoffInput('');
      setStatus('running');
    } catch {
      toast.error('Failed to send');
    } finally {
      setHandoffBusy(false);
    }
  };

  const cancel = async () => {
    if (!confirm('Stop the agent? The current session will be abandoned.')) return;
    try {
      await fetch(`/api/publishing/computer/session/${sessionId}/resolve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cancel: true }),
      });
      setStatus('cancelled');
    } catch {
      toast.error('Cancel failed');
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <div className="bg-background rounded-2xl shadow-2xl w-full max-w-6xl h-[85vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b">
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-lg bg-primary/10 flex items-center justify-center">
              <Bot className="h-5 w-5 text-primary" />
            </div>
            <div>
              <div className="font-semibold">Penworth Computer · {platformName}</div>
              <div className="text-xs text-muted-foreground">
                <StatusChip status={status} />
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {(status === 'running' || status === 'awaiting_input') && (
              <button
                onClick={cancel}
                className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold border hover:bg-red-50 hover:text-red-700 dark:hover:bg-red-950/30"
              >
                <XCircle className="h-3.5 w-3.5" /> Cancel
              </button>
            )}
            <button
              onClick={onClose}
              className="p-2 rounded-lg hover:bg-muted"
              aria-label="Close"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 flex min-h-0">
          {/* Live view */}
          <div className="flex-1 bg-black/90 relative">
            {liveViewUrl ? (
              <iframe
                src={liveViewUrl}
                className="w-full h-full"
                sandbox="allow-same-origin allow-scripts allow-forms"
              />
            ) : (
              <div className="h-full flex flex-col items-center justify-center text-muted-foreground gap-3">
                <Monitor className="h-12 w-12 opacity-40" />
                <div className="text-sm">
                  {status === 'connecting'
                    ? 'Spinning up a secure browser...'
                    : 'Live view unavailable for this runtime.'}
                </div>
                {status === 'connecting' && <Loader2 className="h-4 w-4 animate-spin" />}
              </div>
            )}
          </div>

          {/* Side panel — log + handoff + result */}
          <div className="w-96 border-l flex flex-col min-h-0">
            <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2 text-sm">
              {log.length === 0 && (
                <div className="text-xs text-muted-foreground italic pt-2">
                  Waiting for the agent to begin...
                </div>
              )}
              {log.map((entry, i) => (
                <LogItem key={i} entry={entry} />
              ))}
              <div ref={logEndRef} />
            </div>

            {/* Handoff input */}
            {handoff && (
              <div className="border-t bg-amber-500/10 p-4 space-y-3">
                <div className="flex items-start gap-2">
                  <KeyRound className="h-4 w-4 text-amber-600 mt-0.5 shrink-0" />
                  <div className="min-w-0">
                    <div className="font-semibold text-sm">Agent needs your input</div>
                    <div className="text-xs text-muted-foreground mt-0.5">{handoff.reason}</div>
                    {handoff.hint && (
                      <div className="text-xs text-muted-foreground mt-1 italic">
                        Hint: {handoff.hint}
                      </div>
                    )}
                  </div>
                </div>
                <input
                  value={handoffInput}
                  onChange={(e) => setHandoffInput(e.target.value)}
                  placeholder="Your answer..."
                  className="w-full px-3 py-2 border rounded-lg bg-background text-sm"
                  autoFocus
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !handoffBusy && handoffInput.trim()) submitHandoff();
                  }}
                />
                <button
                  onClick={submitHandoff}
                  disabled={handoffBusy || !handoffInput.trim()}
                  className="w-full inline-flex items-center justify-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                >
                  {handoffBusy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                  Send to agent
                </button>
              </div>
            )}

            {/* Terminal result footer */}
            {status === 'succeeded' && (
              <div className="border-t bg-emerald-500/10 p-4 space-y-2">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                  <div className="font-semibold text-sm">Published</div>
                </div>
                {finalSummary && (
                  <p className="text-xs text-muted-foreground">{finalSummary}</p>
                )}
                {resultUrl && (
                  <a
                    href={resultUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center text-xs font-semibold text-emerald-700 dark:text-emerald-400 hover:underline"
                  >
                    View on {platformName} →
                  </a>
                )}
              </div>
            )}
            {(status === 'failed' || (status === 'cancelled' && errorMessage)) && (
              <div className="border-t bg-red-500/10 p-4">
                <div className="flex items-center gap-2 mb-1">
                  <AlertCircle className="h-4 w-4 text-red-600" />
                  <div className="font-semibold text-sm">
                    {status === 'cancelled' ? 'Cancelled' : 'Failed'}
                  </div>
                </div>
                {errorMessage && (
                  <p className="text-xs text-muted-foreground">{errorMessage}</p>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function StatusChip({ status }: { status: string }) {
  const map: Record<string, { label: string; tone: string }> = {
    connecting: { label: 'Connecting', tone: 'text-muted-foreground' },
    running: { label: 'Running', tone: 'text-sky-700 dark:text-sky-400' },
    awaiting_input: { label: 'Awaiting input', tone: 'text-amber-700 dark:text-amber-500' },
    succeeded: { label: 'Succeeded', tone: 'text-emerald-700 dark:text-emerald-400' },
    failed: { label: 'Failed', tone: 'text-red-700 dark:text-red-400' },
    cancelled: { label: 'Cancelled', tone: 'text-muted-foreground' },
  };
  const cfg = map[status] || { label: status, tone: 'text-muted-foreground' };
  return <span className={cfg.tone}>{cfg.label}</span>;
}

function LogItem({ entry }: { entry: LogEntry }) {
  const iconMap = {
    thought: <Bot className="h-3.5 w-3.5 text-primary/60 shrink-0 mt-0.5" />,
    action: <MousePointer className="h-3.5 w-3.5 text-sky-600 shrink-0 mt-0.5" />,
    error: <AlertCircle className="h-3.5 w-3.5 text-red-600 shrink-0 mt-0.5" />,
    system: <Monitor className="h-3.5 w-3.5 text-muted-foreground shrink-0 mt-0.5" />,
  };
  const toneMap = {
    thought: 'text-foreground',
    action: 'text-sky-700 dark:text-sky-400 font-mono text-xs',
    error: 'text-red-700 dark:text-red-400',
    system: 'text-muted-foreground',
  };
  return (
    <div className="flex items-start gap-2 text-sm">
      {iconMap[entry.kind]}
      <div className={`min-w-0 flex-1 ${toneMap[entry.kind]}`}>
        {entry.turnIndex != null && (
          <span className="text-[10px] text-muted-foreground mr-1.5">#{entry.turnIndex}</span>
        )}
        {entry.text}
      </div>
    </div>
  );
}
