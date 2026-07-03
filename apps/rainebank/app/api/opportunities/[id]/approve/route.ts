import { createClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@lib/supabase-server';
import { placeAndTrackOrder } from '@execution/index';
import { sizeWithRiskCaps } from '@risk/index';
import { insertAuditLog } from '@core/audit';

export const maxDuration = 60;

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const idKey = req.headers.get('Idempotency-Key');
  const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const client = createClient(supabaseUrl, supabaseKey);

  if (idKey) {
    const { data: existing } = await client
      .from('idempotency_keys')
      .select('entity_id')
      .eq('key', idKey)
      .single();
    if (existing?.entity_id) {
      return NextResponse.json({ ok: true, tradeId: existing.entity_id });
    }
  }

  const body = await req.json().catch(() => ({}));

  const { data: opp, error: oppErr } = await client
    .from('trade_opportunities')
    .select('symbol, side, timeframe, entry_plan_json, stop_plan_json, take_profit_json')
    .eq('id', params.id)
    .single();
  if (oppErr || !opp) {
    return NextResponse.json({ ok: false, error: 'opportunity not found' }, { status: 404 });
  }

  const entryPrice = Number(opp.entry_plan_json?.price ?? 0);
  const stopPrice = Number(opp.stop_plan_json?.stop ?? 0);
  const atrUSD = Math.abs(entryPrice - stopPrice);

  const { data: settings } = await client.from('user_risk_settings').select('*').limit(1).single();
  const baseEquity = Number(settings?.portfolio_capital ?? process.env.STARTING_EQUITY_USD ?? '100000');
  const perTradePct = Number(settings?.risk_per_trade_pct ?? 0.01);
  const [{ data: dayPnl }, { data: weekPnl }, { data: portfolioPnl }] =
    await Promise.all([
      client.rpc('day_pnl'),
      client.rpc('week_pnl'),
      client.rpc('portfolio_pnl'),
    ]);
  const dayRiskUSD = Math.abs(Number(dayPnl) || 0);
  const weekRiskUSD = Math.abs(Number(weekPnl) || 0);
  const equityUSD = baseEquity + (Number(portfolioPnl) || 0);

  const allowedQty = sizeWithRiskCaps(
    equityUSD,
    atrUSD,
    dayRiskUSD,
    weekRiskUSD,
    perTradePct
  );

  const qty: number = body.qty ?? allowedQty;
  if (qty <= 0) {
    return NextResponse.json({ ok: false, error: 'invalid qty' }, { status: 400 });
  }
  if (qty > allowedQty) {
    return NextResponse.json(
      { ok: false, error: 'qty exceeds risk cap', cap: allowedQty },
      { status: 400 },
    );
  }

  const { data: trade, error: tradeErr } = await client
    .from('trades')
    .insert({
      opportunity_id: params.id,
      symbol: opp.symbol,
      side: opp.side,
      qty,
    })
    .select('id')
    .single();
  if (tradeErr) {
    return NextResponse.json({ ok: false, error: tradeErr.message }, { status: 500 });
  }


  await insertAuditLog(client, {
    actor_type: 'SYSTEM',
    action: 'APPROVE_OPPORTUNITY',
    entity_type: 'opportunity',
    entity_id: params.id,
    payload_json: {
      qty,
      allowedQty,
      equityUSD,
      atrUSD,
      dayRiskUSD,
      weekRiskUSD,
    },
  });

  try {
    const exec = await placeAndTrackOrder({
      tradeId: trade.id,
      symbol: opp.symbol,
      side: opp.side === 'LONG' ? 'buy' : 'sell',
      qty,
      type: 'market',
      takeProfit: opp.take_profit_json?.tp ? Number(opp.take_profit_json.tp) : undefined,
      stopLoss: stopPrice > 0 ? stopPrice : undefined,
      supabase: client,
    });

    if (exec.status === 'FAILED') {
      await client.from('trades').update({ status: 'FAILED' }).eq('id', trade.id);
      return NextResponse.json({ ok: false, error: exec.errorMsg || 'Broker execution failed.' }, { status: 400 });
    }
  } catch (err: any) {
    // Rollback the trade insertion so it doesn't appear in the vault as a ghost trade
    await client.from('trades').delete().eq('id', trade.id);
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 });
  }

  await client
    .from('trade_opportunities')
    .update({ status: 'APPROVED' })
    .eq('id', params.id);

  if (idKey) {
    try {
      await client
        .from('idempotency_keys')
        .insert({ key: idKey, entity_type: 'trade', entity_id: trade.id });
    } catch (_) {}
  }

  return NextResponse.json({ ok: true, tradeId: trade.id });
}
