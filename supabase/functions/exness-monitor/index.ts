import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2.108.2";
import { isMarketOpen } from "../_shared/market.ts";
import { fetchPaperBars } from "../_shared/execution.ts";
import { ATR } from "npm:technicalindicators@3.1.0";

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

    // Fetch live BYOB users
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

    for (const user of users) {
      const userToken = user.meta_api_token;
      const userAccountId = user.meta_api_account_id;
      const userId = user.user_id;

      console.log(`[Exness Monitor] Processing user ${userId}...`);
      const positionsUrl = `${baseUrl}/users/current/accounts/${userAccountId}/positions`;
      
      let positions = [];
      try {
        const posResponse = await fetch(positionsUrl, {
          headers: { "auth-token": userToken },
        });

        if (!posResponse.ok) {
          const err = await posResponse.text();
          console.error(`[Exness Monitor] User ${userId} failed to fetch positions: ${err}`);
          continue;
        }

        positions = await posResponse.json();
      } catch (e) {
        console.error(`[Exness Monitor] User ${userId} fetch exception: ${e}`);
        continue;
      }

      console.log(`[Exness Monitor] User ${userId} has ${positions.length} open positions.`);

      // --- 0. Reconcile & Execute PENDING Trades ---
      const { data: pendingTrades } = await supabase
        .from("user_trades")
        .select("id, symbol, side, volume, meta_api_order_id, created_at, trade_opportunities(entry_plan_json, stop_plan_json, take_profit_json)")
        .eq("user_id", userId)
        .eq("status", "PENDING");

      if (pendingTrades && pendingTrades.length > 0) {
        const brokerPositionIds = new Set(positions.map((p: any) => String(p.id)));

        for (const trade of pendingTrades) {
          // --- Ghost Trade Pruning (24h TTL) ---
          const ageMs = Date.now() - new Date(trade.created_at).getTime();
          if (ageMs > 24 * 60 * 60 * 1000) {
            console.log(`[Exness Monitor] Ghost Trade pruned: ${trade.symbol} exceeded 24h PENDING TTL.`);
            await supabase.from("user_trades").update({ status: "CANCELLED", error_message: "Pruned by 24h Ghost TTL" }).eq("id", trade.id);
            // Optionally insert into audit log, but since this is an Edge Function it might not have the audit helper imported.
            // We'll rely on the status update for now.
            continue;
          }

          if (trade.meta_api_order_id && brokerPositionIds.has(String(trade.meta_api_order_id))) {
            console.log(`[Exness Monitor] Limit order ${trade.meta_api_order_id} (${trade.symbol}) has been FILLED on broker. Promoting to OPEN.`);
            await supabase.from("user_trades").update({ status: "OPEN" }).eq("id", trade.id);
          } else if (!trade.meta_api_order_id) {
            // --- Soft Pending Order Validation ---
            try {
              const quoteUrl = `${baseUrl}/users/current/accounts/${userAccountId}/symbols/${trade.symbol}/current-quote`;
              const quoteRes = await fetch(quoteUrl, { headers: { "auth-token": userToken } });
              if (!quoteRes.ok) continue;
              const quoteData = await quoteRes.json();
              
              const entryPlan = trade.trade_opportunities?.entry_plan_json || {};
              const entryPrice = entryPlan.price || entryPlan.entry_price || entryPlan.limit_price;
              if (!entryPrice) continue;
              
              let crossed = false;
              const actionType = trade.side === "LONG" ? "ORDER_TYPE_BUY" : "ORDER_TYPE_SELL";

              if (trade.side === "LONG" && quoteData.ask <= entryPrice) crossed = true;
              if (trade.side === "SHORT" && quoteData.bid >= entryPrice) crossed = true;
              
              if (crossed) {
                 console.log(`[Exness Monitor] Soft pending order for ${trade.symbol} crossed entry price ${entryPrice}. Validating momentum...`);
                 // Fetch 1m candles for momentum validation
                 const { bars } = await fetchPaperBars(trade.symbol, "1m", 3);
                 let momentumInvalid = false;
                 
                 if (bars && bars.length >= 2) {
                   const lastBar = bars[bars.length - 1];
                   const prevBar = bars[bars.length - 2];
                   
                   // If LONG, reject if massive consecutive red candles
                   if (trade.side === "LONG" && lastBar.c < lastBar.o && prevBar.c < prevBar.o) {
                      console.log(`[Exness Monitor] Rejected LONG on ${trade.symbol}: bearish momentum crash detected.`);
                      momentumInvalid = true;
                   }
                   // If SHORT, reject if massive consecutive green candles
                   if (trade.side === "SHORT" && lastBar.c > lastBar.o && prevBar.c > prevBar.o) {
                      console.log(`[Exness Monitor] Rejected SHORT on ${trade.symbol}: bullish momentum spike detected.`);
                      momentumInvalid = true;
                   }
                 }

                 if (momentumInvalid) {
                   await supabase.from("user_trades").update({ 
                     status: "REJECTED", 
                     error_message: "Momentum Breaker Tripped: Price crashed through entry zone." 
                   }).eq("id", trade.id);
                 } else {
                   console.log(`[Exness Monitor] Momentum validated. Firing Market Order for ${trade.symbol}.`);
                   const stopPlan = trade.trade_opportunities?.stop_plan_json || {};
                   const takeProfitPlan = trade.trade_opportunities?.take_profit_json || {};
                   const orderPayload = {
                     actionType: actionType,
                     symbol: trade.symbol,
                     volume: trade.volume,
                     stopLoss: stopPlan.stop || stopPlan.stop_price,
                     takeProfit: takeProfitPlan.tp || takeProfitPlan.tp_price,
                     clientId: trade.id,
                   };
                   
                   const metaApiUrl = `${baseUrl}/users/current/accounts/${userAccountId}/trade`;
                   const response = await fetch(metaApiUrl, {
                     method: "POST",
                     headers: { "auth-token": userToken, "Content-Type": "application/json" },
                     body: JSON.stringify(orderPayload),
                   });
                   
                   if (response.ok) {
                     const responseData = await response.json();
                     await supabase.from("user_trades").update({ 
                       status: "OPEN", 
                       meta_api_order_id: responseData.orderId || "EXECUTED" 
                     }).eq("id", trade.id);
                   } else {
                     const err = await response.text();
                     await supabase.from("user_trades").update({ status: "FAILED", error_message: err }).eq("id", trade.id);
                   }
                 }
              }
            } catch (e) {
              console.error(`[Exness Monitor] Error validating soft pending order ${trade.id}: ${e}`);
            }
          }
        }
      }

      const trails = [];

      for (const pos of positions) {
        const { id, type, symbol, openPrice, currentPrice, stopLoss, takeProfit, time } = pos;
        
        if (!isMarketOpen(symbol)) {
          console.log(`[Exness Monitor] Skipping ${symbol} (${id}): Market is closed.`);
          continue;
        }

        // --- 1. Dynamic Trade Termination (Thesis Validation) ---
        console.log(`[Exness Monitor] Validating thesis for open trade ${symbol} (${id})...`);
        
        // Fetch latest AI bias
        const { data: latestSignals } = await supabase
          .from("trade_opportunities")
          .select("side")
          .eq("symbol", symbol)
          .order("created_at", { ascending: false })
          .limit(1);

        const posSide = type === "POSITION_TYPE_BUY" ? "LONG" : "SHORT";
        let shouldClose = false;

        if (latestSignals && latestSignals.length > 0) {
          const aiSide = latestSignals[0].side;
          if (aiSide === posSide) {
            console.log(`[Exness Monitor] AI validated ${posSide} bias for ${symbol}. Keeping position open.`);
          } else {
            console.log(`[Exness Monitor] AI bias flipped to ${aiSide} for ${symbol}. Thesis invalidated!`);
            shouldClose = true;
          }
        } else {
          console.log(`[Exness Monitor] No recent AI data for ${symbol}. Holding trade (Option B logic).`);
        }

        if (shouldClose) {
            const closeUrl = `${baseUrl}/users/current/accounts/${userAccountId}/trade`;
            const closePayload = {
              actionType: "POSITION_CLOSE_ID",
              positionId: id
            };

            const closeResponse = await fetch(closeUrl, {
              method: "POST",
              headers: {
                "auth-token": userToken,
                "Content-Type": "application/json",
              },
              body: JSON.stringify(closePayload)
            });

            if (closeResponse.ok) {
              console.log(`[Exness Monitor] Successfully closed invalid position ${id}`);
              trails.push({ id, symbol, success: true, closed_due_to_dynamic_term: true });
            } else {
              const err = await closeResponse.text();
              console.error(`[Exness Monitor] Failed to close invalid position ${id}: ${err}`);
              await supabase.from("meta_api_retry_queue").insert({
                 user_id: userId,
                 meta_api_account_id: userAccountId,
                 request_type: "POSITION_CLOSE",
                 api_payload: closePayload,
                 last_error: err
              });
              trails.push({ id, symbol, success: false, closed_due_to_dynamic_term: false, error: err, queued_for_retry: true });
            }
            continue; // Skip trailing stop logic since we initiated a close
          }

        // --- 2. Native Trailing Stop Delegation ---
        // Trailing Stops are now handled natively by MetaAPI's servers via the trailingStopLoss parameter 
        // injected during order creation in exness-executor. We no longer poll to trail stops.
      }
      
      report.push({ user_id: userId, positions_checked: positions.length, trailed: trails });
    }

    return new Response(JSON.stringify({
      success: true,
      processed_users: report.length,
      report: report
    }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });

  } catch (error: any) {
    console.error(`[Exness Monitor] Exception:`, error);
    return new Response(`Server error: ${error.message}`, { status: 500 });
  }
});
