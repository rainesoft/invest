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

    const { amount, currency } = await req.json();
    if (!amount || !currency) {
      return NextResponse.json({ error: 'Amount and currency are required' }, { status: 400 });
    }

    // Generate unique reference code for ledger constraints
    const reference = `DEP-${crypto.randomUUID()}`;

    // 1. Get the target wallet
    const { data: wallet, error: walletError } = await supabase
      .from('wallets')
      .select('id')
      .eq('user_id', user.id)
      .eq('currency', currency)
      .single();

    if (walletError || !wallet) {
      return NextResponse.json({ error: 'Wallet not found for specified currency' }, { status: 400 });
    }

    // 2. Insert into deposit_requests table as PENDING_PAYMENT
    const { error: insertError } = await supabase
      .from('deposit_requests')
      .insert({
        user_id: user.id,
        wallet_id: wallet.id,
        amount: amount,
        currency: currency,
        reference_code: reference,
        status: 'PENDING_PAYMENT',
        payment_gateway: 'paystack'
      });

    if (insertError) {
      console.error('Failed to create deposit request:', insertError);
      return NextResponse.json({ error: 'Failed to initiate deposit' }, { status: 500 });
    }

    // Initialize Paystack Checkout
    const response = await fetch('https://api.paystack.co/transaction/initialize', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${PAYSTACK_SECRET_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        email: user.email,
        amount: Math.round(amount * 100), // Paystack requires smallest currency unit
        currency: currency,
        reference: reference,
        metadata: {
          custom_fields: [
            {
              display_name: "User ID",
              variable_name: "user_id",
              value: user.id
            }
          ]
        }
      })
    });

    const data = await response.json();
    
    if (!data.status) {
      return NextResponse.json({ error: data.message }, { status: 400 });
    }

    return NextResponse.json({ 
      authorization_url: data.data.authorization_url,
      reference: reference
    });
    
  } catch (error: any) {
    console.error('Deposit Init Error:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
