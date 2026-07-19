const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function run() {
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
    stop_plan_json: { stop: 73.500, initial: 73.500, atr: 4.16 },
    take_profit_json: { tp: 84.000 },
    ai_summary: '[S-Tier] [BREAKOUT -> MOMENTUM_CONTINUATION] Brent crude is consolidating between $75-$80 after a geopolitically-driven rally from $70.50. The US-Iran ceasefire collapsed on July 8 with 170+ CENTCOM airstrikes and Iranian retaliation against commercial vessels in the Strait of Hormuz. ~20% of global oil supply transits this chokepoint — any further escalation triggers an asymmetric spike toward $90+. A Buy Limit at $77.50 front-runs the 50 EMA ($77.00) to catch the standard intraday pullback during session overlaps. A second Buy Limit at $75.00 catches the deeper liquidity sweep below structural support. Stop loss at $73.50 sits below the 200 EMA and Bollinger Band lower bound — a close below this level invalidates the bullish geopolitical thesis entirely. Take profit at $84.00 targets the 200-day EMA and 38.2% Fibonacci retracement convergence zone. OPEC+ agreed to +188k bpd for August but this is dwarfed by the Hormuz supply risk premium. EIA reported a +3.0M barrel build (bearish) but counteracted by reduced Hormuz shipping traffic. Execution Math: Structural target set at 84.000 yielding a blended 1:2.5 Risk:Reward ratio across scaled entries.',
    ai_risks: 'Managed by AI Risk Officer + Manual Override',
    risk_summary: 'RSI ~55, ATR 4.16, Strait of Hormuz conflict active'
  }).select('id').single();

  if (error) {
    console.error('Error:', error);
  } else {
    console.log('✅ Signal inserted:', data.id);
  }
}
run();
