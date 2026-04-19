/**
 * POST /api/account/delete-request
 *
 * User-facing endpoint. Files a Right-to-Erasure (GDPR Article 17 /
 * equivalents) request on behalf of the authenticated user.
 *
 * This does NOT delete the account immediately. It creates a
 * data_deletion_requests row in status 'received' with a 30-day
 * statutory deadline. An admin fulfils the request via the admin
 * compliance dashboard.
 *
 * Body: {} (no parameters — the user themselves is the subject)
 *
 * Response 201:
 *   {
 *     ok: true,
 *     request_id: uuid,
 *     statutory_deadline: ISO-8601,
 *     message: "Your deletion request has been received..."
 *   }
 *
 * Response 409 if an open request already exists for this user.
 * Response 401 if unauthenticated.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';
import {
  createDeletionRequest,
  inferJurisdictionFromRequest,
} from '@/lib/compliance';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    return await handlePost(request);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[account/delete-request]', message);
    return NextResponse.json({ error: 'internal_error', message }, { status: 500 });
  }
}

async function handlePost(request: NextRequest): Promise<NextResponse> {
  const supabase = await createClient();
  const { data: { user }, error: authErr } = await supabase.auth.getUser();
  if (authErr || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Idempotency: check for an existing open request
  const admin = createServiceClient();
  const { data: existing } = await admin
    .from('data_deletion_requests')
    .select('id, status, statutory_deadline')
    .eq('user_id', user.id)
    .in('status', ['received', 'processing'])
    .order('requested_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (existing) {
    return NextResponse.json(
      {
        error: 'request_already_pending',
        existing_request_id: existing.id,
        existing_status: existing.status,
        existing_deadline: existing.statutory_deadline,
        message:
          'You already have a deletion request in progress. It will be ' +
          'completed before the statutory deadline. No new request is needed.',
      },
      { status: 409 },
    );
  }

  // Pull the user's email from profiles (fall back to auth.users)
  const { data: profile } = await admin
    .from('profiles')
    .select('email')
    .eq('id', user.id)
    .single();
  const userEmail = profile?.email ?? user.email ?? '';

  // IP + UA extraction matches lib/audit.ts pattern
  const xff = request.headers.get('x-forwarded-for') ?? '';
  const clientIp = xff.split(',')[0].trim() || request.headers.get('x-real-ip') || null;

  const result = await createDeletionRequest({
    userId: user.id,
    userEmail,
    source: 'user',
    jurisdiction: inferJurisdictionFromRequest(request),
    ipAddress: clientIp,
    userAgent: request.headers.get('user-agent'),
  });

  if (!result.ok) {
    return NextResponse.json(
      { error: 'failed_to_create_request', message: result.error },
      { status: 500 },
    );
  }

  return NextResponse.json(
    {
      ok: true,
      request_id: result.request.id,
      statutory_deadline: result.request.statutory_deadline,
      message:
        'Your deletion request has been received. Under applicable law, ' +
        'we have 30 days to complete it. You will receive an email ' +
        'confirmation once your data has been erased.',
    },
    { status: 201 },
  );
}
