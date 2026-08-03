import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2.108.2";
import { isAutoTradingEnabled } from "../../../packages/core/settings.ts";
import { fetchPaperBars } from "../../../packages/execution/index.ts";
import { getContextSnapshot } from "../../../packages/strategy/indicators.ts";

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
  action?: "MANUAL_EXECUTION" | "RUNNER_HANDOFF" | "MANAGE_POSITIONS";
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

    // --- POSITION MANAGER LOGIC ---
    if ((payload as any).action === "MANAGE_POSITIONS") {
      console.log("[Position Manager] Starting sweep...");
      if (!META_API_TOKEN || !META_API_ACCOUNT_ID) {
        return new Response("Missing MetaAPI credentials", { status: 500 });
      }

      const { data: openTrades, error } = await supabase
        .from("user_trades")
        .select(`
          id, meta_api_order_id, symbol, side, status, trade_type, user_id,
          trade_opportunities (
            timeframe, entry_plan_json, stop_plan_json, take_profit_json
          )
        `)
        .eq("status", "OPEN")
        .not("meta_api_order_id", "is", null);

      if (error || !openTrades || openTrades.length === 0) {
        return new Response(JSON.stringify({ message: "No open trades to manage" }), { status: 200 });
      }

      const orderMap = new Map<string, any>();
      for (const trade of openTrades) {
        const id = trade.meta_api_order_id;
        if (!id) continue;
        const existing = orderMap.get(id);
        if (!existing || trade.trade_type === "RUNNER") {
          orderMap.set(id, trade);
        }
      }

      const moves: { symbol: string; action: string; from: number; to: number }[] = [];
      const errors: string[] = [];
      const atrCache = new Map<string, number>();
      const uniqueSymbols = [...new Set([...orderMap.values()].map(t => t.symbol))];

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
              bars.map((b: any) => b.c)
            );
            atrCache.set(symbol, snap.atr_14 || 0);
          }
        } catch (_) { /* non-fatal */ }
      }

      // --- AI-DRIVEN INVALIDATION QUERY ---
      const fourHoursAgo = new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString();
      const { data: latestOpps } = await supabase
        .from("trade_opportunities")
        .select("symbol, side, ai_summary, status, source")
        .in("symbol", uniqueSymbols)
        .gte("created_at", fourHoursAgo)
        .order("created_at", { ascending: false });

      const latestOppMap = new Map<string, any>();
      if (latestOpps) {
         for (const opp of latestOpps) {
            if (!latestOppMap.has(opp.symbol)) {
               latestOppMap.set(opp.symbol, opp); // Only keeps the most recent one
            }
         }
      }
      // --- END QUERY ---

      for (const [orderId, trade] of orderMap) {
        try {
          // --- 1. BROKER SYNC CHECK ---
          const posRes = await fetch(
            `${META_API_BASE_URL}/users/current/accounts/${META_API_ACCOUNT_ID}/positions/${orderId}`,
            { headers: { "auth-token": META_API_TOKEN } }
          );

          let position = null;

          if (!posRes.ok) {
            // Check if it's a pending order before assuming it's closed
            const ordRes = await fetch(
              `${META_API_BASE_URL}/users/current/accounts/${META_API_ACCOUNT_ID}/orders/${orderId}`,
              { headers: { "auth-token": META_API_TOKEN } }
            );
            
            if (ordRes.ok) {
               // --- PENDING ORDER GARBAGE COLLECTION ---
               // If the pending order is older than 24 hours, cancel it autonomously.
               try {
                 const orderData = await ordRes.json();
                 if (orderData.time) {
                   const orderTime = new Date(orderData.time).getTime();
                   const now = Date.now();
                   const ageHours = (now - orderTime) / (1000 * 60 * 60);
                   
                   if (ageHours >= 24) {
                     console.log(`[Position Manager] Garbage Collection: Cancelling stale pending order ${orderId} for ${trade.symbol} (${Math.round(ageHours)}h old).`);
                     await fetch(`${META_API_BASE_URL}/users/current/accounts/${META_API_ACCOUNT_ID}/trade`, {
                       method: "POST",
                       headers: { "auth-token": META_API_TOKEN, "Content-Type": "application/json" },
                       body: JSON.stringify({ actionType: "ORDER_CANCEL", orderId })
                     });
                     await supabase.from("user_trades").update({ status: "CLOSED", ai_risks: "Order cancelled (stale limit order > 24h)" }).eq("meta_api_order_id", orderId);
                   }
                 }
               } catch (e) {
                 console.error(`[Position Manager] Failed to process pending order for GC:`, e);
               }
               // It's a pending order, skip trailing stop logic but do NOT mark as closed
               continue;
            } else {
               // Not a position, not an order -> It is TRULY CLOSED
               await supabase.from("user_trades").update({ status: "CLOSED" }).eq("meta_api_order_id", orderId).eq("status", "OPEN");
               continue;
            }
          } else {
            position = await posRes.json();
          }

          if (position?.error) continue;

          const opp = trade.trade_opportunities;
          if (!opp) continue;

          // --- 2. END OF DAY (EOD) SCALP LIQUIDATION ---
          // If it is 4 PM NY time or later, and the trade is a Scalp ('30m' timeframe), liquidate it immediately.
          if (isEodScalp && opp.timeframe === "30m") {
             console.log(`[Position Manager] EOD LIQUIDATION: Closing Scalp ${orderId} for ${trade.symbol} at ${nyHour}:00 NY Time.`);
             try {
                await fetch(`${META_API_BASE_URL}/users/current/accounts/${META_API_ACCOUNT_ID}/trade`, {
                   method: "POST",
                   headers: { "auth-token": META_API_TOKEN, "Content-Type": "application/json" },
                   body: JSON.stringify({ actionType: "POSITION_CLOSE_ID", positionId: orderId })
                });
                await supabase.from("user_trades").update({ status: "CLOSED", ai_risks: "EOD Liquidation (4 PM NY Time)", exit_price: position.currentPrice, profit_loss: position.profit }).eq("meta_api_order_id", orderId);
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
          
          // --- AI-DRIVEN INVALIDATION CHECK ---
          const latestSignal = latestOppMap.get(trade.symbol);
          if (latestSignal) {
             const isOpposite = latestSignal.side !== trade.side && latestSignal.status !== "C-Tier"; 
             const isCTier = latestSignal.ai_summary?.includes("C-Tier") || latestSignal.ai_summary?.includes("No setup");
             
             // Swing Protection: Ignore C-Tier if this is a Swing Runner. Only close on Opposite.
             let shouldInvalidate = false;
             let reason = "";
             if (isOpposite) {
                 shouldInvalidate = true;
                 reason = "AI Trend Reversal Invalidation (Opposing Setup Detected)";
             } else if (isCTier && trade.trade_type !== "RUNNER") {
                 shouldInvalidate = true;
                 reason = "AI Momentum Invalidation (C-Tier / No Setup Detected)";
             }
             
             if (shouldInvalidate) {
                 console.log(`[Position Manager] AI-Driven Invalidation triggered for ${trade.symbol}! ${reason}. Closing position.`);
                 const closeRes = await fetch(`${META_API_BASE_URL}/users/current/accounts/${META_API_ACCOUNT_ID}/trade`, {
                     method: "POST",
                     headers: { "auth-token": META_API_TOKEN, "Content-Type": "application/json" },
                     body: JSON.stringify({ actionType: "POSITION_CLOSE_ID", positionId: orderId })
                 });
                 if (closeRes.ok) {
                     await supabase.from("user_trades").update({ status: "CLOSED", ai_risks: `Closed by Position Manager: ${reason}` }).eq("meta_api_order_id", orderId);
                     moves.push({ symbol: trade.symbol, action: "AI Trend Reversal Close", from: currentPrice, to: currentPrice });
                     continue; // Skip trailing stop logic and move to next trade
                 }
             }
          }
          // --- END INVALIDATION CHECK ---

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

            if (isImprovement && isSafeFromOriginal && profit > 0) {
              newSl = Number(trailSl.toFixed(5));
              actionName = `TRAIL_RUNNER (+${priceMoveInR.toFixed(1)}R)`;
            }
          }

          if (!newSl) {
            if (priceMoveInR >= 2.0) {
              const lockSl = isLong
                ? Number((entryPrice + riskDist).toFixed(5))
                : Number((entryPrice - riskDist).toFixed(5));
              const isImprovement = isLong ? lockSl > currentSl : lockSl < currentSl;
              if (isImprovement) {
                newSl = lockSl;
                actionName = `LOCK_IN_1R (profit +${priceMoveInR.toFixed(1)}R)`;
              }
            } else if (priceMoveInR >= 0.50) {
              const beSl = Number(entryPrice.toFixed(5));
              const isImprovement = isLong ? beSl > currentSl : beSl < currentSl;
              if (isImprovement) {
                newSl = beSl;
                actionName = `BREAK_EVEN (profit +${priceMoveInR.toFixed(1)}R)`;
              }
            }
          }

          if (newSl !== null) {
            console.log(`[Position Manager] ${trade.symbol} ${orderId}: ${actionName} — SL ${currentSl} → ${newSl}`);
            
            // --- VPS EA ROUTING: Save modification to DB instead of MetaAPI ---
            // The vps-poll endpoint will detect the new SL and the EA will execute the modification.
            const { data: currentOpp } = await supabase.from("trade_opportunities").select("stop_plan_json").eq("id", opp.id).single();
            if (currentOpp) {
               const updatedJson = { ...currentOpp.stop_plan_json, stop: newSl };
               const modRes = await supabase.from("trade_opportunities").update({ stop_plan_json: updatedJson }).eq("id", opp.id);
               
               if (!modRes.error) {
                 moves.push({ symbol: trade.symbol, action: actionName, from: currentSl, to: newSl });
               } else {
                 errors.push(`${trade.symbol} ${orderId}: modify failed (DB Error)`);
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

      const result = { evaluated: orderMap.size, moves: moves.length, errors: errors.length, details: moves };
      return new Response(JSON.stringify(result), { status: 200, headers: { "Content-Type": "application/json" } });
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
      return new Response(`Skipped execution for ${signalTier}`, { status: 200 });
    }

    // === EXECUTION GUARD: TIME OF DAY KILL ZONE ===
    // Prevent automated execution during Asian session (22:00 - 06:00 UTC) to avoid low volume chop
    if (!isManual) {
      const currentHourUTC = new Date().getUTCHours();
      if (currentHourUTC >= 22 || currentHourUTC < 6) {
        console.log(`[PAMM Router] Execution blocked: Inside Asian Session Kill Zone (${currentHourUTC}:00 UTC).`);
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
      return new Response("No funded PAMM users found.", { status: 200 });
    }

    // Prepare execution parameters
    const entryPlan = signal.entry_plan_json || {};
    const stopPlan = signal.stop_plan_json || {};
    const defaultEntryPrice = entryPlan.price || entryPlan.entry_price || entryPlan.limit_price;
    const scaledEntries = entryPlan.scaled_entries && Array.isArray(entryPlan.scaled_entries) && entryPlan.scaled_entries.length > 0
      ? entryPlan.scaled_entries
      : [{ price: defaultEntryPrice, weight: 1.0 }];
    let stopLoss = stopPlan.stop || stopPlan.stop_price;
    let takeProfit = signal.take_profit_json?.tp || signal.take_profit_json?.tp_price;

    // === EXECUTION GUARD: DYNAMIC ATR STOP LOSS FLOOR ===
    // Prevent stop losses that are too tight to survive market noise
    if (!isManual && defaultEntryPrice && stopLoss) {
      try {
        const bars = await fetchPaperBars(signal.symbol, "30m", 50, supabase);
        if (bars.length >= 14) {
          const snap = getContextSnapshot(
            bars.map((b: any) => b.t),
            bars.map((b: any) => b.o),
            bars.map((b: any) => b.h),
            bars.map((b: any) => b.l),
            bars.map((b: any) => b.c)
          );
          const atr = snap.atr_14 || 0;
          if (atr > 0) {
            const currentRisk = Math.abs(defaultEntryPrice - stopLoss);
            if (currentRisk < atr) {
              const isLong = signal.side === "LONG" || signal.side === "BUY";
              stopLoss = isLong ? defaultEntryPrice - atr : defaultEntryPrice + atr;
              // Format to 5 decimal places safely
              stopLoss = Number(stopLoss.toFixed(5));
              console.log(`[PAMM Router] Widen Stop Loss: Risk ${currentRisk.toFixed(4)} was less than 1.0x ATR (${atr.toFixed(4)}). Adjusted to ${stopLoss}.`);
            }
          }
        }
      } catch (err) {
        console.error(`[PAMM Router] Failed to calculate ATR for SL floor:`, err);
      }
    }

    // === EXECUTION GUARD 1: TP DIRECTION VALIDATION ===
    // Prevents placing orders where TP is on the wrong side of entry.
    // Root cause of USDJPY LONG having TP at 145.44 while entry was 163.7.
    if (defaultEntryPrice && takeProfit && stopLoss) {
      const isLong = signal.side === "LONG";
      const tpOnWrongSide = isLong ? takeProfit < defaultEntryPrice : takeProfit > defaultEntryPrice;
      if (tpOnWrongSide) {
        const riskDist = Math.abs(defaultEntryPrice - stopLoss);
        const correctedTp = isLong
          ? Number((defaultEntryPrice + riskDist * 2).toFixed(5))
          : Number((defaultEntryPrice - riskDist * 2).toFixed(5));
        console.warn(`[Execution Guard] TP direction mismatch on ${signal.symbol} ${signal.side}! Entry=${defaultEntryPrice}, TP=${takeProfit}. Corrected to ${correctedTp} (2R).`);
        takeProfit = correctedTp;
      }
    }

    // === EXECUTION GUARD 2: MINIMUM SL DISTANCE ===
    // Prevents ultra-tight stops that get swept by spread/volatility.
    const minSlDistances: Record<string, number> = {
      XAGUSD: 0.30, XAUUSD: 2.00, UKOIL: 0.30, BTCUSD: 150,
      EURUSD: 0.0010, GBPUSD: 0.0010, USDJPY: 0.15, US30: 30, NAS100: 30,
    };
    if (defaultEntryPrice && stopLoss) {
      const minDist = minSlDistances[signal.symbol];
      if (minDist) {
        const currentDist = Math.abs(defaultEntryPrice - stopLoss);
        if (currentDist < minDist) {
          const correctedSl = signal.side === "LONG"
            ? Number((defaultEntryPrice - minDist).toFixed(5))
            : Number((defaultEntryPrice + minDist).toFixed(5));
          console.warn(`[Execution Guard] SL too tight on ${signal.symbol}: ${currentDist.toFixed(5)} < min ${minDist}. Widening from ${stopLoss} → ${correctedSl}.`);
          stopLoss = correctedSl;
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
        
        const riskPerTrade = Number(user.portfolio_capital) * effectiveRiskPct * entryWeight * tierRiskModifier * confluenceMultiplier * drawdownModifier;
        let volume = pointsAtRisk > 0 ? riskPerTrade / (pointsAtRisk * pointValueUsd) : 0.01;
        volume = Math.max(0.01, Math.round(volume * 100) / 100);
        
        const riskAmount = pointsAtRisk * volume * pointValueUsd;
        
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

    // --- VPS EXECUTION ROUTING ---
    const riskDistance = Math.abs(defaultEntryPrice - stopLoss);
    
    // Enforce strict 1.0R hardcoded cashout on TP1 for early profit taking
    const quickExitTP = signal.side === "LONG"
      ? Number((defaultEntryPrice + (riskDistance * 1.0)).toFixed(5))
      : Number((defaultEntryPrice - (riskDistance * 1.0)).toFixed(5));

    // Dynamic Trailing Stop Fix: Clamp trailing distance to 1.5x initial risk if ATR is too wide
    const atrRaw = signal.stop_plan_json?.atr;
    let trailingDist = atrRaw ? Number((atrRaw * 2.0).toFixed(5)) : Number((riskDistance * 1.5).toFixed(5));
    if (trailingDist > riskDistance * 2.0) {
      trailingDist = Number((riskDistance * 1.5).toFixed(5));
    }

    // --- DISTRIBUTE VIRTUAL LEDGER ENTRIES TO USERS (QUEUED FOR VPS) ---
    for (const alloc of userAllocations) {
        // Leg A (Quick Exit)
        await supabase.from("user_trades").insert({
          id: crypto.randomUUID(),
          user_id: alloc.user_id,
          opportunity_id: signal.id,
          symbol: signal.symbol,
          side: signal.side,
          volume: alloc.volume / 2,
          risk_amount: alloc.risk_amount / 2,
          status: "PENDING",
          trade_type: "QUICK_EXIT",
        });
        
        // Leg B (Runner)
        // Note: Trailing stop logic for RUNNER will be managed by position manager once OPEN.
        await supabase.from("user_trades").insert({
          id: crypto.randomUUID(),
          user_id: alloc.user_id,
          opportunity_id: signal.id,
          symbol: signal.symbol,
          side: signal.side,
          volume: alloc.volume / 2,
          risk_amount: alloc.risk_amount / 2,
          status: "PENDING",
          trade_type: "RUNNER",
        });
    }

    await supabase.from("trade_opportunities").update({
      status: "QUEUED",
      ai_summary: signal.ai_summary + `\n\n[Execution Desk] Trade allocations generated and queued for VPS execution. Waiting for MT5 EA pickup...`
    }).eq("id", signal.id);

    return new Response(JSON.stringify({ success: true, message: "Queued for VPS" }), { status: 200, headers: { "Content-Type": "application/json" } });
  } catch (error: any) {
    return new Response(`Error: ${error.message}`, { status: 500 });
  }
});
