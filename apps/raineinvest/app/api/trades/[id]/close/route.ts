import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@lib/supabase';

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const { reason } = await req.json().catch(() => ({ reason: 'MANUAL' }));
  const client = supabase;
  const { error } = await client
    .from('trades')
    .update({
      status: 'CLOSED',
      close_reason: reason || 'MANUAL',
      closed_at: new Date().toISOString(),
    })
    .eq('id', params.id);
  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }
  // cancel open orders and write audit log can be added when order management exists
  return NextResponse.json({ ok: true, closedTradeId: params.id });
}
