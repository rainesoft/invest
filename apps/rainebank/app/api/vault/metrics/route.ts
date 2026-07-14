import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export async function GET() {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !key) {
    return NextResponse.json({ error: 'Missing DB connection' }, { status: 500 });
  }

  const supabase = createClient(url, key);

  try {
    const { data: closedTrades, error } = await supabase
      .from('trade_opportunities')
      .select('status, r_multiple, closed_at, created_at')
      .in('status', ['WON', 'LOST'])
      .order('created_at', { ascending: true });

    if (error) {
      console.error(error);
      return NextResponse.json({ error: 'Failed to fetch trade data' }, { status: 500 });
    }

    if (!closedTrades || closedTrades.length === 0) {
      return NextResponse.json({
        winRate: 0,
        netR: 0,
        expectancy: 0,
        equityCurve: []
      });
    }

    let totalWonAllTime = 0;
    let totalLostAllTime = 0;
    let netR = 0;
    let sumWinRAllTime = 0;
    let sumLossRAllTime = 0;
    let cumulativeR = 0;
    const equityCurve = [];

    let won30D = 0;
    let lost30D = 0;
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    for (const trade of closedTrades) {
      const r = Number(trade.r_multiple) || 0;
      const closedAt = trade.closed_at ? new Date(trade.closed_at) : new Date(trade.created_at);
      
      netR += r;
      cumulativeR += r;

      if (trade.status === 'WON') {
        totalWonAllTime++;
        sumWinRAllTime += r;
        if (closedAt >= thirtyDaysAgo) won30D++;
      } else {
        totalLostAllTime++;
        sumLossRAllTime += r;
        if (closedAt >= thirtyDaysAgo) lost30D++;
      }

      equityCurve.push({
        date: closedAt.toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }),
        cumulative_r: Number(cumulativeR.toFixed(2))
      });
    }

    const totalTrades30D = won30D + lost30D;
    const winRate30D = totalTrades30D > 0 ? (won30D / totalTrades30D) * 100 : 0;

    const totalTradesAllTime = totalWonAllTime + totalLostAllTime;
    const lossRateAllTime = totalTradesAllTime > 0 ? (totalLostAllTime / totalTradesAllTime) * 100 : 0;
    const winRateAllTime = totalTradesAllTime > 0 ? (totalWonAllTime / totalTradesAllTime) * 100 : 0;

    const avgWinR = totalWonAllTime > 0 ? sumWinRAllTime / totalWonAllTime : 0;
    const avgLossR = totalLostAllTime > 0 ? Math.abs(sumLossRAllTime / totalLostAllTime) : 0;

    const expectancy = (winRateAllTime / 100 * avgWinR) - (lossRateAllTime / 100 * avgLossR);

    return NextResponse.json({
      winRate: Number(winRate30D.toFixed(1)),
      netR: Number(netR.toFixed(2)),
      expectancy: Number(expectancy.toFixed(2)),
      equityCurve
    });

  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: 'Server Error' }, { status: 500 });
  }
}
