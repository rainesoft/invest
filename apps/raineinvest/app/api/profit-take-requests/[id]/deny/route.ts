import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@lib/supabase';

export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  const client = supabase;
  const { error } = await client
    .from('profit_take_requests')
    .update({ status: 'DENIED', decision_at: new Date().toISOString() })
    .eq('id', params.id);
  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
