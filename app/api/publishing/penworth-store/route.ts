import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';
import { creditReferralIfEligible } from '@/lib/referrals';

// CEO-043 Phase 0.5: publishing the listing involves chapter inserts, cover
// mirror upload, livebook kickoff, referral credit, and the final session
// writeback. For a 9-chapter book this measured 46s wall-clock — the Vercel
// Pro 60s default leaves no headroom. Bump to match Phase 0 across app/api/ai/*.
export const maxDuration = 300;

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
  //
  // NOTE: this SELECT used to also list `language`, but the projects table
  // has no `language` column (i18n is tracked on interview_sessions /
  // publishing_metadata, not at the project level). PostgREST silently
  // converts the unknown-column error into a generic projectErr, which
  // surfaced to authors as "Project not found" — the actual cause behind
  // CEO-089's first round of fixes failing to land. Drop `language` from
  // the SELECT and default the listing language at the use-site below.
  const { data: project, error: projectErr } = await supabase
    .from('projects')
    .select(`
      id, user_id, org_id, title, description, content_type, status,
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

  // Cover URL: defend against ephemeral Ideogram URLs reaching store_listings.
  // CEO-073 added bucket persistence in the cover-generation path going forward,
  // but covers generated before that fix landed (or any cover-generation that
  // hit the persistence-failed fallback path) still carry an ephemeral
  // ideogram.ai URL with a finite `exp=` query param. Once expired, the
  // store thumbnail 404s and the book looks broken on /browse.
  //
  // CEO-091 fix: at publish time, if the cover URL is on the ideogram
  // ephemeral CDN, fetch the bytes and mirror to our `covers` bucket
  // (same path layout as covers/generate). On success, persist BOTH the
  // store_listings.cover_image_url AND the session.front_cover_url so the
  // next publish doesn't re-mirror unnecessarily. On failure, fall through
  // with the ephemeral URL — same fail-soft policy as covers/generate.
  let coverUrl: string | null = session?.front_cover_url || null;
  const isEphemeralCover =
    typeof coverUrl === 'string' &&
    coverUrl.includes('ideogram.ai/api/images/ephemeral');
  if (isEphemeralCover && coverUrl) {
    try {
      const imgResp = await fetch(coverUrl);
      if (imgResp.ok) {
        const contentType = imgResp.headers.get('content-type') || 'image/png';
        const ext = contentType.includes('jpeg') ? 'jpg'
                  : contentType.includes('webp') ? 'webp'
                  : 'png';
        const bytes = await imgResp.arrayBuffer();
        const storagePath = `${user.id}/covers/${session?.id || projectId}-front-publish.${ext}`;
        // Use service-role for the bucket upload. The user-scoped
        // supabase-ssr client has been silently failing INSERT against
        // storage.objects in production with "new row violates row-level
        // security policy" — verified via _cover_diag_trace mirror_fail
        // events on every cover regen 2026-04-25 and prior. RLS is
        // satisfied on paper (path's first foldername segment equals
        // user.id) so the failure is in supabase-ssr's storage auth
        // header propagation, not in policy. Service-role bypasses RLS
        // by design and is the correct privilege level for this internal
        // operation — we already authorized the user as project owner
        // above. CEO-094.
        const svc = createServiceClient();
        const { error: uploadErr } = await svc
          .storage
          .from('covers')
          .upload(storagePath, bytes, {
            contentType,
            upsert: true,
            cacheControl: '31536000',
          });
        if (!uploadErr) {
          const { data: { publicUrl } } = svc
            .storage
            .from('covers')
            .getPublicUrl(storagePath);
          coverUrl = `${publicUrl}?v=${Date.now()}`;
          if (session?.id) {
            await supabase
              .from('interview_sessions')
              .update({ front_cover_url: coverUrl })
              .eq('id', session.id);
          }
        } else {
          console.error('[penworth-store/publish] cover bucket mirror upload failed:', uploadErr.message);
        }
      } else {
        // The ephemeral URL has already expired and returns a 4xx. There
        // is nothing to mirror — the cover is gone at the source. We
        // proceed with the dead URL so the publish itself succeeds; the
        // Founder will need to regenerate the cover. Logged so we can
        // distinguish this case from transient fetch failures.
        console.warn(
          '[penworth-store/publish] ephemeral cover URL already expired',
          { sessionId: session?.id, status: imgResp.status },
        );
      }
    } catch (mirrorErr) {
      console.error('[penworth-store/publish] cover persistence failed; falling back to ephemeral URL:', mirrorErr);
    }
  }

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
    language: 'en',
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

  // ---------- SYNC store_chapters (the reader's source of truth) ----------
  // The reader app at store.penworth.ai/read/[slug] reads chapter content
  // from store_chapters, NOT from the writer's `chapters` table. Until
  // CEO-091 the publish endpoint never wrote to store_chapters, so every
  // published book showed "This book hasn't been finalised yet" no matter
  // how many chapters were marked complete.
  //
  // Strategy: delete-then-insert keyed on listing_id. Idempotent on
  // re-publish. The first chapter is marked is_sample=true so anonymous
  // visitors can read a preview (and so the book page itself can render
  // without a purchase). All others require purchase or subscription per
  // RLS on store_chapters.
  const orderedChapters = [...completeChapters].sort(
    (a: { order_index: number }, b: { order_index: number }) =>
      a.order_index - b.order_index,
  );
  if (orderedChapters.length > 0) {
    // Wipe any prior chapters for this listing so the re-publish path
    // doesn't accumulate stale rows when the writer reorders or removes
    // chapters between publishes.
    await supabase
      .from('store_chapters')
      .delete()
      .eq('listing_id', storeListingId);

    type WriterChapter = {
      title: string | null;
      content: string | null;
      word_count: number | null;
    };
    const chapterRows = orderedChapters.map((c: WriterChapter, idx: number) => {
      const wordCount = c.word_count ?? 0;
      return {
        listing_id: storeListingId,
        chapter_index: idx + 1,
        title: c.title ?? null,
        content_markdown: c.content ?? '',
        word_count: wordCount,
        estimated_minutes: wordCount > 0 ? Math.max(1, Math.ceil(wordCount / 250)) : null,
        is_sample: idx === 0,
      };
    });

    const { error: chapterInsertErr } = await supabase
      .from('store_chapters')
      .insert(chapterRows);

    if (chapterInsertErr) {
      // Don't fail the whole publish on chapter-sync failure — the
      // listing is already live, marketplace_listings will follow, and
      // the Founder can retry. But surface loudly so we notice the
      // store is in a partial state.
      console.error(
        '[penworth-store/publish] store_chapters insert failed; reader will show "not finalised":',
        chapterInsertErr.message,
      );
    }
  }

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

  // ---------- KICK OFF LIVEBOOK GENERATION (fire-and-forget) ----------
  // On first publish, ask the store-side admin-generate-livebook edge function
  // to render a Livebook for this listing. We do not await: TTS + HTML
  // assembly takes 30-90 seconds and the publish response should be snappy.
  // The author can manually re-trigger via the Livebook admin tools if the
  // background job fails — error surface is logs + null livebook_generated_at
  // on the store_listings row, which the Command Center surfaces.
  //
  // voice_kind is hardcoded to default_male here. CEO-058 (voice pool +
  // automatic matching) will replace this with a per-book voice pick once
  // the pool is hydrated and the matching RPC is wired in.
  //
  // Auth model: the edge function bypasses JWT and accepts a shared secret
  // in x-admin-secret. ADMIN_SECRET must be set on the writer Vercel project.
  // If missing, we skip silently in production but log loudly so the gap is
  // visible in observability.
  let livebookGenerationStarted = false;
  if (isFirstPublish) {
    const adminSecret = process.env.ADMIN_SECRET;
    if (!adminSecret) {
      console.error(
        '[penworth-store/publish] ADMIN_SECRET not set — skipping livebook generation kickoff for listing',
        storeListingId,
      );
    } else {
      const livebookUrl =
        'https://lodupspxdvadamrqvkje.supabase.co/functions/v1/admin-generate-livebook';
      // Fire-and-forget. We intentionally do NOT await this fetch — the
      // edge function takes 30-90s to complete TTS + HTML assembly, and we
      // want the publish response back to the writer in <1s. The .catch is
      // there so an unhandled rejection doesn't crash the Vercel function.
      void fetch(livebookUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-admin-secret': adminSecret,
        },
        body: JSON.stringify({
          listing_id: storeListingId,
          voice_kind: 'default_male',
        }),
      })
        .then(async (res) => {
          if (!res.ok) {
            console.error(
              '[penworth-store/publish] Livebook trigger non-OK',
              res.status,
              (await res.text()).slice(0, 200),
            );
          } else {
            console.log(
              '[penworth-store/publish] Livebook generation kicked off for listing',
              storeListingId,
            );
          }
        })
        .catch((err) => {
          console.error('[penworth-store/publish] Livebook trigger fetch failed:', err);
        });
      livebookGenerationStarted = true;
    }
  }

  // ---------- KICK OFF LIVEBOOK IMAGE MATCHING (fire-and-forget) ----------
  // CEO-165 Phase 1. If the listing is enrolled in the Livebook image
  // library (Phase 2 publish-modal toggle), call the image matcher to
  // resolve a paragraph→image map. Same fire-and-forget pattern as the
  // audio livebook above. Until Phase 2 ships the enrolment UI, the
  // `livebook_enrolled` column remains false everywhere and this branch
  // is dormant.
  let livebookImageMatchStarted = false;
  if (isFirstPublish) {
    const svc = createServiceClient();
    const { data: listingRow } = await svc
      .from('store_listings')
      .select('livebook_enrolled, livebook_style')
      .eq('id', storeListingId)
      .maybeSingle();
    if (listingRow?.livebook_enrolled && listingRow?.livebook_style) {
      const adminSecret = process.env.ADMIN_SECRET;
      if (!adminSecret) {
        console.error(
          '[penworth-store/publish] ADMIN_SECRET not set — skipping livebook image match for listing',
          storeListingId,
        );
      } else {
        const matchUrl =
          'https://lodupspxdvadamrqvkje.supabase.co/functions/v1/admin-match-livebook-images';
        void fetch(matchUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-admin-secret': adminSecret,
          },
          body: JSON.stringify({
            listing_id: storeListingId,
          }),
        })
          .then(async (res) => {
            if (!res.ok) {
              console.error(
                '[penworth-store/publish] Livebook image match non-OK',
                res.status,
                (await res.text()).slice(0, 200),
              );
            } else {
              console.log(
                '[penworth-store/publish] Livebook image match kicked off for listing',
                storeListingId,
              );
            }
          })
          .catch((err) => {
            console.error('[penworth-store/publish] Livebook image match fetch failed:', err);
          });
        livebookImageMatchStarted = true;
      }
    }
  }

  // CEO-043: mark the pipeline complete. publishing is the terminal agent
  // in agentOrder, so /api/interview-session?action=advance refuses to flip
  // it (currentIndex >= agentOrder.length - 1). Without this writeback,
  // pipeline_status stays 'active' and the editor UI shows "publishing in
  // progress" forever even though the store listing is live. Patch is safe
  // for re-publishes (jump-back-to-publishing): the row simply re-completes.
  if (session?.id) {
    const completedStatus: Record<string, string> = {
      ...(session as { agent_status?: Record<string, string> }).agent_status || {},
    };
    // session was loaded with a narrow .select(...); fetch agent_status
    // explicitly so we don't clobber upstream stages with an empty object.
    const { data: full } = await supabase
      .from('interview_sessions')
      .select('agent_status')
      .eq('id', session.id)
      .single();
    const merged = { ...(full?.agent_status || {}), ...completedStatus, publishing: 'completed' };
    await supabase
      .from('interview_sessions')
      .update({
        agent_status: merged,
        pipeline_status: 'completed',
        agent_heartbeat_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', session.id);
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
    livebookGenerationStarted,
    livebookImageMatchStarted,
    stats: {
      totalWords,
      chapterCount,
      priceUsd: priceCents / 100,
      priceCents,
      isFreeTier,
    },
  });
}
