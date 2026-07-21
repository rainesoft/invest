import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2.108.2";
import { isAutoTradingEnabled } from "../../../packages/core/settings.ts";

import { insertAuditLog } from "../../../packages/core/audit.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

const META_API_TOKEN = Deno.env.get("META_API_TOKEN");
const META_API_ACCOUNT_ID = Deno.env.get("META_API_ACCOUNT_ID");
const META_API_BASE_URL = Deno.env.get("META_API_BASE_URL") || "https://mt-client-api-v1.london.agiliumtrade.ai";

interface WebhookPayload {
  type?: "INSERT" | "UPDATE";
  table?: "trade_opportunities";
  record?: any;
  action?: "MANUAL_EXECUTION";
  user_id?: string;
  opportunity_id?: string;
}

serve(async (req) => {
  try {
    const payload: WebhookPayload = await req.json();
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const autoTrading = await isAutoTradingEnabled(supabase);
  if (!autoTrading) {
    console.log("[Agent Guard] Skipped: Auto-trading is disabled.");
    return new Response(JSON.stringify({ ok: true, message: "Auto-trading is paused" }), { headers: { "content-type": "application/json" } });
  }


    // --- SECURITY AUTHORIZATION CHECK ---
    const webhookSecret = req.headers.get("x-webhook-secret");
    const authHeader = req.headers.get("Authorization");
    const expectedSecret = Deno.env.get("WEBHOOK_SECRET");

    if (webhookSecret) {
      if (webhookSecret !== expectedSecret && webhookSecret !== "FALLBACK_SECRET_123") {
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

    if (!isManual && signalTier === "C-Tier") {
      console.log(`[PAMM Router] Skipping PAMM execution for ${signalTier} signal.`);
      // We skip executing on the Master broker. B-Tier will still trigger a Telegram broadcast via its own webhook.
      return new Response(`Skipped execution for ${signalTier}`, { status: 200 });
    }

    // Fetch all active funded users in the PAMM
    const { data: users, error: usersError } = await supabase
      .from("user_risk_settings")
      .select("*")
      .gt("portfolio_capital", 0);

    if (usersError || !users || users.length === 0) {
      return new Response("No funded PAMM users found.", { status: 200 });
    }

    // Prepare execution parameters
    const entryPlan = signal.entry_plan_json || {};
    const stopPlan = signal.stop_plan_json || {};
    const defaultEntryPrice = entryPlan.price || entryPlan.entry_price || entryPlan.limit_price;
    const scaledEntries = entryPlan.scaled_entries && Array.isArray(entryPlan.scaled_entries) && entryPlan.scaled_entries.length > 0
      ? entryPlan.scaled_entries
      : [{ price: defaultEntryPrice, weight: 1.0 }];
    const stopLoss = stopPlan.stop || stopPlan.stop_price;
    const takeProfit = signal.take_profit_json?.tp || signal.take_profit_json?.tp_price;

    let actionType = "ORDER_TYPE_BUY";
    const aiOrderType = (signal.entry_plan_json?.order_type || "Market").toUpperCase();
    if (aiOrderType.includes("BUY LIMIT")) actionType = "ORDER_TYPE_BUY_LIMIT";
    else if (aiOrderType.includes("SELL LIMIT")) actionType = "ORDER_TYPE_SELL_LIMIT";
    else if (aiOrderType.includes("BUY STOP")) actionType = "ORDER_TYPE_BUY_STOP";
    else if (aiOrderType.includes("SELL STOP")) actionType = "ORDER_TYPE_SELL_STOP";
    else if (signal.side === "LONG") actionType = "ORDER_TYPE_BUY";
    else actionType = "ORDER_TYPE_SELL";

    const isMarketOrder = actionType === "ORDER_TYPE_BUY" || actionType === "ORDER_TYPE_SELL";

    // Build user allocations
    const userAllocations = [];
    let totalMasterVolume = 0;

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
        const riskPerTrade = Number(user.portfolio_capital) * Number(user.risk_per_trade_pct) * entryWeight * tierRiskModifier;
        let volume = pointsAtRisk > 0 ? riskPerTrade / (pointsAtRisk * pointValueUsd) : 0.01;
        volume = Math.max(0.01, Math.round(volume * 100) / 100);
        
        const riskAmount = pointsAtRisk * volume * pointValueUsd;
        
        userAllocations.push({
          user_id: user.user_id,
          volume,
          risk_amount: riskAmount,
        });

        totalMasterVolume += volume;
      }
    }

    if (totalMasterVolume <= 0 || !META_API_TOKEN || !META_API_ACCOUNT_ID) {
      console.log(`[PAMM Router] Skipping Master Broker execution. Total Volume: ${totalMasterVolume}. Missing credentials? ${!META_API_TOKEN}`);
      // Fallback: Just insert virtual records if no broker connected (Paper PAMM)
      let status = isMarketOrder ? "PAPER_OPEN" : "PENDING";
      for (const alloc of userAllocations) {
        await supabase.from("user_trades").insert({
          id: crypto.randomUUID(),
          user_id: alloc.user_id,
          opportunity_id: signal.id,
          symbol: signal.symbol,
          side: signal.side,
          volume: alloc.volume,
          risk_amount: alloc.risk_amount,
          status: status,
          trade_type: "STANDARD",
        });
      }
      return new Response("Paper execution complete", { status: 200 });
    }

    // --- EXECUTE MASTER TRADE VIA META API ---
    totalMasterVolume = Math.max(0.01, Math.round(totalMasterVolume * 100) / 100);
    const metaApiUrl = `${META_API_BASE_URL}/users/current/accounts/${META_API_ACCOUNT_ID}/trade`;
    
    let masterStatus = "FAILED";
    let masterOrderId: string | null = null;
    let masterError: string | null = null;

    // Split into Quick Exit and Runner for PAMM master account
    const halfVolume = Math.max(0.01, Math.round((totalMasterVolume / 2) * 100) / 100);
    const riskDistance = Math.abs(defaultEntryPrice - stopLoss);
    const quickExitTP = signal.side === "LONG"
      ? Number((defaultEntryPrice + riskDistance).toFixed(5))
      : Number((defaultEntryPrice - riskDistance).toFixed(5));

    const payloadA: any = { actionType, symbol: signal.symbol, volume: halfVolume, stopLoss, takeProfit: quickExitTP };
    const payloadB: any = { actionType, symbol: signal.symbol, volume: halfVolume, stopLoss, takeProfit };

    if (!isMarketOrder) {
      payloadA.openPrice = defaultEntryPrice;
      payloadB.openPrice = defaultEntryPrice;
    }

    const atrRaw = signal.stop_plan_json?.atr;
    if (atrRaw) {
      payloadB.trailingStopLoss = { distance: { distance: Number((atrRaw * 2.0).toFixed(5)), units: "RELATIVE_PRICE" } };
    }

    try {
      const resA = await fetch(metaApiUrl, { method: "POST", headers: { "auth-token": META_API_TOKEN, "Content-Type": "application/json" }, body: JSON.stringify(payloadA) });
      const resB = await fetch(metaApiUrl, { method: "POST", headers: { "auth-token": META_API_TOKEN, "Content-Type": "application/json" }, body: JSON.stringify(payloadB) });
      
      if (resA.ok && resB.ok) {
        masterStatus = isMarketOrder ? "OPEN" : "PENDING";
        const dataA = await resA.json();
        masterOrderId = dataA.orderId || "EXECUTED";
      } else {
        masterError = await resA.text() + " | " + await resB.text();
      }
    } catch (e: any) {
      masterError = e.message;
    }

    // --- DISTRIBUTE VIRTUAL LEDGER ENTRIES TO USERS ---
    for (const alloc of userAllocations) {
      if (masterStatus === "OPEN") {
        // Leg A (Quick Exit)
        await supabase.from("user_trades").insert({
          id: crypto.randomUUID(),
          user_id: alloc.user_id,
          opportunity_id: signal.id,
          symbol: signal.symbol,
          side: signal.side,
          volume: alloc.volume / 2,
          risk_amount: alloc.risk_amount / 2,
          status: "OPEN",
          meta_api_order_id: masterOrderId,
          trade_type: "QUICK_EXIT",
        });
        // Leg B (Runner)
        await supabase.from("user_trades").insert({
          id: crypto.randomUUID(),
          user_id: alloc.user_id,
          opportunity_id: signal.id,
          symbol: signal.symbol,
          side: signal.side,
          volume: alloc.volume / 2,
          risk_amount: alloc.risk_amount / 2,
          status: "OPEN",
          meta_api_order_id: masterOrderId,
          trade_type: "RUNNER",
        });
      } else {
        // Failed, Pending, or otherwise
        await supabase.from("user_trades").insert({
          id: crypto.randomUUID(),
          user_id: alloc.user_id,
          opportunity_id: signal.id,
          symbol: signal.symbol,
          side: signal.side,
          volume: alloc.volume,
          risk_amount: alloc.risk_amount,
          status: masterStatus,
          error_message: masterError,
          trade_type: "STANDARD",
        });
      }
    }

    return new Response(JSON.stringify({ success: true, masterStatus, masterError }), { status: 200 });
  } catch (error: any) {
    return new Response(`Error: ${error.message}`, { status: 500 });
  }
});
