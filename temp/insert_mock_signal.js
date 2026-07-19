const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');

const envLocal = fs.readFileSync('apps/rainebank/.env.local', 'utf8');
const supabaseUrl = envLocal.match(/NEXT_PUBLIC_SUPABASE_URL=(.*)/)[1];
const serviceRoleKey = envLocal.match(/SUPABASE_SERVICE_ROLE_KEY=(.*)/)[1];

const supabase = createClient(supabaseUrl, serviceRoleKey);

async function insert() {
  const { data, error } = await supabase.from('trade_opportunities').insert({
    symbol: 'BTCUSD',
    side: 'LONG',
    timeframe: '1H',
    status: 'PENDING_APPROVAL',
    entry_plan_json: { price: 65000 },
    stop_plan_json: { price: 64000 },
    take_profit_json: { price: 68000 },
    ai_summary: "Strong breakout detected on the 1H timeframe above major resistance. Institutional volume profile suggests a push toward 68k.",
    risk_summary: "1.5% Risk",
    expected_return: 3.0,
    confidence: 0.85
  }).select('id').single();

  if (error) console.error('Error inserting signal:', error);
  else console.log('Successfully inserted mock signal:', data.id);
}

insert();
