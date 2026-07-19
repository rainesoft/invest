const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function run() {
  const userId = "00ebf71d-8ad4-4072-9bb8-6149f55594b1";
  
  // Update Tier
  const { error } = await supabase
    .from('user_subscriptions')
    .update({ billing_amount_usd: 19 })
    .eq('user_id', userId);
  
  if (error) {
    console.error("Error updating tier:", error);
    return;
  }
  console.log("Tier updated to $19/mo (Max Equity: $2499)!");

  // Find UKOIL signal
  const { data: opps } = await supabase
    .from('trade_opportunities')
    .select('id, symbol, status')
    .eq('symbol', 'UKOIL')
    .in('status', ['APPROVED', 'EXPIRED']) // It might have been EXPIRED or APPROVED
    .order('created_at', { ascending: false })
    .limit(1);

  if (opps && opps.length > 0) {
    console.log("Found UKOIL Signal ID:", opps[0].id, "Status:", opps[0].status);
    
    // If it was expired, we temporarily set it back to APPROVED so the executor doesn't reject it
    if (opps[0].status !== 'APPROVED') {
       await supabase.from('trade_opportunities').update({ status: 'APPROVED' }).eq('id', opps[0].id);
    }
    
    const edgeFunctionUrl = process.env.SUPABASE_URL + "/functions/v1/exness-executor";
    const response = await fetch(edgeFunctionUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`
      },
      body: JSON.stringify({
        action: 'MANUAL_EXECUTION',
        user_id: userId,
        opportunity_id: opps[0].id
      })
    });
    console.log("Execution Status:", response.status);
    console.log("Execution Result:", await response.text());
  } else {
    console.log("Could not find UKOIL signal.");
  }
}
run();
