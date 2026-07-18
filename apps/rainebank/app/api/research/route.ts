import { NextResponse } from 'next/server';

export async function POST(req: Request) {
  try {
    const { symbol, timeframe } = await req.json();

    if (!symbol) {
      return NextResponse.json({ ok: false, error: 'Symbol is required' }, { status: 400 });
    }

    const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    
    if (!url || !key) {
      return NextResponse.json({ ok: false, error: 'Missing env variables' }, { status: 500 });
    }

    const fnUrl = `${url}/functions/v1`;
    
    const params = new URLSearchParams();
    params.append('symbols', symbol);
    if (timeframe) {
      params.append('timeframe', timeframe);
    }

    const res = await fetch(`${fnUrl}/research-run?${params.toString()}`, {
      headers: { Authorization: `Bearer ${key}` },
    });

    return new NextResponse(res.body, {
      status: res.status,
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      },
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}
