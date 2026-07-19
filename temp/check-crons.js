const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function run() {
  console.log("=== Checking Audit Logs for Monitor Services ===\n");
  
  const { data: exnessLogs } = await supabase.from('audit_log')
    .select('created_at, payload_json, action')
    .eq('entity_type', 'exness-monitor')
    .order('created_at', { ascending: false })
    .limit(3);
    
  console.log("Exness Monitor Recent Logs:");
  if (exnessLogs && exnessLogs.length > 0) {
    exnessLogs.forEach(l => console.log(`  [${l.created_at}] Action: ${l.action} | Status: ${l.payload_json?.status || 'N/A'}`));
  } else {
    console.log("  No recent audit logs found for exness-monitor.");
  }
  
  const { data: tradeLogs } = await supabase.from('audit_log')
    .select('created_at, payload_json, action')
    .eq('entity_type', 'monitor-open-trades')
    .order('created_at', { ascending: false })
    .limit(3);
    
  console.log("\nMonitor Open Trades Recent Logs:");
  if (tradeLogs && tradeLogs.length > 0) {
    tradeLogs.forEach(l => console.log(`  [${l.created_at}] Action: ${l.action} | Status: ${l.payload_json?.status || 'N/A'}`));
  } else {
    console.log("  No recent audit logs found for monitor-open-trades.");
  }
  
  const { data: resolveLogs } = await supabase.from('audit_log')
    .select('created_at, payload_json, action')
    .eq('entity_type', 'resolve-outcomes')
    .order('created_at', { ascending: false })
    .limit(3);
    
  console.log("\nResolve Outcomes Recent Logs:");
  if (resolveLogs && resolveLogs.length > 0) {
    resolveLogs.forEach(l => console.log(`  [${l.created_at}] Action: ${l.action} | Payload: ${JSON.stringify(l.payload_json).substring(0, 50)}...`));
  } else {
    console.log("  No recent audit logs found for resolve-outcomes.");
  }
}
run();
