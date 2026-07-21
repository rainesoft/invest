const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function run() {
  const { data } = await supabase
    .from('trade_opportunities')
    .select('symbol, status, created_at')
    .eq('status', 'APPROVED');
  console.log(JSON.stringify(data, null, 2));
}
run();
