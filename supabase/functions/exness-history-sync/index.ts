import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2.108.2";

const baseUrl = Deno.env.get("META_API_BASE_URL") || "https://mt-client-api-v1.london.agiliumtrade.ai";

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
    console.error("[History Sync] Failed to insert audit log:", err);
  }
}

serve(async (req) => {
  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!supabaseUrl || !supabaseKey) {
      console.error("Missing Supabase env vars.");
      return new Response("Server Configuration Error", { status: 500 });
    }

    const authHeader = req.headers.get("Authorization");
    const cronSecretHeader = req.headers.get("x-cron-secret");
    const cronSecretEnv = Deno.env.get("CRON_SECRET");
    
    const isAuthorized = 
      authHeader === `Bearer ${supabaseKey}` || 
      (cronSecretHeader && cronSecretEnv && cronSecretHeader === cronSecretEnv);

    if (!isAuthorized) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { "Content-Type": "application/json" } });
    }

    const supabase = createClient(supabaseUrl, supabaseKey);

    // PAMM Architecture: Fetch history from the Master Account
    const masterToken = Deno.env.get("META_API_TOKEN");
    const masterAccountId = Deno.env.get("META_API_ACCOUNT_ID");
    
    if (!masterToken || !masterAccountId) {
      return new Response("Missing Master META_API credentials in ENV", { status: 500 });
    }

    const nowIso = new Date().toISOString();

    // --- STEP 1: Ground-Truth Master Broker Balance & Treasury Auto-Sync ---
    try {
      const accountInfoUrl = `${baseUrl}/users/current/accounts/${masterAccountId}/account-information`;
      const accountRes = await fetch(accountInfoUrl, {
        headers: { "auth-token": masterToken },
      });

      if (accountRes.ok) {
        const accInfo = await accountRes.json();
        const reportedBalance = Number(Number(accInfo.balance || 0).toFixed(2));
        const reportedEquity = Number(Number(accInfo.equity || reportedBalance).toFixed(2));
        const reportedFreeMargin = Number(Number(accInfo.freeMargin || reportedBalance).toFixed(2));

        if (reportedBalance > 0) {
          const { data: masterAccounts } = await supabase
            .from("user_risk_settings")
            .select("id, user_id, portfolio_capital, daily_starting_equity, high_water_mark_equity")
            .eq("is_master_account", true);

          if (masterAccounts && masterAccounts.length > 0) {
            for (const master of masterAccounts) {
              const prevCapital = Number(master.portfolio_capital || 0);
              const capitalDelta = reportedBalance - prevCapital;

              if (Math.abs(capitalDelta) >= 0.01) {
                const currentDailyStart = Number(master.daily_starting_equity || prevCapital);
                const currentHwm = Number(master.high_water_mark_equity || prevCapital);

                // Step up daily starting equity on deposits
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
                      source: "METAAPI_POLL",
                      reason: capitalDelta > 0 ? "Deposit / Realized Profit Detected" : "Withdrawal / Realized Loss Reconciled",
                    },
                  });
                  console.log(`[History Sync] Auto-synced Master Account ${master.user_id.slice(0, 8)} Capital from $${prevCapital.toFixed(2)} to $${reportedBalance.toFixed(2)} (Delta: $${capitalDelta.toFixed(2)})`);
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
      }
    } catch (accErr: any) {
      console.warn("[History Sync] MetaAPI account information fetch warning:", accErr?.message || accErr);
    }

    const report = [];

    // Setup time window (last 48 hours to ensure we catch everything)
    const startTime = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
    const endTime = new Date().toISOString();

    // Check MT5 VPS primary status (Section 1 of System Health Checklist)
    const { data: vpsRisk } = await supabase
      .from("user_risk_settings")
      .select("vps_last_heartbeat")
      .eq("is_master_account", true)
      .maybeSingle();

    const vpsMinsAgo = vpsRisk?.vps_last_heartbeat
      ? (Date.now() - new Date(vpsRisk.vps_last_heartbeat).getTime()) / 60000
      : 999;
    const isVpsPrimaryActive = vpsMinsAgo <= 5.0;

    // Filter trades that genuinely need historical deal reconciliation:
    // 1. Trades marked CLOSED / VPS_CLOSE with profit_usd IS NULL (awaiting final PnL)
    // 2. OR if VPS bridge is degraded/offline (>5m), all active open trades for emergency failover sync
    let targetStatuses = ["CLOSED", "VPS_CLOSE"];
    if (!isVpsPrimaryActive) {
      targetStatuses = ["OPEN", "PENDING", "VPS_CLOSE", "CLOSED"];
    }

    const { data: openTrades, error: openTradesError } = await supabase
      .from("user_trades")
      .select("id, user_id, volume, symbol, meta_api_order_id, status, trade_type, opportunity_id, risk_amount")
      .in("status", targetStatuses)
      .is("profit_usd", null)
      .not("meta_api_order_id", "is", null);

    if (openTradesError || !openTrades || openTrades.length === 0) {
      const msg = isVpsPrimaryActive
        ? "No closed trades awaiting reconciliation. Zero-latency MT5 VPS EA is active and handling live deal callbacks."
        : "No open trades to sync. Account balance reconciled.";
      return new Response(JSON.stringify({ status: "success", message: msg }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
    }

    console.log(`[History Sync] Found ${openTrades.length} trades requiring deal reconciliation. Fetching Master history...`);
    
    const historyUrl = `${baseUrl}/users/current/accounts/${masterAccountId}/history-deals/time/${startTime}/${endTime}`;
    
    let historyDeals = [];
    try {
      let historyResponse = await fetch(historyUrl, {
        headers: { "auth-token": masterToken },
      });

      // 1 retry with backoff if rate-limited or transient failure
      if (!historyResponse.ok && (historyResponse.status === 429 || historyResponse.status >= 500)) {
        console.warn(`[History Sync] MetaAPI responded with ${historyResponse.status}. Retrying in 1.5s...`);
        await new Promise((r) => setTimeout(r, 1500));
        historyResponse = await fetch(historyUrl, {
          headers: { "auth-token": masterToken },
        });
      }

      if (!historyResponse.ok) {
        const err = await historyResponse.text();
        console.warn(`[History Sync] Master failed to fetch history (${historyResponse.status}): ${err}`);
        if (historyResponse.status === 429) {
          await insertAudit(supabase, {
            action: "METAAPI_RATE_LIMITED",
            payload_json: { status: 429, error: err.slice(0, 200) }
          });
        }
        return new Response(JSON.stringify({ success: false, reason: "MetaAPI temporary unavailable", error: err }), {
          status: 200,
          headers: { "Content-Type": "application/json" }
        });
      }

      historyDeals = await historyResponse.json();
    } catch (e: any) {
      console.warn(`[History Sync] Master fetch exception: ${e?.message || e}`);
      return new Response(JSON.stringify({ success: false, reason: "MetaAPI connection error", error: e?.message || String(e) }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
    }

    // Filter for closing deals (where entryType is DEAL_ENTRY_OUT)
    const closingDeals = historyDeals.filter((deal: any) => deal.entryType === "DEAL_ENTRY_OUT");

    const resolvedTrades = [];

    for (const trade of openTrades) {
      // The positionId on the closing deal matches our meta_api_order_id (which was the original opening order id)
      const closingDeal = closingDeals.find((deal: any) => String(deal.positionId) === String(trade.meta_api_order_id));

      if (closingDeal) {
        const entryDeal = historyDeals.find((deal: any) => String(deal.positionId) === String(trade.meta_api_order_id) && deal.entryType === "DEAL_ENTRY_IN");

        const masterProfitUsd = Number(closingDeal.profit) || 0;
        const masterVolume = Number(closingDeal.volume) || 1;
        
        // Calculate proportional profit for this specific user
        const userProfitUsd = (Number(trade.volume) / masterVolume) * masterProfitUsd;

        const isWin = userProfitUsd > 0;
        const finalStatus = isWin ? "WON" : "LOST";
        
        const closePrice = closingDeal.price;
        const closedAt = closingDeal.time;

        const updateData: any = {
            status: finalStatus,
            profit_usd: userProfitUsd,
            close_price: closePrice,
            closed_at: closedAt
        };
        
        if (entryDeal && entryDeal.price) {
            updateData.open_price = entryDeal.price;
        }

        console.log(`[History Sync] Trade ${trade.meta_api_order_id} for User ${trade.user_id} resolved as ${finalStatus} with $${userProfitUsd.toFixed(2)} profit`);

        await supabase
          .from("user_trades")
          .update(updateData)
          .eq("id", trade.id);

        // --- DRAWDOWN BREAKER: UPDATE PORTFOLIO CAPITAL & HWM ---
        const { data: userRisk } = await supabase
          .from("user_risk_settings")
          .select("portfolio_capital, high_water_mark_equity")
          .eq("user_id", trade.user_id)
          .maybeSingle();
          
        if (userRisk) {
            const newCapital = Number(userRisk.portfolio_capital) + userProfitUsd;
            const newHighWaterMark = Math.max(Number(userRisk.high_water_mark_equity) || 0, newCapital);
            
            await supabase
              .from("user_risk_settings")
              .update({
                  portfolio_capital: newCapital,
                  high_water_mark_equity: newHighWaterMark
              })
              .eq("user_id", trade.user_id);
              
            console.log(`[History Sync] Updated User ${trade.user_id} Capital to $${newCapital.toFixed(2)}. HWM: $${newHighWaterMark.toFixed(2)}`);
        }

        resolvedTrades.push({ id: trade.id, finalStatus });

          // --- Breakeven Trigger ---
          // When a QUICK_EXIT leg closes in profit, automatically move the companion RUNNER
          // leg's stop loss to breakeven so it can never close at a loss.
          if (finalStatus === "WON" && trade.trade_type === "QUICK_EXIT") {
            console.log(`[History Sync] QUICK_EXIT WON for ${trade.symbol}. Triggering breakeven on companion RUNNER...`);

            const { data: runnerTrade } = await supabase
              .from("user_trades")
              .select("id, meta_api_order_id")
              .eq("user_id", trade.user_id)
              .eq("opportunity_id", trade.opportunity_id)
              .eq("trade_type", "RUNNER")
              .eq("status", "OPEN")
              .maybeSingle();

            if (runnerTrade?.meta_api_order_id) {
              try {
                // Fetch the live position to get openPrice and current takeProfit
                const posUrl = `${baseUrl}/users/current/accounts/${masterAccountId}/positions/${runnerTrade.meta_api_order_id}`;
                const posRes = await fetch(posUrl, { headers: { "auth-token": masterToken } });

                if (posRes.ok) {
                  const pos = await posRes.json();
                  const breakevenSL = Number(pos.openPrice);
                  const existingTP = Number(pos.takeProfit);

                  const modifyUrl = `${baseUrl}/users/current/accounts/${masterAccountId}/trade`;
                  const modifyPayload = {
                    actionType: "POSITION_MODIFY",
                    positionId: runnerTrade.meta_api_order_id,
                    stopLoss: breakevenSL,   // Breakeven
                    takeProfit: existingTP,   // Re-inject per MetaAPI Modification Protocol
                  };

                  const modifyRes = await fetch(modifyUrl, {
                    method: "POST",
                    headers: { "auth-token": masterToken, "Content-Type": "application/json" },
                    body: JSON.stringify(modifyPayload),
                  });

                  if (modifyRes.ok) {
                    console.log(`[History Sync] Breakeven set on RUNNER ${runnerTrade.meta_api_order_id} at ${breakevenSL}.`);
                  } else {
                    const err = await modifyRes.text();
                    console.error(`[History Sync] Failed to set breakeven on RUNNER: ${err}`);
                  }
                } else {
                  console.error(`[History Sync] Could not fetch live position for RUNNER ${runnerTrade.meta_api_order_id}`);
                }
              } catch (e) {
                console.error(`[History Sync] Breakeven trigger exception:`, e);
              }
            } else {
              console.log(`[History Sync] No open RUNNER found for opportunity ${trade.opportunity_id}. May have already closed.`);
            }
          }

          // --- OPPORTUNITY RECONCILIATION ---
          if (trade.opportunity_id) {
            const { data: siblingTrades } = await supabase
              .from("user_trades")
              .select("id, status, profit_usd, risk_amount")
              .eq("opportunity_id", trade.opportunity_id);

            if (siblingTrades && siblingTrades.length > 0) {
              const hasActiveLegs = siblingTrades.some((st: any) => ["OPEN", "PENDING", "VPS_PENDING", "VPS_PROCESSING"].includes(st.status));
              if (!hasActiveLegs) {
                const totalNetProfit = siblingTrades.reduce((acc: number, st: any) => acc + (Number(st.profit_usd) || 0), 0);
                const totalRisk = siblingTrades.reduce((acc: number, st: any) => acc + (Number(st.risk_amount) || 0), 0);
                const oppOutcome = totalNetProfit > 0 ? "WON" : (totalNetProfit < 0 ? "LOST" : "EXPIRED");
                const rMultiple = totalRisk > 0 ? Number((totalNetProfit / totalRisk).toFixed(2)) : (totalNetProfit > 0 ? 1.0 : -1.0);

                await supabase
                  .from("trade_opportunities")
                  .update({
                    status: oppOutcome,
                    r_multiple: rMultiple,
                    closed_at: closedAt || new Date().toISOString()
                  })
                  .eq("id", trade.opportunity_id)
                  .in("status", ["ACTIVE", "APPROVED", "QUEUED"]);

                console.log(`[History Sync] Reconciled parent opportunity ${trade.opportunity_id} -> ${oppOutcome} (Net: $${totalNetProfit.toFixed(2)}, R: ${rMultiple}R)`);
              }
            }
          }
        }
      }
      
      report.push({ resolved: resolvedTrades });

    return new Response(JSON.stringify({
      success: true,
      report: report,
      debug_deals: historyDeals
    }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });

  } catch (error: any) {
    console.error(`[History Sync] Exception:`, error);
    return new Response(`Server error: ${error.message}`, { status: 500 });
  }
});
