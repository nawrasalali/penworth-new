import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';

// Ideogram image generation typically takes 15-30 seconds. Without this
// explicit maxDuration, Vercel kills the route at the 10-second default
// and the user sees the Generate button spin forever, then no cover
// appears. Matches the 300s ceiling used by the Author pipeline AI
// routes (CEO-043 Phase 0, commit e48ca5c).
export const maxDuration = 300;

// TEMPORARY diagnostic: write one row per pipeline stage so the CEO
// session can see exactly where a cover-generate attempt dies even
// without Vercel runtime-log access. Remove once the silent-failure
// bug is root-caused. Uses service client (bypasses RLS) because we
// want the trace written regardless of the user's auth state.
async function trace(stage: string, details?: string, userId?: string, sessionId?: string) {
  try {
    const admin = createServiceClient();
    await admin.from('_cover_diag_trace').insert({
      stage,
      details: details?.slice(0, 800) ?? null,
      user_id: userId ?? null,
      session_id: sessionId ?? null,
    });
  } catch {
    // swallow — we must never fail the real request because the diag
    // table had a hiccup.
  }
}

// KDP Cover Specifications (6x9 book at 300 DPI)
const KDP_SPECS = {
  FRONT_COVER: {
    width: 1800,  // 6 inches * 300 DPI
    height: 2700, // 9 inches * 300 DPI
  },
  SAFE_ZONE_INCHES: 0.25, // Keep text 0.25" from edges
  BLEED_INCHES: 0.125,
};

interface CoverRequest {
  projectId: string;
  sessionId: string;
  coverType: 'front' | 'back';
  prompt?: string;
  bookTitle: string;
  authorName: string;
  bookDescription?: string;
}

export async function POST(request: NextRequest) {
  // Snapshot a few high-signal request bits so even if auth fails we
  // know the request reached our function and what client sent it.
  const ua = request.headers.get('user-agent')?.slice(0, 120) ?? '';
  await trace('entry', `ua=${ua}`);

  try {
    const supabase = await createClient();

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      await trace('auth_fail', 'no user from supabase.auth.getUser()');
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    await trace('auth_ok', null as any, user.id);

    const body: CoverRequest = await request.json();
    const { projectId, sessionId, coverType, prompt, bookTitle, authorName, bookDescription } = body;

    if (!projectId || !sessionId || !coverType || !bookTitle) {
      await trace('body_invalid', JSON.stringify({ projectId, sessionId, coverType, bookTitle }).slice(0, 300), user.id, sessionId);
      return NextResponse.json(
        { error: 'Missing required fields' },
        { status: 400 }
      );
    }
    await trace('body_ok', `type=${coverType} promptLen=${(prompt ?? '').length}`, user.id, sessionId);

    // Check if this is a regeneration (costs credits).
    // We also pull book_title + outline_data here so the prompt builder
    // below can derive a rich "subject" line even when the client did
    // not bother to send bookDescription (most callers don't — both
    // the editor page and hooks/use-agent-workflow.ts omit it or pass
    // empty string).
    const { data: session } = await supabase
      .from('interview_sessions')
      .select('front_cover_regenerations, back_cover_regenerations, book_title, outline_data')
      .eq('id', sessionId)
      .single();

    const regenerations = coverType === 'front' 
      ? session?.front_cover_regenerations || 0
      : session?.back_cover_regenerations || 0;

    const isRegeneration = regenerations > 0;
    const creditCost = isRegeneration ? 200 : 0; // FREE first time, 200 for regeneration

    // Check credits if regeneration
    if (isRegeneration) {
      const { data: profile } = await supabase
        .from('profiles')
        .select('credits_balance')
        .eq('id', user.id)
        .single();

      if (!profile || (profile.credits_balance ?? 0) < creditCost) {
        await trace('insufficient_credits', `have=${profile?.credits_balance ?? 0} need=${creditCost}`, user.id, sessionId);
        return NextResponse.json(
          { error: `Not enough credits to regenerate. You have ${profile?.credits_balance ?? 0}, need ${creditCost}. Your first cover generation is free; each regeneration after that costs ${creditCost} credits.`, required: creditCost, available: profile?.credits_balance || 0 },
          { status: 402 }
        );
      }

      // Deduct credits
      await supabase
        .from('profiles')
        .update({ credits_balance: (profile.credits_balance ?? 0) - creditCost })
        .eq('id', user.id);
    }

    // Build the Ideogram prompt
    // IMPORTANT: We tell Ideogram NOT to include text - we overlay it ourselves
    let ideogramPrompt: string;

    // Server-side subject derivation (CEO-072 follow-up).
    //
    // The client-side callers of this endpoint (editor page + the
    // use-agent-workflow hook) do NOT send bookDescription, or send it
    // as empty string. Relying on the 60-char book title alone means
    // Ideogram can still produce off-topic imagery — the 14:48 UTC
    // fruit-bowl failure on "The Rewired Self" happened partly for
    // that reason. Derive a subject blurb from the outline's first
    // two chapter titles + their leading key point, which is the
    // richest single signal about what the book is actually about.
    const titleForPrompt = (session?.book_title || bookTitle || '').trim();
    const derivedSubject = deriveSubjectFromOutline(session?.outline_data);
    const effectiveSubject = (bookDescription?.trim() || derivedSubject || '').slice(0, 500);
    await trace('subject_ok', `titleLen=${titleForPrompt.length} subjLen=${effectiveSubject.length} fromOutline=${!bookDescription?.trim() && !!derivedSubject}`, user.id, sessionId);

    if (coverType === 'front') {
      // BUG FIX (CEO-072): when the user picked a suggestion chip (e.g.
      // "Bold and eye-catching with vibrant colors"), the old code sent
      // ONLY that style tag to Ideogram with no book context. With
      // style_type=REALISTIC + magic_prompt=AUTO, Ideogram interpreted
      // a style-only brief as stock food photography and produced a
      // bowl of fruit for a book about AI. Fix: the book's title and
      // subject ALWAYS ride in the prompt. The user's chosen prompt
      // becomes the *style* directive layered on top.
      const userStyle = (prompt ?? '').trim();
      if (userStyle) {
        const topicLine = effectiveSubject
          ? `Book title: "${titleForPrompt}". Subject: ${effectiveSubject}.`
          : `Book title: "${titleForPrompt}".`;
        ideogramPrompt =
          `${topicLine}\n\nVisual style: ${userStyle}.\n\n` +
          `Create a book cover whose imagery directly evokes the book's subject. ` +
          `Keep the style direction but never produce generic stock imagery (no food, no abstract fruit, ` +
          `no unrelated photography). The cover must feel specific to this book.\n\n` +
          `Composition: design this like a New York Times bestseller cover — a single strong central visual ` +
          `motif, symmetrically framed, shot in the middle third of the canvas so the top third can carry a ` +
          `large title and the bottom eighth can carry an author name. High contrast between the focal ` +
          `subject and the background. The top and bottom edges should be visually quieter (darker, softer, ` +
          `or simpler) than the center so overlaid typography reads cleanly. Avoid busy patterns near the ` +
          `edges. 6x9 portrait orientation.`;
      } else {
        ideogramPrompt = buildDefaultFrontCoverPrompt(titleForPrompt, effectiveSubject);
      }
      // Text is overlaid in PDF/Store render — keep the image clean.
      ideogramPrompt +=
        '\n\nIMPORTANT: Do NOT include any text, words, letters, numerals, or typography anywhere in the ' +
        'image. Title and author name will be added later as a typography overlay. To support that overlay, ' +
        'leave the top 35% of the canvas visually quieter (darker background or uncluttered space) and the ' +
        'bottom 18% cleaner than the center. No logos, no symbols that resemble letters.';
    } else {
      ideogramPrompt = buildBackCoverPrompt(titleForPrompt, effectiveSubject);
      ideogramPrompt += '\n\nIMPORTANT: Do NOT include any text, words, letters, or typography in the image. Create a subtle, elegant background suitable for text overlay. Leave the center area relatively simple for description text.';
    }

    // Explicit env guard. Previously a missing IDEOGRAM_API_KEY silently
    // produced a 401 from Ideogram and we returned a generic "Failed to
    // generate cover image" — hard to debug from the client. Now we say
    // exactly what's wrong so the Founder (or Vercel dashboard) can act.
    const ideogramKey = process.env.IDEOGRAM_API_KEY;
    if (!ideogramKey) {
      await trace('env_missing', 'IDEOGRAM_API_KEY', user.id, sessionId);
      console.error('[covers/generate] IDEOGRAM_API_KEY is not set on this deployment');
      return NextResponse.json(
        { error: 'Cover service is not configured on the server (IDEOGRAM_API_KEY missing). Founder action required: set the env var on Vercel and redeploy.' },
        { status: 503 }
      );
    }
    await trace('env_ok', `keyLen=${ideogramKey.length}`, user.id, sessionId);

    // Call Ideogram API
    await trace('ideogram_call_start', null as any, user.id, sessionId);
    const ideogramResponse = await fetch('https://api.ideogram.ai/generate', {
      method: 'POST',
      headers: {
        'Api-Key': ideogramKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        image_request: {
          prompt: ideogramPrompt,
          aspect_ratio: 'ASPECT_2_3', // Book cover ratio
          model: 'V_2',
          magic_prompt_option: 'AUTO',
          // DESIGN produces stylized graphic-design output that reads as
          // a book cover. REALISTIC nudges Ideogram toward stock
          // photography — which is how a book about AI ended up with
          // a fruit photo (CEO-072).
          style_type: 'DESIGN',
        },
      }),
    });
    await trace('ideogram_response', `status=${ideogramResponse.status}`, user.id, sessionId);

    if (!ideogramResponse.ok) {
      const errorText = await ideogramResponse.text();
      await trace('ideogram_fail', `status=${ideogramResponse.status} body=${errorText.slice(0, 500)}`, user.id, sessionId);
      console.error('[covers/generate] Ideogram API error:', ideogramResponse.status, errorText);
      // Surface the actual upstream status + snippet so the user (and us)
      // can diagnose without hunting through logs.
      const snippet = errorText.slice(0, 200);
      return NextResponse.json(
        { error: `Cover service upstream error (HTTP ${ideogramResponse.status}): ${snippet}` },
        { status: 502 }
      );
    }

    const ideogramData = await ideogramResponse.json();
    const ephemeralUrl: string | undefined = ideogramData.data?.[0]?.url;

    if (!ephemeralUrl) {
      await trace('ideogram_no_image', JSON.stringify(ideogramData).slice(0, 500), user.id, sessionId);
      return NextResponse.json(
        { error: 'No image generated' },
        { status: 500 }
      );
    }
    await trace('ideogram_ok', `url=${ephemeralUrl.slice(0, 200)}`, user.id, sessionId);

    // CEO-073: Ideogram image URLs expire in ~10 hours. We must mirror
    // the bytes into our own `covers` storage bucket and persist the
    // public URL of OUR copy. Otherwise every cover the user generates
    // 404s by tomorrow — including covers on already-published books.
    //
    // The covers bucket RLS requires (storage.foldername(name))[1] =
    // auth.uid()::text on INSERT. We satisfy that with the `{userId}/`
    // prefix, mirroring the layout we use for author headshots.
    let imageUrl = ephemeralUrl;
    try {
      await trace('mirror_fetch_start', null as any, user.id, sessionId);
      const imgResp = await fetch(ephemeralUrl);
      if (!imgResp.ok) {
        throw new Error(`fetch ideogram image: HTTP ${imgResp.status}`);
      }
      const contentType = imgResp.headers.get('content-type') || 'image/png';
      const ext = contentType.includes('jpeg') ? 'jpg'
                : contentType.includes('webp') ? 'webp'
                : 'png';
      const bytes = await imgResp.arrayBuffer();
      const storagePath = `${user.id}/covers/${sessionId}-${coverType}.${ext}`;

      const { error: uploadErr } = await supabase
        .storage
        .from('covers')
        .upload(storagePath, bytes, {
          contentType,
          upsert: true,
          cacheControl: '31536000',
        });

      if (uploadErr) {
        throw new Error(`storage upload: ${uploadErr.message}`);
      }

      const { data: { publicUrl } } = supabase
        .storage
        .from('covers')
        .getPublicUrl(storagePath);

      // Cache-buster so the UI repaints immediately on regenerate
      // even though the storage path is deterministic.
      imageUrl = `${publicUrl}?v=${Date.now()}`;
      await trace('mirror_ok', imageUrl.slice(0, 200), user.id, sessionId);
    } catch (mirrorErr: any) {
      // Mirror failure is not fatal — the user still gets a working
      // cover for ~10 hours. We log so we can fix root cause later
      // (likely RLS or a transient Ideogram CDN hiccup) and keep
      // imageUrl pointing at the ephemeral URL. Better degraded than
      // failed.
      await trace('mirror_fail', String(mirrorErr?.message ?? mirrorErr).slice(0, 500), user.id, sessionId);
      console.error('[covers/generate] mirror to bucket failed; falling back to ephemeral URL:', mirrorErr);
    }

    // Update session with new cover URL
    const updateField = coverType === 'front' 
      ? { 
          front_cover_url: imageUrl, 
          front_cover_prompt: ideogramPrompt,
          front_cover_regenerations: regenerations + 1 
        }
      : { 
          back_cover_url: imageUrl, 
          back_cover_prompt: ideogramPrompt,
          back_cover_regenerations: regenerations + 1 
        };

    const { error: updateErr } = await supabase
      .from('interview_sessions')
      .update(updateField)
      .eq('id', sessionId);

    if (updateErr) {
      await trace('db_update_fail', updateErr.message, user.id, sessionId);
    } else {
      await trace('db_update_ok', null as any, user.id, sessionId);
    }

    // Log regeneration if credits were used
    if (isRegeneration) {
      await supabase
        .from('cover_regenerations')
        .insert({
          session_id: sessionId,
          cover_type: coverType,
          credits_used: creditCost,
          prompt_used: ideogramPrompt,
          result_url: imageUrl,
        });
    }

    await trace('done', `regen=${regenerations + 1}`, user.id, sessionId);
    return NextResponse.json({
      success: true,
      imageUrl,
      creditsUsed: creditCost,
      regenerationCount: regenerations + 1,
    });

  } catch (error: any) {
    await trace('exception', String(error?.message ?? error).slice(0, 500));
    console.error('Error generating cover:', error);
    return NextResponse.json(
      { error: `Internal server error: ${error?.message ?? 'unknown'}` },
      { status: 500 }
    );
  }
}

/**
 * Pull a rich "subject" blurb out of the stored outline_data jsonb so
 * Ideogram has something to latch onto beyond a short book title.
 *
 * Client-side callers of /api/covers/generate currently don't send
 * bookDescription — the editor page and use-agent-workflow hook both
 * omit it or pass empty string. Rather than plumbing a new field
 * through two clients, we derive the subject here from whatever the
 * outline agent has already written.
 *
 * Strategy: take the first two chapter titles + the first key point
 * of chapter 1, which is consistently the "what this book is about"
 * signal under our outline agent's format (see the outline_data
 * example in interview_sessions — keys: body[].title, body[].keyPoints[]).
 *
 * Returns an empty string if we can't get anything useful. Defensive
 * against any shape — outline_data is jsonb, so we validate each
 * property access.
 */
function deriveSubjectFromOutline(outlineData: unknown): string {
  if (!outlineData || typeof outlineData !== 'object') return '';
  const body = (outlineData as any).body;
  if (!Array.isArray(body) || body.length === 0) return '';

  const parts: string[] = [];

  const firstTitle = typeof body[0]?.title === 'string' ? body[0].title.trim() : '';
  if (firstTitle) parts.push(firstTitle);

  const firstKeyPoint =
    Array.isArray(body[0]?.keyPoints) && typeof body[0].keyPoints[0] === 'string'
      ? body[0].keyPoints[0].trim()
      : '';
  if (firstKeyPoint) parts.push(firstKeyPoint);

  const secondTitle = typeof body[1]?.title === 'string' ? body[1].title.trim() : '';
  if (secondTitle) parts.push(secondTitle);

  return parts.join(' — ').slice(0, 400);
}

function buildDefaultFrontCoverPrompt(bookTitle: string, description?: string): string {
  // Analyze the title to suggest appropriate imagery
  const lowerTitle = bookTitle.toLowerCase();

  let styleGuide = 'Professional book cover design, high-quality, elegant composition, suitable for publishing';

  // Genre detection from title/description
  if (lowerTitle.includes('business') || lowerTitle.includes('success') || lowerTitle.includes('leadership')) {
    styleGuide = 'Modern business book cover, clean minimalist design, professional corporate aesthetic, abstract geometric shapes, gradient colors, sophisticated and authoritative';
  } else if (lowerTitle.includes('love') || lowerTitle.includes('heart') || lowerTitle.includes('romance')) {
    styleGuide = 'Romantic book cover, soft warm colors, elegant typography space, dreamy atmosphere, emotional and inviting';
  } else if (lowerTitle.includes('mystery') || lowerTitle.includes('dark') || lowerTitle.includes('secret')) {
    styleGuide = 'Mystery thriller book cover, dark moody atmosphere, dramatic lighting, suspenseful composition, intriguing shadows';
  } else if (lowerTitle.includes('health') || lowerTitle.includes('wellness') || lowerTitle.includes('fitness')) {
    styleGuide = 'Health and wellness book cover, fresh vibrant colors, clean energetic design, inspiring and uplifting';
  } else if (lowerTitle.includes('cook') || lowerTitle.includes('recipe') || lowerTitle.includes('food')) {
    styleGuide = 'Cookbook cover, appetizing food photography style, warm inviting colors, culinary elegance';
  } else if (lowerTitle.includes('child') || lowerTitle.includes('kid')) {
    styleGuide = 'Children\'s book cover, bright cheerful colors, playful illustration style, fun and engaging';
  } else if (lowerTitle.includes('history') || lowerTitle.includes('war') || lowerTitle.includes('ancient')) {
    styleGuide = 'Historical book cover, classic elegant design, period-appropriate imagery, distinguished and scholarly';
  } else if (lowerTitle.includes('tech') || lowerTitle.includes('ai') || lowerTitle.includes('digital')) {
    styleGuide = 'Technology book cover, futuristic sleek design, digital aesthetic, modern and innovative';
  }

  return (
    `${styleGuide}. The imagery should evoke the themes of "${bookTitle}". ` +
    `${description ? `Context: ${description}. ` : ''}` +
    `Composition: design this like a New York Times bestseller cover — a single strong central visual motif, ` +
    `symmetrically framed, shot in the middle third of the canvas so the top third can carry a large title and ` +
    `the bottom eighth can carry an author name. Use high contrast between the focal subject and the ` +
    `background. The top and bottom edges should be visually quieter (darker, softer, or simpler) than the ` +
    `center so overlaid typography reads cleanly. Avoid busy patterns near the edges. Target a commercial ` +
    `trade-paperback aesthetic: refined, considered, recognizably a book — not a stock photograph, not an ` +
    `illustration collage. 6x9 portrait orientation.`
  );
}

function buildBackCoverPrompt(bookTitle: string, description?: string): string {
  return `Elegant book back cover background design for "${bookTitle}". Subtle, sophisticated pattern or gradient that complements a front cover. The design should be understated enough to allow text overlay for book description and author bio. Professional publishing quality, soft colors, minimal visual elements in the center area where text will be placed. ${description ? `Theme context: ${description}` : ''}`;
}

// GET endpoint to fetch cover suggestions
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const bookTitle = searchParams.get('title') || '';
  const contentType = searchParams.get('contentType') || '';

  // Return cover style suggestions based on title/content type
  const suggestions = generateCoverSuggestions(bookTitle, contentType);

  return NextResponse.json({ suggestions });
}

function generateCoverSuggestions(title: string, contentType: string): string[] {
  const baseSuggestions = [
    'Professional and modern with abstract shapes',
    'Elegant with subtle textures and clean typography space',
    'Bold and eye-catching with vibrant colors',
    'Minimalist with focus on negative space',
    'Warm and inviting with soft gradients',
  ];

  // Add genre-specific suggestions
  if (contentType === 'fiction') {
    baseSuggestions.push(
      'Atmospheric scene with dramatic lighting',
      'Character silhouette against evocative background'
    );
  } else if (contentType === 'non-fiction' || contentType === 'business') {
    baseSuggestions.push(
      'Clean geometric design with professional colors',
      'Inspirational imagery with upward momentum'
    );
  } else if (contentType === 'memoir') {
    baseSuggestions.push(
      'Personal and intimate with nostalgic tones',
      'Journey metaphor with path or horizon'
    );
  }

  return baseSuggestions;
}
