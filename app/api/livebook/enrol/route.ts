import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';

/**
 * POST /api/livebook/enrol
 *
 * CEO-166 Phase 2 — author opts a listing into the Livebook image library.
 *
 * Body: { listing_id: uuid, style: string }
 *
 * Returns 200 on success: { ok: true, job_id, credits_charged, new_balance }
 * Returns 4xx with { ok: false, reason } on validation/business failure.
 *
 * Auth: requires the user to be signed in. Ownership of the listing is
 * enforced INSIDE the SQL function (enrol_listing_in_livebook), which
 * also handles the atomic credit debit + audit + queue-row creation.
 *
 * After a successful enrolment, the publish flow's matcher will be
 * triggered on first publish (see app/api/publishing/penworth-store/route.ts).
 * If the listing is ALREADY published when enrolment happens (the author
 * publishes first, then enrols), this endpoint also kicks off the matcher
 * fire-and-forget so the author doesn't have to re-publish.
 */
export async function POST(req: NextRequest) {
  // 1. Identify the caller via the user-scoped cookie client.
  const userClient = await createClient();
  const {
    data: { user },
    error: userErr,
  } = await userClient.auth.getUser();
  if (userErr || !user) {
    return NextResponse.json(
      { ok: false, reason: 'unauthenticated' },
      { status: 401 },
    );
  }

  // 2. Validate body.
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { ok: false, reason: 'invalid_json' },
      { status: 400 },
    );
  }
  const listingId = (body as { listing_id?: unknown })?.listing_id;
  const style = (body as { style?: unknown })?.style;
  if (typeof listingId !== 'string' || typeof style !== 'string') {
    return NextResponse.json(
      { ok: false, reason: 'missing_fields' },
      { status: 400 },
    );
  }

  // 3. Atomic enrolment via SQL function (service-role to bypass RLS;
  //    ownership/balance/idempotency are enforced INSIDE the function).
  const svc = createServiceClient();
  const { data, error } = await svc.rpc('enrol_listing_in_livebook', {
    p_listing_id: listingId,
    p_style: style,
    p_user_id: user.id,
  });

  if (error) {
    console.error('[livebook/enrol] RPC failed:', error);
    return NextResponse.json(
      { ok: false, reason: 'rpc_error', detail: error.message },
      { status: 500 },
    );
  }

  // The RPC returns jsonb. supabase-js returns it as a JS object.
  const result = data as {
    ok: boolean;
    reason?: string;
    job_id?: string;
    credits_charged?: number;
    new_balance?: number;
    balance?: number;
    required?: number;
  };

  if (!result.ok) {
    // Map function reason codes to appropriate HTTP statuses.
    const statusByReason: Record<string, number> = {
      unknown_style: 400,
      style_inactive: 400,
      missing_fields: 400,
      user_not_found: 404,
      listing_not_found: 404,
      not_owner: 403,
      already_enrolled: 409,
      insufficient_credits: 402,
    };
    const status = statusByReason[result.reason ?? ''] ?? 400;
    return NextResponse.json(result, { status });
  }

  // 4. If the listing is already published (publish_status='published'),
  //    fire the matcher now — the author won't be re-publishing. If it's
  //    still draft, the matcher fires automatically on first publish via
  //    the existing publish-handler integration (commit 8d700c5).
  try {
    const { data: listingState } = await svc
      .from('store_listings')
      .select('status')
      .eq('id', listingId)
      .maybeSingle();
    const isPublished =
      listingState?.status === 'live' ||
      listingState?.status === 'published';
    if (isPublished) {
      const adminSecret = process.env.ADMIN_SECRET;
      if (!adminSecret) {
        console.error(
          '[livebook/enrol] ADMIN_SECRET not set — enrolled but matcher not kicked off for listing',
          listingId,
        );
      } else {
        const matchUrl =
          'https://lodupspxdvadamrqvkje.supabase.co/functions/v1/admin-match-livebook-images';
        // Fire-and-forget: matcher takes 30+ seconds; don't block the
        // response.
        void fetch(matchUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-admin-secret': adminSecret,
          },
          body: JSON.stringify({
            listing_id: listingId,
            job_id: result.job_id,
          }),
        })
          .then(async (res) => {
            if (!res.ok) {
              console.error(
                '[livebook/enrol] Matcher trigger non-OK',
                res.status,
                (await res.text()).slice(0, 200),
              );
            }
          })
          .catch((err) => {
            console.error('[livebook/enrol] Matcher trigger failed:', err);
          });
      }
    }
  } catch (e) {
    // Best-effort — never let the post-success matcher kick interfere
    // with the success response.
    console.error('[livebook/enrol] post-success matcher kick failed:', e);
  }

  return NextResponse.json(result, { status: 200 });
}
