import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2.108.2";
import { insertAuditLog } from "../../../packages/core/audit.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const TG_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN") ?? "";
const TG_CHAT = Deno.env.get("TELEGRAM_CHAT_ID") ?? "";

interface WebhookPayload {
  type?: "INSERT" | "UPDATE";
  table?: string;
  record?: any;
  old_record?: any;
  action?: "GLOBAL_ABORT" | "WEEKEND_DEFENSE";
}

async function notifyTelegram(text: string) {
  if (!TG_TOKEN || !TG_CHAT) return;
  const url = `https://api.telegram.org/bot${TG_TOKEN}/sendMessage`;
  await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: TG_CHAT, text, parse_mode: "HTML" }),
  }).catch(() => {});
}

serve(async (req) => {
  try {
    const payload: WebhookPayload = await req.json();
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // --- 1. GLOBAL ABORT LOGIC ---
    if (payload.action === "GLOBAL_ABORT") {
      console.log("🚨 [Kill Switch] GLOBAL_ABORT Triggered!");
      
      // Globally pause auto trading
      await supabase.from("system_settings").update({ value: "false" }).eq("key", "auto_trading_enabled");
      await supabase.from("user_risk_settings").update({ auto_trade_enabled: false }).neq("user_id", "dummy");

      // Notify admin to manually assess open trades
      const tgMessage = `🚨 <b>BLACK SWAN / GLOBAL ABORT TRIGGERED</b> 🚨\n\nAuto-trading has been <b>PAUSED</b> globally across all PAMM accounts.\n\n⚠️ <i>Manual Assessment Required:</i> Auto-liquidation is currently bypassed in testing mode. Administrator must log in immediately and manually assess/close all active exposure!`;
      await notifyTelegram(tgMessage);

      await insertAuditLog(supabase, {
        actor_type: "SYSTEM",
        action: "KILL_SWITCH_TRIGGERED",
        entity_type: "system",
        entity_id: "global",
        payload_json: { reason: "External GLOBAL_ABORT payload received" }
      });

      return new Response("Global abort triggered. Auto-trading paused.", { status: 200 });
    }

    // --- 2. AUTO-EJECT LOGIC (Database Webhook) ---
    if (payload.type === "UPDATE" && payload.table === "trade_opportunities") {
      const signal = payload.record;
      const oldSignal = payload.old_record;
      
      // Only act when a signal transitions to REJECTED
      if (signal.status !== "REJECTED" || (oldSignal && oldSignal.status === "REJECTED")) {
        return new Response("Signal is not newly rejected. Ignoring.", { status: 200 });
      }

      // Fetch all open user trades associated with this rejected signal
      const { data: openTrades, error: tradesError } = await supabase
        .from("user_trades")
        .select("*")
        .eq("opportunity_id", signal.id)
        .in("status", ["PENDING", "ACTIVE", "OPEN", "PAPER_OPEN"]);

      if (tradesError || !openTrades || openTrades.length === 0) {
        return new Response("No active trades found for this signal. Nothing to eject.", { status: 200 });
      }

      console.log(`🚨 [Auto-Eject] AI downgraded signal ${signal.symbol}. ${openTrades.length} open trades found.`);

      // Notify admin to manually assess open trades
      const tgMessage = `⚠️ <b>AI INVALIDATION ALERT (${signal.symbol})</b> ⚠️\n\nThe AI has dynamically downgraded and REJECTED an active signal.\n\n<i>${signal.ai_risks || "AI invalidated the setup."}</i>\n\n<b>${openTrades.length} open PAMM trades are tied to this setup!</b>\n\n⚠️ <i>Manual Assessment Required:</i> Auto-liquidation is bypassed. Administrator must log in to assess/close these open positions.`;
      await notifyTelegram(tgMessage);

      await insertAuditLog(supabase, {
        actor_type: "SYSTEM",
        action: "AUTO_EJECT_ALERT",
        entity_type: "research",
        entity_id: signal.id,
        payload_json: { reason: "Signal rejected by AI Risk Officer. Manual intervention requested." }
      });

      return new Response("Auto-eject alert sent.", { status: 200 });
    }

    // --- 3. WEEKEND / END-OF-SESSION ROLL-OVER DEFENSE ---
    if (payload.action === "WEEKEND_DEFENSE") {
      console.log("🛡️ [Weekend Defense] Executing Roll-over sweep...");
      
      const META_TOKEN = Deno.env.get("META_API_TOKEN") || "";
      const META_ACCOUNT = Deno.env.get("META_API_ACCOUNT_ID") || "";
      const META_BASE_URL = Deno.env.get("META_API_BASE_URL") || "https://mt-client-api-v1.london.agiliumtrade.ai";
      const DRY_RUN = Deno.env.get("WEEKEND_DEFENSE_DRY_RUN") !== "false";

      const { data: openTrades, error } = await supabase
        .from("user_trades")
        .select("id, meta_api_order_id, symbol, side, status, user_id")
        .eq("status", "OPEN")
        .not("meta_api_order_id", "is", null);

      if (error || !openTrades || openTrades.length === 0) {
        return new Response("No open trades to defend.", { status: 200 });
      }

      const uniqueOrders = new Set(openTrades.map(t => t.meta_api_order_id));
      console.log(`[Weekend Defense] Found ${uniqueOrders.size} unique master orders to evaluate.`);

      let closedCount = 0;
      let modifiedCount = 0;

      for (const orderId of uniqueOrders) {
        try {
          const posUrl = `${META_BASE_URL}/users/current/accounts/${META_ACCOUNT}/positions/${orderId}`;
          const posRes = await fetch(posUrl, { headers: { "auth-token": META_TOKEN } });

          if (!posRes.ok) {
             console.log(`[Weekend Defense] Position ${orderId} not found on broker. Skipping.`);
             continue;
          }

          const position = await posRes.json();
          const profit = Number(position.profit) || 0;
          const currentPrice = Number(position.currentPrice);
          const openPrice = Number(position.openPrice);

          if (profit < 0) {
             console.log(`[Weekend Defense] Position ${orderId} is in drawdown ($${profit}). CLOSING AT MARKET.`);
             
             if (!DRY_RUN) {
               const closeUrl = `${META_BASE_URL}/users/current/accounts/${META_ACCOUNT}/trade`;
               const closePayload = { actionType: "POSITION_CLOSE_ID", positionId: orderId };
               await fetch(closeUrl, {
                  method: "POST",
                  headers: { "auth-token": META_TOKEN, "Content-Type": "application/json" },
                  body: JSON.stringify(closePayload)
               });
               await supabase.from("user_trades").update({ status: "AUTO_CLOSED" }).eq("meta_api_order_id", orderId);
             }
             closedCount++;
          } else {
             console.log(`[Weekend Defense] Position ${orderId} is in profit ($${profit}). Moving SL to Break-Even (${openPrice}).`);
             
             if (!DRY_RUN) {
               const modifyUrl = `${META_BASE_URL}/users/current/accounts/${META_ACCOUNT}/trade`;
               const modPayload = {
                  actionType: "POSITION_MODIFY",
                  positionId: orderId,
                  stopLoss: openPrice, 
                  takeProfit: position.takeProfit
               };
               await fetch(modifyUrl, {
                  method: "POST",
                  headers: { "auth-token": META_TOKEN, "Content-Type": "application/json" },
                  body: JSON.stringify(modPayload)
               });
             }
             modifiedCount++;
          }
        } catch (err: any) {
          console.error(`[Weekend Defense] Error processing order ${orderId}: ${err.message}`);
        }
      }

      const report = {
        status: DRY_RUN ? "DRY_RUN_COMPLETE" : "EXECUTION_COMPLETE",
        evaluated: uniqueOrders.size,
        closed_at_market: closedCount,
        sl_moved_to_be: modifiedCount
      };

      console.log(`[Weekend Defense] Sweep Complete.`, report);
      
      await insertAuditLog(supabase, {
        actor_type: "SYSTEM",
        action: "WEEKEND_DEFENSE_EXECUTED",
        entity_type: "system",
        entity_id: "global",
        payload_json: report
      });

      return new Response(JSON.stringify(report), { status: 200, headers: { "Content-Type": "application/json" } });
    }

    return new Response("Invalid payload", { status: 400 });

  } catch (error: any) {
    console.error("Kill Switch error:", error);
    return new Response(`Error: ${error.message}`, { status: 500 });
  }
});
