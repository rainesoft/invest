import { createClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@lib/supabase';
import { insertAuditLog } from '@core/audit';

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const client = createClient(supabaseUrl, supabaseKey);
  const body = await req.json().catch(() => ({}));
  const reason: string | undefined = body.reason;

  const { error } = await client
    .from('trade_opportunities')
    .update({ status: 'REJECTED' })
    .eq('id', params.id);
  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  await insertAuditLog(client, {
    actor_type: 'SYSTEM',
    action: 'REJECT_OPPORTUNITY',
    entity_type: 'opportunity',
    entity_id: params.id,
    payload_json: { reason },
  });

  return NextResponse.json({ ok: true, opportunityId: params.id });
}
