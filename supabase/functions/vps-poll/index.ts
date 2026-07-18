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

    // 2. Fetch all pending trades globally
    const { data: pendingTrades, error: fetchError } = await supabase
      .from("user_trades")
      .select(`
        id, symbol, side, volume, trade_type,
        trade_opportunities (
          entry_plan_json,
          stop_plan_json,
          take_profit_json
        )
      `)
      .eq("status", "VPS_PENDING");

    if (fetchError) throw fetchError;

    if (!pendingTrades || pendingTrades.length === 0) {
      return new Response("NO_TRADES", { headers: { "Content-Type": "text/plain" } });
    }

    let csvResponse = "";
    for (const trade of pendingTrades) {
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

      // Format: ID,SYMBOL,SIDE,VOLUME,STOPLOSS,TAKEPROFIT,TRADE_TYPE,ENTRY_PRICE,ORDER_TYPE
      csvResponse += `${trade.id},${trade.symbol},${trade.side},${trade.volume},${stopLossRaw},${targetTP},${trade.trade_type},${entryPrice},${orderType}\n`;
      
      // Lock the trade so it isn't picked up twice by multiple polls
      await supabase.from("user_trades").update({ status: "VPS_PROCESSING" }).eq("id", trade.id);
    }

    return new Response(csvResponse.trim(), { headers: { "Content-Type": "text/plain" } });
  } catch (error: any) {
    console.error("Error polling VPS trades:", error);
    return new Response(`ERROR:${error.message}`, { status: 500 });
  }
});
