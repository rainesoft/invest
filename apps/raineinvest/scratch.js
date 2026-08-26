const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env' });
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
async function run() {
  const { data: t } = await supabase.from('trades').select('id').limit(1);
  const { data: ut } = await supabase.from('user_trades').select('id, status').limit(1);
  console.log("Trades table exists: ", !!t);
  console.log("User trades table exists: ", !!ut);
}
run();
