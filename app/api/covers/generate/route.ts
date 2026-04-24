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

    // Check if this is a regeneration (costs credits)
    const { data: session } = await supabase
      .from('interview_sessions')
      .select('front_cover_regenerations, back_cover_regenerations')
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
        .select('credits')
        .eq('id', user.id)
        .single();

      if (!profile || profile.credits < creditCost) {
        return NextResponse.json(
          { error: 'Insufficient credits', required: creditCost, available: profile?.credits || 0 },
          { status: 402 }
        );
      }

      // Deduct credits
      await supabase
        .from('profiles')
        .update({ credits: profile.credits - creditCost })
        .eq('id', user.id);
    }

    // Build the Ideogram prompt
    // IMPORTANT: We tell Ideogram NOT to include text - we overlay it ourselves
    let ideogramPrompt: string;

    if (coverType === 'front') {
      ideogramPrompt = prompt || buildDefaultFrontCoverPrompt(bookTitle, bookDescription);
      // Add instruction to NOT include text
      ideogramPrompt += '\n\nIMPORTANT: Do NOT include any text, words, letters, or typography in the image. The image should be purely visual with no text elements. Leave space at the top and bottom for text overlay.';
    } else {
      ideogramPrompt = buildBackCoverPrompt(bookTitle, bookDescription);
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
          style_type: 'REALISTIC', // or 'DESIGN' for more stylized
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
    const imageUrl = ideogramData.data?.[0]?.url;

    if (!imageUrl) {
      await trace('ideogram_no_image', JSON.stringify(ideogramData).slice(0, 500), user.id, sessionId);
      return NextResponse.json(
        { error: 'No image generated' },
        { status: 500 }
      );
    }
    await trace('ideogram_ok', `url=${imageUrl.slice(0, 200)}`, user.id, sessionId);

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

  return `${styleGuide}. The imagery should evoke the themes of "${bookTitle}". ${description ? `Context: ${description}` : ''} Create a visually striking cover that would stand out on bookstore shelves and online thumbnails.`;
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
