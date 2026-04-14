import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

const UNLOCK_THRESHOLD = 5; // Unique clicks required to unlock

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { shareCode, fingerprint } = body;

    if (!shareCode || !fingerprint) {
      return NextResponse.json({ error: 'Missing parameters' }, { status: 400 });
    }

    const supabase = await createClient();

    // Find the share link
    const { data: shareLink, error: slError } = await supabase
      .from('share_links')
      .select('id, click_count, unique_clicks, unlocked_at, user_id')
      .eq('share_code', shareCode)
      .single();

    if (slError || !shareLink) {
      return NextResponse.json({ error: 'Share link not found' }, { status: 404 });
    }

    // Try to record unique click
    const { error: clickError } = await supabase
      .from('share_link_clicks')
      .insert({
        share_link_id: shareLink.id,
        visitor_fingerprint: fingerprint,
      });

    // Update click count
    const isUniqueClick = !clickError || !clickError.message.includes('duplicate');
    
    const newClickCount = shareLink.click_count + 1;
    const newUniqueClicks = isUniqueClick ? shareLink.unique_clicks + 1 : shareLink.unique_clicks;

    // Check if should unlock
    const shouldUnlock = !shareLink.unlocked_at && newUniqueClicks >= UNLOCK_THRESHOLD;

    // Update share link stats
    await supabase
      .from('share_links')
      .update({
        click_count: newClickCount,
        unique_clicks: newUniqueClicks,
        unlocked_at: shouldUnlock ? new Date().toISOString() : shareLink.unlocked_at,
      })
      .eq('id', shareLink.id);

    // If just unlocked, notify the user (could trigger email via Resend)
    if (shouldUnlock) {
      // Award credits or unlock watermark-free download
      console.log(`Share link ${shareCode} unlocked for user ${shareLink.user_id}`);
      
      // TODO: Send notification email via Resend
    }

    return NextResponse.json({
      success: true,
      isUnique: isUniqueClick,
      totalClicks: newClickCount,
      uniqueClicks: newUniqueClicks,
      isUnlocked: shouldUnlock || !!shareLink.unlocked_at,
    });
  } catch (error) {
    console.error('Track share error:', error);
    return NextResponse.json(
      { error: 'Failed to track click' },
      { status: 500 }
    );
  }
}
