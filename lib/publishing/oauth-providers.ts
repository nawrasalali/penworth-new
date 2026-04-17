/**
 * OAuth provider registry for Tier 2 auto-publish platforms.
 *
 * Each entry declares the endpoints + env-var names for client_id/secret.
 * The actual OAuth flow lives in /api/publishing/oauth/[slug]/start|callback
 * and reads from this registry so adding a new platform = adding a row here
 * + wiring its upload API.
 *
 * Security model:
 *   - client_id/secret: server-only env vars, never exposed to the browser
 *   - `state`: signed, single-use, bound to user + slug, expires in 10 min
 *   - `code` exchanged server-side over POST
 *   - tokens encrypted via lib/publishing/credentials.ts before DB write
 */

export interface OAuthProvider {
  slug: string;
  displayName: string;
  authorizeUrl: string;
  tokenUrl: string;
  scopes: string[];
  /** Env var holding the OAuth client ID */
  clientIdEnv: string;
  /** Env var holding the OAuth client secret */
  clientSecretEnv: string;
  /**
   * If true, the token endpoint expects client credentials in the
   * Authorization header (HTTP Basic). Otherwise they go in the form body.
   */
  useBasicAuthForTokenExchange: boolean;
  /** How we parse the token response into the encrypted payload. */
  tokenResponseShape: 'oauth2_bearer';
}

export const OAUTH_PROVIDERS: Record<string, OAuthProvider> = {
  draft2digital: {
    slug: 'draft2digital',
    displayName: 'Draft2Digital',
    authorizeUrl: 'https://www.draft2digital.com/api/v2/oauth/authorize',
    tokenUrl: 'https://www.draft2digital.com/api/v2/oauth/token',
    scopes: ['books.write'],
    clientIdEnv: 'DRAFT2DIGITAL_CLIENT_ID',
    clientSecretEnv: 'DRAFT2DIGITAL_CLIENT_SECRET',
    useBasicAuthForTokenExchange: true,
    tokenResponseShape: 'oauth2_bearer',
  },
  gumroad: {
    slug: 'gumroad',
    displayName: 'Gumroad',
    authorizeUrl: 'https://gumroad.com/oauth/authorize',
    tokenUrl: 'https://api.gumroad.com/oauth/token',
    scopes: ['edit_products'],
    clientIdEnv: 'GUMROAD_CLIENT_ID',
    clientSecretEnv: 'GUMROAD_CLIENT_SECRET',
    useBasicAuthForTokenExchange: false,
    tokenResponseShape: 'oauth2_bearer',
  },
};

export function getOAuthProvider(slug: string): OAuthProvider | null {
  return OAUTH_PROVIDERS[slug] || null;
}

/**
 * Token payload that gets encrypted and stored in publishing_credentials.
 * Always a superset of RFC 6749 §5.1. We keep `scope` so we know what
 * permissions we actually received.
 */
export interface StoredOAuthToken {
  access_token: string;
  refresh_token?: string | null;
  token_type: string;
  expires_at?: number | null; // unix seconds
  scope?: string | null;
  obtained_at: number;
}
