const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function run() {
  console.log("=== Cleaning the Vault ===");
  
  // 1. Archive all opportunities
  const { data: opps, error: e1 } = await supabase
    .from('trade_opportunities')
    .update({ is_archived: true })
    .eq('is_archived', false)
    .select('id');
    
  if (e1) console.error("Error archiving opps:", e1);
  else console.log(`✅ Archived ${opps?.length || 0} active trade opportunities.`);

  // 2. Delete all user_trades to reset execution states
  const { data: trades, error: e2 } = await supabase
    .from('user_trades')
    .delete()
    .neq('id', '00000000-0000-0000-0000-000000000000') // delete all
    .select('id');
    
  if (e2) console.error("Error deleting trades:", e2);
  else console.log(`✅ Deleted ${trades?.length || 0} user trades.`);
  
  // 3. Clear Pre-AI Guard cache so new runs aren't skipped
  const { data: logs, error: e3 } = await supabase
    .from('audit_log')
    .delete()
    .eq('entity_type', 'research')
    .select('id');
    
  if (e3) console.error("Error clearing logs:", e3);
  else console.log(`✅ Cleared ${logs?.length || 0} AI evaluation logs.`);
  
  console.log("\nVault successfully cleaned! You have a fresh slate.");
}
run();
