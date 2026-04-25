import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';

/**
 * Unpublish a project from Penworth Store. CEO-107.
 *
 * Soft-unpublish strategy: we do NOT delete store_listings because
 * store_purchases.listing_id has ON DELETE RESTRICT and we never want a
 * writer's withdrawal to break a paying reader's library. The stored
 * procedure flips:
 *   - store_listings.status        live      -> removed
 *   - marketplace_listings.status  active    -> archived
 *   - project_publications.status  published -> unpublished
 *   - projects.status              published -> draft  (project intact, republishable)
 *
 * Authorization (owner / org editor / platform admin) is enforced inside the
 * SECURITY DEFINER function via auth.uid(); we don't repeat it here.
 *
 * Best-effort: also delete the livebook HTML asset from the `livebooks`
 * storage bucket. Failure to delete is logged but does not fail the request
 * — the listing is already withdrawn and the orphaned blob is harmless.
 *
 * POST /api/projects/[id]/unpublish
 */
export async function POST(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id: projectId } = await context.params;

  const { data, error } = await supabase.rpc('unpublish_project_from_store', {
    p_project_id: projectId,
  });

  if (error) {
    const code = error.code || '';
    const status =
      code === '28000' ? 401 :
      code === 'P0002' ? 404 :
      code === '42501' ? 403 :
      400;
    return NextResponse.json({ error: error.message, code }, { status });
  }

  // Best-effort: clean up the livebook HTML so the asset doesn't outlive the listing.
  // Service role required because the livebooks bucket policy is locked down.
  const livebookPath: string | null = (data as { livebook_asset_path?: string | null })?.livebook_asset_path ?? null;
  if (livebookPath) {
    try {
      const service = createServiceClient();
      await service.storage.from('livebooks').remove([livebookPath]);
    } catch (cleanupErr) {
      console.error(
        '[projects/unpublish] livebook cleanup failed (non-fatal):',
        cleanupErr,
        { projectId, livebookPath },
      );
    }
  }

  return NextResponse.json(data);
}
