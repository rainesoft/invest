const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function run() {
  const { data } = await supabase.from('trade_opportunities')
    .select('*')
    .eq('id', 'fe4ec711-88b1-47e2-84e1-9fc7a3ec6491')
    .single();
  
  console.log("=== FULL UKOIL SIGNAL ===");
  console.log("Symbol:", data.symbol);
  console.log("Side:", data.side);
  console.log("Status:", data.status);
  console.log("Timeframe:", data.timeframe);
  console.log("Confidence:", data.confidence);
  console.log("Entry Plan:", JSON.stringify(data.entry_plan_json, null, 2));
  console.log("Stop Plan:", JSON.stringify(data.stop_plan_json, null, 2));
  console.log("TP Plan:", JSON.stringify(data.take_profit_json, null, 2));
  console.log("---");
  console.log("AI Summary:\n", data.ai_summary);
}
run();
