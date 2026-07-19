const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function run() {
  const { data } = await supabase
    .from("market_data_pti")
    .select("ts, h, l, c")
    .eq("symbol", "UKOIL")
    .eq("timeframe", "4h")
    .order("ts", { ascending: false })
    .limit(3);
    
  console.log("=== Recent UKOIL 4H Candles ===");
  if (data) {
    data.forEach(c => console.log(`[${c.ts}] High: ${c.h}, Low: ${c.l}, Close: ${c.c}`));
  }
}
run();
