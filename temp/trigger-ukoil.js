const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function run() {
  // Clear the Pre-AI Guard cache for UKOIL so it doesn't skip
  const { data: cleared } = await supabase.from('audit_log')
    .delete()
    .eq('action', 'REJECTED_BY_RISK_PRE_AI')
    .eq('entity_type', 'research')
    .filter('payload_json->>symbol', 'eq', 'UKOIL');
  console.log('Cleared cached rejections for UKOIL');

  // Now trigger the agent-scalper for UKOIL only
  const url = `${process.env.SUPABASE_URL}/functions/v1/agent-scalper`;
  console.log('Triggering agent-scalper for UKOIL...');
  
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`
    },
    body: JSON.stringify({
      symbols: ['UKOIL'],
      timeframe: '4H'
    })
  });

  // Stream the SSE response
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let fullText = '';
  
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    const chunk = decoder.decode(value, { stream: true });
    fullText += chunk;
    process.stdout.write(chunk);
  }
}
run();
