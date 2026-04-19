import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { createServiceClient } from './service';

export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get(name: string) {
          return cookieStore.get(name)?.value;
        },
        set(name: string, value: string, options: CookieOptions) {
          try {
            cookieStore.set({ name, value, ...options });
          } catch (error) {
            // Handle cookies in Server Components
          }
        },
        remove(name: string, options: CookieOptions) {
          try {
            cookieStore.set({ name, value: '', ...options });
          } catch (error) {
            // Handle cookies in Server Components
          }
        },
      },
    }
  );
}

/**
 * @deprecated Use `createServiceClient` from '@/lib/supabase/service' instead.
 *
 * This wrapper remains for backwards compatibility with 38+ existing
 * call sites. It now delegates to createServiceClient internally, so
 * every caller automatically gets the correct true-service-role behaviour
 * without needing an import swap.
 *
 * BACKGROUND
 * ----------
 * The original implementation used @supabase/ssr's createServerClient
 * with noop cookies and a service-role key. That library is designed
 * for SSR-authenticated requests and has documented edge cases where
 * the user's session cookie can still override the Authorization header,
 * making the "service role" call subject to RLS scoped to the current
 * user. In routes where the authenticated user happens to satisfy the
 * RLS policy (e.g. admin with is_admin=true), the bug is invisible —
 * the query returns the right rows. In routes where the policy checks
 * something else, it silently returns the wrong rows.
 *
 * The /api/admin/compliance/requests/[kind]/[id] PATCH endpoint hit
 * this in an adjacent way (commit 16df46c): the 404 wasn't actually
 * RLS-related there, but the fix prompted a closer look at every
 * admin route. The findings are recorded in prior session notes.
 *
 * createServiceClient uses raw @supabase/supabase-js createClient with
 * the service-role key — unconditional RLS bypass, no cookie interference.
 * New code should import it directly:
 *
 *   import { createServiceClient } from '@/lib/supabase/service';
 *
 * Existing callers of createAdminClient get the corrected behaviour
 * automatically via this delegation. Over time, migrate imports to
 * createServiceClient and remove this wrapper.
 */
export function createAdminClient() {
  return createServiceClient();
}
