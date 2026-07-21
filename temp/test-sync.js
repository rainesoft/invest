const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

(async () => {
  const { data: users } = await supabase.from("user_risk_settings").select("*").eq("is_live_execution_enabled", true).not("meta_api_token", "is", null);
  const user = users[0];
  const baseUrl = process.env.META_API_BASE_URL || "https://mt-client-api-v1.london.agiliumtrade.ai";
  
  const { data: openTrades } = await supabase.from("user_trades").select("id, symbol, meta_api_order_id, status").eq("user_id", user.user_id).in("status", ["OPEN", "PENDING"]);
  
  const startTime = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
  const endTime = new Date().toISOString();
  const historyUrl = `${baseUrl}/users/current/accounts/${user.meta_api_account_id}/history-deals/time/${startTime}/${endTime}`;
  
  const historyResponse = await fetch(historyUrl, { headers: { "auth-token": user.meta_api_token } });
  const historyDeals = await historyResponse.json();
  const closingDeals = historyDeals.filter(deal => deal.entryType === "DEAL_ENTRY_OUT");
  
  for (const trade of openTrades) {
    if (!trade.meta_api_order_id) continue;
    const closingDeal = closingDeals.find(deal => String(deal.positionId) === String(trade.meta_api_order_id));
    if (closingDeal) {
      console.log(`Trade ${trade.meta_api_order_id} resolved!`);
    } else {
      console.log(`Trade ${trade.meta_api_order_id} NOT found in closingDeals. Available positionIds:`, closingDeals.map(d => d.positionId));
    }
  }
})();
