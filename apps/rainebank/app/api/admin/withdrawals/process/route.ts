import { NextResponse } from 'next/server';
import { supabaseServer } from '@lib/supabase-server';

export async function POST(req: Request) {
  try {
    const supabase = supabaseServer();
    const { data: { session }, error: sessionError } = await supabase.auth.getSession();

    if (sessionError || !session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Check if admin
    const { data: userData, error: userError } = await supabase
      .from('users')
      .select('is_admin')
      .eq('id', session.user.id)
      .single();

    if (userError || !userData?.is_admin) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // 1. Fetch pending withdrawals
    const { data: pendingWithdrawals, error: fetchError } = await supabase
      .from('withdrawal_requests')
      .select('*')
      .eq('status', 'PENDING');

    if (fetchError) {
      console.error('Failed to fetch pending withdrawals:', fetchError);
      return NextResponse.json({ error: 'Failed to fetch pending withdrawals' }, { status: 500 });
    }

    if (!pendingWithdrawals || pendingWithdrawals.length === 0) {
      return NextResponse.json({ processedCount: 0, message: 'No pending withdrawals found' });
    }

    let processedCount = 0;

    // Process sequentially (or in parallel if desired, but sequential is safer for ledger)
    for (const withdrawal of pendingWithdrawals) {
      try {
        // --- PAYSTACK SIMULATION ---
        // In a real environment, we would call the Paystack Transfer API here:
        // const paystackRes = await fetch('https://api.paystack.co/transfer', { ... })
        // If it fails, we continue to the next withdrawal.
        await new Promise(resolve => setTimeout(resolve, 100)); // Simulate API latency
        
        // --- COMPLETE WITHDRAWAL LOGIC ---
        // Fetch platform wallet for this currency
        const { data: platformWallet } = await supabase
          .from('wallets')
          .select('id, balance')
          .eq('is_platform', true)
          .eq('currency', withdrawal.currency)
          .single();

        if (!platformWallet) {
          console.error(`Platform wallet for ${withdrawal.currency} not found`);
          continue;
        }

        // Update withdrawal status
        await supabase
          .from('withdrawal_requests')
          .update({ status: 'COMPLETED', updated_at: new Date().toISOString() })
          .eq('id', withdrawal.id);

        // Deduct from platform wallet (since funds physically left the bank account)
        await supabase
          .from('wallets')
          .update({ balance: Number(platformWallet.balance) - Number(withdrawal.amount) })
          .eq('id', platformWallet.id);

        // Record physical payout ledger transaction
        const { data: txn } = await supabase
          .from('ledger_transactions')
          .insert({
            reference_code: withdrawal.reference_code,
            description: 'Batch Processed physical payout to user',
            type: 'BATCH_PAYOUT'
          })
          .select('id')
          .single();

        if (txn) {
          await supabase
            .from('ledger_entries')
            .insert({
              transaction_id: txn.id,
              wallet_id: platformWallet.id,
              amount: -Number(withdrawal.amount)
            });
        }

        processedCount++;
      } catch (err) {
        console.error(`Unexpected error processing withdrawal ${withdrawal.id}:`, err);
      }
    }

    return NextResponse.json({ processedCount, message: `Successfully processed ${processedCount} of ${pendingWithdrawals.length} withdrawals.` });

  } catch (error: any) {
    console.error('Batch process error:', error);
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}
