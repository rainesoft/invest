import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@lib/supabase';

const VALID = ['PENDING_APPROVAL','APPROVED','REJECTED','EXPIRED'];

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const body = await req.json().catch(() => ({}));
  const status: string | undefined = body.status;
  if (!status || !VALID.includes(status)) {
    return NextResponse.json({ ok: false, error: 'invalid status' }, { status: 400 });
  }

  const { error } = await supabase
    .from('trade_opportunities')
    .update({ status })
    .eq('id', params.id);
  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
