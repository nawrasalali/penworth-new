/**
 * Fire-and-forget client-side auth error telemetry.
 *
 * Writes a row to public.auth_client_errors so the CEO / admin console can
 * see what's actually failing for users without bouncing screenshots around.
 * Email is sha256-hashed before sending — we never store raw addresses in
 * this table.
 *
 * The "fire and forget" part matters: this MUST NEVER throw out of the
 * caller's catch path. If telemetry itself fails (network, RLS, etc.) we
 * swallow the error silently — the user's primary error message is what
 * matters, not our logging.
 */
import { createClient } from '@/lib/supabase/client';

export type AuthErrorContext =
  | 'signup'
  | 'login'
  | 'signup_oauth'
  | 'login_oauth'
  | 'forgot_password';

export type AuthErrorKind = 'returned' | 'thrown';

interface AuthErrorPayload {
  context: AuthErrorContext;
  kind: AuthErrorKind;
  email?: string;
  error: unknown;
  meta?: Record<string, unknown>;
}

/** sha256-hash a string, hex-encoded. Browser-only (Web Crypto API). */
async function sha256Hex(input: string): Promise<string> {
  if (typeof window === 'undefined' || !window.crypto?.subtle) return '';
  try {
    const buf = new TextEncoder().encode(input);
    const digest = await window.crypto.subtle.digest('SHA-256', buf);
    return Array.from(new Uint8Array(digest))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  } catch {
    return '';
  }
}

function extractErrorFields(error: unknown): {
  message?: string;
  status?: number;
  code?: string;
} {
  if (!error) return {};
  if (typeof error === 'object') {
    const e = error as { message?: unknown; status?: unknown; code?: unknown };
    return {
      message: typeof e.message === 'string' ? e.message.slice(0, 500) : undefined,
      status: typeof e.status === 'number' ? e.status : undefined,
      code: typeof e.code === 'string' ? e.code.slice(0, 100) : undefined,
    };
  }
  if (typeof error === 'string') return { message: error.slice(0, 500) };
  return {};
}

export async function logAuthError(payload: AuthErrorPayload): Promise<void> {
  try {
    if (typeof window === 'undefined') return;

    const { message, status, code } = extractErrorFields(payload.error);
    const emailHash = payload.email
      ? await sha256Hex(payload.email.trim().toLowerCase())
      : null;

    const supabase = createClient();
    // Best-effort insert. We do NOT await the .then chain — we fire and
    // forget. Any failure (network, RLS, table missing) is swallowed.
    await supabase.from('auth_client_errors').insert({
      context: payload.context,
      email_hash: emailHash || null,
      error_kind: payload.kind,
      message: message ?? null,
      status: status ?? null,
      code: code ?? null,
      user_agent: navigator.userAgent.slice(0, 500),
      url: window.location.href.slice(0, 500),
      meta: payload.meta ?? {},
    });
  } catch {
    // Telemetry must never bubble out of the caller's catch path.
  }
}
