import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createClient as createServiceClient } from '@supabase/supabase-js';

// Generate share link for a project
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { projectId, platform } = body;

    if (!projectId) {
      return NextResponse.json({ error: 'projectId is required' }, { status: 400 });
    }

    // Verify project ownership
    const { data: project, error: projectError } = await supabase
      .from('projects')
      .select('id, title, user_id')
      .eq('id', projectId)
      .eq('user_id', user.id)
      .single();

    if (projectError || !project) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    }

    // Check if share link already exists for this project
    const { data: existingShare } = await supabase
      .from('share_tracks')
      .select('*')
      .eq('project_id', projectId)
      .eq('user_id', user.id)
      .single();

    if (existingShare) {
      const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://penworth.ai';
      return NextResponse.json({
        shareToken: existingShare.share_token,
        shareUrl: `${appUrl}/shared/${existingShare.share_token}`,
        clickCount: existingShare.click_count,
        uniqueClicks: existingShare.unique_clicks,
        unlocked: existingShare.unlocked,
        unlockedAt: existingShare.unlocked_at,
      });
    }

    // Generate new share token
    const shareToken = generateShareToken();
    
    const { data: newShare, error: insertError } = await supabase
      .from('share_tracks')
      .insert({
        user_id: user.id,
        project_id: projectId,
        share_token: shareToken,
        platform: platform || 'copy_link',
      })
      .select()
      .single();

    if (insertError) {
      throw insertError;
    }

    const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://penworth.ai';

    return NextResponse.json({
      shareToken: newShare.share_token,
      shareUrl: `${appUrl}/shared/${newShare.share_token}`,
      clickCount: 0,
      uniqueClicks: 0,
      unlocked: false,
    });

  } catch (error) {
    console.error('Share link error:', error);
    return NextResponse.json(
      { error: 'Failed to generate share link' },
      { status: 500 }
    );
  }
}

// Track a click on a share link (public endpoint)
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const token = searchParams.get('token');
    const visitorId = searchParams.get('vid'); // Anonymous visitor ID from client

    if (!token) {
      return NextResponse.json({ error: 'Token is required' }, { status: 400 });
    }

    // Use service role client for public access
    const serviceClient = createServiceClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    );

    // Find the share track
    const { data: shareTrack, error } = await serviceClient
      .from('share_tracks')
      .select(`
        *,
        projects (
          id,
          title,
          description,
          status
        ),
        profiles:user_id (
          full_name
        )
      `)
      .eq('share_token', token)
      .single();

    if (error || !shareTrack) {
      return NextResponse.json({ error: 'Share link not found' }, { status: 404 });
    }

    // Increment click count
    const newClickCount = (shareTrack.click_count || 0) + 1;
    
    // For simplicity, assume each new visitorId is unique
    // In production, you'd track visitor IDs in a separate table
    const newUniqueClicks = visitorId ? 
      Math.min(newClickCount, (shareTrack.unique_clicks || 0) + 1) : 
      shareTrack.unique_clicks;

    // Check if unlocked threshold reached (5 unique clicks)
    const shouldUnlock = newUniqueClicks >= 5 && !shareTrack.unlocked;

    const updateData: any = {
      click_count: newClickCount,
      unique_clicks: newUniqueClicks,
    };

    if (shouldUnlock) {
      updateData.unlocked = true;
      updateData.unlocked_at = new Date().toISOString();
    }

    await serviceClient
      .from('share_tracks')
      .update(updateData)
      .eq('id', shareTrack.id);

    // If newly unlocked, give credits to the user
    if (shouldUnlock) {
      const unlockCredits = 100;
      
      // Get current balance and update
      const { data: profileData } = await serviceClient
        .from('profiles')
        .select('credits_balance')
        .eq('id', shareTrack.user_id)
        .single();
      
      const currentBalance = profileData?.credits_balance || 0;
      
      await serviceClient
        .from('profiles')
        .update({ credits_balance: currentBalance + unlockCredits })
        .eq('id', shareTrack.user_id);

      await serviceClient.from('credit_transactions').insert({
        user_id: shareTrack.user_id,
        amount: unlockCredits,
        transaction_type: 'share_unlock',
        reference_id: shareTrack.id,
        notes: `Unlock bonus: ${(shareTrack.projects as any)?.title || 'Shared project'} reached 5 unique clicks`,
      });
    }

    return NextResponse.json({
      valid: true,
      project: {
        title: (shareTrack.projects as any)?.title,
        description: (shareTrack.projects as any)?.description,
        author: (shareTrack.profiles as any)?.full_name || 'Anonymous',
      },
      stats: {
        clickCount: newClickCount,
        uniqueClicks: newUniqueClicks,
        unlocked: shareTrack.unlocked || shouldUnlock,
      },
    });

  } catch (error) {
    console.error('Track click error:', error);
    return NextResponse.json(
      { error: 'Failed to track click' },
      { status: 500 }
    );
  }
}

function generateShareToken(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  let result = '';
  for (let i = 0; i < 12; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}
