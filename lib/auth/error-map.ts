import { t, type Locale, type StringKey } from '@/lib/i18n/strings';

/**
 * Map a Supabase Auth error to a friendly, localised message.
 *
 * Supabase returns machine-style messages ("Request rate limit reached",
 * "Invalid login credentials", "Email not confirmed") that aren't what we
 * want end-users reading on a login form. This function translates the
 * common cases to human-readable text; anything unrecognised falls back
 * to a generic friendly line so users never see raw error strings.
 *
 * Call with the error object from supabase.auth.signInWithPassword,
 * signInWithOAuth, resetPasswordForEmail, signUp, etc.
 */
export function mapAuthError(
  error: { message?: string; status?: number; code?: string } | null | undefined,
  locale: Locale = 'en',
): string {
  if (!error) return t('auth.genericError', locale);

  const msg = (error.message || '').toLowerCase();
  const status = error.status;
  const code = (error.code || '').toLowerCase();

  // Rate limiting — Supabase returns 429 and messages like
  // "Request rate limit reached", "email rate limit exceeded",
  // "over_email_send_rate_limit", etc.
  if (
    status === 429 ||
    msg.includes('rate limit') ||
    msg.includes('too many requests') ||
    code.includes('over_') ||
    code === 'rate_limit_exceeded'
  ) {
    return t('auth.err.rateLimit', locale);
  }

  // Email not confirmed
  if (msg.includes('email not confirmed') || msg.includes('not_confirmed') || code === 'email_not_confirmed') {
    return t('auth.err.emailNotConfirmed', locale);
  }

  // Invalid credentials (wrong password, wrong email, or account doesn't
  // exist — Supabase deliberately returns the same message for all three
  // to avoid account enumeration attacks).
  if (
    msg.includes('invalid login credentials') ||
    msg.includes('invalid_credentials') ||
    msg.includes('invalid email') ||
    msg.includes('invalid password') ||
    code === 'invalid_credentials'
  ) {
    return t('auth.err.invalidCreds', locale);
  }

  // Network / fetch failures bubble up as TypeError or "Failed to fetch"
  if (msg.includes('failed to fetch') || msg.includes('network') || error.message?.includes('NetworkError')) {
    return t('auth.err.networkIssue', locale);
  }

  // Unrecognised — fall back to the generic friendly message rather than
  // exposing Supabase's raw text to users.
  return t('auth.genericError', locale);
}

/**
 * Same as mapAuthError, but returns the StringKey instead of the resolved
 * string. Useful when the caller wants to apply its own fallback logic.
 */
export function mapAuthErrorKey(
  error: { message?: string; status?: number; code?: string } | null | undefined,
): StringKey {
  if (!error) return 'auth.genericError';

  const msg = (error.message || '').toLowerCase();
  const status = error.status;
  const code = (error.code || '').toLowerCase();

  if (
    status === 429 ||
    msg.includes('rate limit') ||
    msg.includes('too many requests') ||
    code.includes('over_') ||
    code === 'rate_limit_exceeded'
  ) {
    return 'auth.err.rateLimit';
  }
  if (msg.includes('email not confirmed') || msg.includes('not_confirmed') || code === 'email_not_confirmed') {
    return 'auth.err.emailNotConfirmed';
  }
  if (
    msg.includes('invalid login credentials') ||
    msg.includes('invalid_credentials') ||
    msg.includes('invalid email') ||
    msg.includes('invalid password') ||
    code === 'invalid_credentials'
  ) {
    return 'auth.err.invalidCreds';
  }
  if (msg.includes('failed to fetch') || msg.includes('network')) {
    return 'auth.err.networkIssue';
  }
  return 'auth.genericError';
}
