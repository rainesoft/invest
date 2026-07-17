import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';

const PAYSTACK_SECRET_KEY = process.env.PAYSTACK_SECRET_KEY!;
const NEXT_PUBLIC_SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const supabase = createClient(NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

export async function POST(req: Request) {
  try {
    const rawBody = await req.text();
    const signature = req.headers.get('x-paystack-signature');

    if (!signature) {
      return NextResponse.json({ error: 'No signature' }, { status: 400 });
    }

    // Validate Paystack Signature
    const hash = crypto.createHmac('sha512', PAYSTACK_SECRET_KEY).update(rawBody).digest('hex');
    if (hash !== signature) {
      return NextResponse.json({ error: 'Invalid signature' }, { status: 400 });
    }

    const event = JSON.parse(rawBody);
    console.log('Paystack Webhook Received:', event.event);

    switch (event.event) {
      case 'charge.success': {
        const { reference, amount, currency, metadata } = event.data;
        const userId = metadata?.custom_fields?.find((f: any) => f.variable_name === 'user_id')?.value;
        
        if (!userId) {
          console.error('Charge missing user_id metadata', reference);
          break;
        }

        // Convert kobo/cents back to decimal
        const decimalAmount = amount / 100;

        // 1. Get Platform Clearing Wallet
        const { data: platformWallet } = await supabase
          .from('wallets')
          .select('id')
          .eq('is_platform', true)
          .eq('currency', currency)
          .single();

        if (!platformWallet) {
          console.error(`Platform wallet for ${currency} not found`);
          break;
        }

        // 2. Get User Wallet (or create if it doesn't exist)
        let { data: userWallet } = await supabase
          .from('wallets')
          .select('id')
          .eq('user_id', userId)
          .eq('currency', currency)
          .single();

        if (!userWallet) {
          const { data: newWallet } = await supabase
            .from('wallets')
            .insert({ user_id: userId, currency: currency })
            .select('id')
            .single();
          userWallet = newWallet;
        }

        if (!userWallet) {
          console.error(`Failed to find or create user wallet for ${userId}`);
          break;
        }

        // 3. Process the transfer
        const { error: rpcError } = await supabase.rpc('process_transfer', {
          sender_wallet_id: platformWallet.id,
          receiver_wallet_id: userWallet.id,
          transfer_amount: decimalAmount,
          txn_reference: reference,
          txn_description: 'Paystack Deposit',
          txn_type: 'DEPOSIT'
        });

        if (rpcError) {
          console.error('Ledger error on deposit:', rpcError);
        }
        break;
      }
      
      case 'transfer.success': {
        const { reference } = event.data;
        
        // Mark withdrawal as completed
        const { error } = await supabase
          .from('withdrawal_requests')
          .update({ status: 'COMPLETED' })
          .eq('reference_code', reference);

        if (error) {
          console.error('Failed to update withdrawal status:', error);
        }
        break;
      }

      case 'transfer.failed':
      case 'transfer.reversed': {
        const { reference } = event.data;
        
        // Reverse the escrow lock
        const { error: rpcError } = await supabase.rpc('reverse_withdrawal', {
          p_reference: reference
        });

        if (rpcError) {
          console.error('Failed to reverse failed withdrawal:', rpcError);
        }
        break;
      }
    }

    return NextResponse.json({ status: 'success' });
    
  } catch (error: any) {
    console.error('Webhook Error:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
