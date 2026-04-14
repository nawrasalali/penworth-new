import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { INDUSTRY_PROMPTS, getAvailablePrompts, getPromptById } from '@/lib/industry-prompts';

/**
 * GET /api/prompts - Get available industry prompts for user's plan
 */
export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Get user plan
    const { data: profile } = await supabase
      .from('profiles')
      .select('plan')
      .eq('id', user.id)
      .single();

    const plan = (profile?.plan || 'free') as 'free' | 'pro' | 'max';
    const availablePrompts = getAvailablePrompts(plan);

    // Return prompts with availability info
    const allPrompts = INDUSTRY_PROMPTS.map(prompt => ({
      id: prompt.id,
      name: prompt.name,
      description: prompt.description,
      icon: prompt.icon,
      tier: prompt.tier,
      available: availablePrompts.some(p => p.id === prompt.id),
      exampleTopics: prompt.exampleTopics,
    }));

    return NextResponse.json({
      plan,
      prompts: allPrompts,
      availableCount: availablePrompts.length,
      totalCount: INDUSTRY_PROMPTS.length,
      canUseCustom: plan === 'max',
    });

  } catch (error) {
    console.error('Get prompts error:', error);
    return NextResponse.json(
      { error: 'Failed to get prompts' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/prompts/details - Get full prompt details for book generation
 */
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { promptId, customInstructions } = body;

    if (!promptId) {
      return NextResponse.json({ error: 'promptId is required' }, { status: 400 });
    }

    // Get user plan
    const { data: profile } = await supabase
      .from('profiles')
      .select('plan')
      .eq('id', user.id)
      .single();

    const plan = (profile?.plan || 'free') as 'free' | 'pro' | 'max';
    const availablePrompts = getAvailablePrompts(plan);

    // Check if user has access to this prompt
    const prompt = getPromptById(promptId);
    
    if (!prompt) {
      return NextResponse.json({ error: 'Prompt not found' }, { status: 404 });
    }

    if (!availablePrompts.some(p => p.id === promptId)) {
      return NextResponse.json(
        { 
          error: `The ${prompt.name} prompt requires ${prompt.tier} plan or higher`,
          requiredTier: prompt.tier,
          currentPlan: plan,
        },
        { status: 403 }
      );
    }

    // Check custom instructions (Max only)
    if (customInstructions && plan !== 'max') {
      return NextResponse.json(
        { error: 'Custom instructions require Max plan' },
        { status: 403 }
      );
    }

    // Return full prompt details
    return NextResponse.json({
      prompt: {
        id: prompt.id,
        name: prompt.name,
        description: prompt.description,
        icon: prompt.icon,
        systemPrompt: prompt.systemPrompt,
        suggestedOutline: prompt.suggestedOutline,
        toneGuidelines: prompt.toneGuidelines,
        exampleTopics: prompt.exampleTopics,
      },
      customInstructions: customInstructions || null,
    });

  } catch (error) {
    console.error('Get prompt details error:', error);
    return NextResponse.json(
      { error: 'Failed to get prompt details' },
      { status: 500 }
    );
  }
}
