import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';

// Initialize Supabase with Service Role Key to bypass RLS
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
  global: { fetch: (url, options) => fetch(url, { ...options, cache: 'no-store' }) }
});

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
      .select(`
        id, symbol, side, status, close_price, profit_usd, created_at, closed_at, meta_api_order_id,
        trade_opportunities ( entry_plan_json )
      `)
      .eq('user_id', masterUserId)
      .order('created_at', { ascending: false })
      .limit(100);

    if (tradesError) {
      console.error('tradesError', tradesError);
      return NextResponse.json({ error: 'Failed to fetch fund history' }, { status: 500 });
    }
    
    if (!trades || trades.length === 0) {
      return NextResponse.json({ trades: [] });
    }

    // 3. Post-process to calculate Pips/Points and sanitize data
    const sanitizedTrades = trades.map((trade: any) => {
      const entry_price = trade.trade_opportunities?.entry_plan_json?.price ? Number(trade.trade_opportunities.entry_plan_json.price) : null;
      
      // Calculate Points gained/lost
      let points = 0;
      if (['CLOSED', 'WON', 'LOST'].includes(trade.status) && entry_price && trade.close_price) {
        const diff = ['BUY', 'LONG'].includes(trade.side) 
          ? trade.close_price - entry_price
          : entry_price - trade.close_price;
        points = diff; 
      }

      return {
        id: trade.id,
        symbol: trade.symbol,
        side: trade.side,
        status: trade.status,
        entry_price: entry_price,
        close_price: trade.close_price,
        points_yield: points,
        is_win: trade.profit_usd > 0,
        created_at: trade.created_at,
        closed_at: trade.closed_at,
        meta_api_order_id: trade.meta_api_order_id
      };
    });

    return NextResponse.json({ trades: sanitizedTrades });

  } catch (error) {
    console.error('Error fetching fund history:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
