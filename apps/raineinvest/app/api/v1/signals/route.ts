import { NextResponse } from 'next/server';
import { Unkey } from '@unkey/api';
import { createClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  // Initialize Unkey
  const unkey = new Unkey({ rootKey: process.env.UNKEY_ROOT_KEY || '' });

  // Initialize Supabase with Service Role to bypass RLS since this is a server-to-server authenticated route
  const supabase = createClient(
    process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '',
    process.env.SUPABASE_SERVICE_ROLE_KEY || ''
  );
  try {
    // 1. Extract Bearer Token
    const authHeader = request.headers.get('Authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return NextResponse.json({ error: 'Missing or invalid Authorization header' }, { status: 401 });
    }

    const token = authHeader.split(' ')[1];

    // 2. Verify with Unkey (Handles Auth + Rate Limiting natively)
    const verification = await unkey.keys.verifyKey({
      key: token
    });

    if (!verification.data || !verification.data.valid) {
      if (verification.data?.code === 'RATE_LIMITED') {
        return NextResponse.json({ error: 'Too Many Requests' }, { status: 429 });
      }
      return NextResponse.json({ error: 'Unauthorized: Invalid or expired API Key' }, { status: 401 });
    }

    // 3. Parse Query Parameters for filtering
    const { searchParams } = new URL(request.url);
    const symbol = searchParams.get('symbol');
    const limitParam = searchParams.get('limit');
    
    // Enforce reasonable bounds
    const limit = limitParam ? Math.min(parseInt(limitParam, 10) || 20, 100) : 20;

    // 4. Fetch the Alpha feed from Supabase
    let query = supabase
      .from('trade_opportunities')
      .select('id, symbol, side, timeframe, status, created_at, entry_plan_json, stop_plan_json, take_profit_json, ai_summary')
      .eq('status', 'active')
      .or('is_archived.eq.false,is_archived.is.null')
      .order('created_at', { ascending: false })
      .limit(limit);

    if (symbol) {
      query = query.eq('symbol', symbol.toUpperCase());
    }

    const { data: signals, error: dbError } = await query;

    if (dbError) {
      console.error('Supabase Query Error:', dbError);
      return NextResponse.json({ error: 'Failed to fetch signals' }, { status: 500 });
    }

    // 5. Return the payload
    return NextResponse.json({
      meta: {
        count: signals.length,
        timestamp: new Date().toISOString(),
      },
      data: signals
    });

  } catch (err: any) {
    console.error('B2B API Error:', err);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
