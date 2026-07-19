const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function run() {
  // Archive the old flawed signal
  await supabase.from('trade_opportunities')
    .update({ is_archived: true })
    .eq('id', 'fe4ec711-88b1-47e2-84e1-9fc7a3ec6491');
  console.log('Archived old flawed $70.50 signal.');

  // Clear Pre-AI Guard cache
  await supabase.from('audit_log')
    .delete()
    .eq('action', 'REJECTED_BY_RISK_PRE_AI')
    .eq('entity_type', 'research')
    .filter('payload_json->>symbol', 'eq', 'UKOIL');
  console.log('Cleared cache. Triggering with Rules 16+17 active...\n');

  const url = `${process.env.SUPABASE_URL}/functions/v1/research-run`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`
    },
    body: JSON.stringify({ symbols: ['UKOIL'], timeframe: '4H' })
  });

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    process.stdout.write(decoder.decode(value, { stream: true }));
  }
}
run();
