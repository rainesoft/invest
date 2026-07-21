const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function run() {
  const { data: userTrades } = await supabase.from('user_trades').select('id, meta_api_order_id, status');
  const { data: trades } = await supabase.from('trades').select('id, meta_api_order_id, status');
  console.log(`user_trades count: ${userTrades?.length}`);
  console.log(`trades count: ${trades?.length || 'query failed/no column'}`);
}
run();
