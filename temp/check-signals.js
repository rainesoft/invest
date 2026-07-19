const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function run() {
  const { data } = await supabase
    .from('trade_opportunities')
    .select('id, symbol, status, ai_risks, created_at, is_archived')
    .in('symbol', ['BTCUSD', 'XAGUSD'])
    .order('created_at', { ascending: false })
    .limit(10);
    
  console.log("=== Recent BTCUSD & XAGUSD Signals ===");
  if (data) {
    data.forEach(s => console.log(`[${s.symbol}] Created: ${s.created_at} | Status: ${s.status} | Archived: ${s.is_archived} | AI Risks (Reason): ${s.ai_risks || 'None'}`));
  }
}
run();
