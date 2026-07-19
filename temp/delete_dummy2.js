const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');

const envLocal = fs.readFileSync('apps/rainebank/.env.local', 'utf8');
const supabaseUrl = envLocal.match(/NEXT_PUBLIC_SUPABASE_URL=(.*)/)[1];
const serviceRoleKey = envLocal.match(/SUPABASE_SERVICE_ROLE_KEY=(.*)/)[1];

const supabase = createClient(supabaseUrl, serviceRoleKey);

async function clean() {
  const { data: ex, error: exErr } = await supabase.from('executions').delete().eq('symbol', 'BTCUSD').select();
  console.log(`Deleted ${ex ? ex.length : 0} executions.`);
}
clean();
