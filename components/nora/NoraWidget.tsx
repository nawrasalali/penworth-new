'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { MessageCircle, X, Send, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { NoraSurface } from '@/lib/nora/types';

/**
 * Phase 2.5 Item 3 Commit 8 — NoraWidget.
 *
 * Client-side support-assistant UI. Mounted per-surface by layout
 * files (Commit 9). Orchestrates:
 *   - floating 56px FAB bottom-right
 *   - ⌘K / Ctrl+K toggle
 *   - 400×600 expanded panel with message list + input
 *   - POST /api/nora/conversation/start on first open
 *   - POST /api/nora/conversation/turn on each send
 *   - 429 rate-limit rendering
 *   - 403 nora_unavailable (hides widget silently)
 *   - client_refresh_required action — toast + reload
 *
 * Surface detection:
 *   Server decides user_role; client just passes the right surface
 *   string. Three sources, in priority order:
 *     1. Explicit prop (layout file mounts with surface='guild' etc.)
 *     2. PENWORTH_SURFACE env var at build time via NEXT_PUBLIC prefix
 *     3. hostname inspection as runtime fallback
 *   Layouts should pass the prop explicitly to avoid drift.
 *
 * Hidden paths:
 *   Never renders on /login, /signup, /reset-password, /forgot-password.
 *   These are auth-free surfaces — Nora has no context.
 */

interface NoraMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
  matched_pattern?: { slug: string; title: string } | null;
}

interface ApiTurnResponse {
  assistant_message?: string;
  tool_calls?: Array<{ name: string; input: unknown; result: unknown }>;
  matched_pattern?: { slug: string; title: string } | null;
  client_action?: 'client_refresh_required' | null;
  error?: string;
  message?: string;
  resets_at?: string;
}

interface ApiStartResponse {
  conversation_id?: string;
  welcome_message?: string;
  error?: string;
  message?: string;
}

const HIDDEN_PATHS = [
  '/login',
  '/signup',
  '/reset-password',
  '/forgot-password',
  '/auth/callback',
];

export interface NoraWidgetProps {
  /**
   * Which surface this widget represents. Layout files pass this
   * explicitly. If absent, the widget does runtime hostname detection.
   */
  surface?: NoraSurface;
}

export function NoraWidget({ surface: surfaceProp }: NoraWidgetProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<NoraMessage[]>([]);
  const [input, setInput] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [isStarting, setIsStarting] = useState(false);
  const [mountDenied, setMountDenied] = useState(false);
  const [pathHidden, setPathHidden] = useState(false);
  const [surface, setSurface] = useState<NoraSurface>(surfaceProp ?? 'author');

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // --- Surface detection + path hiding (client-only) ------------------------
  useEffect(() => {
    if (typeof window === 'undefined') return;

    // Resolve surface if no prop given
    if (!surfaceProp) {
      const host = window.location.hostname;
      const envSurface =
        typeof process !== 'undefined'
          ? (process.env.NEXT_PUBLIC_PENWORTH_SURFACE as
              | NoraSurface
              | undefined)
          : undefined;

      let resolved: NoraSurface = 'author';
      if (envSurface) {
        resolved = envSurface;
      } else if (host.startsWith('guild.')) {
        resolved = 'guild';
      } else if (host.startsWith('store.')) {
        resolved = 'store';
      }
      // Admin path wins over host inference
      if (window.location.pathname.startsWith('/admin')) {
        resolved = 'admin';
      }
      setSurface(resolved);
    }

    // Path-based hiding
    const path = window.location.pathname;
    const hidden = HIDDEN_PATHS.some((p) => path.startsWith(p));
    setPathHidden(hidden);
  }, [surfaceProp]);

  // --- Keyboard shortcut: ⌘K / Ctrl+K ---------------------------------------
  useEffect(() => {
    if (pathHidden || mountDenied) return;
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setIsOpen((prev) => !prev);
      }
      if (e.key === 'Escape' && isOpen) {
        setIsOpen(false);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [isOpen, pathHidden, mountDenied]);

  // --- Autoscroll -----------------------------------------------------------
  useEffect(() => {
    if (isOpen && messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, isOpen]);

  // --- Start conversation on first open -------------------------------------
  const ensureConversation = useCallback(async (): Promise<string | null> => {
    if (conversationId) return conversationId;
    setIsStarting(true);
    try {
      const res = await fetch('/api/nora/conversation/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ surface }),
      });
      const body = (await res.json()) as ApiStartResponse;

      if (res.status === 403 && body.error === 'nora_unavailable') {
        // Terminated/resigned Guildmember with no admin flag. Hide
        // widget entirely. No toast — this is a product boundary,
        // not an error.
        setMountDenied(true);
        setIsOpen(false);
        return null;
      }
      if (!res.ok || !body.conversation_id) {
        toast.error(body.message ?? body.error ?? 'Could not start Nora.');
        return null;
      }

      setConversationId(body.conversation_id);
      setMessages([
        {
          id: `welcome-${Date.now()}`,
          role: 'assistant',
          content: body.welcome_message ?? '',
          timestamp: new Date().toISOString(),
        },
      ]);
      return body.conversation_id;
    } catch (err) {
      console.error('[NoraWidget] /start failed:', err);
      toast.error('Could not reach Nora. Check your connection.');
      return null;
    } finally {
      setIsStarting(false);
    }
  }, [conversationId, surface]);

  const handleToggle = useCallback(async () => {
    const next = !isOpen;
    setIsOpen(next);
    if (next && !conversationId) {
      await ensureConversation();
      // Focus input after start resolves
      setTimeout(() => inputRef.current?.focus(), 100);
    } else if (next) {
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [isOpen, conversationId, ensureConversation]);

  // --- Send a turn ----------------------------------------------------------
  const handleSend = useCallback(async () => {
    const userMessage = input.trim();
    if (!userMessage || isSending) return;

    const convId = await ensureConversation();
    if (!convId) return;

    // Optimistic user message
    const userTurn: NoraMessage = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: userMessage,
      timestamp: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, userTurn]);
    setInput('');
    setIsSending(true);

    try {
      const res = await fetch('/api/nora/conversation/turn', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          conversation_id: convId,
          user_message: userMessage,
        }),
      });
      const body = (await res.json()) as ApiTurnResponse;

      if (res.status === 429) {
        toast.error(body.message ?? 'Daily Nora limit reached. Try again later.');
        // Still show the rate-limit message as an assistant turn for clarity
        setMessages((prev) => [
          ...prev,
          {
            id: `rate-${Date.now()}`,
            role: 'assistant',
            content:
              body.message ??
              "You've reached the daily Nora limit. It resets in 24 hours.",
            timestamp: new Date().toISOString(),
          },
        ]);
        return;
      }

      if (res.status === 403 && body.error === 'nora_unavailable') {
        setMountDenied(true);
        setIsOpen(false);
        return;
      }

      if (res.status === 410 && body.error === 'conversation_closed') {
        toast.info('That conversation was closed. Starting a new one.');
        setConversationId(null);
        setMessages([]);
        return;
      }

      if (!res.ok || !body.assistant_message) {
        toast.error(body.message ?? body.error ?? 'Nora hit a snag.');
        return;
      }

      setMessages((prev) => [
        ...prev,
        {
          id: `assistant-${Date.now()}`,
          role: 'assistant',
          content: body.assistant_message!,
          timestamp: new Date().toISOString(),
          matched_pattern: body.matched_pattern ?? null,
        },
      ]);

      // refresh_session tool signalled client reload
      if (body.client_action === 'client_refresh_required') {
        toast.info('Refreshing your session…');
        setTimeout(() => window.location.reload(), 800);
      }
    } catch (err) {
      console.error('[NoraWidget] /turn failed:', err);
      toast.error('Could not reach Nora. Check your connection.');
    } finally {
      setIsSending(false);
      // Re-focus input for the next turn
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [input, isSending, ensureConversation]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void handleSend();
    }
  };

  // --- Render gates ---------------------------------------------------------
  if (pathHidden || mountDenied) return null;

  return (
    <>
      {/* Floating trigger button */}
      {!isOpen && (
        <button
          type="button"
          onClick={handleToggle}
          className={cn(
            'fixed bottom-6 right-6 z-50',
            'h-14 w-14 rounded-full',
            'bg-primary text-primary-foreground shadow-lg',
            'hover:bg-primary/90 hover:shadow-xl',
            'focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
            'transition-all',
            'flex items-center justify-center',
          )}
          aria-label="Open Nora support chat"
        >
          <MessageCircle className="h-6 w-6" />
        </button>
      )}

      {/* Expanded panel */}
      {isOpen && (
        <div
          className={cn(
            'fixed bottom-6 right-6 z-50',
            'w-[400px] max-w-[calc(100vw-3rem)]',
            'h-[600px] max-h-[calc(100vh-3rem)]',
            'bg-background border border-border rounded-lg shadow-2xl',
            'flex flex-col overflow-hidden',
          )}
          role="dialog"
          aria-label="Nora support chat"
        >
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-muted/30">
            <div className="flex items-center gap-2">
              <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center">
                <MessageCircle className="h-4 w-4 text-primary" />
              </div>
              <div>
                <div className="text-sm font-medium">Nora</div>
                <div className="text-xs text-muted-foreground">
                  Penworth support · {surface}
                </div>
              </div>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setIsOpen(false)}
              aria-label="Close Nora"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>

          {/* Message list */}
          <div className="flex-1 overflow-y-auto p-4 space-y-3">
            {isStarting && messages.length === 0 && (
              <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
                Connecting…
              </div>
            )}
            {messages.map((msg) => (
              <MessageBubble key={msg.id} message={msg} />
            ))}
            {isSending && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground pl-2">
                <Loader2 className="h-3 w-3 animate-spin" />
                <span>Nora is typing…</span>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Input */}
          <div className="border-t border-border p-3">
            <div className="flex gap-2 items-end">
              <textarea
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Ask Nora…"
                rows={1}
                disabled={isSending || isStarting}
                className={cn(
                  'flex-1 resize-none rounded-md border border-input bg-background px-3 py-2',
                  'text-sm placeholder:text-muted-foreground',
                  'focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-0',
                  'disabled:opacity-50',
                  'max-h-32',
                )}
                style={{ fieldSizing: 'content' } as React.CSSProperties}
              />
              <Button
                type="button"
                size="sm"
                onClick={() => void handleSend()}
                disabled={!input.trim() || isSending || isStarting}
                aria-label="Send message"
              >
                {isSending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Send className="h-4 w-4" />
                )}
              </Button>
            </div>
            <div className="text-[10px] text-muted-foreground mt-2 px-1">
              Enter to send · Shift+Enter for newline · Esc to close · ⌘K to toggle
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// -----------------------------------------------------------------------------
// MessageBubble — kept in same file; it's a tight helper with no reuse case
// -----------------------------------------------------------------------------

function MessageBubble({ message }: { message: NoraMessage }) {
  const isUser = message.role === 'user';
  return (
    <div
      className={cn('flex', isUser ? 'justify-end' : 'justify-start')}
    >
      <div
        className={cn(
          'max-w-[85%] rounded-lg px-3 py-2 text-sm whitespace-pre-wrap',
          isUser
            ? 'bg-primary text-primary-foreground'
            : 'bg-muted text-foreground',
        )}
      >
        {message.content}
        {message.matched_pattern && (
          <div className="mt-2 pt-2 border-t border-border/20 text-[10px] opacity-70">
            pattern: {message.matched_pattern.title}
          </div>
        )}
      </div>
    </div>
  );
}
