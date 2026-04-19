import { notFound, redirect } from 'next/navigation';
import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';

/**
 * Admin-role types, mirroring profiles_admin_role_check in migration 020.
 * super_admin sees everything; scoped roles see their own panel only.
 */
export type AdminRole =
  | 'super_admin'
  | 'ops_admin'
  | 'finance_admin'
  | 'cs_admin';

/**
 * Gate a server component or server action behind an admin role.
 *
 * Behaviour:
 *   - Unauthenticated → redirect('/login')
 *   - Authenticated but not admin → notFound() (not redirect) so the
 *     route doesn't even acknowledge that /admin/command-center exists
 *     to a non-admin probing URLs
 *   - Admin without the required scope → notFound() same reason
 *   - Admin with the required scope (or super_admin) → returns user
 *
 * The brief flagged that 'admin' is a guessable subdomain and
 * notFound over redirect is the correct posture for guessable paths:
 * it gives a 404 rather than a 302 to /dashboard, which leaks the
 * route's existence.
 *
 * The role check runs server-side via has_admin_role() — the same
 * function the Command Center views use for their RLS WHERE clauses.
 * That means if this middleware ever drifts from view-level access,
 * both paths break together rather than the UI showing data the user
 * shouldn't see.
 */
export async function requireAdminRole(required?: AdminRole): Promise<{
  userId: string;
  email: string;
  fullName: string | null;
  adminRole: AdminRole;
}> {
  const supabase = await createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) {
    redirect('/login');
  }

  // Use service-role for the role check. The user-scoped client could
  // work too (profiles are readable by self under RLS), but service
  // bypass keeps this helper consistent with the RPC-based check and
  // lets us read admin_role even if a future RLS tweak hides it from
  // self-reads.
  const admin = createServiceClient();
  const { data: hasRole, error: rpcErr } = await admin.rpc('has_admin_role', {
    p_user_id: user.id,
    p_required_role: required ?? null,
  });

  if (rpcErr) {
    // Fail closed. Better to 404 a legitimate admin than to let a
    // non-admin through during a transient RPC failure.
    console.error('[requireAdminRole] has_admin_role RPC failed:', rpcErr);
    notFound();
  }

  if (!hasRole) {
    notFound();
  }

  // Load the admin_role + name so the caller can render the header
  // without a second round-trip. Service client again so we don't
  // depend on RLS shape.
  const { data: profile } = await admin
    .from('profiles')
    .select('email, full_name, admin_role')
    .eq('id', user.id)
    .single();

  return {
    userId: user.id,
    email: user.email ?? profile?.email ?? '',
    fullName: profile?.full_name ?? null,
    adminRole: (profile?.admin_role as AdminRole) ?? 'super_admin',
  };
}

/**
 * API route variant — returns a NextResponse on failure rather than
 * redirecting. Use in /api/admin/* handlers where a redirect isn't
 * meaningful.
 *
 * Returns either:
 *   { ok: true, user }   — continue handling the request
 *   { ok: false, response } — return this response directly
 */
export async function requireAdminRoleForApi(
  required?: AdminRole,
): Promise<
  | {
      ok: true;
      userId: string;
      adminRole: AdminRole;
    }
  | {
      ok: false;
      response: NextResponse;
    }
> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return {
      ok: false,
      response: NextResponse.json({ error: 'unauthorized' }, { status: 401 }),
    };
  }

  const admin = createServiceClient();
  const { data: hasRole, error: rpcErr } = await admin.rpc('has_admin_role', {
    p_user_id: user.id,
    p_required_role: required ?? null,
  });

  if (rpcErr || !hasRole) {
    // 404 rather than 403 for the same reason as requireAdminRole.
    return {
      ok: false,
      response: NextResponse.json({ error: 'not_found' }, { status: 404 }),
    };
  }

  const { data: profile } = await admin
    .from('profiles')
    .select('admin_role')
    .eq('id', user.id)
    .single();

  return {
    ok: true,
    userId: user.id,
    adminRole: (profile?.admin_role as AdminRole) ?? 'super_admin',
  };
}
