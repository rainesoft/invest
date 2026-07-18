import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2.108.2";
import { insertAuditLog } from "../../../packages/core/audit.ts";
import { cancelMetaApiOrder } from "../../../packages/execution/index.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const META_API_BASE_URL = Deno.env.get("META_API_BASE_URL") || "https://mt-client-api-v1.new-york.agiliumtrade.ai";

interface WebhookPayload {
  type: "INSERT" | "UPDATE";
  table: string;
  record: any;
  old_record: any;
}

serve(async (req) => {
  try {
    const payload: WebhookPayload = await req.json();

    if (payload.type !== "UPDATE") {
      return new Response("Ignored non-update webhook", { status: 200 });
    }

    const signal = payload.record;
    const oldSignal = payload.old_record;
    
    // Only act when a signal transitions to REJECTED
    if (signal.status !== "REJECTED" || (oldSignal && oldSignal.status === "REJECTED")) {
      return new Response("Signal is not newly rejected. Ignoring.", { status: 200 });
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Fetch all open user trades associated with this rejected signal
    const { data: openTrades, error: tradesError } = await supabase
      .from("user_trades")
      .select("*")
      .eq("opportunity_id", signal.id)
      .in("status", ["PENDING", "ACTIVE", "OPEN", "PAPER_OPEN"]);

    if (tradesError || !openTrades || openTrades.length === 0) {
      return new Response("No active trades found for this signal. Nothing to eject.", { status: 200 });
    }

    console.log(`[Auto-Eject] Found ${openTrades.length} open trades to forcefully liquidate for signal ${signal.symbol}.`);

    const executions = [];

    for (const trade of openTrades) {
      try {
        // Handle Paper Trades locally
        if (trade.status === "PAPER_OPEN" || !trade.meta_api_order_id) {
          await supabase.from("user_trades").update({ status: "AUTO_CLOSED", error_message: "AUTO_EJECT_REJECTED" }).eq("id", trade.id);
          executions.push({ trade_id: trade.id, status: "AUTO_CLOSED", type: "PAPER" });
          
          await insertAuditLog(supabase, {
            actor_type: "SYSTEM",
            action: "AUTO_EJECTED",
            entity_type: "trade",
            entity_id: trade.id,
            payload_json: { reason: "Signal rejected by AI Risk Officer", type: "PAPER" }
          });
          continue;
        }

        // Handle Live Trades (MetaAPI)
        const { data: userRisk } = await supabase
          .from("user_risk_settings")
          .select("meta_api_token, meta_api_account_id")
          .eq("user_id", trade.user_id)
          .single();

        if (!userRisk || !userRisk.meta_api_token || !userRisk.meta_api_account_id) {
           console.log(`[Auto-Eject] Missing MetaAPI credentials for user ${trade.user_id}. Skipping live liquidation.`);
           continue;
        }

        const success = await cancelMetaApiOrder(supabase, trade.user_id, userRisk.meta_api_account_id, userRisk.meta_api_token, trade.meta_api_order_id, trade.status);

        // Finalize locally if successful
        if (success) {
           await supabase.from("user_trades").update({ status: "AUTO_CLOSED", error_message: "AUTO_EJECT_REJECTED" }).eq("id", trade.id);
           executions.push({ trade_id: trade.id, status: "AUTO_CLOSED", type: "LIVE" });
           
           await insertAuditLog(supabase, {
             actor_type: "SYSTEM",
             action: "AUTO_EJECTED",
             entity_type: "trade",
             entity_id: trade.id,
             payload_json: { reason: "Signal rejected by AI Risk Officer", type: "LIVE", meta_api_order_id: trade.meta_api_order_id }
           });
        } else {
           console.error(`[Auto-Eject] Failed to cancel trade ${trade.id}.`);
           await supabase.from("user_trades").update({ status: "AUTO_EJECT_FAILED", error_message: "Failed to cancel via MetaAPI" }).eq("id", trade.id);
           executions.push({ trade_id: trade.id, status: "FAILED", type: "LIVE" });
        }

      } catch (e: any) {
        console.error(`[Auto-Eject Error] Failed to process trade ${trade.id}: ${e.message}`);
      }
    }

    return new Response(JSON.stringify({ message: "Auto-Eject complete", executions }), { status: 200 });
  } catch (error: any) {
    return new Response(`Error: ${error.message}`, { status: 500 });
  }
});
