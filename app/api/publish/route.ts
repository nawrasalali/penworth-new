import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { PLAN_LIMITS } from '@/lib/plans';

/**
 * Publishing API
 * 
 * v2 Spec: Free users CAN publish to Amazon KDP (this is the PLG hook)
 * - Free: KDP only
 * - Pro: KDP only  
 * - Max: KDP, IngramSpark, Draft2Digital, Lulu, Google Play Books
 */

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { projectId, platform, metadata } = body;

    if (!projectId || !platform) {
      return NextResponse.json(
        { error: 'projectId and platform are required' },
        { status: 400 }
      );
    }

    // Verify project ownership and completion
    const { data: project, error: projectError } = await supabase
      .from('projects')
      .select('*, chapters(*)')
      .eq('id', projectId)
      .eq('user_id', user.id)
      .single();

    if (projectError || !project) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    }

    if (project.status !== 'complete') {
      return NextResponse.json(
        { error: 'Project must be complete before publishing' },
        { status: 400 }
      );
    }

    // Get user plan
    const { data: profile } = await supabase
      .from('profiles')
      .select('plan')
      .eq('id', user.id)
      .single();

    const plan = (profile?.plan as keyof typeof PLAN_LIMITS) || 'free';
    const limits = PLAN_LIMITS[plan];

    // Check if platform is allowed for this plan
    if (!limits.publishingConnectors.includes(platform)) {
      const allowedPlatforms = limits.publishingConnectors.join(', ');
      return NextResponse.json(
        { 
          error: `${platform} is not available on the ${plan} plan. Available: ${allowedPlatforms}`,
          code: 'PLATFORM_NOT_ALLOWED',
          allowedPlatforms: limits.publishingConnectors,
          upgradeRequired: plan !== 'max',
        },
        { status: 403 }
      );
    }

    // Generate publishing package based on platform
    const publishingData = await generatePublishingPackage(project, platform, metadata);

    // Record publishing attempt
    const { data: publishRecord, error: recordError } = await supabase
      .from('publishing_records')
      .insert({
        project_id: projectId,
        user_id: user.id,
        platform,
        status: 'pending',
        metadata: {
          ...metadata,
          initiatedAt: new Date().toISOString(),
          plan,
        },
      })
      .select()
      .single();

    if (recordError) {
      // Table might not exist yet, log and continue
      console.log('Publishing record insert skipped:', recordError.message);
    }

    return NextResponse.json({
      success: true,
      platform,
      publishingData,
      message: getPublishingInstructions(platform),
      recordId: publishRecord?.id,
    });

  } catch (error) {
    console.error('Publishing error:', error);
    return NextResponse.json(
      { error: 'Failed to prepare publishing' },
      { status: 500 }
    );
  }
}

// Get available publishing platforms for user
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

    const plan = (profile?.plan as keyof typeof PLAN_LIMITS) || 'free';
    const limits = PLAN_LIMITS[plan];

    const allPlatforms = [
      {
        id: 'kdp',
        name: 'Amazon KDP',
        description: 'Self-publish on Amazon Kindle Direct Publishing',
        url: 'https://kdp.amazon.com',
        available: limits.publishingConnectors.includes('kdp'),
        icon: 'amazon',
      },
      {
        id: 'ingram_spark',
        name: 'IngramSpark',
        description: 'Wide distribution to bookstores worldwide',
        url: 'https://www.ingramspark.com',
        available: limits.publishingConnectors.includes('ingram_spark'),
        icon: 'book',
        requiredPlan: 'max',
      },
      {
        id: 'd2d',
        name: 'Draft2Digital',
        description: 'Distribute to Apple Books, Kobo, B&N and more',
        url: 'https://www.draft2digital.com',
        available: limits.publishingConnectors.includes('d2d'),
        icon: 'share',
        requiredPlan: 'max',
      },
      {
        id: 'lulu',
        name: 'Lulu',
        description: 'Print-on-demand books and global distribution',
        url: 'https://www.lulu.com',
        available: limits.publishingConnectors.includes('lulu'),
        icon: 'printer',
        requiredPlan: 'max',
      },
      {
        id: 'google_play',
        name: 'Google Play Books',
        description: 'Publish directly to Google Play Books store',
        url: 'https://play.google.com/books/publish',
        available: limits.publishingConnectors.includes('google_play'),
        icon: 'play',
        requiredPlan: 'max',
      },
    ];

    return NextResponse.json({
      plan,
      platforms: allPlatforms,
      availablePlatforms: allPlatforms.filter(p => p.available),
    });

  } catch (error) {
    console.error('Get platforms error:', error);
    return NextResponse.json(
      { error: 'Failed to get publishing platforms' },
      { status: 500 }
    );
  }
}

/**
 * Generate publishing package for the specified platform
 */
async function generatePublishingPackage(
  project: any,
  platform: string,
  metadata?: any
): Promise<any> {
  const chapters = project.chapters || [];
  const sortedChapters = chapters.sort((a: any, b: any) => a.order_index - b.order_index);
  
  const totalWordCount = sortedChapters.reduce(
    (sum: number, ch: any) => sum + (ch.word_count || 0), 
    0
  );

  const basePackage = {
    title: project.title,
    description: project.description,
    wordCount: totalWordCount,
    chapterCount: sortedChapters.length,
    chapters: sortedChapters.map((ch: any) => ({
      title: ch.title,
      wordCount: ch.word_count,
    })),
    createdAt: project.created_at,
    completedAt: project.metadata?.completedAt,
  };

  // Platform-specific formatting
  switch (platform) {
    case 'kdp':
      return {
        ...basePackage,
        platform: 'Amazon KDP',
        requirements: {
          format: 'DOCX or PDF',
          coverSize: '2560 x 1600 pixels (for eBook)',
          isbn: 'Optional (KDP provides free ASIN)',
        },
        uploadUrl: 'https://kdp.amazon.com/en_US/bookshelf',
        helpUrl: 'https://kdp.amazon.com/help',
      };
    
    case 'ingram_spark':
      return {
        ...basePackage,
        platform: 'IngramSpark',
        requirements: {
          format: 'PDF (print-ready)',
          coverSize: 'Based on trim size + bleed',
          isbn: 'Required',
        },
        uploadUrl: 'https://www.ingramspark.com/portal',
        helpUrl: 'https://www.ingramspark.com/resources',
      };
    
    case 'd2d':
      return {
        ...basePackage,
        platform: 'Draft2Digital',
        requirements: {
          format: 'DOCX, EPUB, or PDF',
          coverSize: '1600 x 2400 pixels minimum',
          isbn: 'Optional (D2D provides free ISBNs)',
        },
        uploadUrl: 'https://www.draft2digital.com/book/new',
        helpUrl: 'https://www.draft2digital.com/support',
      };
    
    case 'lulu':
      return {
        ...basePackage,
        platform: 'Lulu',
        requirements: {
          format: 'PDF (for print), EPUB (for eBook)',
          coverSize: 'Based on book size',
          isbn: 'Optional (Lulu provides free ISBNs)',
        },
        uploadUrl: 'https://www.lulu.com/create/new',
        helpUrl: 'https://help.lulu.com',
      };
    
    case 'google_play':
      return {
        ...basePackage,
        platform: 'Google Play Books',
        requirements: {
          format: 'EPUB or PDF',
          coverSize: 'Minimum 640 x 1024 pixels',
          isbn: 'Recommended',
        },
        uploadUrl: 'https://play.google.com/books/publish',
        helpUrl: 'https://support.google.com/books/partner',
      };
    
    default:
      return basePackage;
  }
}

/**
 * Get step-by-step publishing instructions
 */
function getPublishingInstructions(platform: string): string {
  const instructions: Record<string, string> = {
    kdp: `
1. Export your book as DOCX or PDF from Penworth
2. Go to kdp.amazon.com and sign in (or create account)
3. Click "Create" → "Kindle eBook" or "Paperback"
4. Upload your manuscript and cover
5. Set your price and territories
6. Submit for review (usually 24-72 hours)
    `.trim(),
    
    ingram_spark: `
1. Export your book as print-ready PDF
2. Go to ingramspark.com and sign in
3. Click "Add New Title"
4. Upload interior PDF and cover
5. Purchase ISBN if needed
6. Set distribution and pricing
7. Submit for review
    `.trim(),
    
    d2d: `
1. Export your book as DOCX or EPUB
2. Go to draft2digital.com and sign in
3. Click "Add Book"
4. Upload manuscript - D2D converts to all formats
5. Upload cover (1600x2400px minimum)
6. Select distribution channels
7. Publish (no review wait time)
    `.trim(),
    
    lulu: `
1. Export your book as PDF (print) or EPUB (eBook)
2. Go to lulu.com and sign in
3. Click "Create" → select product type
4. Upload your files
5. Choose book size and finish
6. Set price and distribution
7. Order proof or publish directly
    `.trim(),
    
    google_play: `
1. Export your book as EPUB or PDF
2. Go to play.google.com/books/publish
3. Sign in with your Google account
4. Click "Add book"
5. Upload your manuscript and cover
6. Fill in metadata and pricing
7. Submit for review (1-2 weeks)
    `.trim(),
  };

  return instructions[platform] || 'Follow the platform\'s publishing guide.';
}
