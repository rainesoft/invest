import { createClient } from '@supabase/supabase-js';

const url = process.env.SUPABASE_URL || 'https://ktezlusdkqlfdwqrldtn.supabase.co';
const key = process.env.SUPABASE_SERVICE_ROLE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imt0ZXpsdXNka3FsZmR3cXJsZHRuIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc0NDYyNDQ2MiwiZXhwIjoyMDYwMjAwNDYyfQ.t1U0KpSeGL8SrsMDuLWVfpXI-SsV5UnJIdRIRNAi9ZM';

const supabase = createClient(url, key);

async function checkCron() {
  console.log('--- RECENT CRON EXECUTIONS ---');
  // We need to use raw SQL for cron schema, but Supabase JS client doesn't support other schemas directly unless we use rpc.
  // Wait, if it doesn't support other schemas, we can't query cron.job_run_details easily without an RPC.
  // Let's just query net.http_request_queue or something? 
  // We'll see if we can do an RPC call or we'll just inform the user.
}

async function checkLogs() {
  console.log('--- LATEST 5 AUDIT LOGS ---');
  const { data: audit, error: auditErr } = await supabase
    .from('audit_log')
    .select('created_at, action, payload_json')
    .eq('entity_type', 'research')
    .order('created_at', { ascending: false })
    .limit(5);

  if (auditErr) {
    console.error('Error fetching audit logs:', auditErr);
  } else {
    audit?.forEach(log => {
      console.log(`[${log.created_at}] ${log.action} - ${JSON.stringify(log.payload_json)}`);
    });
  }

  console.log('\n--- LATEST 5 OPPORTUNITIES ---');
  const { data: opps, error: oppsErr } = await supabase
    .from('trade_opportunities')
    .select('created_at, symbol, status, ai_summary')
    .order('created_at', { ascending: false })
    .limit(5);

  if (oppsErr) {
    console.error('Error fetching opps:', oppsErr);
  } else {
    console.log(`Found ${opps?.length || 0} opportunities.`);
    opps?.forEach(opp => {
      console.log(`[${opp.created_at}] ${opp.symbol} - ${opp.status}: ${opp.ai_summary}`);
    });
  }
}

checkLogs();
