import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

/**
 * GET /api/livebook/styles
 *
 * Returns the list of active Livebook visual styles for the publish-modal
 * style picker. Public-readable per RLS policy livebook_styles_select_public,
 * so the user-scoped client is fine — no service-role bypass needed.
 *
 * Response: { styles: LivebookStyle[] }
 *
 * The styles table is small (2 rows in Phase 0, growing to 6 in Phase 3) and
 * changes rarely, so this endpoint deliberately does no caching at the
 * application layer — Vercel's edge cache + the publish-modal lazy-load
 * pattern give us all the throughput we need.
 */

export const revalidate = 60; // cache 60s at the edge

export async function GET() {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('livebook_styles')
    .select(
      'slug, display_name, description, sample_thumbnail_urls, price_credits, is_active, library_size, recommended_genres, display_order',
    )
    .eq('is_active', true)
    .order('display_order', { ascending: true });

  if (error) {
    console.error('[livebook/styles] query failed:', error);
    return NextResponse.json({ styles: [], error: 'failed_to_load' }, { status: 500 });
  }

  return NextResponse.json({ styles: data ?? [] });
}
