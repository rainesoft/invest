const { createClient } = require('@supabase/supabase-js');
const supabase = createClient('https://ktezlusdkqlfdwqrldtn.supabase.co', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imt0ZXpsdXNka3FsZmR3cXJsZHRuIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc0NDYyNDQ2MiwiZXhwIjoyMDYwMjAwNDYyfQ.t1U0KpSeGL8SrsMDuLWVfpXI-SsV5UnJIdRIRNAi9ZM');

async function test() {
  console.log("Invoking agent-scalper for BTCUSD 4H...");
  const { data, error } = await supabase.functions.invoke('agent-scalper', {
    body: { symbol: "BTCUSD", timeframe: "4H" }
  });
  if (error) console.error("Error:", error);
  else console.log("Success:", data);
}
test();
