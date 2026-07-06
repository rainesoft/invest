const { createClient } = require('@supabase/supabase-js');
const supabase = createClient('https://ktezlusdkqlfdwqrldtn.supabase.co', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imt0ZXpsdXNka3FsZmR3cXJsZHRuIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc0NDYyNDQ2MiwiZXhwIjoyMDYwMjAwNDYyfQ.t1U0KpSeGL8SrsMDuLWVfpXI-SsV5UnJIdRIRNAi9ZM');

async function run() {
  const { error } = await supabase.rpc('rpc_expire_stale_opportunities');
  if (error) console.error("Error sweeping:", error.message);
  else console.log("Sweep completed manually!");
}
run();
