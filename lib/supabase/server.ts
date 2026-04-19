import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { cookies } from 'next/headers';

/**
 * User-scoped Supabase client bound to the current request's cookies.
 *
 * Use this for any query/mutation that should be subject to RLS
 * policies scoped to the authenticated user — dashboards, personal
 * settings, row reads that should return the user's own data.
 *
 * For true service-role bypass (admin operations, cron jobs,
 * cross-user aggregation), import `createServiceClient` from
 * '@/lib/supabase/service' directly.
 *
 * The former `createAdminClient()` wrapper that lived in this file
 * was removed after all 53 callers were migrated to
 * createServiceClient. See commit history for the migration rationale.
 */
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
