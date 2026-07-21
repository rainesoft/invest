const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function run() {
  const { data } = await supabase
    .from('trade_opportunities')
    .select('symbol, status, created_at, ai_risks, ai_summary')
    .gt('created_at', '2026-07-09T10:55:00Z')
    .order('created_at', { ascending: false });
    
  console.log("Total since 11am:", data.length);
  const symbolCounts = data.reduce((acc, row) => {
    acc[row.symbol] = (acc[row.symbol] || 0) + 1;
    return acc;
  }, {});
  console.log("Symbol breakdown:", symbolCounts);
  
  const uniqueSymbols = Object.keys(symbolCounts);
  for (const sym of uniqueSymbols) {
    const recent = data.find(d => d.symbol === sym);
    console.log(`\nMost recent ${sym}:`);
    console.log(`Status: ${recent.status}`);
    console.log(`AI Risks/Reason: ${recent.ai_risks || recent.ai_summary.substring(0, 100) + '...'}`);
  }
}
run();
