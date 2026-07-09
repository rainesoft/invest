import { createClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';

export const maxDuration = 60;

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const client = createClient(supabaseUrl, supabaseKey);

  try {
    // 1. Fetch the user (Mock Auth for Dashboard)
    // In production, this would use supabase.auth.getUser() from the session token
    const userId = "00ebf71d-8ad4-4072-9bb8-6149f55594b1"; 

    // 2. Delegate execution to the Exness Executor Edge Function
    // This allows us to reuse all the complex MetaApi routing, tier validation, 
    // drawdown breakers, and position sizing logic without duplicating it here.
    const edgeFunctionUrl = `${supabaseUrl}/functions/v1/exness-executor`;
    
    const response = await fetch(edgeFunctionUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${supabaseKey}`
      },
      body: JSON.stringify({
        action: 'MANUAL_EXECUTION',
        user_id: userId,
        opportunity_id: params.id
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[Execution Edge Function Error]', errorText);
      throw new Error(errorText);
    }

    const result = await response.json();
    const execution = result.executions?.[0];

    if (execution && (execution.status === 'REJECTED' || execution.status === 'FAILED')) {
       throw new Error(`Execution ${execution.status} by Risk Manager.`);
    }

    return NextResponse.json({ ok: true, result });
    
  } catch (error: any) {
    console.error('[Execution Error]', error.message);
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }
}
