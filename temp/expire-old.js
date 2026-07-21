const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function run() {
  const twelveHoursAgo = new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString();
  
  const { data, error } = await supabase
    .from('trade_opportunities')
    .update({ status: 'EXPIRED', ai_risks: 'Expired: 12h TTL exceeded without execution.' })
    .eq('status', 'APPROVED')
    .lt('created_at', twelveHoursAgo);
    
  if (error) console.error(error);
  else console.log("Expired old signals!");
}
run();
