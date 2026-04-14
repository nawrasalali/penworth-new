import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

// GET: Get user's credit balance and history
export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Get profile with balance
    const { data: profile } = await supabase
      .from('profiles')
      .select('credits_balance')
      .eq('id', user.id)
      .single();

    // Get recent transactions
    const { data: transactions } = await supabase
      .from('credits_ledger')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(50);

    // Calculate stats
    const earned = transactions
      ?.filter(t => t.amount > 0)
      .reduce((sum, t) => sum + t.amount, 0) || 0;
    
    const spent = transactions
      ?.filter(t => t.amount < 0)
      .reduce((sum, t) => sum + Math.abs(t.amount), 0) || 0;

    return NextResponse.json({
      balance: profile?.credits_balance || 0,
      stats: {
        totalEarned: earned,
        totalSpent: spent,
      },
      transactions: transactions?.map(t => ({
        id: t.id,
        amount: t.amount,
        type: t.transaction_type,
        description: t.description,
        balanceAfter: t.balance_after,
        createdAt: t.created_at,
      })) || [],
    });
  } catch (error) {
    console.error('Credits error:', error);
    return NextResponse.json(
      { error: 'Failed to get credits' },
      { status: 500 }
    );
  }
}

// POST: Use credits (for AI generation, etc.)
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { amount, type, description, referenceId } = body;

    if (!amount || amount <= 0) {
      return NextResponse.json({ error: 'Invalid amount' }, { status: 400 });
    }

    // Get current balance
    const { data: profile } = await supabase
      .from('profiles')
      .select('credits_balance')
      .eq('id', user.id)
      .single();

    const currentBalance = profile?.credits_balance || 0;

    if (currentBalance < amount) {
      return NextResponse.json({ 
        error: 'Insufficient credits',
        balance: currentBalance,
        required: amount,
      }, { status: 402 });
    }

    const newBalance = currentBalance - amount;

    // Update balance
    const { error: updateError } = await supabase
      .from('profiles')
      .update({ credits_balance: newBalance })
      .eq('id', user.id);

    if (updateError) throw updateError;

    // Record transaction
    await supabase
      .from('credits_ledger')
      .insert({
        user_id: user.id,
        amount: -amount,
        balance_after: newBalance,
        transaction_type: type || 'usage',
        reference_id: referenceId,
        description: description || 'Credit usage',
      });

    return NextResponse.json({
      success: true,
      previousBalance: currentBalance,
      amountUsed: amount,
      newBalance,
    });
  } catch (error) {
    console.error('Use credits error:', error);
    return NextResponse.json(
      { error: 'Failed to use credits' },
      { status: 500 }
    );
  }
}
