import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2.108.2";

serve(async (req) => {
  try {
    if (req.headers.get("x-vps-secret") !== Deno.env.get("VPS_SECRET_KEY")) {
      return new Response("Unauthorized", { status: 401 });
    }
    const url = new URL(req.url);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    // 1. Update heartbeat for all users (since it's a single-bot central architecture)
    await supabase.from("user_risk_settings").update({ vps_last_heartbeat: new Date().toISOString() }).neq("user_id", "00000000-0000-0000-0000-000000000000");

    // 2. Fetch HFT bias
    const { data: riskSettings } = await supabase
      .from("user_risk_settings")
      .select("hft_bias")
      .eq("user_id", "912d249b-9be8-4691-a11b-5b00f386a804") // use central user
      .single();
    
    const symbol = url.searchParams.get("symbol");
    let currentBias = "NEUTRAL";
    if (riskSettings && typeof riskSettings.hft_bias === "object" && riskSettings.hft_bias !== null && symbol) {
      currentBias = (riskSettings.hft_bias as Record<string, string>)[symbol] || "NEUTRAL";
    }

    // 3. Fetch pending and open trades for the VPS
    const { data: activeTrades, error: fetchError } = await supabase
      .from("user_trades")
      .select(`
        id, symbol, side, volume, trade_type, status, meta_api_order_id,
        trade_opportunities (
          entry_plan_json,
          stop_plan_json,
          take_profit_json
        )
      `)
      .in("status", ["VPS_PENDING", "OPEN", "VPS_CLOSE"]);

    if (fetchError) throw fetchError;

    if (!activeTrades || activeTrades.length === 0) {
      return new Response("NO_TRADES\nBIAS:" + currentBias, { headers: { "Content-Type": "text/plain" } });
    }

    let csvResponse = "BIAS:" + currentBias + "\n";
    for (const trade of activeTrades) {
      const opp = trade.trade_opportunities;
      
      const entryPrice = opp?.entry_plan_json?.price || opp?.entry_plan_json?.entry_price || opp?.entry_plan_json?.limit_price || 0;
      const stopLossRaw = opp?.stop_plan_json?.stop || 0;
      const tpRaw = opp?.take_profit_json?.tp || 0;
      const tp1Raw = opp?.take_profit_json?.tp1;
      const tp2Raw = opp?.take_profit_json?.tp2;
      const tp3Raw = opp?.take_profit_json?.tp3;
      const riskDistance = (entryPrice > 0 && stopLossRaw > 0) ? Math.abs(entryPrice - stopLossRaw) : 0;
      
      let targetTP = tpRaw;
      const isLong = trade.side === "LONG" || trade.side === "BUY";
      if (trade.trade_type === "QUICK_EXIT") {
         targetTP = tp1Raw;
         if (!targetTP || (isLong ? targetTP <= entryPrice : targetTP >= entryPrice)) {
           targetTP = isLong ? Number((entryPrice + riskDistance * 1.0).toFixed(5)) : Number((entryPrice - riskDistance * 1.0).toFixed(5));
         }
      } else if (trade.trade_type === "SWING") {
         targetTP = tp2Raw || tpRaw;
         if (!targetTP || (isLong ? targetTP <= entryPrice : targetTP >= entryPrice)) {
           targetTP = isLong ? Number((entryPrice + riskDistance * 2.0).toFixed(5)) : Number((entryPrice - riskDistance * 2.0).toFixed(5));
         }
      } else if (trade.trade_type === "RUNNER") {
         targetTP = tp3Raw;
         const swingTp = tp2Raw || (isLong ? entryPrice + riskDistance * 2.0 : entryPrice - riskDistance * 2.0);
         if (!targetTP || (isLong ? targetTP <= swingTp : targetTP >= swingTp)) {
           targetTP = isLong ? Number((entryPrice + (riskDistance * 3.5)).toFixed(5)) : Number((entryPrice - (riskDistance * 3.5)).toFixed(5));
         }
      }
      
      // === STRICT DIRECTION VALIDATION FOR TARGET TP (Error 10016 Prevention) ===
      if (entryPrice > 0 && riskDistance > 0) {
        const tpInvalid = isLong ? (targetTP <= entryPrice) : (targetTP >= entryPrice);
        if (tpInvalid) {
          const mult = trade.trade_type === "RUNNER" ? 3.5 : (trade.trade_type === "SWING" ? 2.0 : 1.0);
          targetTP = isLong
            ? Number((entryPrice + (riskDistance * mult)).toFixed(5))
            : Number((entryPrice - (riskDistance * mult)).toFixed(5));
        }
      }
      
      // Symbol-specific precision helper
      const getDecimals = (sym: string) => {
        if (["US30", "NAS100", "SPX500", "GER30", "BTCUSD", "XAUUSD", "XAGUSD", "UKOIL"].includes(sym)) return 2;
        if (sym.endsWith("JPY")) return 3;
        return 5;
      };
      const decimals = getDecimals(trade.symbol);
      
      let safeEntry = entryPrice > 0 ? Number(entryPrice.toFixed(decimals)) : 0;
      let safeSl = stopLossRaw > 0 ? Number(stopLossRaw.toFixed(decimals)) : 0;
      let safeTp = targetTP > 0 ? Number(targetTP.toFixed(decimals)) : 0;
      let safeVolume = Number(trade.volume.toFixed(2));

      // Validate SL direction
      if (safeEntry > 0 && safeSl > 0) {
        const isLong = trade.side === "LONG" || trade.side === "BUY";
        if (isLong && safeSl >= safeEntry) {
          safeSl = Number((safeEntry - (riskDistance > 0 ? riskDistance : 0.001)).toFixed(decimals));
        } else if (!isLong && safeSl <= safeEntry) {
          safeSl = Number((safeEntry + (riskDistance > 0 ? riskDistance : 0.001)).toFixed(decimals));
        }
      }

      const orderType = opp?.entry_plan_json?.order_type || (trade.side === "LONG" ? "BUY MARKET" : "SELL MARKET");
      let action = "MODIFY";
      if (trade.status === "VPS_PENDING") action = "EXECUTE";
      else if (trade.status === "VPS_CLOSE") action = "CLOSE";
      const ticket = trade.meta_api_order_id || "0";

      // Format: ID,SYMBOL,SIDE,VOLUME,STOPLOSS,TAKEPROFIT,TRADE_TYPE,ENTRY_PRICE,ORDER_TYPE,ACTION,TICKET
      csvResponse += `${trade.id},${trade.symbol},${trade.side},${safeVolume},${safeSl},${safeTp},${trade.trade_type},${safeEntry},${orderType},${action},${ticket}\n`;
      
      // Lock the trade so it isn't picked up twice by multiple polls
      if (trade.status === "VPS_PENDING") {
        await supabase.from("user_trades").update({ status: "VPS_PROCESSING" }).eq("id", trade.id);
      }
    }

    return new Response(csvResponse.trim(), { headers: { "Content-Type": "text/plain" } });
  } catch (error: any) {
    console.error("Error polling VPS trades:", error);
    return new Response(`ERROR:${error.message}`, { status: 500 });
  }
});
