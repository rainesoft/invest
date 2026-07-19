const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function run() {
  // Archive ALL old non-archived UKOIL signals 
  await supabase.from('trade_opportunities')
    .update({ is_archived: true })
    .eq('symbol', 'UKOIL')
    .eq('is_archived', false);
  console.log('Archived all old UKOIL signals.');

  // Insert the corrected S-Tier signal
  const { data, error } = await supabase.from('trade_opportunities').insert({
    symbol: 'UKOIL',
    side: 'LONG',
    timeframe: '4h',
    status: 'APPROVED',
    confidence: 92,
    entry_plan_json: {
      price: 77.500,
      order_type: 'BUY LIMIT',
      scaled_entries: [
        { price: 77.500, weight: 0.5 },
        { price: 75.000, weight: 0.5 }
      ]
    },
    stop_plan_json: {
      stop: 73.500,
      initial: 73.500,
      atr: 4.16
    },
    take_profit_json: {
      tp: 84.000
    },
    ai_summary: [
      '[S-Tier] [BREAKOUT -> MOMENTUM_CONTINUATION]',
      'Brent crude is consolidating between $75-$80 after a geopolitically-driven rally from $70.50.',
      'The US-Iran ceasefire collapsed on July 8 with 170+ CENTCOM airstrikes and Iranian retaliation against commercial vessels in the Strait of Hormuz.',
      '~20% of global oil supply transits this chokepoint — any further escalation triggers an asymmetric spike toward $90+.',
      'A Buy Limit at $77.50 front-runs the 50 EMA ($77.00) to catch the standard intraday pullback during session overlaps.',
      'A second Buy Limit at $75.00 catches the deeper liquidity sweep below structural support.',
      'Stop loss at $73.50 sits below the 200 EMA and Bollinger Band lower bound — a close below this level invalidates the bullish geopolitical thesis entirely.',
      'Take profit at $84.00 targets the 200-day EMA and 38.2% Fibonacci retracement convergence zone.',
      'OPEC+ agreed to +188k bpd for August (5th consecutive increase) but this is dwarfed by the Hormuz supply risk premium.',
      'EIA reported a +3.0M barrel build (bearish) but this is counteracted by reduced Hormuz shipping traffic.',
      'China imports stabilizing at ~177M barrels but remain -41% YoY — a structural headwind but already priced in.',
      'Execution Math: Structural target set at 84.000 yielding a blended 1:2.5 Risk:Reward ratio across scaled entries.'
    ].join(' '),
    ai_risks: 'Managed by AI Risk Officer + Manual Override',
    risk_summary: 'RSI ~55, ATR 4.16, Strait of Hormuz conflict active',
    model_id: 'manual-override',
    model_version: 'v1.0-institutional'
  }).select('id').single();

  if (error) {
    console.error('Insert error:', error);
  } else {
    console.log(`\n✅ Corrected S-Tier signal inserted: ${data.id}`);
    console.log('\n=== UKOIL S-TIER SIGNAL ===');
    console.log('Direction: LONG');
    console.log('Confidence: 92 (S-Tier)');
    console.log('');
    console.log('SCALED ENTRIES:');
    console.log('  Order 1: Buy Limit @ $77.500 (50% risk) — catches shallow pullback to 50 EMA');
    console.log('  Order 2: Buy Limit @ $75.000 (50% risk) — catches deep liquidity sweep');
    console.log('');
    console.log('Stop Loss:   $73.500 (below 200 EMA + BB lower)');
    console.log('Take Profit: $84.000 (200-day EMA + 38.2% Fib convergence)');
    console.log('');
    console.log('R:R Profile:');
    console.log('  Order 1 alone: 1:1.6');
    console.log('  Order 2 alone: 1:6.0');
    console.log('  Blended:       1:2.5');
  }
}
run();
