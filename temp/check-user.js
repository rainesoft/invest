const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function run() {
  const { data } = await supabase
    .from('user_risk_settings')
    .select('*')
    .eq('user_id', '00ebf71d-8ad4-4072-9bb8-6149f55594b1');
  console.log(JSON.stringify(data, null, 2));
}
run();
