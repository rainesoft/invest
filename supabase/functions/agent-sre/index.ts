import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2.108.2";

/**
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║           AGENT SRE — Autonomous Site Reliability Engineering            ║
 * ║  Scheduled via pg_cron (Hourly at :15).                                 ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 *
 * Autonomously audits system telemetry, detects pipeline anomalies/crashes,
 * executes self-healing database reconciliations, dispatches Telegram alerts
 * on critical incidents, and logs audit heartbeats.
 */

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const CRON_SECRET = Deno.env.get("CRON_SECRET") ?? "";
const TG_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN") ?? "";
const TG_CHAT = Deno.env.get("TELEGRAM_CHAT_ID") ?? "";

async function notifyTelegram(htmlText: string) {
  if (!TG_TOKEN || !TG_CHAT) return;
  try {
    const url = `https://api.telegram.org/bot${TG_TOKEN}/sendMessage`;
    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: TG_CHAT,
        text: htmlText,
        parse_mode: "HTML",
        disable_web_page_preview: true,
      }),
    });
  } catch (e) {
    console.error("[Agent SRE] Telegram dispatch failed:", e);
  }
}

async function insertAudit(supabase: any, entry: { action: string; entity_type?: string; entity_id?: string; payload_json?: Record<string, any> }) {
  try {
    const { data: last } = await supabase
      .from("audit_log")
      .select("hash")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const prevHash = last?.hash ?? "";
    const data = new TextEncoder().encode(prevHash + JSON.stringify(entry));
    const buf = await crypto.subtle.digest("SHA-256", data);
    const hash = Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");

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

    const { error: insErr } = await supabase.from("audit_log").insert(record);
    if (insErr) {
      console.error("[Agent SRE] Failed to insert audit log:", insErr);
    }
  } catch (err) {
    console.error("[Agent SRE] Failed to insert audit log:", err);
  }
}

serve(async (req) => {
  try {
    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      return new Response(JSON.stringify({ error: "Missing Supabase configuration" }), { status: 500 });
    }

    const authHeader = req.headers.get("Authorization");
    const cronSecretHeader = req.headers.get("x-cron-secret");
    const isAuthorized =
      authHeader === `Bearer ${SUPABASE_SERVICE_ROLE_KEY}` ||
      (cronSecretHeader && CRON_SECRET && cronSecretHeader === CRON_SECRET);

    if (!isAuthorized) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { "Content-Type": "application/json" } });
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    let payload: any = {};
    try {
      const text = await req.text();
      if (text && text.trim().length > 0) {
        payload = JSON.parse(text);
      }
    } catch (_) {}

    // --- GLOBAL ABORT EMERGENCY CIRCUIT BREAKER ---
    if (payload.action === "GLOBAL_ABORT") {
      console.log("🚨 [Agent SRE] GLOBAL_ABORT Triggered!");
      await supabase.from("system_settings").update({ value: "false" }).eq("key", "auto_trading_enabled");
      await supabase.from("user_risk_settings").update({ auto_trade_enabled: false }).neq("user_id", "dummy");
      const tgMessage = `🚨 <b>BLACK SWAN / GLOBAL ABORT TRIGGERED</b> 🚨\n\nAuto-trading has been <b>PAUSED</b> globally across all PAMM accounts.\n\n⚠️ <i>Manual Assessment Required:</i> Administrator must log in and manually assess/close all active exposure!`;
      await notifyTelegram(tgMessage);
      await insertAudit(supabase, {
        action: "KILL_SWITCH_TRIGGERED",
        payload_json: { reason: "External GLOBAL_ABORT payload received by agent-sre" }
      });
      return new Response(JSON.stringify({ status: "success", message: "Global abort triggered. Auto-trading paused." }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
    }

    const now = new Date();
    const oneHourAgoIso = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const issues: string[] = [];
    const autoRemediations: string[] = [];

    // ─────────────────────────────────────────────────────────────
    // PROBE 1: Background Cron Failures (check_cron_failures RPC)
    // ─────────────────────────────────────────────────────────────
    let cronFailuresCount = 0;
    const { data: cronFailures, error: cronRpcError } = await supabase.rpc("check_cron_failures");
    if (cronRpcError) {
      issues.push(`⚠️ <b>Cron Health RPC Error:</b> ${cronRpcError.message}`);
    } else if (cronFailures && cronFailures.length > 0) {
      cronFailuresCount = cronFailures.length;
      const grouped: Record<string, number> = {};
      let sampleMsg = "";
      for (const cf of cronFailures) {
        grouped[cf.jobname] = (grouped[cf.jobname] || 0) + 1;
        if (!sampleMsg) sampleMsg = cf.return_message;
      }
      const desc = Object.entries(grouped).map(([j, c]) => `• <code>${j}</code>: ${c} failures`).join("\n");
      issues.push(`🚨 <b>Cron Jobs Failed (${cronFailuresCount} in last hour):</b>\n${desc}\n<i>Sample:</i> <code>${(sampleMsg || "").slice(0, 200)}</code>`);
    }

    // ─────────────────────────────────────────────────────────────
    // PROBE 2: Database Webhook & HTTP Response Errors
    // ─────────────────────────────────────────────────────────────
    const { data: httpErrors, error: httpFetchError } = await supabase.rpc("check_http_response_errors");

    if (!httpFetchError && httpErrors && httpErrors.length > 0) {
      issues.push(`⚠️ <b>HTTP / Webhook Errors (${httpErrors.length} in last hour):</b> Status ${httpErrors[0].status_code || "ERR"}: ${httpErrors[0].error_msg || "HTTP Error"}`);
    }

    // ─────────────────────────────────────────────────────────────
    // PROBE 3: Edge Function Agent Crashes
    // ─────────────────────────────────────────────────────────────
    const { data: agentCrashes, error: crashError } = await supabase
      .from("audit_log")
      .select("id, payload_json, created_at")
      .eq("action", "AGENT_CRASH")
      .gte("created_at", oneHourAgoIso);

    if (!crashError && agentCrashes && agentCrashes.length > 0) {
      issues.push(`🚨 <b>Agent Crashes (${agentCrashes.length} in last hour):</b> Action AGENT_CRASH logged in audit_log.`);
    }

    // ─────────────────────────────────────────────────────────────
    // PROBE 4: Pipeline Integrity & Autonomous Self-Healing
    // ─────────────────────────────────────────────────────────────

    // 4A. Orphaned PUBLISHED Signals (> 5 mins)
    const fiveMinsAgoIso = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    const { data: orphanedPublished } = await supabase
      .from("trade_opportunities")
      .select("id, symbol, side, created_at")
      .eq("status", "PUBLISHED")
      .lte("created_at", fiveMinsAgoIso);

    if (orphanedPublished && orphanedPublished.length > 0) {
      issues.push(`⚠️ <b>Orphaned PUBLISHED Signals:</b> ${orphanedPublished.length} signals stuck in evaluation.`);
    }

    // 4B. Orphaned APPROVED Signals (Missing user_trades > 5 mins)
    const { data: approvedOpps } = await supabase
      .from("trade_opportunities")
      .select("id, symbol, side, created_at, ai_risks, ai_summary")
      .eq("status", "APPROVED")
      .lte("created_at", fiveMinsAgoIso);

    if (approvedOpps && approvedOpps.length > 0) {
      for (const opp of approvedOpps) {
        const { data: legs } = await supabase.from("user_trades").select("id").eq("opportunity_id", opp.id);
        if (!legs || legs.length === 0) {
          // If execution was skipped or blocked by risk manager, auto-reconcile to REJECTED
          const isSkipped = (opp.ai_risks && opp.ai_risks.includes("Execution Skipped")) ||
                            (opp.ai_summary && opp.ai_summary.includes("[Execution Desk] Execution Skipped"));
          if (isSkipped) {
            await supabase.from("trade_opportunities").update({
              status: "REJECTED",
              closed_at: now.toISOString(),
            }).eq("id", opp.id);
            autoRemediations.push(`Reconciled orphaned APPROVED opportunity ${opp.symbol} (${opp.id}) to REJECTED (Execution Skipped)`);
          } else {
            issues.push(`⚠️ <b>Orphaned APPROVED Signal:</b> ${opp.symbol} (${opp.id}) has no user_trades legs.`);
          }
        }
      }
    }

    // 4C. Auto-Healing: Desynced Closed Trades (status = 'OPEN' with profit_usd IS NOT NULL)
    const { data: desyncedTrades } = await supabase
      .from("user_trades")
      .select("id, symbol, profit_usd")
      .eq("status", "OPEN")
      .not("profit_usd", "is", null);

    if (desyncedTrades && desyncedTrades.length > 0) {
      for (const dt of desyncedTrades) {
        const targetStatus = Number(dt.profit_usd) > 0 ? "WON" : "LOST";
        await supabase.from("user_trades").update({ status: targetStatus }).eq("id", dt.id);
        autoRemediations.push(`Reconciled desynced trade ${dt.symbol} (${dt.id}) to ${targetStatus} ($${dt.profit_usd})`);
      }
    }

    // 4D. Auto-Healing: Stale Unfilled Orders (> 48h old with open_price IS NULL)
    const fortyEightHoursAgoIso = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
    const { data: staleUnfilled } = await supabase
      .from("user_trades")
      .select("id, symbol, side, opportunity_id, created_at")
      .in("status", ["OPEN", "PENDING", "VPS_PENDING"])
      .is("open_price", null)
      .lte("created_at", fortyEightHoursAgoIso);

    if (staleUnfilled && staleUnfilled.length > 0) {
      for (const su of staleUnfilled) {
        await supabase.from("user_trades").update({
          status: "CLOSED",
          error_message: "Order cancelled (Stale unfilled pending order > 48h by agent-sre)",
          closed_at: now.toISOString()
        }).eq("id", su.id);

        if (su.opportunity_id) {
          await supabase.from("trade_opportunities").update({
            status: "EXPIRED",
            r_multiple: 0,
            closed_at: now.toISOString()
          }).eq("id", su.opportunity_id).in("status", ["ACTIVE", "APPROVED"]);
        }
        autoRemediations.push(`Cancelled stale unfilled order ${su.symbol} ${su.side} (${su.id})`);
      }
    }

    // 4E. Auto-Healing: Unreconciled Completed Opportunities (ACTIVE with 0 remaining open trades)
    const twentyFourHoursAgoIso = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { data: activeOpps } = await supabase
      .from("trade_opportunities")
      .select("id, symbol, created_at")
      .in("status", ["ACTIVE", "APPROVED"]);

    if (activeOpps && activeOpps.length > 0) {
      for (const opp of activeOpps) {
        const { data: openLegs } = await supabase
          .from("user_trades")
          .select("id")
          .eq("opportunity_id", opp.id)
          .in("status", ["OPEN", "PENDING", "VPS_PENDING", "VPS_PROCESSING"]);

        if (!openLegs || openLegs.length === 0) {
          const { data: allLegs } = await supabase
            .from("user_trades")
            .select("id, status, profit_usd, risk_amount")
            .eq("opportunity_id", opp.id);

          if (!allLegs || allLegs.length === 0) {
            if (opp.created_at <= twentyFourHoursAgoIso) {
              await supabase.from("trade_opportunities").update({
                status: "EXPIRED",
                r_multiple: 0,
                closed_at: now.toISOString()
              }).eq("id", opp.id);
              autoRemediations.push(`Expired completed opportunity ${opp.symbol} (${opp.id}) with 0 trades created`);
            }
          } else {
            const totalNetProfit = allLegs.reduce((acc: number, l: any) => acc + (Number(l.profit_usd) || 0), 0);
            const totalRisk = allLegs.reduce((acc: number, l: any) => acc + (Number(l.risk_amount) || 0), 0);
            const oppOutcome = totalNetProfit > 0 ? "WON" : (totalNetProfit < 0 ? "LOST" : "EXPIRED");
            const rMultiple = totalRisk > 0 ? Number((totalNetProfit / totalRisk).toFixed(2)) : (totalNetProfit > 0 ? 1.0 : (totalNetProfit < 0 ? -1.0 : 0));

            await supabase.from("trade_opportunities").update({
              status: oppOutcome,
              r_multiple: rMultiple,
              closed_at: now.toISOString()
            }).eq("id", opp.id);
            autoRemediations.push(`Reconciled completed opportunity ${opp.symbol} (${opp.id}) to ${oppOutcome} (Net: $${totalNetProfit.toFixed(2)}, R: ${rMultiple}R)`);
          }
        }
      }
    }

    // 4F. Broker Execution Failures in Last Hour (MT5 Codes 10013, 10014, 10015, 10016, 10018, 10019)
    const { data: recentFailedTrades } = await supabase
      .from("user_trades")
      .select("id, symbol, side, opportunity_id, error_message, created_at")
      .eq("status", "FAILED")
      .gte("created_at", oneHourAgoIso);

    if (recentFailedTrades && recentFailedTrades.length > 0) {
      const getErrorDescription = (errMsg: string | null) => {
        if (!errMsg) return "Unknown broker error";
        if (errMsg.includes("10013")) return "Code:10013 (Invalid Request / Unmapped Symbol Alias — verify broker symbol e.g. SPX500->US500, NAS100->USTEC)";
        if (errMsg.includes("10014")) return "Code:10014 (Invalid Volume / Lot Step)";
        if (errMsg.includes("10015")) return "Code:10015 (Invalid Price / Slipped Breakout Entry)";
        if (errMsg.includes("10016")) return "Code:10016 (Invalid Stops / TP Direction Mismatch)";
        if (errMsg.includes("10018")) return "Code:10018 (Market Closed / Session Inactive)";
        if (errMsg.includes("10019")) return "Code:10019 (Insufficient Free Margin)";
        return errMsg;
      };

      const sample = recentFailedTrades[0];
      const errorDesc = getErrorDescription(sample.error_message);
      issues.push(`🚨 <b>Broker Execution Errors (${recentFailedTrades.length} in last hour):</b> ${sample.symbol} ${sample.side} failed with <code>${errorDesc}</code>.`);

      // Auto-reconcile parent opportunities stuck in APPROVED or ACTIVE
      for (const ft of recentFailedTrades) {
        if (ft.opportunity_id) {
          const { data: opp } = await supabase
            .from("trade_opportunities")
            .select("id, status, ai_summary")
            .eq("id", ft.opportunity_id)
            .in("status", ["APPROVED", "ACTIVE"])
            .maybeSingle();

          if (opp) {
            const specificReason = getErrorDescription(ft.error_message);
            const failReason = `Broker Execution Failed: ${specificReason}`;
            await supabase.from("trade_opportunities").update({
              status: "REJECTED",
              ai_risks: failReason,
              ai_summary: `${opp.ai_summary || ""}\n\n[Agent SRE Auto-Healing] ${failReason}`.trim(),
              closed_at: now.toISOString(),
            }).eq("id", opp.id);
            autoRemediations.push(`Marked failed opportunity ${ft.symbol} (${opp.id}) as REJECTED due to ${failReason}`);
          }
        }
      }
    }

    // ─────────────────────────────────────────────────────────────
    // PROBE 5: MT5 VPS EA Heartbeat & Connectivity
    // ─────────────────────────────────────────────────────────────
    let vpsMinsAgo: number | null = null;
    let isVpsAlive = false;
    const { data: vpsRisk } = await supabase
      .from("user_risk_settings")
      .select("vps_last_heartbeat, is_live_execution_enabled")
      .eq("is_master_account", true)
      .maybeSingle();

    if (vpsRisk?.vps_last_heartbeat) {
      const hbTime = new Date(vpsRisk.vps_last_heartbeat).getTime();
      vpsMinsAgo = Math.max(0, (Date.now() - hbTime) / 60000);
      isVpsAlive = vpsMinsAgo <= 1.0;
      if (vpsMinsAgo > 3.0 && vpsRisk.is_live_execution_enabled) {
        issues.push(`🔴 <b>MT5 VPS Bridge Disconnected:</b> Last heartbeat was ${vpsMinsAgo.toFixed(1)} mins ago.`);
      }
    } else {
      issues.push(`⚠️ <b>MT5 VPS Bridge:</b> No heartbeat timestamp found for master account.`);
    }

    // ─────────────────────────────────────────────────────────────
    // PROBE 6: Market Data Freshness (market_data_pti)
    // ─────────────────────────────────────────────────────────────
    const { data: ptiCandles } = await supabase
      .from("market_data_pti")
      .select("symbol, timeframe, ts")
      .eq("timeframe", "30m")
      .order("ts", { ascending: false })
      .limit(20);

    const latestTs = ptiCandles?.[0]?.ts ? new Date(ptiCandles[0].ts).getTime() : 0;
    const candleHoursAgo = latestTs > 0 ? (Date.now() - latestTs) / (1000 * 60 * 60) : null;
    if (candleHoursAgo !== null && candleHoursAgo > 3.0) {
      // Check day of week (0 = Sunday, 6 = Saturday)
      const day = now.getUTCDay();
      const isWeekend = day === 6 || (day === 0 && now.getUTCHours() < 21);
      if (!isWeekend) {
        issues.push(`⚠️ <b>Market Data Stale:</b> Latest 30m candle is ${candleHoursAgo.toFixed(1)}h old.`);
      }
    }

    // ─────────────────────────────────────────────────────────────
    // PROBE 7: Treasury Solvency
    // ─────────────────────────────────────────────────────────────
    const { data: treasurySetting } = await supabase
      .from("system_settings")
      .select("value")
      .eq("key", "treasury_status")
      .maybeSingle();

    let solvencyRatio = 1.0;
    let isSolvent = true;
    if (treasurySetting?.value) {
      const val = typeof treasurySetting.value === "string" ? JSON.parse(treasurySetting.value) : treasurySetting.value;
      solvencyRatio = Number(val.solvency_ratio || 1.0);
      isSolvent = val.is_solvent !== false && solvencyRatio >= 1.0;
      if (!isSolvent) {
        issues.push(`🚨 <b>Treasury Insolvent:</b> Solvency ratio is ${solvencyRatio.toFixed(2)} (< 1.0).`);
      }
    }

    // ─────────────────────────────────────────────────────────────
    // PROBE 8: AI Evaluation Model Timeouts / API Errors
    // ─────────────────────────────────────────────────────────────
    let apiTimeoutCount = 0;
    const { data: apiTimeouts, error: timeoutErr } = await supabase
      .from("audit_log")
      .select("id, payload_json, created_at")
      .eq("action", "API_TIMEOUT")
      .gte("created_at", oneHourAgoIso);

    if (!timeoutErr && apiTimeouts && apiTimeouts.length > 0) {
      apiTimeoutCount = apiTimeouts.length;
      if (apiTimeoutCount >= 3) {
        const sampleReason = apiTimeouts[0]?.payload_json?.error || apiTimeouts[0]?.payload_json?.reason || "API Outage";
        issues.push(`⚠️ <b>AI Model Outage (${apiTimeoutCount} timeouts in last hour):</b> <code>${String(sampleReason).slice(0, 150)}</code>`);
      }
    }

    // ─────────────────────────────────────────────────────────────
    // PROBE 9: Account Drawdown & Circuit Breaker Guardrails
    // ─────────────────────────────────────────────────────────────
    let drawdownBreachedCount = 0;
    const { data: allRiskAccounts } = await supabase
      .from("user_risk_settings")
      .select("user_id, portfolio_capital, daily_starting_equity, high_water_mark_equity, max_daily_drawdown_pct, max_drawdown_pct, auto_trade_enabled");

    if (allRiskAccounts && allRiskAccounts.length > 0) {
      for (const acc of allRiskAccounts) {
        const capital = Number(acc.portfolio_capital || 0);
        const dailyStart = Number(acc.daily_starting_equity || capital);
        const hwm = Number(acc.high_water_mark_equity || capital);
        const maxDailyDdPct = Number(acc.max_daily_drawdown_pct || 0.05);
        const maxTotalDdPct = Number(acc.max_drawdown_pct || 0.10);

        if (dailyStart > 0) {
          const currentDailyLoss = (dailyStart - capital) / dailyStart;
          if (currentDailyLoss >= maxDailyDdPct) {
            drawdownBreachedCount++;
            issues.push(`🚨 <b>Daily Drawdown Breached:</b> Account ${acc.user_id.slice(0, 8)} lost ${(currentDailyLoss * 100).toFixed(1)}% today (Max: ${(maxDailyDdPct * 100).toFixed(0)}%).`);
          }
        }

        if (hwm > 0) {
          const currentTotalLoss = (hwm - capital) / hwm;
          if (currentTotalLoss >= maxTotalDdPct) {
            drawdownBreachedCount++;
            issues.push(`🚨 <b>Max Total Drawdown Breached:</b> Account ${acc.user_id.slice(0, 8)} drawdown is ${(currentTotalLoss * 100).toFixed(1)}% from HWM (Max: ${(maxTotalDdPct * 100).toFixed(0)}%).`);
          }
        }
      }
    }

    // ─────────────────────────────────────────────────────────────
    // TELEMETRY SUMMARY & INCIDENT ALERTING
    // ─────────────────────────────────────────────────────────────
    const isHealthy = issues.length === 0;
    const reportPayload = {
      timestamp: now.toISOString(),
      is_healthy: isHealthy,
      cron_failures: cronFailuresCount,
      vps_latency_mins: vpsMinsAgo,
      solvency_ratio: solvencyRatio,
      market_data_latency_hours: candleHoursAgo,
      api_timeouts_count: apiTimeoutCount,
      drawdown_breaches_count: drawdownBreachedCount,
      issues_count: issues.length,
      issues,
      remediations_count: autoRemediations.length,
      autoRemediations,
    };

    // 1. Insert Audit Log Heartbeat
    await insertAudit(supabase, {
      action: isHealthy ? "SRE_HEARTBEAT" : "SRE_HEALTH_ALERT",
      payload_json: reportPayload,
    });

    if (autoRemediations.length > 0) {
      await insertAudit(supabase, {
        action: "SRE_AUTO_REMEDIATION",
        payload_json: { remediations: autoRemediations },
      });
    }

    // 2. Telemetry Unit Humanizers
    const vpsLatencyDisplay = vpsMinsAgo === null
      ? "N/A"
      : vpsMinsAgo < 1
        ? `${Math.round(vpsMinsAgo * 60)}s (Optimal)`
        : vpsMinsAgo < 5
          ? `${vpsMinsAgo.toFixed(1)}m (Active)`
          : `${vpsMinsAgo.toFixed(1)}m ⚠️ (Delayed)`;

    const candleLatencyDisplay = candleHoursAgo === null
      ? "N/A"
      : candleHoursAgo < 1
        ? `${Math.round(candleHoursAgo * 60)}m (Real-time)`
        : `${candleHoursAgo.toFixed(1)}h ⚠️ (Lagging)`;

    const solvencyDisplay = `${solvencyRatio.toFixed(2)}x Reserve Ratio (${solvencyRatio >= 1.5 ? "Healthy" : "Tight"})`;
    const aiErrorsDisplay = `${apiTimeoutCount} in last hour`;

    // 3. Intelligent Alert Throttling (Suppress identical recurring errors within 4 hours)
    let shouldNotifyTelegram = false;
    if (!isHealthy || autoRemediations.length > 0) {
      if (autoRemediations.length > 0) {
        shouldNotifyTelegram = true;
      } else {
        const { data: lastAlert } = await supabase
          .from("audit_log")
          .select("created_at, payload_json")
          .eq("action", "SRE_HEALTH_ALERT")
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();

        const lastAlertTime = lastAlert?.created_at ? new Date(lastAlert.created_at).getTime() : 0;
        const hoursSinceLastAlert = (Date.now() - lastAlertTime) / (1000 * 60 * 60);

        const prevIssues = JSON.stringify(lastAlert?.payload_json?.issues || []);
        const currentIssues = JSON.stringify(issues);
        const isIdenticalAlert = prevIssues === currentIssues;

        if (!isIdenticalAlert || hoursSinceLastAlert >= 4) {
          shouldNotifyTelegram = true;
        } else {
          console.log(`[Agent SRE] Suppressed identical recurring SRE Telegram alert (${hoursSinceLastAlert.toFixed(1)}h since last broadcast).`);
        }
      }
    }

    if (shouldNotifyTelegram) {
      const tgLines = [
        `🤖 <b>AGENT SRE | SYSTEM HEALTH REPORT</b>`,
        `⏱ <i>${now.toUTCString()}</i>`,
        `━━━━━━━━━━━━━━━━━━━━━`,
        isHealthy ? `🟢 <b>Status:</b> Healthy (Self-Healing Executed)` : `🔴 <b>Status:</b> Action Required (${issues.length} Anomal${issues.length > 1 ? "ies" : "y"})`,
        ``,
      ];

      if (issues.length > 0) {
        tgLines.push(`<b>Active Incidents:</b>`);
        tgLines.push(...issues);
        tgLines.push(``);
      }

      if (autoRemediations.length > 0) {
        tgLines.push(`<b>Autonomous Remediations Applied:</b>`);
        for (const rem of autoRemediations) {
          tgLines.push(`• ✅ <i>${rem}</i>`);
        }
        tgLines.push(``);
      }

      tgLines.push(`<b>System Telemetry Health:</b>`);
      tgLines.push(`• VPS Heartbeat: <code>${vpsLatencyDisplay}</code>`);
      tgLines.push(`• Candle Feed: <code>${candleLatencyDisplay}</code>`);
      tgLines.push(`• Treasury Solvency: <code>${solvencyDisplay}</code>`);
      tgLines.push(`• AI Service Errors: <code>${aiErrorsDisplay}</code>`);

      await notifyTelegram(tgLines.join("\n"));
    }

    console.log(`[Agent SRE] Execution complete. Healthy: ${isHealthy}. Issues: ${issues.length}. Remediations: ${autoRemediations.length}.`);

    return new Response(JSON.stringify(reportPayload), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (error: any) {
    console.error("[Agent SRE] Unhandled exception:", error);
    await notifyTelegram(`🚨 <b>AGENT SRE CRASH:</b> <code>${error.message}</code>`);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});
