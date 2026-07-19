const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function run() {
  // Get the most recent UKOIL signal
  const { data: recent } = await supabase.from('trade_opportunities')
    .select('*')
    .eq('symbol', 'UKOIL')
    .order('created_at', { ascending: false })
    .limit(3);
  
  console.log("=== Recent UKOIL Signals ===");
  for (const r of recent || []) {
    console.log(`[${r.created_at}] ${r.side} | Status: ${r.status} | Confidence: ${r.confidence}`);
    console.log(`  Entry: ${JSON.stringify(r.entry_plan_json)}`);
    console.log(`  Stop: ${JSON.stringify(r.stop_plan_json)}`);
    console.log(`  TP: ${JSON.stringify(r.take_profit_json)}`);
    console.log(`  AI Summary: ${r.ai_summary?.substring(0, 200)}`);
    console.log('---');
  }
}
run();
