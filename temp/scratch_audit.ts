import { createClient } from '@supabase/supabase-js';
import * as fs from 'fs';

const envFile = fs.readFileSync('.env.local', 'utf8');
for (const line of envFile.split('\n')) {
  if (line.includes('=')) {
    const [key, ...vals] = line.split('=');
    process.env[key.trim()] = vals.join('=').trim();
  }
}

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !supabaseKey) {
  console.error("Missing supabase credentials");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function main() {
  const { data, error } = await supabase
    .from('audit_log')
    .select('*')
    .eq('entity_type', 'research')
    .gte('created_at', new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString())
    .order('created_at', { ascending: false });

  if (error) {
    console.error("Error fetching audit logs:", error);
  } else {
    console.log("=== Recent Research Audit Logs ===");
    for (const log of data || []) {
      console.log(`[${new Date(log.created_at).toISOString()}] ${log.action} - ${log.payload_json?.symbol || ''} - ${log.payload_json?.reason || ''}`);
    }
    
    // Also check for any rejected opportunities in the trade_opportunities table directly
    const { data: opps } = await supabase
      .from('trade_opportunities')
      .select('symbol, status, created_at, ai_risks, ai_summary')
      .gte('created_at', new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString())
      .order('created_at', { ascending: false });
      
    console.log("\n=== Recent Trade Opportunities ===");
    for (const opp of opps || []) {
      console.log(`[${new Date(opp.created_at).toISOString()}] ${opp.symbol} - ${opp.status} - ${opp.ai_risks || 'No risks logged'}`);
    }
  }
}
main();
