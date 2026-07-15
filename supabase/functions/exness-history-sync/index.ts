import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2.108.2";

const baseUrl = Deno.env.get("META_API_BASE_URL") || "https://mt-client-api-v1.london.agiliumtrade.ai";

serve(async (req) => {
  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!supabaseUrl || !supabaseKey) {
      console.error("Missing Supabase env vars.");
      return new Response("Server Configuration Error", { status: 500 });
    }

    const authHeader = req.headers.get("Authorization");
    const cronSecretHeader = req.headers.get("x-cron-secret");
    const cronSecretEnv = Deno.env.get("CRON_SECRET");
    
    const isAuthorized = 
      authHeader === `Bearer ${supabaseKey}` || 
      (cronSecretHeader && cronSecretEnv && cronSecretHeader === cronSecretEnv);

    if (!isAuthorized) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { "Content-Type": "application/json" } });
    }

    const supabase = createClient(supabaseUrl, supabaseKey);

    // 1. Fetch live BYOB users
    const { data: users, error: usersError } = await supabase
      .from("user_risk_settings")
      .select("*")
      .eq("is_live_execution_enabled", true)
      .not("meta_api_token", "is", null)
      .not("meta_api_account_id", "is", null);

    if (usersError || !users) {
      return new Response("Failed to fetch users", { status: 500 });
    }

    const report = [];

    // Setup time window (last 48 hours to ensure we catch everything)
    const startTime = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
    const endTime = new Date().toISOString();

    for (const user of users) {
      const userToken = user.meta_api_token;
      const userAccountId = user.meta_api_account_id;
      const userId = user.user_id;

      // Check if user has any OPEN or PENDING trades (a pending limit order might have filled and closed rapidly)
      const { data: openTrades, error: openTradesError } = await supabase
        .from("user_trades")
        .select("id, symbol, meta_api_order_id, status")
        .eq("user_id", userId)
        .in("status", ["OPEN", "PENDING"]);

      if (openTradesError || !openTrades || openTrades.length === 0) {
        continue;
      }

      console.log(`[History Sync] Processing user ${userId} with ${openTrades.length} open trades...`);
      
      const historyUrl = `${baseUrl}/users/current/accounts/${userAccountId}/history-deals/time/${startTime}/${endTime}`;
      
      let historyDeals = [];
      try {
        const historyResponse = await fetch(historyUrl, {
          headers: { "auth-token": userToken },
        });

        if (!historyResponse.ok) {
          const err = await historyResponse.text();
          console.error(`[History Sync] User ${userId} failed to fetch history: ${err}`);
          continue;
        }

        historyDeals = await historyResponse.json();
      } catch (e) {
        console.error(`[History Sync] User ${userId} fetch exception: ${e}`);
        continue;
      }

      // Filter for closing deals (where entryType is DEAL_ENTRY_OUT)
      const closingDeals = historyDeals.filter((deal: any) => deal.entryType === "DEAL_ENTRY_OUT");

      const resolvedTrades = [];

      for (const trade of openTrades) {
        if (!trade.meta_api_order_id) continue;

        // The positionId on the closing deal matches our meta_api_order_id (which was the original opening order id)
        const closingDeal = closingDeals.find((deal: any) => String(deal.positionId) === String(trade.meta_api_order_id));

        if (closingDeal) {
          const profitUsd = closingDeal.profit; // Note: if account is not USD, this might need conversion, but typically MT5 returns account currency
          const closePrice = closingDeal.price;
          const closedAt = closingDeal.time;
          
          const finalStatus = profitUsd > 0 ? "CLOSED_WON" : "CLOSED_LOST";

          console.log(`[History Sync] Trade ${trade.meta_api_order_id} resolved as ${finalStatus} with $${profitUsd} profit.`);

          await supabase
            .from("user_trades")
            .update({
              status: finalStatus,
              profit_usd: profitUsd,
              close_price: closePrice,
              closed_at: closedAt
            })
            .eq("id", trade.id);

          resolvedTrades.push({ id: trade.id, finalStatus, profitUsd });
        }
      }
      
      report.push({ user_id: userId, resolved: resolvedTrades });
    }

    return new Response(JSON.stringify({
      success: true,
      processed_users: users.length,
      report: report
    }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });

  } catch (error: any) {
    console.error(`[History Sync] Exception:`, error);
    return new Response(`Server error: ${error.message}`, { status: 500 });
  }
});
