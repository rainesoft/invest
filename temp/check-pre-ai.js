const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function run() {
  const { data } = await supabase
    .from('audit_log')
    .select('created_at, payload_json')
    .eq('action', 'REJECTED_BY_RISK_PRE_AI')
    .eq('entity_type', 'research')
    .filter('payload_json->>symbol', 'eq', 'UKOIL')
    .order('created_at', { ascending: false })
    .limit(1);

  if (data && data.length > 0) {
    console.log(`Last UKOIL Pre-AI Guard Rejection: ${data[0].created_at}`);
    console.log(`Reason: ${data[0].payload_json.reason}`);
    
    // Clear it so the user can run again
    await supabase.from('audit_log').delete().eq('entity_type', 'research').filter('payload_json->>symbol', 'eq', 'UKOIL');
    console.log(`\nCache cleared for UKOIL.`);
  } else {
    console.log("No recent UKOIL isolation logs found.");
  }
}
run();
