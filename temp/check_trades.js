const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');

const envLocal = fs.readFileSync('apps/rainebank/.env.local', 'utf8');
const supabaseUrl = envLocal.match(/NEXT_PUBLIC_SUPABASE_URL=(.*)/)[1];
const serviceRoleKey = envLocal.match(/SUPABASE_SERVICE_ROLE_KEY=(.*)/)[1];

const supabase = createClient(supabaseUrl, serviceRoleKey);

async function check() {
  const { data, error } = await supabase.from('trades').select('*').limit(1);
  if (error) console.error(error);
  console.log('Trades table columns:', data ? Object.keys(data[0] || {}) : 'No data');
  
  // also check executions
  const { data: execs } = await supabase.from('executions').select('*').limit(1);
  console.log('Executions columns:', execs ? Object.keys(execs[0] || {}) : 'No data');
}
check();
