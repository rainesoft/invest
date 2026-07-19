const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function run() {
  const { error } = await supabase
    .from('audit_log')
    .delete()
    .eq('action', 'REJECTED_BY_RISK_PRE_AI');
  if (error) console.error(error);
  else console.log("Cache cleared!");
}
run();
