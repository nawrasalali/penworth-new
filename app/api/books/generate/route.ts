import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { inngest } from '@/inngest/client';
import { PLAN_LIMITS, CREDIT_COSTS, getDocumentLimit } from '@/lib/plans';

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { projectId, outline, voiceProfile } = body;

    if (!projectId || !outline) {
      return NextResponse.json(
        { error: 'projectId and outline are required' },
        { status: 400 }
      );
    }

    // Fetch project to verify ownership
    const { data: project, error: projectError } = await supabase
      .from('projects')
      .select(`
        *,
        organizations (industry)
      `)
      .eq('id', projectId)
      .eq('user_id', user.id)
      .single();

    if (projectError || !project) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    }

    // Check if book is already being written
    if (project.status === 'writing') {
      return NextResponse.json(
        { error: 'Book is already being written' },
        { status: 400 }
      );
    }

    // Get user profile with plan and credits
    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('plan, credits_balance, credits_purchased, documents_this_month, documents_reset_at')
      .eq('id', user.id)
      .single();

    if (profileError || !profile) {
      return NextResponse.json({ error: 'Profile not found' }, { status: 404 });
    }

    const plan = (profile.plan as keyof typeof PLAN_LIMITS) || 'free';
    const limits = PLAN_LIMITS[plan];
    const creditCost = CREDIT_COSTS.standardDocument; // 1000 credits = 1 document

    // Check if monthly reset is needed
    const resetDate = new Date(profile.documents_reset_at || 0);
    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);

    let documentsThisMonth = profile.documents_this_month || 0;
    let creditsBalance = profile.credits_balance || 0;

    if (resetDate < startOfMonth) {
      // Reset monthly counters
      documentsThisMonth = 0;
      creditsBalance = limits.monthlyCredits;
      
      await supabase
        .from('profiles')
        .update({
          documents_this_month: 0,
          credits_balance: limits.monthlyCredits,
          documents_reset_at: new Date().toISOString(),
        })
        .eq('id', user.id);
    }

    // Calculate total available credits (monthly + purchased)
    const totalCredits = creditsBalance + (profile.credits_purchased || 0);
    const documentLimit = getDocumentLimit(plan);

    // Check credit balance - this IS the document limit check
    // 1000 credits = 1 document, so insufficient credits = document limit reached
    if (totalCredits < creditCost) {
      const upgradeMessage = plan === 'free' 
        ? 'Upgrade to Pro for more documents and the ability to purchase credit packs.'
        : 'Purchase a credit pack to continue.';
      
      return NextResponse.json(
        { 
          error: `You've used your ${documentLimit} document${documentLimit > 1 ? 's' : ''} for this month. ${upgradeMessage}`,
          code: 'INSUFFICIENT_CREDITS',
          creditsAvailable: totalCredits,
          creditsNeeded: creditCost,
          documentsUsed: documentsThisMonth,
          documentLimit,
          canBuyCredits: limits.canBuyCredits,
        },
        { status: 403 }
      );
    }

    // Deduct credits (monthly first, then purchased)
    let newCreditsBalance = creditsBalance;
    let newCreditsPurchased = profile.credits_purchased || 0;

    if (creditsBalance >= creditCost) {
      // Use monthly credits
      newCreditsBalance = creditsBalance - creditCost;
    } else {
      // Use remaining monthly + purchased
      const fromPurchased = creditCost - creditsBalance;
      newCreditsBalance = 0;
      newCreditsPurchased = (profile.credits_purchased || 0) - fromPurchased;
    }

    // Update profile with new credits and document count
    const { error: updateError } = await supabase
      .from('profiles')
      .update({
        credits_balance: newCreditsBalance,
        credits_purchased: newCreditsPurchased,
        documents_this_month: documentsThisMonth + 1,
      })
      .eq('id', user.id);

    if (updateError) {
      console.error('Failed to deduct credits:', updateError);
      return NextResponse.json(
        { error: 'Failed to process credits' },
        { status: 500 }
      );
    }

    // Log the credit transaction
    await supabase.from('credit_transactions').insert({
      user_id: user.id,
      amount: -creditCost,
      type: 'document_generation',
      description: `Generated document: ${project.title}`,
      metadata: { projectId, plan },
    });

    // Trigger Inngest function for durable writing (any document type)
    const outlineBody = outline.body || outline.chapters || [];
    const { ids } = await inngest.send({
      name: 'book/write',
      data: {
        projectId,
        userId: user.id,
        title: project.title,
        description: project.description,
        outline: {
          body: outlineBody,
          chapters: outlineBody, // legacy
          frontMatter: outline.frontMatter || [],
          backMatter: outline.backMatter || [],
          templateMeta: outline.templateMeta,
        },
        industry: project.organizations?.industry || 'general',
        voiceProfile,
        plan,
      },
    });

    // Update project status
    await supabase
      .from('projects')
      .update({
        status: 'writing',
        metadata: {
          inngestEventId: ids[0],
          startedAt: new Date().toISOString(),
          totalChapters: outlineBody.length,
          creditsUsed: creditCost,
        },
      })
      .eq('id', projectId);

    return NextResponse.json({
      success: true,
      eventId: ids[0],
      message: 'Book generation started',
      totalChapters: outline.chapters.length,
      creditsUsed: creditCost,
      creditsRemaining: newCreditsBalance + newCreditsPurchased,
    });

  } catch (error) {
    console.error('Book generation error:', error);
    return NextResponse.json(
      { error: 'Failed to start book generation' },
      { status: 500 }
    );
  }
}

// Get book generation status
export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const projectId = searchParams.get('projectId');

    if (!projectId) {
      return NextResponse.json(
        { error: 'projectId is required' },
        { status: 400 }
      );
    }

    // Fetch project with chapters
    const { data: project, error } = await supabase
      .from('projects')
      .select(`
        id,
        title,
        status,
        metadata,
        chapters (
          id,
          title,
          order_index,
          status,
          word_count
        )
      `)
      .eq('id', projectId)
      .eq('user_id', user.id)
      .single();

    if (error || !project) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    }

    const chapters = project.chapters || [];
    const completedChapters = chapters.filter(ch => ch.status === 'complete').length;
    const totalChapters = project.metadata?.totalChapters || chapters.length;
    const totalWords = chapters.reduce((sum, ch) => sum + (ch.word_count || 0), 0);

    return NextResponse.json({
      status: project.status,
      progress: {
        completedChapters,
        totalChapters,
        percentage: totalChapters ? Math.round((completedChapters / totalChapters) * 100) : 0,
      },
      totalWords,
      chapters: chapters.sort((a, b) => a.order_index - b.order_index).map(ch => ({
        id: ch.id,
        title: ch.title,
        status: ch.status,
        wordCount: ch.word_count,
      })),
      startedAt: project.metadata?.startedAt,
      completedAt: project.metadata?.completedAt,
    });

  } catch (error) {
    console.error('Status check error:', error);
    return NextResponse.json(
      { error: 'Failed to check status' },
      { status: 500 }
    );
  }
}
