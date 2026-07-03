import { NextResponse } from 'next/server';
import { supabaseServer } from '@lib/supabase-server';

export async function GET(request: Request) {
  const supabase = supabaseServer();

  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { data: settings, error } = await supabase
    .from('user_risk_settings')
    .select('*')
    .eq('user_id', user.id)
    .single();

  if (error && error.code !== 'PGRST116') {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // If no settings exist yet (PGRST116), return an empty object,
  // the frontend will fall back to its default state
  return NextResponse.json({ settings: settings || {} });
}

export async function POST(request: Request) {
  const supabase = supabaseServer();

  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await request.json();
    
    // Validate bounds
    let telegram_chat_id = body.telegram_chat_id || null;
    
    // Anti-Piracy Check: Prevent users from hooking up to Group Chats/Channels
    if (telegram_chat_id) {
      if (telegram_chat_id.includes('-') || telegram_chat_id.includes('@') || !/^\d+$/.test(telegram_chat_id)) {
        return NextResponse.json({ 
          error: 'Invalid Telegram Chat ID. Group chats and channels are strictly prohibited. You must use a personal Direct Message Chat ID (positive numbers only).' 
        }, { status: 400 });
      }
    }

    const updates = {
      user_id: user.id,
      portfolio_capital: Math.max(0, Number(body.portfolio_capital || 0)),
      risk_per_trade_pct: Math.min(0.2, Math.max(0.001, Number(body.risk_per_trade_pct || 0.01))),
      max_portfolio_heat_pct: Math.min(1.0, Math.max(0.01, Number(body.max_portfolio_heat_pct || 0.10))),
      max_spread_points: Math.min(1000, Math.max(0, Number(body.max_spread_points || 50))),
      max_volume_per_trade: Math.max(0.01, Number(body.max_volume_per_trade || 50)),
      active_broker: body.active_broker || 'METAAPI',
      meta_api_token: body.meta_api_token || null,
      meta_api_account_id: body.meta_api_account_id || null,
      alpaca_key: body.alpaca_key || null,
      alpaca_secret: body.alpaca_secret || null,
      is_live_execution_enabled: Boolean(body.is_live_execution_enabled),
      auto_trade_enabled: Boolean(body.auto_trade_enabled),
      sync_trailing_stops: Boolean(body.sync_trailing_stops),
      auto_trade_tiers: Array.isArray(body.auto_trade_tiers) ? body.auto_trade_tiers : [],
      telegram_bot_token: body.telegram_bot_token || null,
      telegram_chat_id,
    };

    const { data, error } = await supabase
      .from('user_risk_settings')
      .upsert(updates, { onConflict: 'user_id' })
      .select()
      .single();

    if (error) throw error;

    return NextResponse.json({ success: true, settings: data });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
