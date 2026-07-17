import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

// Initialize Supabase with Service Role Key to bypass RLS
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

export async function GET(request: Request) {
  try {
    // 1. Fetch the master account's user ID securely
    const { data: masterSettings, error: masterError } = await supabaseAdmin
      .from('user_risk_settings')
      .select('user_id')
      .eq('is_master_account', true)
      .limit(1);

    if (masterError || !masterSettings || masterSettings.length === 0) {
      return NextResponse.json({ trades: [] });
    }

    const masterUserId = masterSettings[0].user_id;

    // 2. Fetch the trades belonging to the master account
    // We explicitly only select non-sensitive columns. We hide volume to protect exact AUM size.
    const { data: trades, error: tradesError } = await supabaseAdmin
      .from('user_trades')
      .select('id, symbol, side, status, entry_price, close_price, realized_pnl, created_at, closed_at')
      .eq('user_id', masterUserId)
      .order('created_at', { ascending: false })
      .limit(100);

    if (tradesError) {
      return NextResponse.json({ error: 'Failed to fetch fund history' }, { status: 500 });
    }

    // 3. Post-process to calculate Pips/Points and sanitize data
    const sanitizedTrades = trades.map(trade => {
      // Calculate Points gained/lost
      let points = 0;
      if (trade.status === 'CLOSED' && trade.entry_price && trade.close_price) {
        const diff = trade.side === 'BUY' 
          ? trade.close_price - trade.entry_price
          : trade.entry_price - trade.close_price;
        points = diff; 
      }

      return {
        id: trade.id,
        symbol: trade.symbol,
        side: trade.side,
        status: trade.status,
        entry_price: trade.entry_price,
        close_price: trade.close_price,
        points_yield: points,
        is_win: trade.realized_pnl > 0,
        created_at: trade.created_at,
        closed_at: trade.closed_at
      };
    });

    return NextResponse.json({ trades: sanitizedTrades });

  } catch (error) {
    console.error('Error fetching fund history:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
