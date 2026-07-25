'use server';

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const supabase = createClient(supabaseUrl, supabaseKey);

export async function fetchLiveTrades() {
  const { data, error } = await supabase
    .from('user_trades')
    .select(`
      id, symbol, side, volume, risk_amount, status, created_at, trade_type, meta_api_order_id,
      trade_opportunities (
        id, ai_summary, confidence, risk_summary, entry_plan_json, stop_plan_json, take_profit_json
      )
    `)
    .in('status', ['OPEN', 'PENDING'])
    .order('created_at', { ascending: false });

  if (error) {
    console.error('Error fetching live trades:', error);
    return [];
  }
  return data;
}

export async function fetchMacroSentiment() {
  const { data, error } = await supabase
    .from('market_context')
    .select('symbol, macro_bias, narrative, created_at')
    .order('created_at', { ascending: false })
    .limit(4);

  if (error) {
    console.error('Error fetching macro sentiment:', error);
    return [];
  }
  return data;
}

export async function fetchSystemHealth() {
  const { data, error } = await supabase
    .from('user_risk_settings')
    .select('portfolio_capital, high_water_mark_equity, daily_starting_equity')
    .eq('is_master_account', true)
    .maybeSingle();

  if (error || !data) {
    console.error('Error fetching system health:', error);
    return null;
  }
  
  const dailyDrawdown = data.daily_starting_equity > 0 
    ? ((data.daily_starting_equity - data.portfolio_capital) / data.daily_starting_equity) * 100 
    : 0;

  return {
    portfolio_capital: data.portfolio_capital,
    daily_drawdown: Math.max(0, dailyDrawdown),
    high_water_mark: data.high_water_mark_equity
  };
}
