import { createClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';
import { sizeWithRiskCaps } from '@risk/index';
import { insertAuditLog } from '@core/audit';

export const maxDuration = 60;

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const client = createClient(supabaseUrl, supabaseKey);

  try {
    // 1. Fetch the Opportunity
    const { data: opp, error: oppErr } = await client
      .from('trade_opportunities')
      .select('symbol, side, timeframe, entry_plan_json, stop_plan_json, take_profit_json')
      .eq('id', params.id)
      .single();
      
    if (oppErr || !opp) {
      return NextResponse.json({ ok: false, error: 'Opportunity not found' }, { status: 404 });
    }

    const entryPrice = Number(opp.entry_plan_json?.price ?? 0);
    const stopPrice = Number(opp.stop_plan_json?.stop ?? 0);
    const atrUSD = Math.abs(entryPrice - stopPrice);

    // 2. Fetch the user's risk settings (Mock Auth for Dashboard)
    // In production, this would use supabase.auth.getUser() from the session token
    const userId = "00ebf71d-8ad4-4072-9bb8-6149f55594b1"; 

    const { data: settings, error: settingsErr } = await client
      .from('user_risk_settings')
      .select('*')
      .eq('user_id', userId)
      .single();

    if (settingsErr || !settings) {
      return NextResponse.json({ ok: false, error: 'User risk settings not found' }, { status: 404 });
    }

    // 3. Calculate position sizing based on risk metrics
    const baseEquity = Number(settings.portfolio_capital ?? process.env.STARTING_EQUITY_USD ?? '100000');
    const perTradePct = Number(settings.risk_per_trade_pct ?? 0.01);
    
    // Fetch user PNL stats via RPC
    const [{ data: dayPnl }, { data: weekPnl }, { data: portfolioPnl }] = await Promise.all([
      client.rpc('day_pnl', { p_user_id: userId }),
      client.rpc('week_pnl', { p_user_id: userId }),
      client.rpc('portfolio_pnl', { p_user_id: userId }),
    ]);
    
    const dayRiskUSD = Math.abs(Number(dayPnl) || 0);
    const weekRiskUSD = Math.abs(Number(weekPnl) || 0);
    const equityUSD = baseEquity + (Number(portfolioPnl) || 0);

    const qty = sizeWithRiskCaps(
      equityUSD,
      atrUSD,
      dayRiskUSD,
      weekRiskUSD,
      perTradePct,
      0.02, // max day risk
      0.05, // max week risk
      Number(settings.max_volume_per_trade ?? 50)
    );

    if (qty <= 0) {
      return NextResponse.json({ ok: false, error: 'Risk constraints violated. Calculated volume is 0.' }, { status: 403 });
    }

    // 4. Insert Trade for User
    const { data: trade, error: tradeErr } = await client
      .from('trades')
      .insert({
        opportunity_id: params.id,
        symbol: opp.symbol,
        side: opp.side,
        qty,
        user_id: userId
      })
      .select('id')
      .single();

    if (tradeErr) throw new Error(tradeErr.message);

    await insertAuditLog(client, {
      actor_type: 'USER',
      action: 'TRADE_EXECUTED',
      entity_type: 'trade',
      entity_id: trade.id,
      payload_json: { symbol: opp.symbol, qty, userId, entryPrice },
    });

    // 5. Update opportunity status to ACTIVE globally
    await client
        .from('trade_opportunities')
        .update({ status: 'ACTIVE' })
        .eq('id', params.id);

    return NextResponse.json({ ok: true, tradeId: trade.id });
    
  } catch (error: any) {
    console.error('[Execution Error]', error.message);
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }
}
