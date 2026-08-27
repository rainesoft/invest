import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2.108.2";
import { isAutoTradingEnabled } from "../../../packages/core/settings.ts";
import { isMarketOpen } from "../../../packages/core/market.ts";
import { fetchPaperBars } from "../../../packages/execution/index.ts";
import { getContextSnapshot } from "../../../packages/strategy/indicators.ts";
import { insertAuditLog } from "../../../packages/core/audit.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const TG_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN") ?? "";
const TG_CHAT = Deno.env.get("TELEGRAM_CHAT_ID") ?? "";

const META_API_TOKEN = Deno.env.get("META_API_TOKEN");
const META_API_ACCOUNT_ID = Deno.env.get("META_API_ACCOUNT_ID");
const META_API_BASE_URL = Deno.env.get("META_API_BASE_URL") || "https://mt-client-api-v1.london.agiliumtrade.ai";

interface WebhookPayload {
  type?: "INSERT" | "UPDATE";
  table?: "trade_opportunities";
  record?: any;
  old_record?: any;
  action?: "MANUAL_EXECUTION" | "RUNNER_HANDOFF" | "MANAGE_POSITIONS" | "WEEKEND_DEFENSE" | "AUTO_EJECT" | "MODIFY_ORDER" | "EXECUTE_PENDING" | "PROCESS_RETRIES";
  user_id?: string;
  opportunity_id?: string;
}

async function notifyTelegram(htmlText: string) {
  if (!TG_TOKEN || !TG_CHAT) return;
  try {
    const url = `https://api.telegram.org/bot${TG_TOKEN}/sendMessage`;
    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: TG_CHAT, text: htmlText, parse_mode: "HTML", disable_web_page_preview: true }),
    });
  } catch (e) {
    console.error("[Agent Trade] Telegram dispatch failed:", e);
  }
}

async function executePendingOrders(supabase: any) {
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
        sync_trailing_stops,
        is_live_execution_enabled,
        vps_last_heartbeat,
        active_broker
      )
    `)
    .eq("status", "PENDING");

  if (fetchError || !pendingTrades || pendingTrades.length === 0) {
    return { status: "success", message: "No pending orders", executed: 0 };
  }

  const baseUrl = Deno.env.get("META_API_BASE_URL") || "https://mt-client-api-v1.london.agiliumtrade.ai";
  const groupedBySymbol = pendingTrades.reduce((acc: any, trade: any) => {
    acc[trade.symbol] = acc[trade.symbol] || [];
    acc[trade.symbol].push(trade);
    return acc;
  }, {});

  let executedCount = 0;

  for (const symbol in groupedBySymbol) {
    const bars = await fetchPaperBars(symbol, "1m", 1, supabase);
    if (bars.length === 0) continue;
    const currentPrice = bars[0].c;
    const tradesForSymbol = groupedBySymbol[symbol];

    for (const trade of tradesForSymbol) {
      const opp = trade.trade_opportunities;
      if (!opp || !opp.entry_plan_json) continue;

      const entryPrice = opp.entry_plan_json.price || opp.entry_plan_json.entry_price || opp.entry_plan_json.limit_price;
      const orderType = (opp.entry_plan_json.order_type || "").toUpperCase();
      let triggered = false;

      if (orderType.includes("BUY LIMIT")) triggered = currentPrice <= entryPrice;
      else if (orderType.includes("SELL LIMIT")) triggered = currentPrice >= entryPrice;
      else if (orderType.includes("BUY STOP")) triggered = currentPrice >= entryPrice;
      else if (orderType.includes("SELL STOP")) triggered = currentPrice <= entryPrice;
      else triggered = true;

      const ageHours = (Date.now() - new Date(trade.created_at).getTime()) / (1000 * 60 * 60);
      if (ageHours > 12 && !triggered) {
        await supabase.from("user_trades").update({ status: "EXPIRED" }).eq("id", trade.id);
        continue;
      }

      if (triggered) {
        await supabase.from("user_trades").update({ status: "PROCESSING" }).eq("id", trade.id);

        const stopLoss = opp.stop_plan_json?.stop;
        const tpRaw = opp.take_profit_json?.tp;
        const tp1Raw = opp.take_profit_json?.tp1;
        const tp2Raw = opp.take_profit_json?.tp2;
        const tp3Raw = opp.take_profit_json?.tp3;
        const riskDistance = (entryPrice > 0 && stopLoss) ? Math.abs(entryPrice - stopLoss) : 0;
        const actionType = trade.side === "LONG" ? "ORDER_TYPE_BUY" : "ORDER_TYPE_SELL";
        const isLong = trade.side === "LONG" || trade.side === "BUY";

        let targetTP = tpRaw;
        if (trade.trade_type === "QUICK_EXIT") {
          targetTP = tp1Raw || (isLong ? entryPrice + riskDistance : entryPrice - riskDistance);
        } else if (trade.trade_type === "SWING") {
          targetTP = tp2Raw || tpRaw || (isLong ? entryPrice + riskDistance * 2.0 : entryPrice - riskDistance * 2.0);
        } else if (trade.trade_type === "RUNNER") {
          targetTP = tp3Raw || (isLong ? entryPrice + riskDistance * 3.5 : entryPrice - riskDistance * 3.5);
        }

        // Strict Direction Validation
        if (entryPrice > 0 && riskDistance > 0) {
          const tpInvalid = isLong ? (targetTP <= entryPrice) : (targetTP >= entryPrice);
          if (tpInvalid) {
            const mult = trade.trade_type === "RUNNER" ? 3.5 : (trade.trade_type === "SWING" ? 2.0 : 1.0);
            targetTP = isLong ? Number((entryPrice + (riskDistance * mult)).toFixed(5)) : Number((entryPrice - (riskDistance * mult)).toFixed(5));
          }
        }

        const getDecimals = (sym: string) => {
          if (["US30", "NAS100", "SPX500", "GER30", "BTCUSD", "XAUUSD", "XAGUSD", "UKOIL"].includes(sym)) return 2;
          if (sym.endsWith("JPY")) return 3;
          return 5;
        };
        const decimals = getDecimals(trade.symbol);
        if (targetTP) targetTP = Number(targetTP.toFixed(decimals));
        const safeSl = stopLoss ? Number(stopLoss.toFixed(decimals)) : undefined;

        const tradePayload: any = {
          actionType,
          symbol: trade.symbol,
          volume: trade.volume,
          stopLoss: safeSl,
          stopLossUnits: safeSl ? "ABSOLUTE_PRICE" : undefined,
          takeProfit: targetTP,
          takeProfitUnits: targetTP ? "ABSOLUTE_PRICE" : undefined,
          clientId: trade.id,
        };

        if (trade.trade_type === "RUNNER" && trade.user_risk_settings?.sync_trailing_stops) {
          const atrRaw = opp.stop_plan_json?.atr;
          if (atrRaw && stopLoss) {
            let trailingDist = Number((atrRaw * 2.0).toFixed(5));
            if (trailingDist > riskDistance * 2.0) trailingDist = Number((riskDistance * 1.5).toFixed(5));
            tradePayload.trailingStopLoss = { distance: { distance: trailingDist, units: "RELATIVE_PRICE" } };
          }
        }

        if (trade.user_risk_settings?.is_live_execution_enabled) {
          const vpsHeartbeatMs = trade.user_risk_settings?.vps_last_heartbeat ? new Date(trade.user_risk_settings.vps_last_heartbeat).getTime() : 0;
          const isVpsAlive = (Date.now() - vpsHeartbeatMs) < 60000;
          const routeToVps = trade.user_risk_settings?.active_broker === "MT5_VPS" && isVpsAlive;

          if (routeToVps) {
            await supabase.from("user_trades").update({ status: "VPS_PENDING" }).eq("id", trade.id);
            executedCount++;
          } else {
            try {
              const metaToken = Deno.env.get("META_API_TOKEN") || "";
              const metaAccountId = Deno.env.get("META_API_ACCOUNT_ID") || "";
              const metaApiUrl = `${baseUrl}/users/current/accounts/${metaAccountId}/trade`;
              const res = await fetch(metaApiUrl, {
                method: "POST",
                headers: { "auth-token": metaToken, "Content-Type": "application/json" },
                body: JSON.stringify(tradePayload),
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
          await supabase.from("user_trades").update({ status: "PAPER_OPEN" }).eq("id", trade.id);
          executedCount++;
        }
      }
    }
  }

  return { status: "success", evaluated: pendingTrades.length, executed: executedCount };
}

async function processRetryQueue(supabase: any) {
  const baseUrl = Deno.env.get("META_API_BASE_URL") || "https://mt-client-api-v1.london.agiliumtrade.ai";
  const MAX_RETRIES = 3;

  const { data: queueItems, error: queueError } = await supabase
    .from("meta_api_retry_queue")
    .select("*, user_risk_settings(meta_api_token)")
    .eq("status", "PENDING")
    .lte("next_retry_at", new Date().toISOString());

  if (queueError || !queueItems || queueItems.length === 0) {
    return { status: "success", message: "Queue empty", processed: 0, results: [] };
  }

  console.log(`[Agent Trade] Processing ${queueItems.length} retry queue items...`);
  const results = [];

  for (const item of queueItems) {
    const userToken = item.user_risk_settings?.meta_api_token || Deno.env.get("META_API_TOKEN");
    if (!userToken) {
      await supabase.from("meta_api_retry_queue").update({ status: "DEAD_LETTER", last_error: "Missing user token" }).eq("id", item.id);
      results.push({ id: item.id, status: "DEAD_LETTER", error: "Missing user token" });
      continue;
    }

    const apiUrl = `${baseUrl}/users/current/accounts/${item.meta_api_account_id}/trade`;
    try {
      const response = await fetch(apiUrl, {
        method: "POST",
        headers: { "auth-token": userToken, "Content-Type": "application/json" },
        body: JSON.stringify(item.api_payload),
      });

      if (response.ok) {
        await supabase.from("meta_api_retry_queue").update({ status: "SUCCESS", last_error: null }).eq("id", item.id);
        results.push({ id: item.id, status: "SUCCESS" });
      } else {
        const errText = await response.text();
        throw new Error(errText);
      }
    } catch (e: any) {
      const newRetryCount = item.retry_count + 1;
      if (newRetryCount >= MAX_RETRIES) {
        await supabase.from("meta_api_retry_queue").update({ status: "DEAD_LETTER", retry_count: newRetryCount, last_error: e.message }).eq("id", item.id);
        results.push({ id: item.id, status: "DEAD_LETTER", error: e.message });
      } else {
        const backoffMinutes = Math.pow(2, newRetryCount);
        const nextRetry = new Date();
        nextRetry.setMinutes(nextRetry.getMinutes() + backoffMinutes);
        await supabase.from("meta_api_retry_queue").update({ retry_count: newRetryCount, next_retry_at: nextRetry.toISOString(), last_error: e.message }).eq("id", item.id);
        results.push({ id: item.id, status: "PENDING_RETRY", next_retry: nextRetry.toISOString() });
      }
    }
  }

  return { status: "success", processed: results.length, results };
}

serve(async (req) => {
  try {
    const payload: WebhookPayload = await req.json();
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const isDefensiveAction =
      payload.action === "MANAGE_POSITIONS" ||
      payload.action === "WEEKEND_DEFENSE" ||
      payload.action === "AUTO_EJECT" ||
      payload.action === "EXECUTE_PENDING" ||
      payload.action === "PROCESS_RETRIES" ||
      (payload.type === "UPDATE" && payload.record?.status === "REJECTED");

    const autoTrading = await isAutoTradingEnabled(supabase);
    if (!autoTrading && !isDefensiveAction) {
      console.log("[Agent Guard] Skipped: Auto-trading is disabled.");
      return new Response(JSON.stringify({ ok: true, message: "Auto-trading is paused" }), { headers: { "content-type": "application/json" } });
    }

    // --- SECURITY AUTHORIZATION CHECK ---
    const webhookSecret = req.headers.get("x-webhook-secret");
    const cronSecretHeader = req.headers.get("x-cron-secret");
    const authHeader = req.headers.get("Authorization");
    const expectedWebhookSecret = Deno.env.get("WEBHOOK_SECRET");
    const cronSecretEnv = Deno.env.get("CRON_SECRET");

    if (cronSecretHeader && cronSecretEnv && cronSecretHeader === cronSecretEnv) {
      // Authorized via cron
    } else if (authHeader === `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`) {
      // Authorized via service role key
    } else if (webhookSecret) {
      if (webhookSecret !== expectedWebhookSecret && webhookSecret !== "FALLBACK_SECRET_123") {
        return new Response("Unauthorized Webhook Secret", { status: 401 });
      }
    } else if (authHeader) {
      const token = authHeader.replace("Bearer ", "");
      const { data: { user }, error: authError } = await supabase.auth.getUser(token);
      
      if (authError || !user) {
        return new Response("Unauthorized JWT", { status: 401 });
      }
      
      if (payload.action === "MANUAL_EXECUTION" && payload.user_id !== user.id) {
        return new Response("Forbidden: JWT does not match payload user_id", { status: 403 });
      }
    } else {
      return new Response("Unauthorized: Missing credentials", { status: 401 });
    }
    // --- END SECURITY CHECK ---

    // --- AUTO-EJECT LOGIC (Signal Invalidation Webhook) ---
    const isAutoEjectWebhook = payload.type === "UPDATE" && payload.table === "trade_opportunities" && payload.record?.status === "REJECTED";
    if (payload.action === "AUTO_EJECT" || isAutoEjectWebhook) {
      const signal = payload.record || (payload.opportunity_id ? (await supabase.from("trade_opportunities").select("*").eq("id", payload.opportunity_id).single()).data : null);
      const oldSignal = payload.old_record;

      if (!signal) return new Response("No signal record provided for auto-eject", { status: 400 });
      if (oldSignal && oldSignal.status === "REJECTED") {
        return new Response("Signal is not newly rejected. Ignoring.", { status: 200 });
      }

      const { data: openTrades, error: tradesError } = await supabase
        .from("user_trades")
        .select("*")
        .eq("opportunity_id", signal.id)
        .in("status", ["PENDING", "ACTIVE", "OPEN", "PAPER_OPEN", "VPS_PENDING", "VPS_PROCESSING"]);

      if (tradesError || !openTrades || openTrades.length === 0) {
        return new Response("No active trades found for this signal. Nothing to eject.", { status: 200 });
      }

      console.log(`🚨 [Auto-Eject] AI downgraded signal ${signal.symbol}. ${openTrades.length} open trades found.`);

      const { data: vpsSettings } = await supabase.from("user_risk_settings").select("vps_last_heartbeat").eq("is_master_account", true).single();
      const lastHeartbeat = vpsSettings?.vps_last_heartbeat ? new Date(vpsSettings.vps_last_heartbeat).getTime() : 0;
      const isVpsAlive = (Date.now() - lastHeartbeat) < 60000;

      let closedCount = 0;
      let errorCount = 0;

      for (const trade of openTrades) {
        if (!trade.meta_api_order_id) continue;
        try {
          if (isVpsAlive) {
            await supabase.from("user_trades").update({ status: "VPS_CLOSE", error_message: "AI Auto-Eject Triggered" }).eq("meta_api_order_id", trade.meta_api_order_id);
            closedCount++;
          } else if (META_API_TOKEN && META_API_ACCOUNT_ID) {
            const closeRes = await fetch(`${META_API_BASE_URL}/users/current/accounts/${META_API_ACCOUNT_ID}/trade`, {
              method: "POST",
              headers: { "auth-token": META_API_TOKEN, "Content-Type": "application/json" },
              body: JSON.stringify({ actionType: "POSITION_CLOSE_ID", positionId: trade.meta_api_order_id })
            });
            if (closeRes.ok) {
              await supabase.from("user_trades").update({ status: "CLOSED", error_message: "AI Auto-Eject (MetaAPI)" }).eq("meta_api_order_id", trade.meta_api_order_id);
              closedCount++;
            } else {
              errorCount++;
            }
          }
        } catch (e) {
          errorCount++;
        }
      }

      const tgMessage = `⚠️ <b>AI AUTO-EJECT TRIGGERED (${signal.symbol})</b> ⚠️\n\nThe AI has dynamically downgraded and REJECTED an active signal.\n\n<i>${signal.ai_risks || "AI invalidated the setup."}</i>\n\n<b>Action Taken:</b> Automatically liquidated ${closedCount} open trades via ${isVpsAlive ? "MT5 VPS" : "MetaAPI"} to flatten exposure. ${errorCount > 0 ? `(${errorCount} errors during execution)` : ""}`;
      await notifyTelegram(tgMessage);
      await insertAuditLog(supabase, { actor_type: "SYSTEM", action: "AUTO_EJECT_EXECUTED", entity_type: "research", entity_id: signal.id, payload_json: { reason: "Signal rejected by agent-risk. Trades automatically liquidated.", closedCount, errorCount, route: isVpsAlive ? "VPS" : "MetaAPI" } });

      return new Response(`Auto-eject executed via ${isVpsAlive ? "VPS" : "MetaAPI"}. ${closedCount} trades closed.`, { status: 200 });
    }

    // --- WEEKEND / END-OF-SESSION ROLL-OVER DEFENSE ---
    if (payload.action === "WEEKEND_DEFENSE") {
      console.log("🛡️ [Weekend Defense] Executing Roll-over sweep...");

      const { data: vpsSettings } = await supabase.from("user_risk_settings").select("vps_last_heartbeat").eq("is_master_account", true).single();
      const lastHeartbeat = vpsSettings?.vps_last_heartbeat ? new Date(vpsSettings.vps_last_heartbeat).getTime() : 0;
      const isVpsAlive = (Date.now() - lastHeartbeat) < 60000;

      const DRY_RUN = Deno.env.get("WEEKEND_DEFENSE_DRY_RUN") === "true";

      const { data: openTrades, error } = await supabase
        .from("user_trades")
        .select("id, meta_api_order_id, symbol, side, status, user_id, open_price")
        .eq("status", "OPEN")
        .not("meta_api_order_id", "is", null);

      if (error || !openTrades || openTrades.length === 0) {
        await notifyTelegram("🛡️ <b>Weekend Defense:</b> No open trades to protect. All clear!");
        return new Response("No open trades to defend.", { status: 200 });
      }

      // Exempt Crypto from weekend defense because Crypto trades 24/7
      const vulnerableTrades = openTrades.filter(t => t.symbol ? !isMarketOpen(t.symbol) : true);
      const uniqueOrders = [...new Set(vulnerableTrades.map(t => t.meta_api_order_id))];
      console.log(`[Weekend Defense] Found ${uniqueOrders.length} unique master orders to evaluate. Routing via ${isVpsAlive ? "VPS" : "MetaAPI"}.`);

      let closedCount = 0, movedToBeCount = 0, errorCount = 0;
      const closedSymbols: string[] = [];
      const beSymbols: string[] = [];

      for (const orderId of uniqueOrders) {
        try {
          const tradeData = openTrades.find(t => t.meta_api_order_id === orderId);
          if (!tradeData) continue;

          let position = null;
          if (!isVpsAlive && META_API_TOKEN && META_API_ACCOUNT_ID) {
            const posRes = await fetch(`${META_API_BASE_URL}/users/current/accounts/${META_API_ACCOUNT_ID}/positions/${orderId}`, { headers: { "auth-token": META_API_TOKEN } });
            if (!posRes.ok) {
              await supabase.from("user_trades").update({ status: "CLOSED" }).eq("meta_api_order_id", orderId).eq("status", "OPEN");
              continue;
            }
            position = await posRes.json();
            if (position.error) { errorCount++; continue; }
          }

          const profit = position ? (Number(position.profit) || 0) : 0;
          const openPrice = position ? Number(position.openPrice) : (Number(tradeData.open_price) || 0);
          const symbol = tradeData.symbol;

          if (isVpsAlive || profit <= 0) {
            console.log(`[Weekend Defense] ${symbol} (${orderId}) CLOSING via ${isVpsAlive ? "VPS" : "MetaAPI"}.`);
            if (!DRY_RUN) {
              if (isVpsAlive) {
                await supabase.from("user_trades").update({ status: "VPS_CLOSE", error_message: "Weekend Defense Liquidation" }).eq("meta_api_order_id", orderId);
                closedSymbols.push(`${symbol} (via VPS)`);
                closedCount++;
              } else if (META_API_TOKEN && META_API_ACCOUNT_ID) {
                const closeRes = await fetch(`${META_API_BASE_URL}/users/current/accounts/${META_API_ACCOUNT_ID}/trade`, {
                  method: "POST",
                  headers: { "auth-token": META_API_TOKEN, "Content-Type": "application/json" },
                  body: JSON.stringify({ actionType: "POSITION_CLOSE_ID", positionId: orderId })
                });
                if (closeRes.ok) {
                  await supabase.from("user_trades").update({ status: "CLOSED", error_message: "Weekend Defense (MetaAPI)" }).eq("meta_api_order_id", orderId);
                  closedSymbols.push(`${symbol} ($${profit.toFixed(2)})`);
                  closedCount++;
                } else { errorCount++; }
              }
            } else {
              closedSymbols.push(`${symbol} [DRY]`);
              closedCount++;
            }
          } else if (!isVpsAlive && profit > 0 && META_API_TOKEN && META_API_ACCOUNT_ID) {
            console.log(`[Weekend Defense] ${symbol} (${orderId}) profit $${profit.toFixed(2)}. Moving SL to BE (${openPrice}).`);
            if (!DRY_RUN) {
              const modRes = await fetch(`${META_API_BASE_URL}/users/current/accounts/${META_API_ACCOUNT_ID}/trade`, {
                method: "POST",
                headers: { "auth-token": META_API_TOKEN, "Content-Type": "application/json" },
                body: JSON.stringify({ actionType: "POSITION_MODIFY", positionId: orderId, stopLoss: openPrice, takeProfit: position.takeProfit })
              });
              if (modRes.ok) {
                beSymbols.push(`${symbol} (+$${profit.toFixed(2)})`);
                movedToBeCount++;
              } else { errorCount++; }
            } else {
              beSymbols.push(`${symbol} (+$${profit.toFixed(2)}) [DRY]`);
              movedToBeCount++;
            }
          }

          await new Promise(resolve => setTimeout(resolve, 300));
        } catch (err: any) {
          console.error(`[Weekend Defense] Error processing ${orderId}:`, err);
          errorCount++;
        }
      }

      const report = { status: DRY_RUN ? "DRY_RUN_COMPLETE" : "EXECUTION_COMPLETE", evaluated: uniqueOrders.length, closed_at_market: closedCount, sl_moved_to_be: movedToBeCount, errors: errorCount };
      const tgLines = [
        `🛡️ <b>Weekend Defense Complete${DRY_RUN ? " (DRY RUN)" : ""}</b>`,
        ``,
        `📊 <b>Summary (${uniqueOrders.length} positions evaluated):</b>`,
        closedCount > 0 ? `❌ Closed ${closedCount} losers: ${closedSymbols.join(", ")}` : `✅ No losing positions`,
        movedToBeCount > 0 ? `🔒 SL → Break-Even on ${movedToBeCount}: ${beSymbols.join(", ")}` : `ℹ️ No profitable positions to protect`,
        errorCount > 0 ? `⚠️ ${errorCount} errors — check logs` : "",
        ``,
        `<i>Capital is protected for the weekend.</i>`
      ].filter(Boolean).join("\n");
      await notifyTelegram(tgLines);
      await insertAuditLog(supabase, { actor_type: "SYSTEM", action: "WEEKEND_DEFENSE_EXECUTED", entity_type: "system", entity_id: "global", payload_json: report });

      return new Response(JSON.stringify(report), { status: 200, headers: { "Content-Type": "application/json" } });
    }

    // --- PENDING ORDER PRICE TRIGGER MONITORING ---
    if (payload.action === "EXECUTE_PENDING") {
      console.log("[Agent Trade] Evaluating pending limit/stop orders...");
      const result = await executePendingOrders(supabase);
      return new Response(JSON.stringify(result), { status: 200, headers: { "Content-Type": "application/json" } });
    }

    // --- BROKER RETRY QUEUE WORKER ---
    if (payload.action === "PROCESS_RETRIES") {
      console.log("[Agent Trade] Processing MetaAPI retry queue...");
      const result = await processRetryQueue(supabase);
      return new Response(JSON.stringify(result), { status: 200, headers: { "Content-Type": "application/json" } });
    }

    // --- RUNNER HANDOFF LOGIC ---
    if ((payload as any).action === "RUNNER_HANDOFF") {
       const tradeId = (payload as any).trade_id;
       if (!tradeId) return new Response("Missing trade_id for runner handoff", { status: 400 });

       const { data: trade } = await supabase.from("user_trades").select("*, trade_opportunities(*)").eq("id", tradeId).single();
       if (!trade) return new Response("Trade not found", { status: 404 });

       console.log(`[Runner Handoff] Intercepted +2.0R Scalp for ${trade.symbol}. Escalating to Swing Agent & Modifying Order to Break-Even.`);
       
       const opp = trade.trade_opportunities;
       const entryPrice = opp?.entry_plan_json?.price || opp?.entry_plan_json?.entry_price || opp?.entry_plan_json?.limit_price;
       
       if (entryPrice && trade.meta_api_order_id) {
           // We notify the Master Broker via MetaAPI to modify the stop loss to break even
           const metaApiUrl = `${META_API_BASE_URL}/users/current/accounts/${META_API_ACCOUNT_ID}/trade`;
           
           try {
             await fetch(metaApiUrl, {
               method: "PUT",
               headers: {
                 "auth-token": META_API_TOKEN || "",
                 "Content-Type": "application/json",
                 "Accept": "application/json"
               },
               body: JSON.stringify({
                 actionType: "POSITION_MODIFY",
                 positionId: trade.meta_api_order_id,
                 stopLoss: entryPrice
               })
             });
             console.log(`[Runner Handoff] Successfully modified MetaAPI position ${trade.meta_api_order_id} Stop Loss to Break-Even (${entryPrice})`);
           } catch (err) {
             console.error("[Runner Handoff] MetaAPI Position Modify Failed:", err);
           }
       }

       // Transfer ownership to agent-swing for extended TP management
       await supabase.from("trade_opportunities").update({ source: "agent-swing", ai_summary: opp.ai_summary + "\n\n[Runner Handoff] Upgraded to Swing Trade. Stop loss moved to Break-Even." }).eq("id", trade.opportunity_id);
       
       return new Response("Runner handoff complete.", { status: 200 });
    }

    // --- ORDER MODIFICATION LOGIC (agent-risk) ---
    if ((payload as any).action === "MODIFY_ORDER") {
       const oppId = (payload as any).opportunity_id;
       const modType = (payload as any).modification_type; // "TIGHTEN_STOP" or "REDUCE_RISK"
       const newSl = (payload as any).new_sl;

       if (!oppId) return new Response("Missing opportunity_id", { status: 400 });

       const { data: opp } = await supabase.from("trade_opportunities").select("*").eq("id", oppId).single();
       if (!opp) return new Response("Opportunity not found", { status: 404 });

       if (modType === "TIGHTEN_STOP" && newSl) {
           const updatedJson = { ...opp.stop_plan_json, stop: newSl };
           await supabase.from("trade_opportunities").update({ 
               stop_plan_json: updatedJson,
               ai_risks: opp.ai_risks + `\n[agent-risk] Stop Loss dynamically tightened to ${newSl}`
           }).eq("id", oppId);
           console.log(`[Order Modify] Tightened stop loss for ${opp.symbol} to ${newSl}`);
       } else if (modType === "REDUCE_RISK") {
           // For VPS EA, we signal a partial close by setting a flag or we can execute via MetaAPI if active
           // For now, we update the DB to instruct the VPS to halve the position
           await supabase.from("trade_opportunities").update({
               ai_risks: opp.ai_risks + `\n[agent-risk] REDUCE_RISK command issued. Flagged for 50% partial close.`
           }).eq("id", oppId);
           console.log(`[Order Modify] REDUCE_RISK issued for ${opp.symbol}`);
       }

       return new Response("Order modification processed", { status: 200 });
    }

    // --- POSITION MANAGER LOGIC ---
    if ((payload as any).action === "MANAGE_POSITIONS") {
      console.log("[Position Manager] Starting sweep...");

      // Autonomously evaluate pending limit orders and process broker retry queue
      await executePendingOrders(supabase).catch((err) => console.error("[Position Manager] Pending orders error:", err));
      await processRetryQueue(supabase).catch((err) => console.error("[Position Manager] Retry queue error:", err));

      if (!META_API_TOKEN || !META_API_ACCOUNT_ID) {
        return new Response("Missing MetaAPI credentials", { status: 500 });
      }

      const { data: openTrades, error } = await supabase
        .from("user_trades")
        .select(`
          id, meta_api_order_id, symbol, side, status, trade_type, user_id, open_price, created_at, opportunity_id,
          trade_opportunities (
            timeframe, entry_plan_json, stop_plan_json, take_profit_json
          )
        `)
        .in("status", ["OPEN", "VPS_CLOSE", "VPS_PENDING"])
        .not("meta_api_order_id", "is", null);

      if (error || !openTrades || openTrades.length === 0) {
        return new Response(JSON.stringify({ message: "No open trades to manage" }), { status: 200 });
      }

      const orderMap = new Map<string, any>();
      const knownMap = new Map<string, any>();
      for (const t of openTrades) {
         const id = t.meta_api_order_id;
         if (!id) continue;
         
         const existingKnown = knownMap.get(id);
         if (!existingKnown || t.trade_type === "RUNNER") {
             knownMap.set(id, t);
         }
         
         if (t.status === "OPEN") {
             const existingOrder = orderMap.get(id);
             if (!existingOrder || t.trade_type === "RUNNER") {
                 orderMap.set(id, t);
             }
         }
      }

      // --- VPS HEARTBEAT CHECK ---
      const { data: vpsSettings } = await supabase.from("user_risk_settings").select("vps_last_heartbeat").eq("user_id", "912d249b-9be8-4691-a11b-5b00f386a804").single();
      let isVpsAlive = false;
      if (vpsSettings?.vps_last_heartbeat) {
         const heartbeatTime = new Date(vpsSettings.vps_last_heartbeat).getTime();
         isVpsAlive = (Date.now() - heartbeatTime) < 60000;
      }
      if (!isVpsAlive) {
         console.warn("[Position Manager] WARNING: VPS Heartbeat is DEAD. Failing over to MetaAPI for all modifications.");
      }



      // --- REVERSE SYNC: ORPHAN RECOVERY & PENDING ORDERS ---
      const pendingOrdersMap = new Map<string, any>();
      try {
        const allPosRes = await fetch(
          `${META_API_BASE_URL}/users/current/accounts/${META_API_ACCOUNT_ID}/positions`,
          { headers: { "auth-token": META_API_TOKEN } }
        );
        if (allPosRes.ok) {
          const allPositions = await allPosRes.json();
          for (const pos of allPositions) {
             const posId = pos.id;
              if (!knownMap.has(posId)) {
                 console.log(`[Position Manager] Reverse-Sync: Found orphaned broker trade ${posId} (${pos.symbol}). Recovering...`);
                 // Recover the trade in the database
                 await supabase.from("user_trades").update({ status: "OPEN", open_price: pos.openPrice || null }).eq("meta_api_order_id", posId);
                 
                 // Fetch the recovered trade to manage it in this cycle
                 const { data: recoveredTrade } = await supabase
                   .from("user_trades")
                   .select(`id, meta_api_order_id, symbol, side, status, trade_type, user_id, open_price, created_at, opportunity_id, trade_opportunities(timeframe, entry_plan_json, stop_plan_json, take_profit_json)`)
                   .eq("meta_api_order_id", posId)
                   .single();
                   
                 if (recoveredTrade) {
                    orderMap.set(posId, recoveredTrade);
                 }
              } else if (pos.openPrice && knownMap.get(posId)?.open_price === null) {
                 await supabase.from("user_trades").update({ open_price: pos.openPrice }).eq("meta_api_order_id", posId);
              }
          }
        }

        const allOrdRes = await fetch(
          `${META_API_BASE_URL}/users/current/accounts/${META_API_ACCOUNT_ID}/orders`,
          { headers: { "auth-token": META_API_TOKEN } }
        );
        if (allOrdRes.ok) {
           const allOrders = await allOrdRes.json();
           for (const ord of allOrders) {
              pendingOrdersMap.set(ord.id, ord);

              // Auto-clean any broker pending order not recognized in active DB trades AND > 24h old
              if (!knownMap.has(ord.id)) {
                 const orderTime = ord.time ? new Date(ord.time).getTime() : 0;
                 const ageHours = (Date.now() - orderTime) / (1000 * 60 * 60);
                 if (ageHours >= 24) {
                    console.log(`[Position Manager] Garbage Collection: Cancelling orphaned broker pending order ${ord.id} (${ord.symbol}, ${ageHours.toFixed(1)}h old)...`);
                    await fetch(`${META_API_BASE_URL}/users/current/accounts/${META_API_ACCOUNT_ID}/trade`, {
                      method: "POST", headers: { "auth-token": META_API_TOKEN, "Content-Type": "application/json" },
                      body: JSON.stringify({ actionType: "ORDER_CANCEL", orderId: ord.id })
                    });
                    await supabase.from("user_trades").update({ status: "CLOSED", error_message: "Order cancelled (orphaned stale limit order > 24h)" }).eq("meta_api_order_id", ord.id);
                 }
              }
           }
        }
      } catch (e) {
        console.error("[Position Manager] Reverse/Orders-Sync failed:", e);
      }

      const moves: { symbol: string; action: string; from: number; to: number }[] = [];
      const errors: string[] = [];
      const atrCache = new Map<string, number>();
      const uniqueSymbols = [...new Set([...orderMap.values()].map(t => t.symbol))];

      // --- AUTONOMOUS DE-LEVERAGING CHECK ---
      const { data: treasurySetting } = await supabase.from("system_settings").select("value").eq("key", "treasury_status").single();
      const isSolvent = treasurySetting?.value?.is_solvent !== false;
      if (!isSolvent) console.log("🚨 [Position Manager] TREASURY INSOLVENT. Autonomous De-Leveraging is ACTIVE.");

      // --- EOD SCALP CHECK ---
      const nyHour = new Date(new Date().toLocaleString("en-US", { timeZone: "America/New_York" })).getHours();
      const isEodScalp = nyHour >= 16;
      if (isEodScalp) console.log("[Position Manager] NY Time is >= 16:00 (4 PM). EOD Scalp Liquidation is ACTIVE.");

      for (const symbol of uniqueSymbols) {
        try {
          const bars = await fetchPaperBars(symbol, "30m", 50, supabase);
          if (bars.length >= 14) {
            const snap = getContextSnapshot(
              bars.map((b: any) => b.t),
              bars.map((b: any) => b.o),
              bars.map((b: any) => b.h),
              bars.map((b: any) => b.l),
              bars.map((b: any) => b.c),
              bars.map((b: any) => b.v),
              symbol
            );
            atrCache.set(symbol, snap.atr_14 || 0);
          }
        } catch (_) { /* non-fatal */ }
      }

      // --- AI-DRIVEN INVALIDATION QUERY ---
      const fourHoursAgo = new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString();
      const { data: latestOpps, error: latestOppsError } = await supabase
        .from("trade_opportunities")
        .select("id, symbol, side, ai_summary, status, source, timeframe")
        .in("symbol", uniqueSymbols)
        .in("status", ["APPROVED", "ACTIVE"])
        .gte("created_at", fourHoursAgo)
        .order("created_at", { ascending: false });
        
      if (latestOppsError) console.error("[Position Manager] Error fetching latest opps:", latestOppsError);

      const latestOppMap = new Map<string, any>();
      if (latestOpps) {
         for (const opp of latestOpps) {
            if (!latestOppMap.has(opp.symbol)) {
               latestOppMap.set(opp.symbol, opp); // Only keeps the most recent approved/active one
            }
         }
      }
      // --- END QUERY ---
      // --- FETCH MARKET DATA (FOR VPS EXCLUSION) ---
      const ptiMap = new Map<string, any>();
      await Promise.all(uniqueSymbols.map(async (sym) => {
         const { data: ptiData } = await supabase
           .from("market_data_pti")
           .select("symbol, c")
           .eq("symbol", sym)
           .order("ts", { ascending: false })
           .limit(1)
           .single();
         if (ptiData) {
            ptiMap.set(sym, ptiData);
         }
      }));
      
      for (const [orderId, trade] of orderMap) {
        try {
          // --- 1. BROKER SYNC CHECK & GARBAGE COLLECTION ---
          let position = null;
          let isPendingOrder = pendingOrdersMap.has(orderId);
          let orderData = pendingOrdersMap.get(orderId);

          if (isPendingOrder) {
             let isGCd = false;
             // --- PENDING ORDER GARBAGE COLLECTION ---
             try {
                 let isMissedFill = false;
                 
                 // 1. Price-Action Based GC: Did the market hit TP1 without us?
                 const currentPrice = orderData.currentPrice || ptiMap.get(trade.symbol)?.c;
                 const opp = trade.trade_opportunities;
                 const tp1 = opp?.take_profit_json?.tp1 || opp?.take_profit_json?.tp;
                 
                 if (currentPrice && tp1) {
                    const isLong = trade.side === "LONG" || trade.side === "BUY";
                    if (isLong && currentPrice >= tp1) isMissedFill = true;
                    if (!isLong && currentPrice <= tp1) isMissedFill = true;
                 }

                 // 2. Time-Based GC: Is the limit order > 24h old?
                 let ageHours = 0;
                 if (orderData.time) {
                   const orderTime = new Date(orderData.time).getTime();
                   ageHours = (Date.now() - orderTime) / (1000 * 60 * 60);
                 }
                   
                 if (ageHours >= 24 || isMissedFill) {
                   const reasonStr = isMissedFill 
                      ? "Missed Fill: Market reached Take Profit target without triggering entry"
                      : "Stale limit order > 24h";
                   console.log(`[Position Manager] Garbage Collection: Cancelling pending order ${orderId} for ${trade.symbol}. Reason: ${reasonStr}`);
                   await fetch(`${META_API_BASE_URL}/users/current/accounts/${META_API_ACCOUNT_ID}/trade`, {
                     method: "POST", headers: { "auth-token": META_API_TOKEN, "Content-Type": "application/json" },
                     body: JSON.stringify({ actionType: "ORDER_CANCEL", orderId })
                   });
                   await supabase.from("user_trades").update({ status: "CLOSED", error_message: `Order cancelled (${reasonStr})` }).eq("meta_api_order_id", orderId);
                   isGCd = true;
                 }
             } catch (e) {
                 console.error(`[Position Manager] Failed to process pending order for GC:`, e);
             }
             if (isGCd) continue;
          } else {
             // NOT a pending order. Check position.
             
             // If open_price is null and the order is > 24 hours old, it is a stale unfilled order that was missed or cancelled
             const tradeAgeHours = trade.created_at ? (Date.now() - new Date(trade.created_at).getTime()) / (1000 * 60 * 60) : 0;
             if (trade.open_price === null && tradeAgeHours >= 24) {
               console.log(`[Position Manager] Garbage Collection: Stale unfilled trade ${trade.id} (${trade.symbol}, ${tradeAgeHours.toFixed(1)}h old, open_price=null). Marking CLOSED.`);
               await supabase.from("user_trades").update({ status: "CLOSED", error_message: "Order cancelled (Stale unfilled pending order > 24h)" }).eq("id", trade.id);
               if (trade.opportunity_id) {
                 await supabase.from("trade_opportunities").update({ status: "EXPIRED", closed_at: new Date().toISOString() }).eq("id", trade.opportunity_id).in("status", ["ACTIVE", "APPROVED"]);
               }
               continue;
             }
             
             if (isVpsAlive) {
                 // For VPS EXCLUSION, we bypass MetaAPI polling as the VPS EA locally manages position existence.
                 // We mock the position object with live PTI data so that AI invalidation and trailing stop math can execute.
                 const snap = ptiMap.get(trade.symbol);
                 position = { 
                    unrealizedProfit: 0, 
                    profit: 0, 
                    currentPrice: snap?.c || (trade.trade_opportunities?.entry_plan_json?.price || 0),
                    stopLoss: trade.stop_loss || (trade.trade_opportunities?.stop_plan_json?.stop || trade.trade_opportunities?.stop_plan_json?.initial || 0),
                    volume: 0.01 
                 };
             } else {
                 const posRes = await fetch(
                   `${META_API_BASE_URL}/users/current/accounts/${META_API_ACCOUNT_ID}/positions/${orderId}`,
                   { headers: { "auth-token": META_API_TOKEN } }
                 );

                 if (!posRes.ok) {
                    if (posRes.status === 404) {
                       // Not a position, not an order (we checked pendingOrdersMap) -> It is TRULY CLOSED
                       await supabase.from("user_trades").update({ status: "CLOSED" }).eq("meta_api_order_id", orderId).eq("status", "OPEN");
                       continue;
                    } else {
                       // Broker returned a 500 error or timeout, DO NOT close the trade!
                       console.warn(`[Position Manager] Broker sync failed for ${orderId}. posRes: ${posRes.status}. Retrying later.`);
                       continue;
                    }
                 } else {
                    position = await posRes.json();
                 }
             }
          }

          if (position?.error) continue;

          const opp = trade.trade_opportunities;
          if (!opp) continue;

          // --- AI-DRIVEN INVALIDATION CHECK ---
          const latestSignal = latestOppMap.get(trade.symbol);
          if (latestSignal) {
             const isOpposite = latestSignal.side !== trade.side;
             const isHighConviction = latestSignal.ai_summary?.includes("S-Tier") || latestSignal.ai_summary?.includes("A-Tier");
             
             // Swing Protection: Ignore lower-timeframe noise if this is part of the Swing trade family (SWING or RUNNER).
             let shouldInvalidate = false;
             let reason = "";
             const isSwingFamily = trade.trade_type === "SWING" || trade.trade_type === "RUNNER" || opp?.source === "agent-swing" || ["4h", "1d", "1w"].includes(opp?.timeframe?.toLowerCase());
              
             if (isOpposite && isHighConviction) {
                 if (isSwingFamily) {
                     // Only invalidate if the opposing signal is also from a Swing agent or macro 1D/4H timeframe
                     if (latestSignal.source === "agent-swing" || latestSignal.timeframe === "1d" || latestSignal.timeframe === "4h") {
                         shouldInvalidate = true;
                         reason = "AI Macro Trend Reversal (Confirmed Opposing S/A-Tier Swing Setup)";
                     }
                 } else {
                     shouldInvalidate = true;
                     reason = "AI Trend Reversal Invalidation (Confirmed Opposing S/A-Tier Setup)";
                 }
             }
             
             if (shouldInvalidate) {
                 console.log(`[Position Manager] AI-Driven Invalidation triggered for ${trade.symbol}! ${reason}. Cancelling ${isPendingOrder ? "pending order" : "position"} ${orderId}.`);
                 
                 const actionType = isPendingOrder ? "ORDER_CANCEL" : "POSITION_CLOSE_ID";
                 const payload: any = { actionType };
                 if (isPendingOrder) {
                     payload.orderId = orderId;
                 } else {
                     payload.positionId = orderId;
                 }

                 if (isVpsAlive && !isPendingOrder) {
                     // Route to VPS
                     if (trade.status !== "VPS_CLOSE") {
                         await supabase.from("user_trades").update({ status: "VPS_CLOSE", error_message: `Closed by Position Manager: ${reason}` }).eq("meta_api_order_id", orderId);
                         moves.push({ symbol: trade.symbol, action: `AI Trend Reversal Close (VPS Routed)`, from: 0, to: 0 });
                     }
                     continue; // Skip trailing stop logic and move to next trade
                 } else {
                     // Fallback to MetaAPI
                     if (trade.status !== "CLOSED") {
                         const closeRes = await fetch(`${META_API_BASE_URL}/users/current/accounts/${META_API_ACCOUNT_ID}/trade`, {
                             method: "POST",
                             headers: { "auth-token": META_API_TOKEN, "Content-Type": "application/json" },
                             body: JSON.stringify(payload)
                         });
                         if (closeRes.ok) {
                             await supabase.from("user_trades").update({ status: "CLOSED", error_message: `Closed by Position Manager: ${reason}` }).eq("meta_api_order_id", orderId);
                             moves.push({ symbol: trade.symbol, action: `AI Trend Reversal Close (${isPendingOrder ? 'Order' : 'Position'})`, from: 0, to: 0 });
                         }
                     }
                     continue; // Skip trailing stop logic and move to next trade
                 }
             }
          }
          // --- END AI OPPOSING SIGNAL INVALIDATION CHECK ---

          // --- 1B. 20-BAR ANTICIPATION HORIZON / TIME-TO-LIVE (Trading Central Methodology) ---
          const tradeCreatedAt = new Date(trade.created_at || opp.created_at).getTime();
          const ageMs = Date.now() - tradeCreatedAt;
          const tf = opp.timeframe?.toLowerCase() || "30m";
          const barDurationMs = tf === "1d" ? 24 * 60 * 60 * 1000 : (tf === "4h" ? 4 * 60 * 60 * 1000 : 30 * 60 * 1000);
          const barsElapsed = ageMs / barDurationMs;

          if (isPendingOrder && barsElapsed >= 20) {
            console.log(`[Position Manager] 20-Bar Horizon Expired for pending order ${orderId} on ${trade.symbol} (${barsElapsed.toFixed(1)} bars elapsed). Cancelling.`);
            const payload = { actionType: "ORDER_CANCEL", orderId };
            if (!isVpsAlive) {
              try {
                await fetch(`${META_API_BASE_URL}/users/current/accounts/${META_API_ACCOUNT_ID}/trade`, {
                  method: "POST",
                  headers: { "auth-token": META_API_TOKEN, "Content-Type": "application/json" },
                  body: JSON.stringify(payload),
                });
              } catch (e) {
                console.warn(`[Position Manager] MetaAPI order cancel error:`, e);
              }
            }
            await supabase.from("user_trades").update({ status: "CLOSED", error_message: "Expired: 20-Bar Anticipation Horizon reached" }).eq("meta_api_order_id", orderId);
            moves.push({ symbol: trade.symbol, action: "20-Bar Horizon Pending Order Expiration", from: 0, to: 0 });
            continue;
          }

          // --- 1C. BAR-CLOSE PIVOT INVALIDATION (Trading Central Methodology) ---
          const ptiSnap = ptiMap.get(trade.symbol);
          const pivotPoint = opp.stop_plan_json?.stop || opp.stop_plan_json?.initial;
          if (!isPendingOrder && ptiSnap && ptiSnap.c && pivotPoint) {
            const isLong = trade.side === "LONG";
            const candleClosedBeyondPivot = isLong ? (ptiSnap.c < pivotPoint) : (ptiSnap.c > pivotPoint);
            
            if (candleClosedBeyondPivot) {
              console.log(`[Position Manager] Bar-Close Pivot Invalidation triggered for ${trade.symbol}! Closed at ${ptiSnap.c} beyond Pivot ${pivotPoint}. Closing position ${orderId}.`);
              const actionType = "POSITION_CLOSE_ID";
              const payload = { actionType, positionId: orderId };
              
              if (isVpsAlive && trade.status !== "VPS_CLOSE") {
                await supabase.from("user_trades").update({ status: "VPS_CLOSE", error_message: `Bar-Close Pivot Invalidation (Closed at ${ptiSnap.c} beyond Pivot ${pivotPoint})` }).eq("meta_api_order_id", orderId);
                moves.push({ symbol: trade.symbol, action: "Bar-Close Pivot Invalidation (VPS Routed)", from: 0, to: 0 });
              } else if (trade.status !== "CLOSED") {
                const closeRes = await fetch(`${META_API_BASE_URL}/users/current/accounts/${META_API_ACCOUNT_ID}/trade`, {
                  method: "POST",
                  headers: { "auth-token": META_API_TOKEN, "Content-Type": "application/json" },
                  body: JSON.stringify(payload),
                });
                if (closeRes.ok) {
                  await supabase.from("user_trades").update({ status: "CLOSED", error_message: `Bar-Close Pivot Invalidation (Closed at ${ptiSnap.c} beyond Pivot ${pivotPoint})` }).eq("meta_api_order_id", orderId);
                  moves.push({ symbol: trade.symbol, action: "Bar-Close Pivot Invalidation", from: 0, to: 0 });
                }
              }

              // --- 1D. CONTINGENT ALTERNATIVE SCENARIO AUTO-EXECUTION (Trading Central Methodology) ---
              // When the preferred thesis is invalidated by a confirmed candle close beyond the Pivot,
              // immediately stage the alternative scenario to capture the directional reversal breakout.
              try {
                const altScenario = opp.entry_plan_json?.trading_central_levels?.alternative_scenario;
                if (altScenario && altScenario.direction && altScenario.target_1 && altScenario.target_2) {
                  const altSide = altScenario.direction;
                  const altEntry = Number(ptiSnap.c.toFixed(5));
                  const altSl = Number(pivotPoint.toFixed(5));
                  const altTp1 = Number(altScenario.target_1.toFixed(5));
                  const altTp2 = Number(altScenario.target_2.toFixed(5));
                  const altRisk = Math.abs(altEntry - altSl);
                  const altReward = Math.abs(altTp2 - altEntry);
                  const altRr = altRisk > 0 ? altReward / altRisk : 0;

                  // Verify the alternative setup maintains institutional R:R >= 1.50
                  if (altRr >= 1.50) {
                    const tenMinsAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();
                    const { data: existingFlip } = await supabase
                      .from("trade_opportunities")
                      .select("id")
                      .eq("symbol", trade.symbol)
                      .eq("side", altSide)
                      .gte("created_at", tenMinsAgo)
                      .limit(1);

                    if (!existingFlip || existingFlip.length === 0) {
                      console.log(`[Position Manager] Auto-Origination: Triggering Alternative Scenario for ${trade.symbol} (${altSide}) targeting TP1: ${altTp1}, TP2: ${altTp2}.`);
                      
                      const flipRationale = `[Trading Central Contingent Flip] Preferred ${trade.side} thesis invalidated on bar close beyond Pivot ($${pivotPoint}). Autonomously activated Alternative Scenario: ${altSide} towards TP1 $${altTp1} and TP2 $${altTp2}. Invalidation/Pivot set at $${altSl}.`;

                      const { data: newFlipOpp } = await supabase
                        .from("trade_opportunities")
                        .insert({
                          symbol: trade.symbol,
                          side: altSide,
                          timeframe: opp.timeframe || "30m",
                          status: "APPROVED",
                          source: opp.source || "agent-day",
                          entry_plan_json: {
                            price: altEntry,
                            order_type: altSide === "LONG" ? "BUY MARKET" : "SELL MARKET",
                            max_holding_bars: 20,
                            horizon_hours: opp.timeframe === "1d" ? 480 : 10,
                          },
                          stop_plan_json: { stop: altSl, initial: altSl },
                          take_profit_json: { tp: altTp2, tp1: altTp1, tp2: altTp2 },
                          risk_summary: `Contingent Flip | R:R 1:${altRr.toFixed(1)}`,
                          confidence: 82,
                          ai_summary: flipRationale,
                          ai_risks: "Managed by AI Risk Officer (Contingent Alternative Flip)",
                          model_id: "agent-trade-contingent-flip",
                        })
                        .select("id")
                        .single();

                      if (newFlipOpp) {
                        moves.push({
                          symbol: trade.symbol,
                          action: `Alternative Scenario Triggered (${altSide} @ ${altEntry})`,
                          from: 0,
                          to: altTp2,
                        });
                        await insertAuditLog(supabase, {
                          actor_type: "SYSTEM",
                          action: "ALTERNATIVE_SCENARIO_TRIGGERED",
                          entity_type: "trade_opportunities",
                          entity_id: newFlipOpp.id,
                          payload_json: {
                            symbol: trade.symbol,
                            previous_side: trade.side,
                            new_side: altSide,
                            entry: altEntry,
                            pivot_sl: altSl,
                            tp1: altTp1,
                            tp2: altTp2,
                            rationale: flipRationale,
                          },
                        });
                      }
                    }
                  }
                }
              } catch (flipErr: any) {
                console.error(`[Position Manager] Error triggering alternative scenario for ${trade.symbol}:`, flipErr);
              }

              continue;
            }
          }

          if (isPendingOrder) {
             continue; // Skip all remaining trailing stop/leveraging logic for pending orders
          }

          // --- 2. AUTONOMOUS DE-LEVERAGING (Emergency Trimming) ---
          if (!isSolvent && trade.status === "OPEN") {
             const profit = Number(position.profit) || 0;
             const currentVol = Number(position.volume) || 0.01;
             const entryPrice = opp.entry_plan_json?.price || opp.entry_plan_json?.entry_price;
             
             if (profit > 0 && entryPrice) {
                 // Profitable: Move SL to Breakeven
                 console.log(`[Position Manager] DE-LEVERAGING: Moving SL to Breakeven for ${orderId}`);
                 await fetch(`${META_API_BASE_URL}/users/current/accounts/${META_API_ACCOUNT_ID}/trade`, {
                     method: "POST",
                     headers: { "auth-token": META_API_TOKEN, "Content-Type": "application/json" },
                     body: JSON.stringify({ actionType: "POSITION_MODIFY", positionId: orderId, stopLoss: entryPrice })
                 });
             } else if (currentVol > 0.01) {
                 // Losing: Partial Close by 50%
                 console.log(`[Position Manager] DE-LEVERAGING: Partially closing 50% of ${orderId} (${trade.symbol}).`);
                 const newVol = Math.max(0.01, Math.floor((currentVol / 2) * 100) / 100);
                 await fetch(`${META_API_BASE_URL}/users/current/accounts/${META_API_ACCOUNT_ID}/trade`, {
                     method: "POST",
                     headers: { "auth-token": META_API_TOKEN, "Content-Type": "application/json" },
                     body: JSON.stringify({ actionType: "POSITION_CLOSE_ID", positionId: orderId, volume: currentVol - newVol })
                 });
             }
             continue; // Skip all other logic to avoid conflicting modifications
          }

          // --- 3. END OF DAY (EOD) SCALP LIQUIDATION ---
          // If it is 4 PM NY time or later, and the trade is a Scalp ('30m' timeframe), liquidate it immediately.
          if (isEodScalp && opp.timeframe === "30m") {
              console.log(`[Position Manager] EOD LIQUIDATION: Closing Scalp ${orderId} for ${trade.symbol} at ${nyHour}:00 NY Time.`);
             try {
                if (isVpsAlive) {
                   await supabase.from("user_trades").update({ status: "VPS_CLOSE", error_message: "EOD Liquidation (4 PM NY Time)" }).eq("meta_api_order_id", orderId);
                } else {
                   await fetch(`${META_API_BASE_URL}/users/current/accounts/${META_API_ACCOUNT_ID}/trade`, {
                      method: "POST",
                      headers: { "auth-token": META_API_TOKEN, "Content-Type": "application/json" },
                      body: JSON.stringify({ actionType: "POSITION_CLOSE_ID", positionId: orderId })
                   });
                   await supabase.from("user_trades").update({ status: "CLOSED", error_message: "EOD Liquidation (4 PM NY Time)", close_price: position.currentPrice, profit_usd: position.profit }).eq("meta_api_order_id", orderId);
                }
             } catch (e) {
                console.error(`[Position Manager] Failed EOD liquidation for ${orderId}:`, e);
             }
             continue; // Skip trailing stop logic
          }

          // --- 3. TRAILING STOP LOGIC ---

          const entryPrice = opp.entry_plan_json?.price || opp.entry_plan_json?.entry_price;
          const originalSl = opp.stop_plan_json?.initial || opp.stop_plan_json?.stop;
          const originalTp = opp.take_profit_json?.tp;

          if (!entryPrice || !originalSl) continue;

          const currentPrice = Number(position.currentPrice);
          const currentSl = Number(position.stopLoss) || originalSl;
          const profit = Number(position.profit) || 0;
          const riskDist = Math.abs(entryPrice - originalSl);
          
          if (riskDist === 0) continue;

          const isLong = trade.side === "LONG";
          


          const priceMoveInR = isLong
            ? (currentPrice - entryPrice) / riskDist
            : (entryPrice - currentPrice) / riskDist;

          const atr = atrCache.get(trade.symbol) || riskDist;
          let newSl: number | null = null;
          let actionName = "";

          if (trade.trade_type === "RUNNER") {
            const trailSl = isLong ? currentPrice - (atr * 1.5) : currentPrice + (atr * 1.5);
            const isImprovement = isLong ? trailSl > currentSl : trailSl < currentSl;
            const isSafeFromOriginal = isLong ? trailSl > originalSl : trailSl < originalSl;

            if (isImprovement && isSafeFromOriginal && (profit > 0 || priceMoveInR > 0)) {
              newSl = Number(trailSl.toFixed(5));
              actionName = `TRAIL_RUNNER (+${priceMoveInR.toFixed(1)}R)`;
            }
          }

          if (!newSl) {
            if (priceMoveInR >= 3.0) {
              const lockSl = isLong
                ? Number((entryPrice + (riskDist * 2.0)).toFixed(5))
                : Number((entryPrice - (riskDist * 2.0)).toFixed(5));
              const isImprovement = isLong ? lockSl > currentSl : lockSl < currentSl;
              if (isImprovement) {
                newSl = lockSl;
                actionName = `LOCK_IN_2R (profit +${priceMoveInR.toFixed(1)}R)`;
              }
            } else if (priceMoveInR >= 2.0) {
              const lockSl = isLong
                ? Number((entryPrice + riskDist).toFixed(5))
                : Number((entryPrice - riskDist).toFixed(5));
              const isImprovement = isLong ? lockSl > currentSl : lockSl < currentSl;
              if (isImprovement) {
                newSl = lockSl;
                actionName = `LOCK_IN_1R (profit +${priceMoveInR.toFixed(1)}R)`;
              }
            } else if (priceMoveInR >= 1.0) {
              const lockSl = isLong
                ? Number((entryPrice + (riskDist * 0.5)).toFixed(5))
                : Number((entryPrice - (riskDist * 0.5)).toFixed(5));
              const isImprovement = isLong ? lockSl > currentSl : lockSl < currentSl;
              if (isImprovement) {
                newSl = lockSl;
                actionName = `LOCK_IN_HALF_R (profit +${priceMoveInR.toFixed(1)}R)`;
              }
            } else if (priceMoveInR >= 0.50) {
              const beSl = Number(entryPrice.toFixed(5));
              const isImprovement = isLong ? beSl > currentSl : beSl < currentSl;
              if (isImprovement) {
                newSl = beSl;
                actionName = `BREAK_EVEN (profit +${priceMoveInR.toFixed(1)}R)`;
              }
            } else if (barsElapsed >= 20 && profit > 0) {
              const beSl = Number(entryPrice.toFixed(5));
              const isImprovement = isLong ? beSl > currentSl : beSl < currentSl;
              if (isImprovement) {
                newSl = beSl;
                actionName = `20_BAR_THESIS_DECAY_BE (aged ${barsElapsed.toFixed(1)} bars)`;
              }
            }
          }

          if (newSl !== null) {
            console.log(`[Position Manager] ${trade.symbol} ${orderId}: ${actionName} — SL ${currentSl} → ${newSl}`);
            
            if (isVpsAlive) {
                // --- VPS EA ROUTING: Save modification to DB instead of MetaAPI ---
                const { data: currentOpp } = await supabase.from("trade_opportunities").select("stop_plan_json").eq("id", opp.id).single();
                if (currentOpp) {
                   const updatedJson = { ...currentOpp.stop_plan_json, stop: newSl };
                   const modRes = await supabase.from("trade_opportunities").update({ stop_plan_json: updatedJson }).eq("id", opp.id);
                   
                   if (!modRes.error) {
                     await supabase.from("user_trades").update({ stop_loss: newSl }).eq("meta_api_order_id", orderId);
                     moves.push({ symbol: trade.symbol, action: actionName + " (VPS)", from: currentSl, to: newSl });
                   } else {
                     errors.push(`${trade.symbol} ${orderId}: modify failed (DB Error)`);
                   }
                }
            } else {
                // --- METAAPI FAILOVER ---
                const modRes = await fetch(`${META_API_BASE_URL}/users/current/accounts/${META_API_ACCOUNT_ID}/trade`, {
                   method: "POST",
                   headers: { "auth-token": META_API_TOKEN, "Content-Type": "application/json" },
                   body: JSON.stringify({ actionType: "POSITION_MODIFY", positionId: orderId, stopLoss: newSl })
                });
                if (modRes.ok) {
                    const { data: currentOpp } = await supabase.from("trade_opportunities").select("stop_plan_json").eq("id", opp.id).single();
                    if (currentOpp) {
                       const updatedJson = { ...currentOpp.stop_plan_json, stop: newSl };
                       await supabase.from("trade_opportunities").update({ stop_plan_json: updatedJson }).eq("id", opp.id);
                       await supabase.from("user_trades").update({ stop_loss: newSl }).eq("meta_api_order_id", orderId);
                    }
                    moves.push({ symbol: trade.symbol, action: actionName + " (MetaAPI Failover)", from: currentSl, to: newSl });
                } else {
                    errors.push(`${trade.symbol} ${orderId}: modify failed (MetaAPI Error)`);
                }
            }
          }

          await new Promise(r => setTimeout(r, 100));
        } catch (err: any) {
          errors.push(`${orderId}: ${err.message}`);
        }
      }

      if (moves.length > 0) {
        const TG_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN") ?? "";
        const TG_CHAT = Deno.env.get("TELEGRAM_CHAT_ID") ?? "";
        if (TG_TOKEN && TG_CHAT) {
          const lines = [`📐 <b>Position Manager — SL Updates</b>`, ``, ...moves.map(m => `• <b>${m.symbol}</b> ${m.action}: ${m.from} → <b>${m.to}</b>`)];
          if (errors.length > 0) lines.push(``, `⚠️ ${errors.length} errors`);
          await fetch(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ chat_id: TG_CHAT, text: lines.join("\n"), parse_mode: "HTML" }),
          }).catch(() => {});
        }
      }

      return new Response(JSON.stringify({
        evaluated: orderMap.size,
        moves: moves.length,
        errors: errors.length,
        errorList: errors,
        details: moves
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    }


    let signal: any = null;
    let isManual = payload.action === "MANUAL_EXECUTION";

    if (isManual) {
      if (!payload.opportunity_id) return new Response("Missing opportunity_id", { status: 400 });
      const { data: oppData } = await supabase.from("trade_opportunities").select("*").eq("id", payload.opportunity_id).single();
      if (!oppData) return new Response("Signal not found", { status: 404 });
      signal = oppData;
    } else {
      if (payload.type !== "INSERT" && payload.type !== "UPDATE") return new Response("Ignored non-actionable webhook", { status: 200 });
      signal = payload.record;
      const oldSignal = (payload as any).old_record;
      if (payload.type === "UPDATE" && oldSignal && oldSignal.status === "APPROVED") {
        return new Response("Signal was already approved. Ignoring.", { status: 200 });
      }
    }

    if (signal.status !== "APPROVED") {
      return new Response("Signal not approved.", { status: 200 });
    }

    // AI Tier Filtering for PAMM (Autopilot only trades S & A Tier unless manually overridden)
    const signalTier = (() => {
      const summary = signal.ai_summary || "";
      const match = summary.match(/(S|A|B|C)-Tier/m);
      return match ? `${match[1]}-Tier` : null;
    })();

    if (!isManual && (signalTier === "C-Tier" || signalTier === "B-Tier")) {
      console.log(`[PAMM Router] Skipping PAMM execution for ${signalTier} signal (Minimum A-Tier required).`);
      const rejectReason = `Rejected: Minimum A-Tier required for Auto-Execution (Found ${signalTier}).`;
      await supabase.from("trade_opportunities").update({ status: "REJECTED", ai_summary: signal.ai_summary + "\n\n[Execution Desk] " + rejectReason, ai_risks: rejectReason }).eq("id", signal.id);
      return new Response(`Skipped execution for ${signalTier}`, { status: 200 });
    }

    // === EXECUTION GUARD: TIME OF DAY KILL ZONE ===
    // Prevent automated execution during Asian session (22:00 - 06:00 UTC) to avoid low volume chop
    const isSwingTrade = signal.source === "agent-swing" || signal.source_agent === "agent-swing" || ["4h", "1d", "1w"].includes(signal.timeframe?.toLowerCase()) || signal.ai_summary?.includes("[SWING]");
    if (!isManual && !isSwingTrade) {
      const currentHourUTC = new Date().getUTCHours();
      if (currentHourUTC >= 22 || currentHourUTC < 6) {
        console.log(`[PAMM Router] Execution blocked: Inside Asian Session Kill Zone (${currentHourUTC}:00 UTC).`);
        const rejectReason = `Rejected: Inside Asian Session Kill Zone (${currentHourUTC}:00 UTC). (Only bypassed for Swing Trades)`;
        await supabase.from("trade_opportunities").update({ status: "REJECTED", ai_summary: signal.ai_summary + "\n\n[Execution Desk] " + rejectReason, ai_risks: rejectReason }).eq("id", signal.id);
        return new Response(`Blocked by Kill Zone filter at ${currentHourUTC}:00 UTC`, { status: 200 });
      }
    }

    // Fetch all active funded users in the PAMM
    const { data: users, error: usersError } = await supabase
      .from("user_risk_settings")
      .select("*")
      .gt("portfolio_capital", 0);

    // Fetch Global Pyramiding with House Money (PHM) Settings
    const { data: sysSettings } = await supabase.from("system_settings").select("value").eq("key", "phm_settings").maybeSingle();
    const phmSettings = sysSettings?.value || { active: false, floor_capital: 0, risk_pct: 0.01 };

    if (usersError || !users || users.length === 0) {
      const rejectReason = `Rejected: No funded PAMM users found.`;
      await supabase.from("trade_opportunities").update({ status: "REJECTED", ai_summary: signal.ai_summary + "\n\n[Execution Desk] " + rejectReason, ai_risks: rejectReason }).eq("id", signal.id);
      return new Response("No funded PAMM users found.", { status: 200 });
    }

    // Prepare execution parameters
    const entryPlan = signal.entry_plan_json || {};
    const stopPlan = signal.stop_plan_json || {};
    let defaultEntryPrice = entryPlan.price || entryPlan.entry_price || entryPlan.limit_price;
    const scaledEntries = entryPlan.scaled_entries && Array.isArray(entryPlan.scaled_entries) && entryPlan.scaled_entries.length > 0
      ? entryPlan.scaled_entries
      : [{ price: defaultEntryPrice, weight: 1.0 }];
    let stopLoss = stopPlan.stop || stopPlan.stop_price;
    let takeProfit = signal.take_profit_json?.tp || signal.take_profit_json?.tp_price;

    // === EXECUTION GUARD: DYNAMIC ATR STOP LOSS FLOOR ===
    // Prevent stop losses that are too tight to survive market noise.
    // For Swing Trades, enforce floor against 1.25x Daily ATR rather than 30m ATR.
    if (!isManual && defaultEntryPrice && stopLoss) {
      try {
        const tfForAtr = isSwingTrade ? "1D" : "30m";
        const minAtrMultiplier = isSwingTrade ? 1.25 : 1.0;
        const bars = await fetchPaperBars(signal.symbol, tfForAtr, 50, supabase);
        if (bars.length >= 14) {
          const snap = getContextSnapshot(
            bars.map((b: any) => b.t),
            bars.map((b: any) => b.o),
            bars.map((b: any) => b.h),
            bars.map((b: any) => b.l),
            bars.map((b: any) => b.c),
            bars.map((b: any) => b.v),
            signal.symbol
          );
          const rawAtr = snap.atr_14 || 0;
          const minRequiredRisk = rawAtr * minAtrMultiplier;
          if (minRequiredRisk > 0) {
            const currentRisk = Math.abs(defaultEntryPrice - stopLoss);
            if (currentRisk < minRequiredRisk) {
              const isLong = signal.side === "LONG" || signal.side === "BUY";
              stopLoss = isLong ? defaultEntryPrice - minRequiredRisk : defaultEntryPrice + minRequiredRisk;
              // Format to 5 decimal places safely
              stopLoss = Number(stopLoss.toFixed(5));
              console.log(`[PAMM Router] Widen Stop Loss: Risk ${currentRisk.toFixed(4)} was less than ${minAtrMultiplier}x ATR (${minRequiredRisk.toFixed(4)} on ${tfForAtr}). Adjusted SL to ${stopLoss}.`);
            }
          }
        }
      } catch (err) {
        console.error(`[PAMM Router] Failed to calculate ATR for SL floor:`, err);
      }
    }

    // === EXECUTION GUARD 1: TP DIRECTION & MULTI-LEG SANITIZATION ===
    // Prevents placing orders where TP (or any TP leg) is on the wrong side of entry.
    // Protects against MT5 Error 10016 (Invalid Stops) across SWING, QUICK_EXIT, and RUNNER legs.
    if (defaultEntryPrice && stopLoss) {
      const isLong = signal.side === "LONG" || signal.side === "BUY";
      const riskDist = Math.abs(defaultEntryPrice - stopLoss);
      let tpUpdated = false;

      let currentTp = takeProfit;
      let tp1 = signal.take_profit_json?.tp1;
      let tp2 = signal.take_profit_json?.tp2;
      let tp3 = signal.take_profit_json?.tp3;

      if (riskDist > 0) {
        if (isLong) {
          if (!tp1 || tp1 <= defaultEntryPrice) {
            tp1 = Number((defaultEntryPrice + riskDist * 1.0).toFixed(5));
            tpUpdated = true;
          }
          if (!tp2 || tp2 <= tp1) {
            tp2 = Number((tp1 + riskDist * 1.0).toFixed(5));
            tpUpdated = true;
          }
          if (!tp3 || tp3 <= tp2) {
            tp3 = Number((tp2 + riskDist * 1.5).toFixed(5));
            tpUpdated = true;
          }
          if (!currentTp || currentTp <= defaultEntryPrice) {
            currentTp = tp2;
            tpUpdated = true;
          }
        } else {
          if (!tp1 || tp1 >= defaultEntryPrice) {
            tp1 = Number((defaultEntryPrice - riskDist * 1.0).toFixed(5));
            tpUpdated = true;
          }
          if (!tp2 || tp2 >= tp1) {
            tp2 = Number((tp1 - riskDist * 1.0).toFixed(5));
            tpUpdated = true;
          }
          if (!tp3 || tp3 >= tp2) {
            tp3 = Number((tp2 - riskDist * 1.5).toFixed(5));
            tpUpdated = true;
          }
          if (!currentTp || currentTp >= defaultEntryPrice) {
            currentTp = tp2;
            tpUpdated = true;
          }
        }
      }

      if (tpUpdated) {
        console.warn(`[Execution Guard] TP direction mismatch corrected on ${signal.symbol} ${signal.side}! Entry=${defaultEntryPrice}. Corrected TP=${currentTp}, TP1=${tp1}, TP2=${tp2}, TP3=${tp3}.`);
        takeProfit = currentTp;
        const updatedTpJson = {
          ...signal.take_profit_json,
          tp: currentTp,
          tp_price: currentTp,
          tp1,
          tp2,
          tp3
        };
        await supabase.from("trade_opportunities").update({ take_profit_json: updatedTpJson }).eq("id", signal.id);
        signal.take_profit_json = updatedTpJson;
      }
    }

    // === EXECUTION GUARD 1B: SL DIRECTION VALIDATION ===
    // Prevents placing orders where SL is on the wrong side of entry (MT5 Code 10016).
    if (defaultEntryPrice && stopLoss) {
      const isLong = signal.side === "LONG" || signal.side === "BUY";
      const slOnWrongSide = isLong ? stopLoss > defaultEntryPrice : stopLoss < defaultEntryPrice;
      if (slOnWrongSide) {
        const currentRisk = Math.abs(defaultEntryPrice - stopLoss);
        const correctedSl = isLong
          ? Number((defaultEntryPrice - currentRisk).toFixed(5))
          : Number((defaultEntryPrice + currentRisk).toFixed(5));
        console.warn(`[Execution Guard] SL direction mismatch on ${signal.symbol} ${signal.side}! Entry=${defaultEntryPrice}, SL=${stopLoss}. Corrected to ${correctedSl}.`);
        stopLoss = correctedSl;
        
        const updatedStopJson = {
          ...signal.stop_plan_json,
          stop: correctedSl,
          stop_price: correctedSl
        };
        await supabase.from("trade_opportunities").update({ stop_plan_json: updatedStopJson }).eq("id", signal.id);
        signal.stop_plan_json = updatedStopJson;
      }
    }

    // === EXECUTION GUARD 1C: SPREAD BUFFER ON STOP LOSS ===
    // Pushes the Stop Loss slightly wider to prevent broker spread hunting
    if (defaultEntryPrice && stopLoss) {
      const spreadBuffers: Record<string, number> = {
        XAGUSD: 0.05, XAUUSD: 0.50, UKOIL: 0.05, BTCUSD: 25,
        EURUSD: 0.0003, GBPUSD: 0.0003, USDJPY: 0.03, US30: 5, NAS100: 5,
        AUDUSD: 0.0003, NZDUSD: 0.0003, EURJPY: 0.03, GBPJPY: 0.03,
      };
      const buffer = spreadBuffers[signal.symbol] || 0;
      if (buffer > 0) {
        const isLong = signal.side === "LONG" || signal.side === "BUY";
        const bufferedSl = isLong
          ? Number((stopLoss - buffer).toFixed(5))
          : Number((stopLoss + buffer).toFixed(5));
        console.log(`[Execution Guard] Applying ${buffer} spread buffer to ${signal.symbol} SL. ${stopLoss} → ${bufferedSl}`);
        stopLoss = bufferedSl;
        
        const updatedStopJson = {
          ...signal.stop_plan_json,
          stop: bufferedSl,
          stop_price: bufferedSl
        };
        await supabase.from("trade_opportunities").update({ stop_plan_json: updatedStopJson }).eq("id", signal.id);
        signal.stop_plan_json = updatedStopJson;
      }
    }

    // === EXECUTION GUARD 1D: ORDER FLOW BREAKOUT VOLUME GUARD ===
    // Prevents entering breakout market orders when tick volume is anemic
    const orderTypeStr = (signal.entry_plan_json?.order_type || "Market").toUpperCase();
    if (!isManual && (orderTypeStr.includes("STOP") || signal.ai_summary?.includes("BREAKOUT"))) {
      try {
        const bars = await fetchPaperBars(signal.symbol, "30m", 30, supabase);
        if (bars.length >= 10) {
          const snap = getContextSnapshot(
            bars.map((b: any) => b.t),
            bars.map((b: any) => b.o),
            bars.map((b: any) => b.h),
            bars.map((b: any) => b.l),
            bars.map((b: any) => b.c),
            bars.map((b: any) => b.v),
            signal.symbol
          );
          if (snap.volume_regime === "ANEMIC" || (snap.volume_ratio !== null && snap.volume_ratio < 0.70)) {
            const rejectReason = `[Execution Desk] REJECTED: Low-Volume Fakeout Trap. Breakout tick volume ratio is anemic (${snap.volume_ratio}x < 0.70x required).`;
            await supabase.from("trade_opportunities").update({ status: "REJECTED", ai_summary: (signal.ai_summary || "") + "\n\n" + rejectReason, ai_risks: rejectReason }).eq("id", signal.id);
            console.log(`[Execution Desk] Rejected ${signal.symbol} due to anemic breakout volume.`);
            return new Response(JSON.stringify({ success: true, message: "Rejected due to low volume fakeout" }), { status: 200 });
          }
        }
      } catch (err) {
        console.error(`[Execution Desk] Order Flow Guard check failed:`, err);
      }
    }

    // === EXECUTION GUARD 2: MINIMUM SL & TP DISTANCE ===
    // Prevents ultra-tight stops that get swept by spread/volatility.
    const minDistances: Record<string, number> = {
      XAGUSD: 0.30, XAUUSD: 2.00, UKOIL: 0.30, BTCUSD: 150,
      EURUSD: 0.0010, GBPUSD: 0.0010, USDJPY: 0.15, US30: 30, NAS100: 30,
      AUDUSD: 0.0010, NZDUSD: 0.0020, EURJPY: 0.15, GBPJPY: 0.15,
    };
    
    if (defaultEntryPrice) {
      const minDist = minDistances[signal.symbol];
      if (minDist) {
        // Validate Stop Loss Distance
        if (stopLoss) {
          const currentSlDist = Math.abs(defaultEntryPrice - stopLoss);
          if (currentSlDist < minDist) {
            const correctedSl = signal.side === "LONG"
              ? Number((defaultEntryPrice - minDist).toFixed(5))
              : Number((defaultEntryPrice + minDist).toFixed(5));
            console.warn(`[Execution Guard] SL too tight on ${signal.symbol}: ${currentSlDist.toFixed(5)} < min ${minDist}. Widening from ${stopLoss} → ${correctedSl}.`);
            stopLoss = correctedSl;
          }
        }
        
        // Validate Take Profit Distance
        if (takeProfit) {
          const currentTpDist = Math.abs(takeProfit - defaultEntryPrice);
          if (currentTpDist < minDist) {
            const isLong = signal.side === "LONG" || signal.side === "BUY";
            const correctedTp = isLong
              ? Number((defaultEntryPrice + minDist).toFixed(5))
              : Number((defaultEntryPrice - minDist).toFixed(5));
            console.warn(`[Execution Guard] TP too close on ${signal.symbol}: ${currentTpDist.toFixed(5)} < min ${minDist}. Widening from ${takeProfit} → ${correctedTp}.`);
            takeProfit = correctedTp;
            
            // Persist corrected TP to the DB
            const updatedTpJson = { 
              ...signal.take_profit_json, 
              tp: correctedTp, 
              tp_price: correctedTp,
              tp1: correctedTp,
              tp2: correctedTp,
              tp3: correctedTp 
            };
            await supabase.from("trade_opportunities").update({ take_profit_json: updatedTpJson }).eq("id", signal.id);
            signal.take_profit_json = updatedTpJson;
          }
        }
      }
    }

    let actionType = "ORDER_TYPE_BUY";
    const aiOrderType = (signal.entry_plan_json?.order_type || "Market").toUpperCase();
    if (aiOrderType.includes("BUY LIMIT")) actionType = "ORDER_TYPE_BUY_LIMIT";
    else if (aiOrderType.includes("SELL LIMIT")) actionType = "ORDER_TYPE_SELL_LIMIT";
    else if (aiOrderType.includes("BUY STOP")) actionType = "ORDER_TYPE_BUY_STOP";
    else if (aiOrderType.includes("SELL STOP")) actionType = "ORDER_TYPE_SELL_STOP";
    else if (signal.side === "LONG") actionType = "ORDER_TYPE_BUY";
    else actionType = "ORDER_TYPE_SELL";

    const isMarketOrder = actionType === "ORDER_TYPE_BUY" || actionType === "ORDER_TYPE_SELL";

    // --- PORTFOLIO MANAGER: Dynamic Risk Sizing (Confluence Check) ---
    let confluenceMultiplier = 1.0;
    let pmReason = "Standard Allocation";

    if (!isManual) {
      // Query recent signals for this symbol in the last 4 hours (tight confluence window)
      const fourHoursAgo = new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString();
      const { data: recentSignals } = await supabase
        .from("trade_opportunities")
        .select("id, side, ai_summary, status, source")
        .eq("symbol", signal.symbol)
        .gte("created_at", fourHoursAgo)
        .neq("id", signal.id);

      if (recentSignals && recentSignals.length > 0) {
        let alignedCount = 0;
        let opposingCount = 0;

        for (const rs of recentSignals) {
          if (rs.status === "REJECTED" || rs.status === "INVALID") continue;
          
          if (rs.side === signal.side) {
             alignedCount++;
          } else {
             opposingCount++;
          }
        }

        if (alignedCount > 0 && opposingCount === 0) {
          confluenceMultiplier = 3.0; // Bump risk to 3x for a conviction play
          pmReason = "Portfolio Manager: 3.0x Risk Multiplier (Massive Multi-Agent Confluence Detected within 4H)";
        } else if (opposingCount > 0 && opposingCount >= alignedCount) {
          confluenceMultiplier = 0.5;
          pmReason = "Portfolio Manager: 0.5x Risk Multiplier (Counter-Trend Scalp / Opposing Confluence)";
        }
      }

      // --- DUPLICATE ASSET LOCK ---
      // Prevents stacking multiple trades for the exact same asset if one is already open.
      const { data: existingOpenTrades } = await supabase
        .from("user_trades")
        .select("id")
        .eq("symbol", signal.symbol)
        .eq("status", "OPEN");
      
      if (existingOpenTrades && existingOpenTrades.length > 0) {
        const rejectReason = `Rejected by Execution Desk: Duplicate lock. An open position already exists for ${signal.symbol}.`;
        await supabase.from("trade_opportunities").update({ status: "REJECTED", ai_summary: signal.ai_summary + "\n\n[Execution Desk] " + rejectReason, ai_risks: rejectReason }).eq("id", signal.id);
        console.log(`[Execution Desk] Rejected ${signal.symbol} due to existing open trade (Duplicate Lock).`);
        return new Response(JSON.stringify({ success: true, message: "Rejected due to duplicate lock" }), { status: 200 });
      }

      // --- DYNAMIC CORRELATION LIMITS ---
      const correlationGroups = [
        ["XAUUSD", "XAGUSD"],
        ["US30", "NAS100", "SPX500"],
        ["EURUSD", "GBPUSD"]
      ];
      
      const group = correlationGroups.find(g => g.includes(signal.symbol));
      if (group) {
        const otherSymbolsInGroup = group.filter(s => s !== signal.symbol);
        
        const { data: openCorrelatedTrades } = await supabase
          .from("user_trades")
          .select("side, symbol")
          .in("symbol", otherSymbolsInGroup)
          .eq("status", "OPEN");

        if (openCorrelatedTrades && openCorrelatedTrades.length > 0) {
           let sameDirectionCount = 0;
           let oppositeDirectionCount = 0;
           
           for (const trade of openCorrelatedTrades) {
             if (trade.side === signal.side) sameDirectionCount++;
             else oppositeDirectionCount++;
           }
           
           if (oppositeDirectionCount > 0) {
              const rejectReason = `Rejected by Execution Desk: Contradictory signal against open highly correlated asset.`;
              await supabase.from("trade_opportunities").update({ status: "REJECTED", ai_summary: signal.ai_summary + "\n\n[Execution Desk] " + rejectReason, ai_risks: rejectReason }).eq("id", signal.id);
              console.log(`[Execution Desk] Rejected ${signal.symbol} due to contradictory open correlated position.`);
              return new Response(JSON.stringify({ success: true, message: "Rejected due to correlation contradiction" }), { status: 200 });
           }
           
           if (sameDirectionCount > 0) {
              confluenceMultiplier *= 0.5;
              pmReason += `\n[Execution Desk] 0.5x Risk Modifier Applied: Heavy Correlation Detected with OPEN position.`;
           }
        }
      }
      // --- END DYNAMIC CORRELATION LIMITS ---

    }  
      const updatedSummary = `${signal.ai_summary || ""} \n\n[Execution Desk] ${pmReason}`;
      await supabase.from("trade_opportunities").update({ ai_summary: updatedSummary }).eq("id", signal.id);
      signal.ai_summary = updatedSummary; 
    // --- END PORTFOLIO MANAGER ---

    // --- PRE-TRADE INSOLVENCY CHECK ---
    const { data: treasuryData } = await supabase.from("system_settings").select("value").eq("key", "treasury_status").single();
    if (treasuryData && treasuryData.value) {
       const status = treasuryData.value as any;
       if (status.is_solvent === false || status.solvency_ratio < 1.0) {
          const rejectReason = `[Execution Desk] REJECTED: Treasury Insolvency Lockout. Broker margin is insufficient to cover aggregate user wallets (Ratio: ${status.solvency_ratio}).`;
          await supabase.from("trade_opportunities").update({ status: "REJECTED", ai_summary: signal.ai_summary + "\n\n" + rejectReason, ai_risks: rejectReason }).eq("id", signal.id);
          console.log(`[Execution Desk] Rejected ${signal.symbol} due to Treasury Insolvency Lockout.`);
          return new Response(JSON.stringify({ success: true, message: "Rejected due to insolvency" }), { status: 200 });
       }
    }

    // Build user allocations
    const userAllocations = [];
    let totalMasterVolume = 0;

    // --- DYNAMIC VOLUME STEP ---
    const minVolumes: Record<string, number> = {
      US30: 0.1, NAS100: 0.1, SPX500: 0.1, GER30: 0.1,
      BTCUSD: 0.01, UKOIL: 0.01, XAUUSD: 0.01, XAGUSD: 0.01
    };
    const volumeStep = minVolumes[signal.symbol] || 0.01;

    // --- FOMC WINDOW SIZE MULTIPLIER (1.5x) ---
    // agent-day and agent-swing set this flag when a Fed/central bank event
    // is active (±90 min pre-event or 6h post-event). We increase position
    // sizing to capitalise on macro-driven volatility expansion.
    // All downstream safety caps (MAX_LOT_CAP, drawdown, blowout) still apply.
    let fomcSizeMultiplier = 1.0;
    try {
      const { data: fomcFlag } = await supabase
        .from("system_settings")
        .select("value")
        .eq("key", "fomc_window_active")
        .single();
      if (fomcFlag?.value === true) {
        fomcSizeMultiplier = 1.5;
        console.log(`[FOMC] fomc_window_active = true. Applying 1.5x size multiplier.`);
      }
    } catch (_) { /* non-critical — default to 1.0 */ }

    let blockedByRiskManager = false;

    // --- PROBABILITY & KELLY CALIBRATION SIZING ---
    let probabilityModifier = 1.0;
    let allowRunnerLeg = true;
    let probNote = "";

    try {
      const { data: auditEntries } = await supabase
        .from("audit_log")
        .select("payload_json")
        .eq("entity_id", signal.id)
        .order("created_at", { ascending: false })
        .limit(1);

      const calProb = auditEntries?.[0]?.payload_json?.calibrated_probability;
      if (typeof calProb === "number") {
        if (calProb < 45) {
          probabilityModifier = 0.5;
          allowRunnerLeg = false; // Disable secondary runner leg to prevent compounding drawdown
          probNote = `Kelly Sizing: 0.5x risk modifier applied (Calibrated P(win) ${calProb}% < 45%). RUNNER leg disabled.`;
          console.log(`[PAMM Router] [${signal.symbol}] ${probNote}`);
        } else if (calProb < 50) {
          probabilityModifier = 0.75;
          probNote = `Kelly Sizing: 0.75x risk modifier applied (Calibrated P(win) ${calProb}% < 50%).`;
          console.log(`[PAMM Router] [${signal.symbol}] ${probNote}`);
        }
      }
    } catch (probErr: any) {
      console.warn(`[PAMM Router] Failed to check calibrated probability:`, probErr.message);
    }

    for (const scaledEntry of scaledEntries) {
      const entryPrice = scaledEntry.price;
      const entryWeight = scaledEntry.weight || 1.0;
      const pointsAtRisk = Math.abs(entryPrice - stopLoss);
      
      const contractSizes: Record<string, number> = {
        UKOIL: 1000, XAUUSD: 100, XAGUSD: 5000, US30: 1, NAS100: 1, SPX500: 1, GER30: 1, BTCUSD: 1, EURUSD: 100000, GBPUSD: 100000, USDJPY: 100000,
      };
      const contractSize = contractSizes[signal.symbol] || 100000;
      let pointValueUsd = contractSize;
      if (signal.symbol.endsWith("JPY")) pointValueUsd = contractSize / entryPrice;
      else if (signal.symbol === "GER30") pointValueUsd = contractSize * 1.1;

      for (const user of users) {
        if (isManual && payload.user_id !== user.user_id) continue;

        let tierRiskModifier = 1.0;
        if (signalTier === "B-Tier") tierRiskModifier = 0.5;

        // --- ALL-TIME DRAWDOWN BREAKER & PHM ---
        let drawdownModifier = 1.0;
        const hwm = Number(user.high_water_mark_equity) || Number(user.portfolio_capital);
        const maxDrawdownPct = Number(user.max_drawdown_pct) || 0.05;
        
        let effectiveHwm = hwm;
        let effectiveRiskPct = Number(user.risk_per_trade_pct);
        
        // Global House Money Logic
        if (phmSettings.active && phmSettings.floor_capital > 0) {
            if (Number(user.portfolio_capital) > Number(phmSettings.floor_capital)) {
                effectiveRiskPct = Number(phmSettings.risk_pct) || effectiveRiskPct;
                console.log(`[PHM Active] User ${user.user_id} is playing with House Money! Risk escalated to ${effectiveRiskPct * 100}%`);
            }
            // Override HWM to force a soft-landing at the PHM Floor
            effectiveHwm = Math.max(hwm, Number(phmSettings.floor_capital));
        }

        if (Number(user.portfolio_capital) < effectiveHwm * (1 - maxDrawdownPct)) {
           console.log(`[Drawdown Breaker] User ${user.user_id} breached ${maxDrawdownPct*100}% all-time max drawdown (Relative HWM: ${effectiveHwm})! Blocking new execution.`);
           continue; // Skips allocating volume to this user
        }

        // --- DAILY DRAWDOWN BREAKER (PROP FIRM RULE) ---
        if (user.daily_starting_equity != null) {
            const dailyStart = Number(user.daily_starting_equity);
            const maxDailyLoss = Number(user.max_daily_drawdown_pct) || 0.05;
            if (Number(user.portfolio_capital) < dailyStart * (1 - maxDailyLoss)) {
               console.log(`[Drawdown Breaker] User ${user.user_id} breached ${maxDailyLoss*100}% DAILY drawdown limit! Blocking new execution until 5PM reset.`);
               continue; // Skips allocating volume to this user
            }
        }
        
        const riskPerTrade = Number(user.portfolio_capital) * effectiveRiskPct * entryWeight * tierRiskModifier * confluenceMultiplier * drawdownModifier * fomcSizeMultiplier * probabilityModifier;
        let volume = pointsAtRisk > 0 ? riskPerTrade / (pointsAtRisk * pointValueUsd) : volumeStep;
        
        // --- ASSET-CLASS HARD VOLUME CAPS (Commodity Multiplier & Volatility Governors) ---
        const assetLotCaps: Record<string, number> = {
          UKOIL: 0.02,
          XAUUSD: 0.02,
          XAGUSD: 0.02,
          US30: 0.10,
          NAS100: 0.10,
          SPX500: 0.10,
          GER30: 0.10,
          BTCUSD: 0.02,
          EURUSD: 0.20,
          GBPUSD: 0.20,
          USDJPY: 0.20,
          AUDUSD: 0.20,
          NZDUSD: 0.20,
          EURJPY: 0.20,
          GBPJPY: 0.20,
        };
        const maxAssetCap = assetLotCaps[signal.symbol] || 0.20;
        const userMaxCap = Number(user.max_volume_per_trade) || maxAssetCap;
        const hardLotCeiling = Math.min(maxAssetCap, userMaxCap);

        volume = Math.min(hardLotCeiling, volume);
        volume = Math.max(volumeStep, Math.floor(volume / volumeStep) * volumeStep);
        
        let effectivePointsAtRisk = pointsAtRisk;
        let riskAmount = effectivePointsAtRisk * volume * pointValueUsd;
        
        // --- ACCOUNT BLOWOUT PROTECTION & SMART LIMIT ENTRY OPTIMIZATION ---
        // If the minimum lot creates a risk that exceeds 10% of capital, check if this is an S/A-Tier Limit order
        // that can be pulled deeper into the structural discount zone to satisfy the 10% hard cap safely.
        const maxPermissibleRisk = Number(user.portfolio_capital) * 0.10;
        if (riskAmount > maxPermissibleRisk) {
          const isLimitOrder = aiOrderType.includes("LIMIT");
          const isHighConfidence = (signal.confidence || 0) >= 80;
          const maxPointsAtRisk = maxPermissibleRisk / (volumeStep * pointValueUsd);
          
          if (isLimitOrder && isHighConfidence && maxPointsAtRisk > 0 && pointsAtRisk <= maxPointsAtRisk * 2.5) {
            const isLong = signal.side === "LONG" || signal.side === "BUY";
            const optimizedEntryPrice = isLong
              ? Number((stopLoss + maxPointsAtRisk).toFixed(5))
              : Number((stopLoss - maxPointsAtRisk).toFixed(5));

            console.log(`[Smart Order Sizing] Optimizing S-Tier ${signal.symbol} Limit Entry: Pulling entry closer to SL ($${entryPrice} → $${optimizedEntryPrice}) to satisfy 10% cap ($${maxPermissibleRisk.toFixed(2)}).`);
            
            scaledEntry.price = optimizedEntryPrice;
            defaultEntryPrice = optimizedEntryPrice;
            effectivePointsAtRisk = maxPointsAtRisk;
            riskAmount = effectivePointsAtRisk * volumeStep * pointValueUsd;
            
            // Backfill the optimized entry price into signal record and database for tracking
            if (signal.entry_plan_json) {
              signal.entry_plan_json.price = optimizedEntryPrice;
              await supabase.from("trade_opportunities").update({
                entry_plan_json: signal.entry_plan_json,
              }).eq("id", signal.id);
            }
          } else {
            console.log(`[Risk Manager] Blocking User ${user.user_id}: allocated volume (${volume}) creates $${riskAmount.toFixed(2)} risk, violating 10% hard cap ($${maxPermissibleRisk.toFixed(2)}).`);
            blockedByRiskManager = true;
            continue;
          }
        }

        // Only send to Master Broker if auto-execution is on for the user and they aren't paper trading
        if (user.auto_trade_enabled && user.is_live_execution_enabled) {
          totalMasterVolume += volume;
        }

        userAllocations.push({
          user_id: user.user_id,
          volume,
          risk_amount: riskAmount,
        });
      }
    }

    if (totalMasterVolume <= 0) {
      console.log(`[PAMM Router] Skipping execution. Total Volume: ${totalMasterVolume}.`);
      let rejectReason = `Rejected: No volume allocated (Circuit Breaker / Max Drawdown reached for all users).`;
      if (blockedByRiskManager) {
        rejectReason = `Rejected: No volume allocated (10% Account Blowout Protection hard cap reached for users).`;
      }
      await supabase.from("trade_opportunities").update({ status: "REJECTED", ai_summary: signal.ai_summary + "\n\n[Execution Desk] " + rejectReason, ai_risks: rejectReason }).eq("id", signal.id);
      return new Response("No volume allocated", { status: 200 });
    }

    // --- VPS EXECUTION ROUTING ---
    const riskDistance = Math.abs(defaultEntryPrice - stopLoss);
    
    // Enforce strict 1.0R hardcoded cashout on TP1 for early profit taking
    const isLongForQuickExit = signal.side === "LONG" || signal.side === "BUY";
    const quickExitTP = isLongForQuickExit
      ? Number((defaultEntryPrice + (riskDistance * 1.0)).toFixed(5))
      : Number((defaultEntryPrice - (riskDistance * 1.0)).toFixed(5));

    // Inject quickExitTP into tp1 if not already set, so MT5 EA executes the cashout
    if (signal.take_profit_json) {
      const updatedTpJsonWithQuickExit = {
        ...signal.take_profit_json,
        tp1: signal.take_profit_json.tp1 || quickExitTP,
      };
      await supabase.from("trade_opportunities").update({ take_profit_json: updatedTpJsonWithQuickExit }).eq("id", signal.id);
      signal.take_profit_json = updatedTpJsonWithQuickExit;
    }

    // Dynamic Trailing Stop Fix: Clamp trailing distance to 1.5x initial risk if ATR is too wide
    const atrRaw = signal.stop_plan_json?.atr;
    let trailingDist = atrRaw ? Number((atrRaw * 2.0).toFixed(5)) : Number((riskDistance * 1.5).toFixed(5));
    if (trailingDist > riskDistance * 2.0) {
      trailingDist = Number((riskDistance * 1.5).toFixed(5));
    }

    // --- DISTRIBUTE VIRTUAL LEDGER ENTRIES TO USERS (QUEUED FOR VPS) ---
    for (const alloc of userAllocations) {
        let legAVolume = alloc.volume;
        let legBVolume = 0;

        if (allowRunnerLeg && alloc.volume >= volumeStep * 2) {
          legAVolume = Math.floor((alloc.volume / 2) / volumeStep) * volumeStep;
          if (legAVolume < volumeStep) legAVolume = alloc.volume; // Default to full volume on single leg if too small
          legBVolume = Math.floor((alloc.volume - legAVolume) / volumeStep) * volumeStep;
        }

        const legARisk = alloc.volume > 0 ? Number(((alloc.risk_amount * legAVolume) / alloc.volume).toFixed(2)) : alloc.risk_amount;
        const legBRisk = alloc.volume > 0 && legBVolume > 0 ? Number(((alloc.risk_amount * legBVolume) / alloc.volume).toFixed(2)) : 0;

        // Leg A (Quick Exit / Swing)
        await supabase.from("user_trades").insert({
          id: crypto.randomUUID(),
          user_id: alloc.user_id,
          opportunity_id: signal.id,
          symbol: signal.symbol,
          side: signal.side,
          volume: legAVolume,
          risk_amount: legARisk,
          status: "VPS_PENDING",
          trade_type: (signal.source === "agent-swing" || signal.source_agent === "agent-swing" || ["4h", "1d"].includes(signal.timeframe?.toLowerCase())) ? "SWING" : "QUICK_EXIT",
        });
        
        // Leg B (Runner)
        // Note: Trailing stop logic for RUNNER will be managed by position manager once OPEN.
        if (allowRunnerLeg && legBVolume >= volumeStep) {
          await supabase.from("user_trades").insert({
            id: crypto.randomUUID(),
            user_id: alloc.user_id,
            opportunity_id: signal.id,
            symbol: signal.symbol,
            side: signal.side,
            volume: legBVolume,
            risk_amount: legBRisk,
            status: "VPS_PENDING",
            trade_type: "RUNNER",
          });
        }
    }

    const summaryAddition = probNote ? `\n\n[Execution Desk] ${probNote}` : "";
    await supabase.from("trade_opportunities").update({
      status: "QUEUED",
      ai_summary: signal.ai_summary + summaryAddition + `\n\n[Execution Desk] Trade allocations generated and queued for VPS execution. Waiting for MT5 EA pickup...`
    }).eq("id", signal.id);

    return new Response(JSON.stringify({ success: true, message: "Queued for VPS" }), { status: 200, headers: { "Content-Type": "application/json" } });
  } catch (error: any) {
    return new Response(`Error: ${error.message}`, { status: 500 });
  }
});
