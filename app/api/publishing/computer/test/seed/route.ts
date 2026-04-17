import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';

export const runtime = 'nodejs';

/**
 * POST /api/publishing/computer/test/seed
 *
 * Admin-only. Creates (or reuses) a stub project with completed chapters
 * + canonical publishing metadata so we can drive Penworth Computer
 * against a real row without touching a real book. Returns { projectId }
 * which the /admin/computer/test page passes to the normal
 * /api/publishing/computer/[slug]/start endpoint.
 *
 * Idempotent: calling twice returns the same projectId.
 */

const STUB_TITLE = '[TEST] Penworth Computer Test Book';
const STUB_AUTHOR = 'Penworth Test';

const STUB_CHAPTERS = [
  {
    title: 'Chapter One: The Test Begins',
    order_index: 1,
    content:
      'This is a stub chapter for testing Penworth Computer. It exists only in staging and should never reach a live retailer. If you are reading this on Kobo, please delete the book immediately and flag to the Penworth engineering team.\n\nThe purpose of this test is to verify that the full automation pipeline — Browserbase session creation, Playwright CDP connect, Claude computer-use tool loop, screenshot capture, action dispatch, file upload via setInputFiles, and the 2FA handoff flow — all works end-to-end against a real third-party UI without risking a real book.',
  },
  {
    title: 'Chapter Two: Why We Test',
    order_index: 2,
    content:
      'Publishing automation is fragile. Third-party UIs move buttons. Auth flows add 2FA steps. File validators change MIME-type expectations. Any of these can break a Kobo publish in ways that only surface when real credentials hit real forms.\n\nThis stub book lets us rehearse the full flow as often as we want without wasting a real manuscript. Each run tests: encryption round-trip, DOCX generation, Browserbase session lifecycle, Claude tool-use parsing, and the SSE stream back to the admin UI.',
  },
];

export async function POST() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: profile } = await supabase
    .from('profiles')
    .select('id, is_admin, full_name, email')
    .eq('id', user.id)
    .single();
  if (!profile?.is_admin) {
    return NextResponse.json(
      { error: 'Admin only' },
      { status: 403 },
    );
  }

  // Service client so we bypass RLS when seeding cleanly
  const service = createServiceClient();

  // Reuse existing stub if one exists for this admin
  const { data: existing } = await service
    .from('projects')
    .select('id')
    .eq('user_id', user.id)
    .eq('title', STUB_TITLE)
    .is('deleted_at', null)
    .maybeSingle();

  let projectId: string;
  if (existing) {
    projectId = existing.id;
  } else {
    const { data: project, error: projectErr } = await service
      .from('projects')
      .insert({
        user_id: user.id,
        title: STUB_TITLE,
        status: 'complete',
        content_type: 'nonfiction_book',
      })
      .select('id')
      .single();
    if (projectErr || !project) {
      return NextResponse.json(
        { error: projectErr?.message || 'Failed to create stub project' },
        { status: 500 },
      );
    }
    projectId = project.id;

    // Seed chapters
    for (const ch of STUB_CHAPTERS) {
      await service.from('chapters').insert({
        project_id: projectId,
        title: ch.title,
        order_index: ch.order_index,
        content: ch.content,
        status: 'complete',
      });
    }
  }

  // Ensure publishing_metadata exists. Upsert so repeated seeds self-heal.
  await service
    .from('publishing_metadata')
    .upsert(
      {
        project_id: projectId,
        user_id: user.id,
        title: STUB_TITLE,
        author_name: STUB_AUTHOR,
        author_bio: 'Internal test account for Penworth Computer automation runs.',
        short_description:
          'Automation test manuscript. Not intended for public distribution.',
        long_description:
          'This book exists to exercise the Penworth Computer publishing pipeline end-to-end. Please do not purchase or promote.',
        keywords: ['test', 'automation', 'penworth', 'internal', 'qa'],
        bisac_codes: ['COM000000', 'REF026000', 'BUS070000'],
        price_usd: 0,
        currency: 'USD',
        is_free: true,
        territories: 'worldwide',
        language: 'en',
        audience: 'adult',
        contains_explicit: false,
      },
      { onConflict: 'project_id' },
    );

  return NextResponse.json({ projectId, seeded: !existing });
}
