export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { supabaseServer } from '@lib/supabase-server';
import { createClient } from '@supabase/supabase-js';

export async function GET(request: Request) {
  const supabase = supabaseServer();
  const { searchParams } = new URL(request.url);
  const page = parseInt(searchParams.get('page') || '1');
  const limit = parseInt(searchParams.get('limit') || '10');
  const hideRejected = searchParams.get('hideRejected') === 'true';
  
  const from = (page - 1) * limit;
  const to = from + limit - 1;
  
  // We still use the standard auth client to securely verify the user's session
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // We use the service role key to securely bypass RLS/table permissions when fetching
  const adminClient = createClient(
    process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  let query = adminClient
    .from('user_trades')
    .select('*, trade_opportunities(*)', { count: 'exact' })
    .eq('user_id', user.id);

  if (hideRejected) {
    // Hide trades that never executed successfully
    query = query.not('status', 'in', '("REJECTED","EXPIRED","CANCELLED","FAILED")');
  }

  const { data, count, error } = await query
    .order('created_at', { ascending: false })
    .range(from, to);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Map to VaultSignal expected by frontend
  const mappedData = data.map((trade: any) => ({
    id: trade.id,
    symbol: trade.symbol,
    side: trade.side,
    timeframe: trade.trade_opportunities?.timeframe || 'Unknown',
    status: trade.status,
    created_at: trade.created_at,
    entry_plan_json: trade.trade_opportunities?.entry_plan_json,
    stop_plan_json: trade.trade_opportunities?.stop_plan_json,
    take_profit_json: trade.trade_opportunities?.take_profit_json,
    ai_summary: trade.trade_opportunities?.ai_summary,
    ai_risks: trade.trade_opportunities?.ai_risks || trade.error_message,
    meta_api_order_id: trade.meta_api_order_id,
    risk_amount: trade.risk_amount,
    volume: trade.volume,
    trade_type: trade.trade_type
  }));

  return NextResponse.json({ 
    signals: mappedData, 
    is_pro: true, // Legacy flag, true so full UI renders
    pagination: { total: count || 0, page, limit }
  });
}
