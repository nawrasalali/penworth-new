import { NextResponse, type NextRequest } from 'next/server';
import { updateSession } from '@/lib/supabase/middleware';

/**
 * Host-based routing:
 *   guild.penworth.ai  -> rewrite /<path> to /guild/<path>  (Guild subdomain)
 *   all other hosts    -> pass through to the default Penworth app
 *
 * The rewrite is internal — the user's address bar still shows guild.penworth.ai.
 */
function routeByHost(request: NextRequest): NextResponse | null {
  const host = (request.headers.get('host') || '').toLowerCase();
  const { pathname, search } = request.nextUrl;

  // Skip rewriting for assets, internal next routes, and all api routes.
  // API routes live at /api/* and are shared across every host — they must
  // never be rewritten to /guild/api/* (which doesn't exist) regardless of host.
  const shouldSkip =
    pathname.startsWith('/_next') ||
    pathname.startsWith('/api/') ||
    pathname.match(/\.(svg|png|jpg|jpeg|gif|webp|ico)$/);

  if (shouldSkip) return null;

  const isGuildHost =
    host === 'guild.penworth.ai' ||
    host.startsWith('guild.') ||
    // Allow a ?guild=1 override for local/preview testing without a subdomain
    request.nextUrl.searchParams.get('guild') === '1';

  if (isGuildHost) {
    // If the request is already targeting /guild, leave it alone
    if (pathname === '/guild' || pathname.startsWith('/guild/')) {
      return null;
    }
    // Rewrite root and all other paths under /guild
    const url = request.nextUrl.clone();
    url.pathname = pathname === '/' ? '/guild' : `/guild${pathname}`;
    return NextResponse.rewrite(url);
  }

  return null;
}

export async function middleware(request: NextRequest) {
  // First, handle host-based rewrites for the Guild subdomain.
  const hostRewrite = routeByHost(request);
  if (hostRewrite) {
    return hostRewrite;
  }
  // Then run the standard Supabase session refresh / protected-route logic.
  return await updateSession(request);
}

export const config = {
  matcher: [
    /*
     * Match all request paths except:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - public folder
     * - api routes that don't need auth
     */
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
