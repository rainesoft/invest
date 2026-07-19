const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

async function cancelOrders() {
  const userId = "00ebf71d-8ad4-4072-9bb8-6149f55594b1"; 

  const { data: user, error: userError } = await supabase
    .from('user_risk_settings')
    .select('meta_api_token, meta_api_account_id')
    .eq('user_id', userId)
    .single();

  if (userError || !user) {
    console.error("Failed to fetch user settings", userError);
    return;
  }

  const { data: cancelledTrades, error: tradesError } = await supabase
    .from('user_trades')
    .select('id, symbol, meta_api_order_id')
    .eq('user_id', userId)
    .eq('status', 'CANCELLED')
    .not('meta_api_order_id', 'is', null);
    
  if (tradesError) {
     console.error("Failed to fetch trades", tradesError);
     return;
  }

  const baseUrl = process.env.META_API_BASE_URL || "https://mt-client-api-v1.new-york.agiliumtrade.ai";

  console.log(`Found ${cancelledTrades.length} cancelled trades to verify with broker...`);

  for (const trade of cancelledTrades) {
    if (trade.meta_api_order_id === "EXECUTED") {
      continue;
    }

    console.log(`Sending cancellation for order ${trade.meta_api_order_id} (${trade.symbol}) to MetaAPI...`);
    
    try {
      const cancelPayload = {
        actionType: "ORDER_CANCEL",
        orderId: trade.meta_api_order_id
      };
      
      const cancelUrl = `${baseUrl}/users/current/accounts/${user.meta_api_account_id}/trade`;
      const response = await fetch(cancelUrl, {
        method: "POST",
        headers: {
          "auth-token": user.meta_api_token,
          "Content-Type": "application/json"
        },
        body: JSON.stringify(cancelPayload)
      });
      
      if (!response.ok) {
        const err = await response.text();
        console.error(`  [!] Failed to cancel on broker: ${err}`);
      } else {
        console.log(`  [+] Successfully cancelled order ${trade.meta_api_order_id} on broker!`);
      }
    } catch (e) {
      console.error(`  [!] Error: ${e.message}`);
    }
  }
}

cancelOrders();
