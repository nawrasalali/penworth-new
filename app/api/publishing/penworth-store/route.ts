import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

/**
 * Publish a completed project to Penworth Store (the 17th platform Penworth
 * owns fully). Unlike external platforms which only generate submission
 * guides, this one actually lists the book live in the marketplace.
 *
 * Flow:
 *   1. Verify ownership + project has at least one complete chapter
 *   2. Look up the 'penworth' platform row
 *   3. Upsert a project_publications row with status='published'
 *   4. Upsert a marketplace_listing making the book discoverable
 *   5. Return the external_url pointing at /marketplace/[id]
 *
 * Idempotent: calling twice updates the existing rows instead of creating
 * duplicates.
 */
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { projectId, priceUsd, description, licenseType } = await request.json();
  if (!projectId) {
    return NextResponse.json({ error: 'projectId required' }, { status: 400 });
  }

  // Verify ownership and load project with chapters
  const { data: project, error: projectErr } = await supabase
    .from('projects')
    .select(`
      id, user_id, title, description, content_type, status,
      chapters(id, title, content, word_count, status, order_index)
    `)
    .eq('id', projectId)
    .eq('user_id', user.id)
    .single();

  if (projectErr || !project) {
    return NextResponse.json({ error: 'Project not found' }, { status: 404 });
  }

  const completeChapters = (project.chapters || []).filter((c: any) => c.status === 'complete');
  if (completeChapters.length === 0) {
    return NextResponse.json(
      { error: 'Project has no completed chapters. Finish writing before publishing.' },
      { status: 400 },
    );
  }

  // Load the session for cover + author info
  const { data: session } = await supabase
    .from('interview_sessions')
    .select('id, author_name, about_author, front_cover_url, back_cover_url, book_title')
    .eq('project_id', projectId)
    .eq('user_id', user.id)
    .single();

  // Look up the Penworth platform row
  const { data: platform, error: platformErr } = await supabase
    .from('publishing_platforms')
    .select('id, slug')
    .eq('slug', 'penworth')
    .single();

  if (platformErr || !platform) {
    return NextResponse.json(
      { error: 'Penworth Store platform row missing — contact support' },
      { status: 500 },
    );
  }

  // Compute listing metadata
  const totalWords = completeChapters.reduce((s: number, c: any) => s + (c.word_count || 0), 0);
  const chapterCount = completeChapters.length;
  const firstChapterContent = completeChapters.sort((a: any, b: any) => a.order_index - b.order_index)[0]?.content || '';
  const sampleContent = firstChapterContent.slice(0, 2000);
  const listingTitle = session?.book_title || project.title;
  const listingDescription = description || project.description || `A ${project.content_type} by ${session?.author_name || 'Penworth author'}`;
  const coverUrl = session?.front_cover_url || null;
  const priceCents = typeof priceUsd === 'number' && priceUsd > 0 ? Math.round(priceUsd * 100) : 0;
  const isFreeTier = priceCents === 0;

  // ---------- UPSERT marketplace_listing ----------
  // Check if one already exists for this project
  const { data: existingListing } = await supabase
    .from('marketplace_listings')
    .select('id')
    .eq('project_id', projectId)
    .eq('seller_id', user.id)
    .maybeSingle();

  const listingPayload = {
    project_id: projectId,
    seller_id: user.id,
    title: listingTitle,
    description: listingDescription.slice(0, 500),
    long_description: listingDescription,
    sample_content: sampleContent,
    price_cents: priceCents,
    license_type: licenseType || 'personal',
    status: 'active',
    word_count: totalWords,
    chapter_count: chapterCount,
    cover_url: coverUrl,
    front_cover_url: session?.front_cover_url || null,
    back_cover_url: session?.back_cover_url || null,
    is_free_tier: isFreeTier,
    updated_at: new Date().toISOString(),
  };

  let listingId: string;
  if (existingListing) {
    const { data: updated, error: updateErr } = await supabase
      .from('marketplace_listings')
      .update(listingPayload)
      .eq('id', existingListing.id)
      .select('id')
      .single();
    if (updateErr || !updated) {
      console.error('Listing update failed:', updateErr);
      return NextResponse.json({ error: 'Failed to update listing' }, { status: 500 });
    }
    listingId = updated.id;
  } else {
    const { data: created, error: insertErr } = await supabase
      .from('marketplace_listings')
      .insert(listingPayload)
      .select('id')
      .single();
    if (insertErr || !created) {
      console.error('Listing create failed:', insertErr);
      return NextResponse.json({ error: 'Failed to create listing' }, { status: 500 });
    }
    listingId = created.id;
  }

  const externalUrl = `/marketplace/${listingId}`;

  // ---------- UPSERT project_publications ----------
  const { data: existingPub } = await supabase
    .from('project_publications')
    .select('id')
    .eq('project_id', projectId)
    .eq('platform_id', platform.id)
    .maybeSingle();

  const pubPayload = {
    project_id: projectId,
    platform_id: platform.id,
    user_id: user.id,
    status: 'published',
    published_at: new Date().toISOString(),
    external_url: externalUrl,
    updated_at: new Date().toISOString(),
  };

  if (existingPub) {
    await supabase.from('project_publications').update(pubPayload).eq('id', existingPub.id);
  } else {
    await supabase.from('project_publications').insert(pubPayload);
  }

  // Also flip the project's own status to 'published' if not already
  if (project.status !== 'published') {
    await supabase.from('projects').update({ status: 'published' }).eq('id', projectId);
  }

  return NextResponse.json({
    success: true,
    listingId,
    externalUrl,
    platform: 'penworth',
    stats: {
      totalWords,
      chapterCount,
      priceUsd: priceCents / 100,
      isFreeTier,
    },
  });
}
