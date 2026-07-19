const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');

const envLocal = fs.readFileSync('apps/rainebank/.env.local', 'utf8');
const supabaseUrl = envLocal.match(/NEXT_PUBLIC_SUPABASE_URL=(.*)/)[1];
const serviceRoleKey = envLocal.match(/SUPABASE_SERVICE_ROLE_KEY=(.*)/)[1];

const supabase = createClient(supabaseUrl, serviceRoleKey);

async function invoke() {
  console.log('Invoking research-run manually...');
  const { data, error } = await supabase.functions.invoke('research-run', {
    body: { timeframe: '1h' }
  });

  if (error) {
    console.error('Invocation Error:', error);
  } else {
    console.log('Success!', data);
  }
}

invoke();
