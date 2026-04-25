import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

// GET: Get user's referral data
export async function GET() {
  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Get user's referral code and stats
    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('referral_code, credits_balance, lifetime_credits_earned')
      .eq('id', user.id)
      .single();

    if (profileError) {
      return NextResponse.json({ error: 'Profile not found' }, { status: 404 });
    }

    // Get referral stats
    const { data: referrals, error: referralsError } = await supabase
      .from('referrals')
      .select(`
        id,
        status,
        credits_awarded,
        created_at,
        qualified_at,
        referee:referee_id (
          email,
          full_name
        )
      `)
      .eq('referrer_id', user.id)
      .order('created_at', { ascending: false });

    // Calculate stats
    const totalReferrals = referrals?.length || 0;
    const creditedReferrals = referrals?.filter(r => r.status === 'credited').length || 0;
    const pendingReferrals = referrals?.filter(r => r.status === 'pending').length || 0;
    const totalCreditsEarned = referrals
      ?.filter(r => r.status === 'credited')
      .reduce((sum, r) => sum + (r.credits_awarded || 0), 0) || 0;

    // Get recent credit transactions
    const { data: transactions } = await supabase
      .from('credit_transactions')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(20);

    const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://penworth.ai';

    return NextResponse.json({
      referralCode: profile.referral_code,
      referralLink: `${appUrl}/signup?ref=${profile.referral_code}`,
      creditsBalance: profile.credits_balance || 0,
      lifetimeCreditsEarned: profile.lifetime_credits_earned || 0,
      stats: {
        totalReferrals,
        creditedReferrals,
        pendingReferrals,
        totalCreditsEarned,
      },
      referrals: referrals?.map(r => ({
        id: r.id,
        status: r.status,
        creditsAwarded: r.credits_awarded,
        createdAt: r.created_at,
        qualifiedAt: r.qualified_at,
        referee: {
          email: (r.referee as any)?.email ? 
            (r.referee as any).email.replace(/(.{2}).*(@.*)/, '$1***$2') : 'Unknown',
          name: (r.referee as any)?.full_name || 'Anonymous',
        },
      })) || [],
      recentTransactions: transactions || [],
    });

  } catch (error) {
    console.error('Referral data error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch referral data' },
      { status: 500 }
    );
  }
}

// POST: Apply referral code during signup
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { referralCode } = body;

    if (!referralCode) {
      return NextResponse.json({ error: 'Referral code is required' }, { status: 400 });
    }

    // Check if user already has a referrer
    const { data: currentProfile } = await supabase
      .from('profiles')
      .select('referred_by')
      .eq('id', user.id)
      .single();

    if (currentProfile?.referred_by) {
      return NextResponse.json(
        { error: 'You have already been referred by someone' },
        { status: 400 }
      );
    }

    // Find the referrer by code
    const { data: referrer, error: referrerError } = await supabase
      .from('profiles')
      .select('id, email, referral_code')
      .eq('referral_code', referralCode.toUpperCase())
      .single();

    if (referrerError || !referrer) {
      return NextResponse.json({ error: 'Invalid referral code' }, { status: 400 });
    }

    // Can't refer yourself
    if (referrer.id === user.id) {
      return NextResponse.json({ error: 'You cannot refer yourself' }, { status: 400 });
    }

    // Update user's profile with referrer
    const { error: updateError } = await supabase
      .from('profiles')
      .update({ referred_by: referrer.id })
      .eq('id', user.id);

    if (updateError) {
      throw updateError;
    }

    // Create referral record
    const { error: referralError } = await supabase
      .from('referrals')
      .insert({
        referrer_id: referrer.id,
        referee_id: user.id,
        status: 'pending',
      });

    if (referralError) {
      // If duplicate, that's okay
      if (!referralError.message.includes('duplicate')) {
        throw referralError;
      }
    }

    // Give welcome bonus credits to new user (100 credits — symbolic
    // thank-you; not enough to write a full document, encouraging the
    // referee to engage further by upgrading or topping up).
    const welcomeCredits = 100;
    
    // Read current balance and increment — overwriting would zero out
    // any credits the user already had (e.g. from monthly free grant).
    const { data: refereeProfile } = await supabase
      .from('profiles')
      .select('credits_balance, lifetime_credits_earned')
      .eq('id', user.id)
      .single();

    const currentBalance = refereeProfile?.credits_balance || 0;
    const currentLifetime = refereeProfile?.lifetime_credits_earned || 0;

    await supabase
      .from('profiles')
      .update({
        credits_balance: currentBalance + welcomeCredits,
        lifetime_credits_earned: currentLifetime + welcomeCredits,
      })
      .eq('id', user.id);

    await supabase.from('credit_transactions').insert({
      user_id: user.id,
      amount: welcomeCredits,
      transaction_type: 'welcome_bonus',
      notes: `Welcome bonus via referral code ${referralCode}`,
    });

    return NextResponse.json({
      success: true,
      message: 'Referral code applied successfully',
      welcomeCredits,
    });

  } catch (error) {
    console.error('Apply referral error:', error);
    return NextResponse.json(
      { error: 'Failed to apply referral code' },
      { status: 500 }
    );
  }
}
