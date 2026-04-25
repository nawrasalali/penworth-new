import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { creditReferralIfEligible } from '@/lib/referrals';

// Inline slugify — used to be imported from lib/utils, but the repo has
// both `lib/utils.ts` (which wins module resolution for '@/lib/utils')
// and `lib/utils/index.ts` (which is where slugify actually lives).
// Rather than refactor the barrel for one call-site, we inline the
// 5-line function here. Same implementation as lib/utils/index.ts.
function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Publish a completed project to Penworth Store.
 *
 * Single authoritative publish path for writers inside Penworth. Writes to
 * three tables in order:
 *   1. store_listings       — Store's own catalogue; status='live' here is
 *                             what makes store.penworth.ai/book/[slug] work
 *   2. marketplace_listings — kept in sync so the legacy
 *                             penworth.ai/marketplace/[id] URL still resolves
 *   3. project_publications — per-platform per-project audit row
 *
 * On first publish only: projects.status flips to 'published' and the
 * referral-credit hook runs. Idempotent: second call with same projectId
 * updates the same rows and keeps the original slug.
 *
 * Body: { projectId, priceCents?, priceUsd?, subtitle?, description?,
 *         categories?, tags?, format?, licenseType? }
 * Returns: { success, storeUrl, marketplaceUrl, externalUrl, storeListingId,
 *            listingId, slug, platform, stats }
 */

// store.penworth.ai is where /book/[slug] is served.
const STORE_ORIGIN = 'https://store.penworth.ai';

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const {
    projectId,
    priceCents: priceCentsIn,
    priceUsd,
    subtitle,
    description,
    categories,
    tags,
    format,
    licenseType,
    authorName: authorNameOverride,
  } = body as {
    projectId?: string;
    priceCents?: number;
    priceUsd?: number;
    subtitle?: string;
    description?: string;
    categories?: string[];
    tags?: string[];
    format?: string;
    licenseType?: string;
    authorName?: string;
  };

  if (!projectId) {
    return NextResponse.json({ error: 'projectId required' }, { status: 400 });
  }

  // Load the project. We rely on Row-Level Security on `projects` to enforce
  // SELECT access (own / org / public). The previous implementation added a
  // redundant `.eq('user_id', user.id)` filter on top of RLS, which broke
  // legitimate publishes when:
  //   - user_id was NULL on legacy rows (column allows NULL; ON DELETE SET NULL)
  //   - the project belonged to an org and the publisher was an org editor
  //   - the publisher was a super_admin acting via admin policies
  // We replace the filter with an explicit authorization check below.
  const { data: project, error: projectErr } = await supabase
    .from('projects')
    .select(`
      id, user_id, org_id, title, description, content_type, status, language,
      chapters(id, title, content, word_count, status, order_index)
    `)
    .eq('id', projectId)
    .single();

  if (projectErr || !project) {
    return NextResponse.json({ error: 'Project not found' }, { status: 404 });
  }

  // Authorize: owner, org editor/admin/owner, or NULL-user_id legacy row
  // (which we self-heal below so subsequent ownership checks pass).
  const userIsOwner = project.user_id === user.id;
  const userIsLegacyNullOwner = project.user_id === null;
  let userIsOrgEditor = false;
  if (!userIsOwner && project.org_id) {
    const { data: membership } = await supabase
      .from('org_members')
      .select('role')
      .eq('org_id', project.org_id)
      .eq('user_id', user.id)
      .in('role', ['owner', 'admin', 'editor'])
      .maybeSingle();
    userIsOrgEditor = !!membership;
  }

  if (!userIsOwner && !userIsOrgEditor && !userIsLegacyNullOwner) {
    return NextResponse.json(
      { error: 'You are not the author of this project' },
      { status: 403 },
    );
  }

  // Self-heal: claim the row for the current user so future ownership
  // checks pass and the user appears in their own dashboard.
  if (userIsLegacyNullOwner) {
    await supabase.from('projects').update({ user_id: user.id }).eq('id', projectId);
  }

  const completeChapters = (project.chapters || []).filter(
    (c: { status: string }) => c.status === 'complete',
  );
  if (completeChapters.length === 0) {
    return NextResponse.json(
      { error: 'Project has no completed chapters. Finish writing before publishing.' },
      { status: 400 },
    );
  }

  // Load the session for cover + author info. Same RLS-trust pattern as
  // the projects load above — drop the redundant `.eq('user_id', user.id)`.
  const { data: session } = await supabase
    .from('interview_sessions')
    .select('id, user_id, author_name, about_author, front_cover_url, back_cover_url, book_title')
    .eq('project_id', projectId)
    .single();

  // If the publisher supplied an author display name override (any script,
  // any language), persist it back to the session so the listing description
  // and any future cover regenerations reflect the author's chosen rendering.
  const trimmedAuthorName = (authorNameOverride || '').trim();
  const effectiveAuthorName =
    trimmedAuthorName ||
    session?.author_name ||
    'Penworth author';
  if (
    session?.id &&
    trimmedAuthorName &&
    trimmedAuthorName !== session.author_name
  ) {
    await supabase
      .from('interview_sessions')
      .update({ author_name: trimmedAuthorName })
      .eq('id', session.id);
  }

  // Look up the Penworth platform row (used by project_publications)
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

  // Resolve price. Preferred: priceCents. priceUsd accepted for back-compat.
  const priceCents =
    typeof priceCentsIn === 'number' && priceCentsIn >= 0
      ? Math.round(priceCentsIn)
      : typeof priceUsd === 'number' && priceUsd >= 0
      ? Math.round(priceUsd * 100)
      : 0;
  const isFreeTier = priceCents === 0;

  // Compute listing metadata
  const totalWords = completeChapters.reduce(
    (s: number, c: { word_count: number | null }) => s + (c.word_count || 0),
    0,
  );
  const chapterCount = completeChapters.length;
  const firstChapterContent =
    completeChapters.sort(
      (a: { order_index: number }, b: { order_index: number }) => a.order_index - b.order_index,
    )[0]?.content || '';
  const sampleContent = firstChapterContent.slice(0, 2000);
  const listingTitle = session?.book_title || project.title;
  const listingDescription =
    description ||
    project.description ||
    `A ${project.content_type} by ${effectiveAuthorName}`;
  const coverUrl = session?.front_cover_url || null;
  const listingFormat =
    format && ['ebook', 'audiobook', 'cinematic'].includes(format) ? format : 'ebook';
  const readMinutes = totalWords > 0 ? Math.max(1, Math.ceil(totalWords / 250)) : null;

  // Categories: if the caller didn't pick any, infer from content_type so the
  // listing is still browsable. Mirrors the modal's defaultCategoriesFor() so
  // the back-end is the single source of truth and the modal can drop the
  // category-picker UI without breaking the listing taxonomy.
  const inferredCategories = ((): string[] => {
    if (Array.isArray(categories) && categories.length > 0) {
      return categories.slice(0, 10);
    }
    const c = (project.content_type || '').toLowerCase();
    if (c.includes('memoir')) return ['memoir'];
    if (c.includes('fiction') && !c.includes('non')) return ['fiction'];
    if (c.includes('poetry')) return ['poetry'];
    if (c.includes('self') && c.includes('help')) return ['self-help', 'non-fiction'];
    if (c.includes('business')) return ['business', 'non-fiction'];
    if (c.includes('biograph')) return ['biography', 'non-fiction'];
    if (c.includes('non')) return ['non-fiction'];
    return ['non-fiction'];
  })();

  // ---------- UPSERT store_listings (Store authoritative catalogue) ----------
  // Match by author_id + metadata.project_id. No FK to projects; Store is
  // a bounded context, linkage is tracked in metadata.
  const { data: existingStoreListing } = await supabase
    .from('store_listings')
    .select('id, listing_slug')
    .eq('author_id', user.id)
    .filter('metadata->>project_id', 'eq', projectId)
    .maybeSingle();

  let slug = (existingStoreListing?.listing_slug as string | undefined) || undefined;
  if (!slug) {
    const base = slugify(listingTitle) || `book-${projectId.slice(0, 8)}`;
    slug = base;
    for (let suffix = 2; suffix <= 50; suffix++) {
      const { data: clash } = await supabase
        .from('store_listings')
        .select('id')
        .eq('listing_slug', slug)
        .maybeSingle();
      if (!clash) break;
      slug = `${base}-${suffix}`;
    }
  }

  const storePayload: Record<string, unknown> = {
    listing_slug: slug,
    title: listingTitle,
    subtitle: subtitle || null,
    author_id: user.id,
    description: listingDescription,
    language: project.language || 'en',
    format: listingFormat,
    cover_image_url: coverUrl,
    word_count: totalWords,
    read_minutes: readMinutes,
    price_cents: priceCents,
    currency: 'USD',
    tier: 'standard',
    status: 'live',
    published_at: new Date().toISOString(),
    subscription_eligible: true,
    categories: inferredCategories,
    tags: Array.isArray(tags) ? tags.slice(0, 20) : [],
    metadata: {
      project_id: projectId,
      content_type: project.content_type,
      source: 'penworth-writer-one-click',
      chapter_count: chapterCount,
    },
    updated_at: new Date().toISOString(),
  };

  let storeListingId: string;
  if (existingStoreListing) {
    const { data: updated, error: updateErr } = await supabase
      .from('store_listings')
      .update(storePayload)
      .eq('id', existingStoreListing.id)
      .select('id')
      .single();
    if (updateErr || !updated) {
      console.error('[penworth-store/publish] store_listings update failed:', updateErr);
      return NextResponse.json({ error: 'Failed to update store listing' }, { status: 500 });
    }
    storeListingId = updated.id;
  } else {
    const { data: created, error: insertErr } = await supabase
      .from('store_listings')
      .insert(storePayload)
      .select('id')
      .single();
    if (insertErr || !created) {
      console.error('[penworth-store/publish] store_listings insert failed:', insertErr);
      return NextResponse.json(
        { error: 'Failed to create store listing', detail: insertErr?.message },
        { status: 500 },
      );
    }
    storeListingId = created.id;
  }

  const storeUrl = `${STORE_ORIGIN}/book/${slug}`;

  // ---------- UPSERT marketplace_listings (legacy /marketplace/[id]) ----------
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
    tags: Array.isArray(tags) ? tags.slice(0, 20) : [],
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
      console.error('[penworth-store/publish] marketplace_listings update failed:', updateErr);
      return NextResponse.json(
        { error: 'Failed to update marketplace listing' },
        { status: 500 },
      );
    }
    listingId = updated.id;
  } else {
    const { data: created, error: insertErr } = await supabase
      .from('marketplace_listings')
      .insert(listingPayload)
      .select('id')
      .single();
    if (insertErr || !created) {
      console.error('[penworth-store/publish] marketplace_listings insert failed:', insertErr);
      return NextResponse.json(
        { error: 'Failed to create marketplace listing' },
        { status: 500 },
      );
    }
    listingId = created.id;
  }

  const marketplaceUrl = `/marketplace/${listingId}`;

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
    external_url: storeUrl,
    updated_at: new Date().toISOString(),
  };

  if (existingPub) {
    await supabase.from('project_publications').update(pubPayload).eq('id', existingPub.id);
  } else {
    await supabase.from('project_publications').insert(pubPayload);
  }

  const isFirstPublish = project.status !== 'published';

  if (isFirstPublish) {
    await supabase.from('projects').update({ status: 'published' }).eq('id', projectId);
  }

  if (isFirstPublish) {
    try {
      const result = await creditReferralIfEligible(supabase, user.id);
      if (result.credited) {
        console.log('[penworth-store/publish] Credited referrer', {
          referrerId: result.referrerId,
          creditsAwarded: result.creditsAwarded,
          refereeId: user.id,
        });
      }
    } catch (err) {
      console.error('[penworth-store/publish] Referral credit hook failed:', err);
    }
  }

  return NextResponse.json({
    success: true,
    storeUrl,
    marketplaceUrl,
    externalUrl: storeUrl,
    storeListingId,
    listingId,
    slug,
    platform: 'penworth',
    stats: {
      totalWords,
      chapterCount,
      priceUsd: priceCents / 100,
      priceCents,
      isFreeTier,
    },
  });
}
