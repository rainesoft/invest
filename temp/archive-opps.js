const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function run() {
  const { error } = await supabase
    .from('trade_opportunities')
    .update({ status: 'EXPIRED' })
    .eq('status', 'APPROVED');
  if (error) console.error("Error expiring:", error);
  else console.log("Old signals expired!");
}
run();
