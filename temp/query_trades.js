const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');

const envLocal = fs.readFileSync('apps/rainebank/.env.local', 'utf8');
const supabaseUrl = envLocal.match(/NEXT_PUBLIC_SUPABASE_URL=(.*)/)[1];
const serviceRoleKey = envLocal.match(/SUPABASE_SERVICE_ROLE_KEY=(.*)/)[1];

const supabase = createClient(supabaseUrl, serviceRoleKey);

async function clean() {
  const { data: ut } = await supabase.from('user_trades').select('*');
  console.log('user_trades:', ut);
  
  const { data: t } = await supabase.from('trades').select('*');
  console.log('trades:', t);
}
clean();
