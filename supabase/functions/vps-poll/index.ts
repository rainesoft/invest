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
      
      let targetTP = tpRaw;
      if (trade.trade_type === "QUICK_EXIT" && stopLossRaw > 0 && entryPrice > 0) {
         const riskDistance = Math.abs(entryPrice - stopLossRaw);
         targetTP = trade.side === "LONG" 
           ? Number((entryPrice + riskDistance).toFixed(5))
           : Number((entryPrice - riskDistance).toFixed(5));
      }
      
      const orderType = opp?.entry_plan_json?.order_type || (trade.side === "LONG" ? "BUY MARKET" : "SELL MARKET");
      let action = "MODIFY";
      if (trade.status === "VPS_PENDING") action = "EXECUTE";
      else if (trade.status === "VPS_CLOSE") action = "CLOSE";
      const ticket = trade.meta_api_order_id || "0";

      // Format: ID,SYMBOL,SIDE,VOLUME,STOPLOSS,TAKEPROFIT,TRADE_TYPE,ENTRY_PRICE,ORDER_TYPE,ACTION,TICKET
      csvResponse += `${trade.id},${trade.symbol},${trade.side},${trade.volume},${stopLossRaw},${targetTP},${trade.trade_type},${entryPrice},${orderType},${action},${ticket}\n`;
      
      // Lock the trade so it isn't picked up twice by multiple polls
      if (trade.status === "VPS_PENDING") {
        await supabase.from("user_trades").update({ status: "VPS_PROCESSING" }).eq("id", trade.id);
      } else if (trade.status === "VPS_CLOSE") {
        await supabase.from("user_trades").update({ status: "CLOSED" }).eq("id", trade.id);
      }
    }

    return new Response(csvResponse.trim(), { headers: { "Content-Type": "text/plain" } });
  } catch (error: any) {
    console.error("Error polling VPS trades:", error);
    return new Response(`ERROR:${error.message}`, { status: 500 });
  }
});
