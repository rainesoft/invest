const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function run() {
  // Get the latest UKOIL 4H candles
  const { data: candles } = await supabase
    .from('market_data_pti')
    .select('ts, o, h, l, c, v')
    .eq('symbol', 'UKOIL')
    .eq('timeframe', '4h')
    .order('ts', { ascending: false })
    .limit(20);

  if (!candles || candles.length === 0) {
    console.log("No UKOIL candle data found.");
    return;
  }

  console.log("=== UKOIL 4H CHART DATA (Most Recent First) ===\n");
  
  // Calculate key technicals
  const closes = candles.map(c => Number(c.c)).reverse();
  const highs = candles.map(c => Number(c.h)).reverse();
  const lows = candles.map(c => Number(c.l)).reverse();
  
  // Simple EMA approximation
  const ema20 = closes.slice(-20).reduce((a,b) => a+b, 0) / Math.min(closes.length, 20);
  
  // ATR calculation (last 14 candles)
  let atrSum = 0;
  for (let i = 1; i < Math.min(closes.length, 15); i++) {
    const tr = Math.max(
      highs[i] - lows[i],
      Math.abs(highs[i] - closes[i-1]),
      Math.abs(lows[i] - closes[i-1])
    );
    atrSum += tr;
  }
  const atr14 = atrSum / Math.min(closes.length - 1, 14);
  
  // Recent swing high/low
  const recentHighs = highs.slice(-10);
  const recentLows = lows.slice(-10);
  const swingHigh = Math.max(...recentHighs);
  const swingLow = Math.min(...recentLows);
  const currentPrice = closes[closes.length - 1];
  
  console.log("--- Last 10 Candles ---");
  const recent = [...candles].reverse().slice(-10);
  recent.forEach(c => {
    const bull = Number(c.c) >= Number(c.o) ? '🟢' : '🔴';
    console.log(`${bull} [${c.ts}] O:${Number(c.o).toFixed(3)} H:${Number(c.h).toFixed(3)} L:${Number(c.l).toFixed(3)} C:${Number(c.c).toFixed(3)}`);
  });
  
  console.log(`\n--- Key Levels ---`);
  console.log(`Current Close:    $${currentPrice.toFixed(3)}`);
  console.log(`20-Period EMA:    $${ema20.toFixed(3)}`);
  console.log(`ATR(14):          $${atr14.toFixed(3)}`);
  console.log(`10-Bar Swing High: $${swingHigh.toFixed(3)}`);
  console.log(`10-Bar Swing Low:  $${swingLow.toFixed(3)}`);
  console.log(`\n--- Your Trade ---`);
  console.log(`Entry:   $77.500`);
  console.log(`Current: ~$75.583`);
  console.log(`Drawdown: -$${(77.5 - 75.583).toFixed(3)} per unit`);
  console.log(`Distance to Swing Low: $${(currentPrice - swingLow).toFixed(3)}`);
  console.log(`ATR Buffer from Current: $${(currentPrice - atr14).toFixed(3)}`);
  
  // Weekend gap risk assessment
  console.log(`\n--- Weekend Gap Risk Assessment ---`);
  console.log(`1 ATR move UP from current:   $${(currentPrice + atr14).toFixed(3)}`);
  console.log(`1 ATR move DOWN from current: $${(currentPrice - atr14).toFixed(3)}`);
  console.log(`2 ATR move DOWN from current: $${(currentPrice - 2*atr14).toFixed(3)} (Extreme weekend gap scenario)`);
}
run();
