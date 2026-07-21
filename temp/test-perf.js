const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function run() {
  const start = Date.now();
  
  const edgeFunctionUrl = process.env.SUPABASE_URL + "/functions/v1/agent-scalper";
  console.log("Triggering agent-scalper to measure execution time...");
  
  const response = await fetch(edgeFunctionUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`
    },
    body: JSON.stringify({ symbols: "EURUSD", timeframe: "4H" }) // Only ONE symbol
  });
  
  console.log("Status:", response.status);
  const end = Date.now();
  console.log("Time taken for 1 symbol:", (end - start) / 1000, "seconds");
}
run();
