import crypto from 'crypto';

/**
 * Signed OAuth state.
 *
 * Carries (userId, slug, projectId, nonce, iat) across the provider
 * round-trip without needing a DB lookup. HMAC-SHA256 over the JSON with
 * the server secret, base64url encoded.
 *
 * Expires after 10 minutes (iat enforced in verify).
 *
 * The master key is taken from PENWORTH_CREDENTIAL_KEY so OAuth state is
 * invalidated if that rotates — same failure domain as the encrypted
 * credentials themselves. Fails closed if missing.
 */

const TTL_SECONDS = 600;

function getSecret(): Buffer {
  const key = process.env.PENWORTH_CREDENTIAL_KEY;
  if (!key || key.length < 32) {
    throw new Error('PENWORTH_CREDENTIAL_KEY env var missing or too short');
  }
  // Namespace so this can't be confused with credential encryption
  return crypto.createHmac('sha256', key).update('pw:oauth:state').digest();
}

export interface OAuthState {
  userId: string;
  slug: string;
  projectId?: string | null;
  nonce: string;
  iat: number;
}

function b64urlEncode(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlDecode(s: string): Buffer {
  const pad = 4 - (s.length % 4);
  const padded = pad < 4 ? s + '='.repeat(pad) : s;
  return Buffer.from(padded.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}

export function signOAuthState(payload: Omit<OAuthState, 'nonce' | 'iat'>): string {
  const state: OAuthState = {
    ...payload,
    projectId: payload.projectId || null,
    nonce: crypto.randomBytes(16).toString('hex'),
    iat: Math.floor(Date.now() / 1000),
  };
  const body = Buffer.from(JSON.stringify(state), 'utf8');
  const sig = crypto.createHmac('sha256', getSecret()).update(body).digest();
  return `${b64urlEncode(body)}.${b64urlEncode(sig)}`;
}

export function verifyOAuthState(token: string): OAuthState {
  const [bodyB64, sigB64] = token.split('.');
  if (!bodyB64 || !sigB64) throw new Error('Malformed state');

  const body = b64urlDecode(bodyB64);
  const sig = b64urlDecode(sigB64);
  const expected = crypto.createHmac('sha256', getSecret()).update(body).digest();

  if (sig.length !== expected.length || !crypto.timingSafeEqual(sig, expected)) {
    throw new Error('Invalid state signature');
  }

  const state = JSON.parse(body.toString('utf8')) as OAuthState;
  const ageSec = Math.floor(Date.now() / 1000) - state.iat;
  if (ageSec < 0 || ageSec > TTL_SECONDS) {
    throw new Error('State expired');
  }
  return state;
}
