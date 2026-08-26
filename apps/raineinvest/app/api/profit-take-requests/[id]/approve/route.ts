import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@lib/supabase';

export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  const client = supabase;
  const { data: reqRow, error: reqErr } = await client
    .from('profit_take_requests')
    .select('trade_id')
    .eq('id', params.id)
    .single();
  if (reqErr || !reqRow) {
    return NextResponse.json({ ok: false, error: 'request not found' }, { status: 404 });
  }
  const { error: tradeErr } = await client
    .from('trades')
    .update({
      status: 'CLOSED',
      close_reason: 'TARGET',
      closed_at: new Date().toISOString(),
    })
    .eq('id', reqRow.trade_id);
  if (tradeErr) {
    return NextResponse.json({ ok: false, error: tradeErr.message }, { status: 500 });
  }
  await client
    .from('profit_take_requests')
    .update({ status: 'APPROVED', decision_at: new Date().toISOString() })
    .eq('id', params.id);
  return NextResponse.json({ ok: true, closedTradeId: reqRow.trade_id });
}
