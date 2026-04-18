import { SupabaseClient } from '@supabase/supabase-js';

interface WatermarkStatus {
  shouldShowWatermark: boolean;
  reason: 'paid_tier' | 'purchased_credits' | 'referrals' | 'free_with_watermark';
}

/**
 * Check if user's documents should display the "by penworth.ai" watermark.
 * 
 * Watermark is REMOVED if:
 * - User is on a paid tier (pro, max, enterprise)
 * - User is on free tier but has purchased credit packs
 * - User is on free tier but has successful referrals
 * 
 * Watermark is SHOWN if:
 * - User is on free tier with no purchases and no referrals
 */
export async function getWatermarkStatus(
  supabase: SupabaseClient,
  userId: string
): Promise<WatermarkStatus> {
  const { data: profile } = await supabase
    .from('profiles')
    .select('plan, has_purchased_credits, has_referred_users')
    .eq('id', userId)
    .single();

  if (!profile) {
    // Default to showing watermark if no profile found
    return { shouldShowWatermark: true, reason: 'free_with_watermark' };
  }

  // 'plan' is the actual column on profiles — 'free' | 'pro' | 'max' | 'enterprise'.
  // (Previous code queried 'subscription_tier' which doesn't exist; that made
  // every paid user fall into the 'free' branch and show the watermark.)
  const tier = profile.plan || 'free';

  // Paid tiers never have watermark
  if (tier !== 'free') {
    return { shouldShowWatermark: false, reason: 'paid_tier' };
  }

  // Free tier users who purchased credits
  if (profile.has_purchased_credits) {
    return { shouldShowWatermark: false, reason: 'purchased_credits' };
  }

  // Free tier users who have referrals
  if (profile.has_referred_users) {
    return { shouldShowWatermark: false, reason: 'referrals' };
  }

  // Free tier with no purchases or referrals
  return { shouldShowWatermark: true, reason: 'free_with_watermark' };
}

/**
 * Check if user can create a new document on free tier.
 * 
 * Free tier rules:
 * - First month: 1 free document (1000 credits)
 * - After first month: Must top up or upgrade to create new documents
 * - Account stays active forever (can view existing documents)
 */
export async function canCreateDocument(
  supabase: SupabaseClient,
  userId: string
): Promise<{ allowed: boolean; reason: string }> {
  const { data: profile } = await supabase
    .from('profiles')
    .select('plan, credits_balance, credits_purchased, free_document_used_at, created_at')
    .eq('id', userId)
    .single();

  if (!profile) {
    return { allowed: false, reason: 'Profile not found' };
  }

  const tier = profile.plan || 'free';

  // Paid tiers: check credits balance
  if (tier !== 'free') {
    if ((profile.credits_balance || 0) >= 1000) {
      return { allowed: true, reason: 'Has credits' };
    }
    return { allowed: false, reason: 'Insufficient credits. Top up or wait for monthly refresh.' };
  }

  // Free tier with purchased credits
  if ((profile.credits_purchased || 0) >= 1000) {
    return { allowed: true, reason: 'Has purchased credits' };
  }

  // Free tier: check if first month and hasn't used free document
  const accountCreated = new Date(profile.created_at);
  const oneMonthAfterCreation = new Date(accountCreated);
  oneMonthAfterCreation.setMonth(oneMonthAfterCreation.getMonth() + 1);
  const now = new Date();

  // Still in first month
  if (now <= oneMonthAfterCreation) {
    // Check if already used free document
    if (!profile.free_document_used_at) {
      return { allowed: true, reason: 'Free document available (first month)' };
    }
    return { 
      allowed: false, 
      reason: 'Free document already used. Top up credits or upgrade to create more.' 
    };
  }

  // After first month on free tier with no credits
  return { 
    allowed: false, 
    reason: 'Free trial period ended. Top up credits or upgrade to continue creating documents.' 
  };
}

/**
 * Mark the free document as used (for free tier users)
 */
export async function markFreeDocumentUsed(
  supabase: SupabaseClient,
  userId: string
): Promise<void> {
  await supabase
    .from('profiles')
    .update({ free_document_used_at: new Date().toISOString() })
    .eq('id', userId);
}
