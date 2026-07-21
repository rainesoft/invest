const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');

const envLocal = fs.readFileSync('apps/rainebank/.env.local', 'utf8');
const supabaseUrl = envLocal.match(/NEXT_PUBLIC_SUPABASE_URL=(.*)/)[1];
const serviceRoleKey = envLocal.match(/SUPABASE_SERVICE_ROLE_KEY=(.*)/)[1];

const supabase = createClient(supabaseUrl, serviceRoleKey);

async function promote() {
  const email = 'kobequagraine@yahoo.com';
  
  // Get user id from auth.users via RPC or just update directly if we can't query auth.users
  // Wait, service role can query auth.admin
  const { data: { users }, error: fetchErr } = await supabase.auth.admin.listUsers();
  if (fetchErr) {
    console.error('Fetch error:', fetchErr);
    return;
  }
  
  const user = users.find(u => u.email === email);
  if (!user) {
    console.error(`User ${email} not found`);
    return;
  }
  
  const { error: updateErr } = await supabase
    .from('user_risk_settings')
    .update({ is_admin: true })
    .eq('user_id', user.id);
    
  if (updateErr) {
    console.error('Update error:', updateErr);
  } else {
    console.log(`Successfully promoted ${email} to admin!`);
  }
}

promote();
