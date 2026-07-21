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

    // PAMM Architecture: Fetch history from the Master Account
    const masterToken = Deno.env.get("META_API_TOKEN");
    const masterAccountId = Deno.env.get("META_API_ACCOUNT_ID");
    
    if (!masterToken || !masterAccountId) {
      return new Response("Missing Master META_API credentials in ENV", { status: 500 });
    }

    const report = [];

    // Setup time window (last 48 hours to ensure we catch everything)
    const startTime = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
    const endTime = new Date().toISOString();

    // Fetch all open trades across the entire PAMM
    const { data: openTrades, error: openTradesError } = await supabase
      .from("user_trades")
      .select("id, symbol, meta_api_order_id, status, trade_type, opportunity_id, risk_amount")
      .in("status", ["OPEN", "PENDING"])
      .not("meta_api_order_id", "is", null);

    if (openTradesError || !openTrades || openTrades.length === 0) {
      return new Response("No open trades to sync", { status: 200 });
    }

    console.log(`[History Sync] Found ${openTrades.length} open trades across PAMM vaults. Fetching Master history...`);
    
    const historyUrl = `${baseUrl}/users/current/accounts/${masterAccountId}/history-deals/time/${startTime}/${endTime}`;
    
    let historyDeals = [];
    try {
      const historyResponse = await fetch(historyUrl, {
        headers: { "auth-token": masterToken },
      });

      if (!historyResponse.ok) {
        const err = await historyResponse.text();
        console.error(`[History Sync] Master failed to fetch history: ${err}`);
        return new Response("Failed to fetch Master history", { status: 500 });
      }

      historyDeals = await historyResponse.json();
    } catch (e) {
      console.error(`[History Sync] Master fetch exception: ${e}`);
      return new Response("Exception fetching Master history", { status: 500 });
    }

    // Filter for closing deals (where entryType is DEAL_ENTRY_OUT)
    const closingDeals = historyDeals.filter((deal: any) => deal.entryType === "DEAL_ENTRY_OUT");

    const resolvedTrades = [];

    for (const trade of openTrades) {
      // The positionId on the closing deal matches our meta_api_order_id (which was the original opening order id)
      const closingDeal = closingDeals.find((deal: any) => String(deal.positionId) === String(trade.meta_api_order_id));

      if (closingDeal) {
        const profitUsd = closingDeal.profit;
        const isWin = profitUsd > 0;
        const finalStatus = isWin ? "WON" : "LOST";
        
        const closePrice = closingDeal.price;
        const closedAt = closingDeal.time;

        console.log(`[History Sync] Trade ${trade.meta_api_order_id} resolved as ${finalStatus} with $${profitUsd} profit`);

        await supabase
          .from("user_trades")
          .update({
            status: finalStatus,
            profit_usd: profitUsd,
            close_price: closePrice,
            closed_at: closedAt
          })
          .eq("id", trade.id);

        resolvedTrades.push({ id: trade.id, finalStatus });

          // --- Breakeven Trigger ---
          // When a QUICK_EXIT leg closes in profit, automatically move the companion RUNNER
          // leg's stop loss to breakeven so it can never close at a loss.
          if (finalStatus === "WON" && trade.trade_type === "QUICK_EXIT") {
            console.log(`[History Sync] QUICK_EXIT WON for ${trade.symbol}. Triggering breakeven on companion RUNNER...`);

            const { data: runnerTrade } = await supabase
              .from("user_trades")
              .select("id, meta_api_order_id")
              .eq("user_id", trade.user_id)
              .eq("opportunity_id", trade.opportunity_id)
              .eq("trade_type", "RUNNER")
              .eq("status", "OPEN")
              .single();

            if (runnerTrade?.meta_api_order_id) {
              try {
                // Fetch the live position to get openPrice and current takeProfit
                const posUrl = `${baseUrl}/users/current/accounts/${masterAccountId}/positions/${runnerTrade.meta_api_order_id}`;
                const posRes = await fetch(posUrl, { headers: { "auth-token": masterToken } });

                if (posRes.ok) {
                  const pos = await posRes.json();
                  const breakevenSL = Number(pos.openPrice);
                  const existingTP = Number(pos.takeProfit);

                  const modifyUrl = `${baseUrl}/users/current/accounts/${masterAccountId}/trade`;
                  const modifyPayload = {
                    actionType: "POSITION_MODIFY",
                    positionId: runnerTrade.meta_api_order_id,
                    stopLoss: breakevenSL,   // Breakeven
                    takeProfit: existingTP,   // Re-inject per MetaAPI Modification Protocol
                  };

                  const modifyRes = await fetch(modifyUrl, {
                    method: "POST",
                    headers: { "auth-token": masterToken, "Content-Type": "application/json" },
                    body: JSON.stringify(modifyPayload),
                  });

                  if (modifyRes.ok) {
                    console.log(`[History Sync] Breakeven set on RUNNER ${runnerTrade.meta_api_order_id} at ${breakevenSL}.`);
                  } else {
                    const err = await modifyRes.text();
                    console.error(`[History Sync] Failed to set breakeven on RUNNER: ${err}`);
                  }
                } else {
                  console.error(`[History Sync] Could not fetch live position for RUNNER ${runnerTrade.meta_api_order_id}`);
                }
              } catch (e) {
                console.error(`[History Sync] Breakeven trigger exception:`, e);
              }
            } else {
              console.log(`[History Sync] No open RUNNER found for opportunity ${trade.opportunity_id}. May have already closed.`);
            }
          }
        }
      }
      
      report.push({ resolved: resolvedTrades });

    return new Response(JSON.stringify({
      success: true,
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
