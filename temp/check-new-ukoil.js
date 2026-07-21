const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function run() {
  const { data } = await supabase.from('trade_opportunities')
    .select('id, symbol, side, status, confidence, entry_plan_json, stop_plan_json, take_profit_json, ai_summary, is_archived')
    .eq('symbol', 'UKOIL')
    .eq('is_archived', false)
    .order('created_at', { ascending: false })
    .limit(3);
  
  if (!data || data.length === 0) {
    console.log('No non-archived UKOIL signals found. The re-run may still be processing.');
  } else {
    for (const s of data) {
      console.log(`[${s.status}] Confidence: ${s.confidence}`);
      console.log(`  Entry: ${JSON.stringify(s.entry_plan_json)}`);
      console.log(`  Stop: ${JSON.stringify(s.stop_plan_json)}`);
      console.log(`  TP: ${JSON.stringify(s.take_profit_json)}`);
      console.log(`  Summary: ${s.ai_summary?.substring(0, 300)}`);
      console.log('---');
    }
  }
}
run();
