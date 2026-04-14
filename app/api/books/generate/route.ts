import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { inngest } from '@/inngest/client';

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

    // Fetch project to verify ownership and get details
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

    // Check user's credits/subscription (simple check)
    const { data: profile } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', user.id)
      .single();

    // Get organization subscription tier
    const { data: orgMember } = await supabase
      .from('org_members')
      .select('organizations(subscription_tier)')
      .eq('user_id', user.id)
      .single();

    const tier = (orgMember?.organizations as any)?.subscription_tier || 'free';

    // Free tier cannot generate books
    if (tier === 'free') {
      return NextResponse.json(
        { error: 'Book generation requires Pro plan or higher' },
        { status: 403 }
      );
    }

    // Trigger Inngest function for durable book writing
    const { ids } = await inngest.send({
      name: 'book/write',
      data: {
        projectId,
        userId: user.id,
        title: project.title,
        description: project.description,
        outline,
        industry: project.organizations?.industry || 'general',
        voiceProfile,
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
          totalChapters: outline.chapters.length,
        },
      })
      .eq('id', projectId);

    return NextResponse.json({
      success: true,
      eventId: ids[0],
      message: 'Book generation started',
      totalChapters: outline.chapters.length,
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
