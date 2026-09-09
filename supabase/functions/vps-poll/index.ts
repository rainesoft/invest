import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2.108.2";

async function computeHash(input: string) {
  const data = new TextEncoder().encode(input);
  const buf = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function insertAudit(supabase: any, entry: { action: string; entity_type?: string; entity_id?: string; actor_id?: string; payload_json?: Record<string, any> }) {
  try {
    const { data: last } = await supabase
      .from("audit_log")
      .select("hash")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const prevHash = last?.hash ?? "";
    const hash = await computeHash(prevHash + JSON.stringify(entry));

    const record: any = {
      actor_type: "SYSTEM",
      action: entry.action,
      entity_type: entry.entity_type || "system",
      payload_json: entry.payload_json || {},
      hash,
    };
    if (entry.entity_id && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(entry.entity_id)) {
      record.entity_id = entry.entity_id;
    }
    if (entry.actor_id && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(entry.actor_id)) {
      record.actor_id = entry.actor_id;
    }

    await supabase.from("audit_log").insert(record);
  } catch (err) {
    console.error("[VPS Poll] Failed to insert audit log:", err);
  }
}

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
    const nowIso = new Date().toISOString();
    await supabase.from("user_risk_settings").update({ vps_last_heartbeat: nowIso }).neq("user_id", "00000000-0000-0000-0000-000000000000");

    // 1b. Ground-Truth Master Broker Balance Auto-Sync (Deposits, Withdrawals, Realized PnL)
    const rawBalance = url.searchParams.get("balance");
    const rawEquity = url.searchParams.get("equity");
    const rawFreeMargin = url.searchParams.get("free_margin");

    if (rawBalance && !isNaN(Number(rawBalance)) && Number(rawBalance) > 0) {
      const reportedBalance = Number(Number(rawBalance).toFixed(2));
      const reportedEquity = rawEquity && !isNaN(Number(rawEquity)) ? Number(Number(rawEquity).toFixed(2)) : reportedBalance;
      const reportedFreeMargin = rawFreeMargin && !isNaN(Number(rawFreeMargin)) ? Number(Number(rawFreeMargin).toFixed(2)) : reportedBalance;

      const { data: masterAccounts } = await supabase
        .from("user_risk_settings")
        .select("id, user_id, portfolio_capital, daily_starting_equity, high_water_mark_equity")
        .eq("is_master_account", true);

      if (masterAccounts && masterAccounts.length > 0) {
        for (const master of masterAccounts) {
          const prevCapital = Number(master.portfolio_capital || 0);
          const capitalDelta = reportedBalance - prevCapital;

          // Reconcile if difference is at least 1 cent
          if (Math.abs(capitalDelta) >= 0.01) {
            const currentDailyStart = Number(master.daily_starting_equity || prevCapital);
            const currentHwm = Number(master.high_water_mark_equity || prevCapital);

            // Step up daily_starting_equity on deposits to prevent false daily drawdown alarms
            const updatedDailyStart = reportedBalance > currentDailyStart ? reportedBalance : currentDailyStart;
            const updatedHwm = Math.max(currentHwm, reportedBalance);

            await supabase
              .from("user_risk_settings")
              .update({
                portfolio_capital: reportedBalance,
                daily_starting_equity: updatedDailyStart,
                high_water_mark_equity: updatedHwm,
                updated_at: nowIso,
              })
              .eq("id", master.id);

            if (Math.abs(capitalDelta) >= 1.00) {
              await insertAudit(supabase, {
                action: "BROKER_BALANCE_AUTO_SYNC",
                entity_type: "user_risk_settings",
                entity_id: master.id,
                actor_id: master.user_id,
                payload_json: {
                  previous_capital: prevCapital,
                  new_capital: reportedBalance,
                  delta: Number(capitalDelta.toFixed(2)),
                  equity: reportedEquity,
                  free_margin: reportedFreeMargin,
                  source: "VPS_HEARTBEAT",
                  reason: capitalDelta > 0 ? "Deposit / Realized Profit Detected" : "Withdrawal / Realized Loss Reconciled",
                },
              });
              console.log(`[VPS Poll] Auto-synced Master Account ${master.user_id.slice(0, 8)} Capital from $${prevCapital.toFixed(2)} to $${reportedBalance.toFixed(2)} (Delta: $${capitalDelta.toFixed(2)})`);
            }
          }
        }
      }

      // Update Treasury Status with live broker metrics
      const { data: currentTreasury } = await supabase
        .from("system_settings")
        .select("value")
        .eq("key", "treasury_status")
        .maybeSingle();

      let currentSolvencyRatio = 2.98;
      if (currentTreasury?.value) {
        const parsed = typeof currentTreasury.value === "string" ? JSON.parse(currentTreasury.value) : currentTreasury.value;
        currentSolvencyRatio = Number(parsed.solvency_ratio || 2.98);
      }

      await supabase
        .from("system_settings")
        .upsert({
          key: "treasury_status",
          value: JSON.stringify({
            is_solvent: true,
            updated_at: nowIso,
            free_margin: reportedFreeMargin,
            solvency_ratio: currentSolvencyRatio,
          }),
        });
    }

    // 2. Fetch HFT bias (Permanently locked to NEUTRAL to disable unmanaged HFT_NATIVE blind scalps)
    const currentBias = "NEUTRAL";

    // 3. Fetch pending and open trades for the VPS
    const { data: activeTrades, error: fetchError } = await supabase
      .from("user_trades")
      .select(`
        id, symbol, side, volume, trade_type, status, meta_api_order_id, opportunity_id,
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
        if (["US30", "NAS100", "SPX500", "GER30", "BTCUSD", "ETHUSD", "XAUUSD", "XAGUSD", "UKOIL", "USOIL", "AAPL", "MSFT", "NVDA", "AMZN", "TSLA", "META", "GOOGL"].includes(sym)) return 2;
        if (sym === "JP225") return 1;
        if (sym.endsWith("JPY")) return 3;
        return 5;
      };
      const decimals = getDecimals(trade.symbol);
      
      let safeEntry = entryPrice > 0 ? Number(entryPrice.toFixed(decimals)) : 0;
      let safeSl = stopLossRaw > 0 ? Number(stopLossRaw.toFixed(decimals)) : 0;
      let safeTp = targetTP > 0 ? Number(targetTP.toFixed(decimals)) : 0;
      let safeVolume = Number(trade.volume.toFixed(2));

      // Check for Companion Quick Exit Breakeven Lock on RUNNER legs
      if (trade.trade_type === "RUNNER" && trade.status === "OPEN" && trade.opportunity_id) {
        const { data: qeLeg } = await supabase
          .from("user_trades")
          .select("status, profit_usd")
          .eq("opportunity_id", trade.opportunity_id)
          .eq("trade_type", "QUICK_EXIT")
          .maybeSingle();

        if (qeLeg?.status === "WON") {
          // Breakeven Lock: Set SL to entry price
          safeSl = safeEntry;
        }
      }

      // Validate SL and TP direction strictly (Error 10016 Prevention)
      if (safeEntry > 0) {
        const isLong = trade.side === "LONG" || trade.side === "BUY";
        const effRisk = riskDistance > 0 ? riskDistance : (safeEntry * 0.005);

        // Validate SL direction for fresh pending orders (allow trailing/profit SL for OPEN trades)
        if (trade.status === "VPS_PENDING" && safeSl > 0) {
          if (isLong && safeSl >= safeEntry) {
            safeSl = Number((safeEntry - effRisk).toFixed(decimals));
          } else if (!isLong && safeSl <= safeEntry) {
            safeSl = Number((safeEntry + effRisk).toFixed(decimals));
          }
        }

        // Validate TP direction unconditionally
        if (safeTp > 0) {
          if (isLong && safeTp <= safeEntry) {
            safeTp = Number((safeEntry + (effRisk * 1.75)).toFixed(decimals));
          } else if (!isLong && safeTp >= safeEntry) {
            safeTp = Number((safeEntry - (effRisk * 1.75)).toFixed(decimals));
          }
        }
      }

      const CANONICAL_TO_BROKER_SYMBOLS: Record<string, string> = {
        SPX500: "US500",
        NAS100: "USTEC",
        GER30: "DE30",
        GER40: "DE30",
        JP225: "JP225",
        US30: "US30",
        UKOIL: "UKOIL",
        USOIL: "USOIL",
        BTCUSD: "BTCUSD",
        ETHUSD: "ETHUSD",
        AAPL: "AAPL",
        MSFT: "MSFT",
        NVDA: "NVDA",
        AMZN: "AMZN",
        TSLA: "TSLA",
        META: "META",
        GOOGL: "GOOGL",
      };
      const brokerSymbol = CANONICAL_TO_BROKER_SYMBOLS[trade.symbol] || trade.symbol;

      const orderType = opp?.entry_plan_json?.order_type || (trade.side === "LONG" ? "BUY MARKET" : "SELL MARKET");
      let action = "MODIFY";
      if (trade.status === "VPS_PENDING") action = "EXECUTE";
      else if (trade.status === "VPS_CLOSE") action = "CLOSE";
      const ticket = trade.meta_api_order_id || "0";

      // Format: ID,SYMBOL,SIDE,VOLUME,STOPLOSS,TAKEPROFIT,TRADE_TYPE,ENTRY_PRICE,ORDER_TYPE,ACTION,TICKET
      csvResponse += `${trade.id},${brokerSymbol},${trade.side},${safeVolume},${safeSl},${safeTp},${trade.trade_type},${safeEntry},${orderType},${action},${ticket}\n`;
      
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
