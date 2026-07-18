const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '../../.env' });
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
async function run() {
  const { data } = await supabase.from('user_risk_settings').select('*');
  console.log(JSON.stringify(data, null, 2));
}
run();
