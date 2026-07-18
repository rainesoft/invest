import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2.108.2";
import { fetchPaperBars } from "../../../packages/execution/index.ts";

serve(async (req) => {
  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    // 1. Fetch all PENDING trades
    const { data: pendingTrades, error: fetchError } = await supabase
      .from("user_trades")
      .select(`
        id,
        user_id,
        opportunity_id,
        symbol,
        side,
        volume,
        trade_type,
        created_at,
        trade_opportunities (
          entry_plan_json,
          stop_plan_json,
          take_profit_json
        ),
        user_risk_settings!inner (
          meta_api_token,
          meta_api_account_id,
          sync_trailing_stops,
          is_live_execution_enabled,
          vps_last_heartbeat,
          active_broker
        )
      `)
      .eq("status", "PENDING");

    if (fetchError) throw fetchError;
    if (!pendingTrades || pendingTrades.length === 0) {
      return new Response(JSON.stringify({ status: "success", message: "No pending orders" }), { headers: { "Content-Type": "application/json" } });
    }

    const baseUrl = Deno.env.get("META_API_BASE_URL") || "https://mt-client-api-v1.new-york.agiliumtrade.ai";

    // 2. Group by Symbol to optimize market data fetching
    const groupedBySymbol = pendingTrades.reduce((acc: any, trade: any) => {
      acc[trade.symbol] = acc[trade.symbol] || [];
      acc[trade.symbol].push(trade);
      return acc;
    }, {});

    let executedCount = 0;

    for (const symbol in groupedBySymbol) {
      // Fetch live price
      const bars = await fetchPaperBars(symbol, '1m', 1, supabase);
      if (bars.length === 0) continue;
      
      const currentPrice = bars[0].c;
      const tradesForSymbol = groupedBySymbol[symbol];

      for (const trade of tradesForSymbol) {
        const opp = trade.trade_opportunities;
        if (!opp || !opp.entry_plan_json) continue;

        const entryPrice = opp.entry_plan_json.price || opp.entry_plan_json.entry_price || opp.entry_plan_json.limit_price;
        const orderType = (opp.entry_plan_json.order_type || "").toUpperCase();
        
        let triggered = false;

        if (orderType.includes("BUY LIMIT")) {
          triggered = currentPrice <= entryPrice;
        } else if (orderType.includes("SELL LIMIT")) {
          triggered = currentPrice >= entryPrice;
        } else if (orderType.includes("BUY STOP")) {
          triggered = currentPrice >= entryPrice;
        } else if (orderType.includes("SELL STOP")) {
          triggered = currentPrice <= entryPrice;
        } else {
          triggered = true; // Market orders should already be executed, but just in case
        }

        // Expire if pending for > 12 hours
        const ageHours = (new Date().getTime() - new Date(trade.created_at).getTime()) / (1000 * 60 * 60);
        if (ageHours > 12 && !triggered) {
          await supabase.from("user_trades").update({ status: "EXPIRED" }).eq("id", trade.id);
          continue;
        }

        if (triggered) {
          // Lock the trade to prevent double execution
          await supabase.from("user_trades").update({ status: "PROCESSING" }).eq("id", trade.id);

          const stopLoss = opp.stop_plan_json?.stop;
          const takeProfit = opp.take_profit_json?.tp;
          const actionType = trade.side === "LONG" ? "ORDER_TYPE_BUY" : "ORDER_TYPE_SELL";

          // Calculate TP for QUICK_EXIT
          let targetTP = takeProfit;
          if (trade.trade_type === "QUICK_EXIT" && stopLoss) {
             const riskDistance = Math.abs(entryPrice - stopLoss);
             targetTP = trade.side === "LONG" 
               ? Number((entryPrice + riskDistance).toFixed(5))
               : Number((entryPrice - riskDistance).toFixed(5));
          }

          const payload: any = {
            actionType,
            symbol: trade.symbol,
            volume: trade.volume,
            stopLoss: stopLoss,
            takeProfit: targetTP,
            clientId: trade.id, // Using user_trades.id as the MetaAPI clientId
          };

          // Trailing Stops for RUNNER
          if (trade.trade_type === "RUNNER" && trade.user_risk_settings?.sync_trailing_stops) {
             const atrRaw = opp.stop_plan_json?.atr;
             if (atrRaw) {
               payload.trailingStopLoss = {
                 distance: { distance: Number((atrRaw * 2.0).toFixed(5)), units: "RELATIVE_PRICE" },
               };
             }
          }

          if (trade.user_risk_settings?.is_live_execution_enabled) {
            const nowMs = Date.now();
            // We need to fetch vps_last_heartbeat and active_broker. Let's assume we added them to the query!
            const vpsHeartbeatMs = trade.user_risk_settings?.vps_last_heartbeat ? new Date(trade.user_risk_settings.vps_last_heartbeat).getTime() : 0;
            const isVpsAlive = (nowMs - vpsHeartbeatMs) < 60000;
            const routeToVps = trade.user_risk_settings?.active_broker === 'MT5_VPS' && isVpsAlive;

            if (routeToVps) {
               await supabase.from("user_trades").update({ status: "VPS_PENDING" }).eq("id", trade.id);
               executedCount++;
            } else {
              try {
                const metaApiUrl = `${baseUrl}/users/current/accounts/${trade.user_risk_settings.meta_api_account_id}/trade`;
                const res = await fetch(metaApiUrl, {
                  method: "POST",
                  headers: { 
                    "auth-token": trade.user_risk_settings.meta_api_token, 
                    "Content-Type": "application/json" 
                  },
                  body: JSON.stringify(payload),
                });
                
                if (!res.ok) {
                  const errorText = await res.text();
                  await supabase.from("user_trades").update({ status: "FAILED", error_message: errorText }).eq("id", trade.id);
                } else {
                  const data = await res.json();
                  await supabase.from("user_trades").update({ status: "OPEN", meta_api_order_id: data.orderId || "EXECUTED" }).eq("id", trade.id);
                  executedCount++;
                }
              } catch (e: any) {
                await supabase.from("user_trades").update({ status: "FAILED", error_message: e.message }).eq("id", trade.id);
              }
            }
          } else {
             // Paper Trading execution
             await supabase.from("user_trades").update({ status: "PAPER_OPEN" }).eq("id", trade.id);
             executedCount++;
          }
        }
      }
    }

    return new Response(JSON.stringify({ status: "success", executed: executedCount }), { headers: { "Content-Type": "application/json" } });
  } catch (error: any) {
    console.error("Error monitoring pending orders:", error);
    return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
});
