import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// GET /api/distributors - List distributors (admin) or get own profile
// POST /api/distributors - Apply to become a distributor
// PATCH /api/distributors - Update distributor profile

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const code = searchParams.get('code');
  const country = searchParams.get('country');
  const stats = searchParams.get('stats');

  // If stats requested, return campaign stats
  if (stats === 'campaign') {
    const campaign = searchParams.get('campaign') || 'operation-viet-but';
    
    const { data: campaignData } = await supabase
      .from('expansion_campaigns')
      .select('*')
      .eq('code', campaign)
      .single();

    if (!campaignData) {
      return NextResponse.json({ error: 'Campaign not found' }, { status: 404 });
    }

    // Get signup count
    const { count: signupCount } = await supabase
      .from('distributor_signups')
      .select('*', { count: 'exact', head: true })
      .eq('campaign', campaign);

    return NextResponse.json({
      campaign: campaignData,
      currentSignups: signupCount || 0,
      progress: ((signupCount || 0) / campaignData.signup_target) * 100,
      daysRemaining: campaignData.end_date 
        ? Math.ceil((new Date(campaignData.end_date).getTime() - Date.now()) / (1000 * 60 * 60 * 24))
        : null,
    });
  }

  // Get distributor by code (for tracking)
  if (code) {
    const { data: distributor } = await supabase
      .from('master_distributors')
      .select('id, full_name, distributor_code, country, tier, status')
      .eq('distributor_code', code)
      .eq('status', 'active')
      .single();

    if (!distributor) {
      return NextResponse.json({ error: 'Distributor not found' }, { status: 404 });
    }

    return NextResponse.json({ distributor });
  }

  // List distributors by country (for admin/leaderboard)
  if (country) {
    const { data: distributors } = await supabase
      .from('master_distributors')
      .select('id, full_name, distributor_code, tier, total_signups, total_conversions')
      .eq('country', country)
      .eq('status', 'active')
      .order('total_signups', { ascending: false })
      .limit(20);

    return NextResponse.json({ distributors: distributors || [] });
  }

  return NextResponse.json({ error: 'Missing parameters' }, { status: 400 });
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { 
    full_name, 
    email, 
    phone, 
    country, 
    region,
    application_data 
  } = body;

  if (!full_name || !email || !country) {
    return NextResponse.json(
      { error: 'Missing required fields: full_name, email, country' },
      { status: 400 }
    );
  }

  // Check if already applied
  const { data: existing } = await supabase
    .from('master_distributors')
    .select('id, status')
    .eq('email', email)
    .single();

  if (existing) {
    return NextResponse.json(
      { error: 'Application already exists', status: existing.status },
      { status: 409 }
    );
  }

  // Generate unique distributor code
  const code = generateDistributorCode(country);

  // Create application
  const { data: distributor, error } = await supabase
    .from('master_distributors')
    .insert({
      full_name,
      email,
      phone,
      country,
      region,
      distributor_code: code,
      status: 'pending',
      application_data: application_data || {},
      signup_deadline: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString(), // 90 days
    })
    .select()
    .single();

  if (error) {
    console.error('Error creating distributor:', error);
    return NextResponse.json({ error: 'Failed to create application' }, { status: 500 });
  }

  // TODO: Send confirmation email
  // await sendDistributorApplicationEmail(email, { full_name, code });

  return NextResponse.json({
    success: true,
    message: 'Application submitted successfully',
    distributor_code: code,
    distributor_id: distributor.id,
  });
}

// Track a signup attributed to a distributor
export async function PATCH(req: NextRequest) {
  const body = await req.json();
  const { action } = body;

  if (action === 'track_signup') {
    const { 
      distributor_code, 
      user_id, 
      source, 
      campaign,
      landing_page,
      utm_source,
      utm_medium,
      utm_campaign 
    } = body;

    if (!distributor_code || !user_id) {
      return NextResponse.json(
        { error: 'Missing distributor_code or user_id' },
        { status: 400 }
      );
    }

    // Get distributor
    const { data: distributor } = await supabase
      .from('master_distributors')
      .select('id')
      .eq('distributor_code', distributor_code)
      .eq('status', 'active')
      .single();

    if (!distributor) {
      return NextResponse.json({ error: 'Invalid distributor code' }, { status: 404 });
    }

    // Record signup
    const { data: signup, error } = await supabase
      .from('distributor_signups')
      .insert({
        distributor_id: distributor.id,
        user_id,
        source: source || 'direct',
        campaign: campaign || 'operation-viet-but',
        landing_page,
        utm_source,
        utm_medium,
        utm_campaign,
        referral_code: distributor_code,
      })
      .select()
      .single();

    if (error) {
      console.error('Error recording signup:', error);
      return NextResponse.json({ error: 'Failed to record signup' }, { status: 500 });
    }

    // Update distributor stats
    await supabase.rpc('increment_distributor_signups', { 
      distributor_id: distributor.id 
    });

    // Update campaign stats
    if (campaign) {
      await supabase.rpc('increment_campaign_signups', { 
        campaign_code: campaign 
      });
    }

    return NextResponse.json({ success: true, signup_id: signup.id });
  }

  if (action === 'track_conversion') {
    const { user_id, payment_amount } = body;

    if (!user_id) {
      return NextResponse.json({ error: 'Missing user_id' }, { status: 400 });
    }

    // Find the signup record
    const { data: signup } = await supabase
      .from('distributor_signups')
      .select('id, distributor_id, converted_to_paid')
      .eq('user_id', user_id)
      .single();

    if (!signup) {
      // User wasn't referred by a distributor
      return NextResponse.json({ success: true, attributed: false });
    }

    if (signup.converted_to_paid) {
      // Already converted
      return NextResponse.json({ success: true, already_converted: true });
    }

    // Update signup record
    const commission = (payment_amount || 0) * 0.30; // 30% commission
    
    await supabase
      .from('distributor_signups')
      .update({
        converted_to_paid: true,
        first_payment_at: new Date().toISOString(),
        total_payments: payment_amount || 0,
        commission_due: commission,
      })
      .eq('id', signup.id);

    // Update distributor stats
    await supabase.rpc('increment_distributor_conversions', { 
      distributor_id: signup.distributor_id,
      revenue: payment_amount || 0,
      commission: commission
    });

    return NextResponse.json({ 
      success: true, 
      attributed: true, 
      commission_due: commission 
    });
  }

  return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
}

function generateDistributorCode(country: string): string {
  const prefix = country.substring(0, 2).toUpperCase();
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let suffix = '';
  for (let i = 0; i < 6; i++) {
    suffix += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return `${prefix}-${suffix}`;
}
