'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

interface Turn {
  role: 'assistant' | 'user';
  content: string;
  at: string;
}

export default function MentorChat({
  memberName,
  memberStatus,
}: {
  memberName: string;
  memberStatus: string;
}) {
  const router = useRouter();
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState('');
  const [loading, setLoading] = useState(false);
  const [starting, setStarting] = useState(false);
  const [ending, setEnding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [turnsRemaining, setTurnsRemaining] = useState<number | null>(null);
  const [summary, setSummary] = useState<any>(null);
  const endRef = useRef<HTMLDivElement>(null);

  // Auto-start on mount — gives members no extra click
  useEffect(() => {
    if (memberStatus !== 'active' && memberStatus !== 'probation') return;
    start();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [turns]);

  async function start() {
    setStarting(true);
    setError(null);
    try {
      const res = await fetch('/api/guild/agents/mentor/start', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) {
        if (data.existing_checkin_id) {
          // Already checked in this week — the server page will render the
          // completed view on refresh.
          router.refresh();
          return;
        }
        setError(data.error ?? 'Failed to start');
        return;
      }
      setSessionId(data.session_id);
      setTurns(data.turns);
    } catch (e: any) {
      setError(e?.message ?? 'Network error');
    } finally {
      setStarting(false);
    }
  }

  async function sendMessage() {
    if (!sessionId) return;
    const message = draft.trim();
    if (!message) return;
    if (message.length > 4000) {
      setError('Message too long (4000 char max)');
      return;
    }
    setLoading(true);
    setError(null);

    // Optimistically add user turn
    const optimistic: Turn = {
      role: 'user',
      content: message,
      at: new Date().toISOString(),
    };
    setTurns((t) => [...t, optimistic]);
    setDraft('');

    try {
      const res = await fetch('/api/guild/agents/mentor/continue', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ session_id: sessionId, message }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? 'Failed');
        // roll back optimistic turn on error
        setTurns((t) => t.slice(0, -1));
        setDraft(message);
        return;
      }
      setTurns((t) => [
        ...t,
        {
          role: 'assistant',
          content: data.assistant_message,
          at: new Date().toISOString(),
        },
      ]);
      setTurnsRemaining(data.turns_remaining);
    } catch (e: any) {
      setError(e?.message ?? 'Network error');
      setTurns((t) => t.slice(0, -1));
      setDraft(message);
    } finally {
      setLoading(false);
    }
  }

  async function endSession() {
    if (!sessionId) return;
    if (!confirm('End this check-in? You won\'t be able to add more to it.')) return;
    setEnding(true);
    setError(null);
    try {
      const res = await fetch('/api/guild/agents/mentor/end', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ session_id: sessionId }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? 'Failed to end');
        return;
      }
      setSummary(data.summary);
      // Server-side render picks up the new checkin on refresh
      setTimeout(() => router.refresh(), 600);
    } catch (e: any) {
      setError(e?.message ?? 'Network error');
    } finally {
      setEnding(false);
    }
  }

  if (memberStatus !== 'active' && memberStatus !== 'probation') {
    return (
      <div className="rounded-lg border border-neutral-200 bg-neutral-50 px-4 py-6 text-sm text-neutral-600">
        Check-ins are paused for members with status "{memberStatus}".
      </div>
    );
  }

  if (starting) {
    return <Skeleton label={`Greeting you, ${memberName}…`} />;
  }

  return (
    <div className="flex min-h-[500px] flex-col rounded-xl border border-neutral-200 bg-white">
      <div className="flex-1 space-y-4 overflow-y-auto p-5">
        {turns.map((t, i) => (
          <TurnBubble key={i} role={t.role} content={t.content} />
        ))}
        {loading && (
          <TurnBubble role="assistant" content="…" muted />
        )}
        <div ref={endRef} />
      </div>

      {summary && (
        <div className="border-t border-neutral-200 bg-emerald-50 px-5 py-3 text-sm text-emerald-900">
          Saved. Refreshing…
        </div>
      )}

      {error && (
        <div className="border-t border-red-200 bg-red-50 px-5 py-2 text-sm text-red-800">
          {error}
        </div>
      )}

      <div className="border-t border-neutral-200 p-3">
        <div className="mb-2 flex items-center justify-between">
          <div className="text-xs text-neutral-500">
            {turnsRemaining !== null && turnsRemaining >= 0
              ? `${turnsRemaining} turns left this session`
              : '\u00A0'}
          </div>
          <button
            onClick={endSession}
            disabled={
              ending ||
              loading ||
              turns.filter((t) => t.role === 'user').length < 1
            }
            className="text-xs font-medium text-neutral-600 hover:text-neutral-900 disabled:opacity-40"
          >
            {ending ? 'Saving…' : 'End check-in →'}
          </button>
        </div>
        <div className="flex gap-2">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                sendMessage();
              }
            }}
            placeholder="Type your reply… (⌘↵ to send)"
            rows={2}
            disabled={loading || ending || !sessionId}
            className="flex-1 resize-none rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900 placeholder-neutral-400 focus:border-neutral-900 focus:outline-none focus:ring-1 focus:ring-neutral-900 disabled:bg-neutral-50"
            maxLength={4000}
          />
          <button
            onClick={sendMessage}
            disabled={loading || ending || !sessionId || !draft.trim()}
            className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-neutral-800 disabled:cursor-not-allowed disabled:bg-neutral-300"
          >
            Send
          </button>
        </div>
      </div>
    </div>
  );
}

function TurnBubble({
  role,
  content,
  muted,
}: {
  role: 'assistant' | 'user';
  content: string;
  muted?: boolean;
}) {
  const isUser = role === 'user';
  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`max-w-[85%] whitespace-pre-wrap rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${
          isUser
            ? 'bg-neutral-900 text-white'
            : `bg-neutral-100 text-neutral-900 ${muted ? 'opacity-50' : ''}`
        }`}
      >
        {content}
      </div>
    </div>
  );
}

function Skeleton({ label }: { label: string }) {
  return (
    <div className="flex min-h-[500px] items-center justify-center rounded-xl border border-dashed border-neutral-200 bg-neutral-50 text-sm text-neutral-500">
      {label}
    </div>
  );
}
