import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';

const PAYSTACK_SECRET_KEY = process.env.PAYSTACK_SECRET_KEY!;
const NEXT_PUBLIC_SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const supabase = createClient(NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

export async function POST(req: Request) {
  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return NextResponse.json({ error: 'Missing Authorization header' }, { status: 401 });
    }

    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { amount, currency, walletId, destination } = await req.json();
    if (!amount || !currency || !walletId || !destination) {
      return NextResponse.json({ error: 'Amount, currency, walletId, and destination are required' }, { status: 400 });
    }

    const reference = `WDL-${crypto.randomUUID()}`;

    // 1. Lock the funds in Escrow via the secure RPC
    const { data: withdrawalId, error: rpcError } = await supabase.rpc('request_withdrawal', {
      p_user_id: user.id,
      p_wallet_id: walletId,
      p_amount: amount,
      p_currency: currency,
      p_reference: reference,
      p_destination: destination
    });

    if (rpcError) {
      console.error('Withdrawal RPC Error:', rpcError);
      return NextResponse.json({ error: rpcError.message || 'Insufficient funds or invalid wallet' }, { status: 400 });
    }

    // 2. Fetch the scheduled processing date
    const { data: requestRecord } = await supabase
      .from('withdrawal_requests')
      .select('scheduled_for')
      .eq('id', withdrawalId)
      .single();

    // The transfer is now queued and scheduled for the 1st or 15th.
    return NextResponse.json({ 
      status: 'SCHEDULED',
      reference: reference,
      scheduled_for: requestRecord?.scheduled_for,
      message: 'Withdrawal request queued successfully'
    });
    
  } catch (error: any) {
    console.error('Withdrawal Init Error:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
