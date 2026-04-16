import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

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
  try {
    const supabase = await createClient();
    
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body: CoverRequest = await request.json();
    const { projectId, sessionId, coverType, prompt, bookTitle, authorName, bookDescription } = body;

    if (!projectId || !sessionId || !coverType || !bookTitle) {
      return NextResponse.json(
        { error: 'Missing required fields' },
        { status: 400 }
      );
    }

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

    // Call Ideogram API
    const ideogramResponse = await fetch('https://api.ideogram.ai/generate', {
      method: 'POST',
      headers: {
        'Api-Key': process.env.IDEOGRAM_API_KEY || '',
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

    if (!ideogramResponse.ok) {
      const error = await ideogramResponse.text();
      console.error('Ideogram API error:', error);
      return NextResponse.json(
        { error: 'Failed to generate cover image' },
        { status: 500 }
      );
    }

    const ideogramData = await ideogramResponse.json();
    const imageUrl = ideogramData.data?.[0]?.url;

    if (!imageUrl) {
      return NextResponse.json(
        { error: 'No image generated' },
        { status: 500 }
      );
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

    await supabase
      .from('interview_sessions')
      .update(updateField)
      .eq('id', sessionId);

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

    return NextResponse.json({
      success: true,
      imageUrl,
      creditsUsed: creditCost,
      regenerationCount: regenerations + 1,
    });

  } catch (error) {
    console.error('Error generating cover:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
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
