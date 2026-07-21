const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function run() {
  const { data } = await supabase
    .from('audit_log')
    .select('*')
    .gt('created_at', '2026-07-09T10:55:00Z')
    .eq('entity_type', 'research')
    .order('created_at', { ascending: false });
    
  console.log("Total audit logs since 11am:", data.length);
  const symbolCounts = data.reduce((acc, row) => {
    const sym = row.payload_json?.symbol || 'UNKNOWN';
    acc[sym] = (acc[sym] || 0) + 1;
    return acc;
  }, {});
  console.log("Symbol breakdown:", symbolCounts);
  
  for (const sym of Object.keys(symbolCounts)) {
     const logs = data.filter(d => d.payload_json?.symbol === sym);
     console.log(`\nActions for ${sym}:`);
     for (const log of logs) {
        console.log(`- ${log.action}: ${log.payload_json?.reason || ''}`);
     }
  }
}
run();
