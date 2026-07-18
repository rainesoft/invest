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
        .select("id, symbol, meta_api_order_id, status, trade_type, opportunity_id, risk_amount")
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
          
          const finalStatus = profitUsd > 0 ? "WON" : "LOST";

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

          // VIRTUAL PAMM REPLICATION
          // If this is the Master Account resolving a trade, we must replicate this outcome 
          // to all virtual retail trades attached to the same opportunity_id.
          const roiMult = profitUsd / trade.risk_amount; // e.g. made +$100 on $1000 risk = +0.10 ROI

          // Fetch all open virtual trades for this opportunity
          const { data: virtualTrades } = await supabase
            .from("user_trades")
            .select("id, risk_amount")
            .eq("opportunity_id", trade.opportunity_id)
            .eq("trade_type", trade.trade_type)
            .in("status", ["PAPER_OPEN", "PENDING", "OPEN"])
            .neq("id", trade.id);

          if (virtualTrades && virtualTrades.length > 0) {
            console.log(`[History Sync] Replicating Master PnL to ${virtualTrades.length} virtual trades...`);
            
            for (const vTrade of virtualTrades) {
              const vProfit = Number((vTrade.risk_amount * roiMult).toFixed(2));
              await supabase
                .from("user_trades")
                .update({
                  status: finalStatus,
                  profit_usd: vProfit,
                  close_price: closePrice,
                  closed_at: closedAt
                })
                .eq("id", vTrade.id);
            }
          }

          resolvedTrades.push({ id: trade.id, finalStatus, profitUsd });

          // --- Breakeven Trigger ---
          // When a QUICK_EXIT leg closes in profit, automatically move the companion RUNNER
          // leg's stop loss to breakeven so it can never close at a loss.
          if (finalStatus === "WON" && trade.trade_type === "QUICK_EXIT") {
            console.log(`[History Sync] QUICK_EXIT WON for ${trade.symbol}. Triggering breakeven on companion RUNNER...`);

            const { data: runnerTrade } = await supabase
              .from("user_trades")
              .select("id, meta_api_order_id")
              .eq("user_id", userId)
              .eq("opportunity_id", trade.opportunity_id)
              .eq("trade_type", "RUNNER")
              .eq("status", "OPEN")
              .single();

            if (runnerTrade?.meta_api_order_id) {
              try {
                // Fetch the live position to get openPrice and current takeProfit
                const posUrl = `${baseUrl}/users/current/accounts/${userAccountId}/positions/${runnerTrade.meta_api_order_id}`;
                const posRes = await fetch(posUrl, { headers: { "auth-token": userToken } });

                if (posRes.ok) {
                  const pos = await posRes.json();
                  const breakevenSL = Number(pos.openPrice);
                  const existingTP = Number(pos.takeProfit);

                  const modifyUrl = `${baseUrl}/users/current/accounts/${userAccountId}/trade`;
                  const modifyPayload = {
                    actionType: "POSITION_MODIFY",
                    positionId: runnerTrade.meta_api_order_id,
                    stopLoss: breakevenSL,   // Breakeven
                    takeProfit: existingTP,   // Re-inject per MetaAPI Modification Protocol
                  };

                  const modifyRes = await fetch(modifyUrl, {
                    method: "POST",
                    headers: { "auth-token": userToken, "Content-Type": "application/json" },
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
