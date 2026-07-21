const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function run() {
  const { data } = await supabase
    .from('user_trades')
    .select('id, symbol, side, status, error_message, created_at, opportunity_id')
    .eq('user_id', '00ebf71d-8ad4-4072-9bb8-6149f55594b1')
    .order('created_at', { ascending: false })
    .limit(5);
  console.log(JSON.stringify(data, null, 2));
}
run();
