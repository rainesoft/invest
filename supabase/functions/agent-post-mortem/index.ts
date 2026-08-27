import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2.108.2";
import { insertAuditLog } from "../../../packages/core/audit.ts";

/**
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║                 AGENT POST-MORTEM & WEEKLY INTELLIGENCE                  ║
 * ║  Unified hub for Institutional CRO Deep-Dives and Executive Reporting    ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 */

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const CRON_SECRET = Deno.env.get("CRON_SECRET") || "";
const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY") || "";
const TG_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN") ?? "";
const TG_CHAT = Deno.env.get("TELEGRAM_CHAT_ID") ?? "";

async function notifyTelegram(text: string, parseMode: "HTML" | "Markdown" = "HTML") {
  if (!TG_TOKEN || !TG_CHAT) return;
  try {
    const url = `https://api.telegram.org/bot${TG_TOKEN}/sendMessage`;
    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: TG_CHAT,
        text,
        parse_mode: parseMode,
        disable_web_page_preview: true,
      }),
    });
  } catch (e) {
    console.error("[Agent Post-Mortem] Telegram dispatch failed:", e);
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
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    let body: any = {};
    if (req.method === "POST") {
      try {
        const text = await req.text();
        if (text && text.trim().length > 0) {
          body = JSON.parse(text);
        }
      } catch (_) {}
    }

    const mode = body?.mode || body?.action || "ALL"; // "EXECUTIVE_SUMMARY" | "CRO_REPORT" | "ALL"
    const lookbackDays = Number(body?.days || 7);

    const lookbackDate = new Date();
    lookbackDate.setDate(lookbackDate.getDate() - lookbackDays);
    const dateString = lookbackDate.toISOString();

    console.log(`[Agent Post-Mortem] Starting ${mode} evaluation for past ${lookbackDays} days (since ${dateString})...`);

    // ─────────────────────────────────────────────────────────────
    // 1. Fetch Closed Opportunities & User Trades
    // ─────────────────────────────────────────────────────────────
    const { data: opportunities, error: oppsError } = await supabase
      .from("trade_opportunities")
      .select("id, symbol, side, status, r_multiple, ai_summary, ai_risks, created_at, closed_at")
      .gte("created_at", dateString);

    if (oppsError) throw oppsError;

    const { data: closedTrades, error: tradesError } = await supabase
      .from("user_trades")
      .select("id, symbol, side, status, profit_usd, closed_at, trade_type, created_at, opportunity_id")
      .gte("created_at", dateString)
      .in("status", ["CLOSED", "AUTO_CLOSED", "EXPIRED", "FAILED", "WON", "LOST"]);

    if (tradesError) throw tradesError;

    // ─────────────────────────────────────────────────────────────
    // 2. Compute Core Financial & Performance Metrics
    // ─────────────────────────────────────────────────────────────
    const resolvedOpps = opportunities?.filter((o) => ["WON", "LOST"].includes(o.status)) || [];
    const totalResolvedOpps = resolvedOpps.length;
    let wonOpps = 0;
    let netR = 0;

    for (const opp of resolvedOpps) {
      if (opp.status === "WON") wonOpps++;
      if (opp.r_multiple != null) {
        netR += Number(opp.r_multiple);
      }
    }

    const oppWinRate = totalResolvedOpps > 0 ? ((wonOpps / totalResolvedOpps) * 100).toFixed(1) : "0.0";
    const formattedNetR = netR > 0 ? `+${netR.toFixed(2)}` : netR.toFixed(2);

    // User Trades PnL metrics
    const stats: Record<string, { wins: number; losses: number; total_pnl: number; count: number }> = {};
    let totalWins = 0;
    let totalLosses = 0;
    let totalPnL = 0;

    const completedTrades = closedTrades?.filter((t) => t.profit_usd !== null) || [];
    for (const trade of completedTrades) {
      if (!stats[trade.symbol]) stats[trade.symbol] = { wins: 0, losses: 0, total_pnl: 0, count: 0 };
      const pnl = Number(trade.profit_usd) || 0;
      stats[trade.symbol].count++;
      stats[trade.symbol].total_pnl += pnl;
      totalPnL += pnl;
      if (pnl > 0) {
        stats[trade.symbol].wins++;
        totalWins++;
      } else {
        stats[trade.symbol].losses++;
        totalLosses++;
      }
    }

    const totalTradeCount = totalWins + totalLosses;
    const tradeWinRate = totalTradeCount > 0 ? ((totalWins / totalTradeCount) * 100).toFixed(1) + "%" : "0%";

    const summaryPayload = {
      evaluated_days: lookbackDays,
      total_setups_evaluated: opportunities?.length || 0,
      total_resolved_opportunities: totalResolvedOpps,
      won_opportunities: wonOpps,
      lost_opportunities: totalResolvedOpps - wonOpps,
      opportunity_win_rate: `${oppWinRate}%`,
      net_r_multiple: formattedNetR,
      total_executed_trades: totalTradeCount,
      realized_pnl_usd: totalPnL.toFixed(2),
      trade_win_rate: tradeWinRate,
      symbol_breakdown: stats,
    };

    let executiveMessageSent = false;
    let croReportSent = false;

    // ─────────────────────────────────────────────────────────────
    // 3. EXECUTIVE SUMMARY (Public / Social Media Summary)
    // ─────────────────────────────────────────────────────────────
    if (mode === "EXECUTIVE_SUMMARY" || mode === "ALL") {
      const executiveCopy = [
        `📊 <b>RaineInvest Alpha Engine: Weekly Audit</b>`,
        ``,
        `Another week of autonomous, mathematically verified execution.`,
        ``,
        `🔹 <b>Net Performance:</b> <code>${formattedNetR} R-Multiple</code>`,
        `🔹 <b>Win Rate:</b> <code>${oppWinRate}%</code>`,
        `🔹 <b>Total Setups Evaluated:</b> <code>${totalResolvedOpps}</code>`,
        `🔹 <b>Realized PnL:</b> <code>$${totalPnL.toFixed(2)}</code>`,
        ``,
        `The risk engine enforced strict 1:2 R/R and asset isolation rules without emotional drift.`,
        ``,
        `<i>Live ledger and delayed feed are available at https://raineinvest.com.</i>`,
      ].join("\n");

      await notifyTelegram(executiveCopy, "HTML");
      executiveMessageSent = true;
    }

    // ─────────────────────────────────────────────────────────────
    // 4. CRO INSTITUTIONAL DEEP-DIVE (Shadow Ledger + GPT-4o Review)
    // ─────────────────────────────────────────────────────────────
    let reflectionReport = "";
    if (mode === "CRO_REPORT" || mode === "ALL") {
      const META_TOKEN = Deno.env.get("META_API_TOKEN") || "";
      const META_ACCOUNT = Deno.env.get("META_API_ACCOUNT_ID") || "";
      const META_BASE_URL = Deno.env.get("META_API_BASE_URL") || "https://mt-client-api-v1.london.agiliumtrade.ai";

      // 4A. Shadow Ledger Evaluation
      const { data: shadowPending } = await supabase
        .from("shadow_ledger")
        .select("*")
        .eq("status", "PENDING")
        .gte("created_at", dateString);

      if (shadowPending && shadowPending.length > 0 && META_TOKEN && META_ACCOUNT) {
        console.log(`[Agent Post-Mortem] Evaluating ${shadowPending.length} raw AI signals in Shadow Ledger...`);
        for (const sig of shadowPending) {
          try {
            if (!sig.take_profit || !sig.stop_loss) continue;
            const startTime = new Date(sig.created_at).toISOString();
            const url = `${META_BASE_URL}/users/current/accounts/${META_ACCOUNT}/historical-market-data/symbols/${sig.symbol}/candles/1h?startTime=${startTime}&limit=100`;
            const res = await fetch(url, { headers: { "auth-token": META_TOKEN } });
            if (!res.ok) continue;
            const candles = await res.json();

            let finalStatus = "PENDING";
            for (const candle of candles) {
              const high = candle.high;
              const low = candle.low;
              if (sig.side === "LONG") {
                if (low <= sig.stop_loss) { finalStatus = "LOST"; break; }
                if (high >= sig.take_profit) { finalStatus = "WON"; break; }
              } else if (sig.side === "SHORT") {
                if (high >= sig.stop_loss) { finalStatus = "LOST"; break; }
                if (low <= sig.take_profit) { finalStatus = "WON"; break; }
              }
            }

            if (finalStatus !== "PENDING") {
              await supabase
                .from("shadow_ledger")
                .update({ status: finalStatus, evaluated_at: new Date().toISOString() })
                .eq("id", sig.id);
            }
          } catch (e) {
            console.error(`[Agent Post-Mortem] Shadow evaluation error for ${sig.id}:`, e);
          }
        }
      }

      // 4B. Aggregate Shadow Stats
      const shadowStats: Record<string, any> = {};
      const { data: shadowEvaluated } = await supabase
        .from("shadow_ledger")
        .select("symbol, timeframe, status")
        .in("status", ["WON", "LOST"])
        .gte("created_at", dateString);

      if (shadowEvaluated) {
        for (const sig of shadowEvaluated) {
          const key = `${sig.symbol} (${sig.timeframe})`;
          if (!shadowStats[key]) shadowStats[key] = { wins: 0, losses: 0, total: 0 };
          shadowStats[key].total++;
          if (sig.status === "WON") shadowStats[key].wins++;
          if (sig.status === "LOST") shadowStats[key].losses++;
        }
        for (const key in shadowStats) {
          shadowStats[key].win_rate =
            shadowStats[key].total > 0
              ? ((shadowStats[key].wins / shadowStats[key].total) * 100).toFixed(1) + "%"
              : "0%";
        }
      }

      // 4C. GPT-4o Reflection Analysis
      if (OPENAI_API_KEY) {
        const llmPayload = {
          summary: summaryPayload,
          shadow_ledger_stats: shadowStats,
          sample_opportunities: opportunities?.slice(0, 30).map((o) => ({
            symbol: o.symbol,
            side: o.side,
            status: o.status,
            r_multiple: o.r_multiple,
            rationale: o.ai_summary,
            risks: o.ai_risks,
          })),
        };

        const systemPrompt = `You are the Chief Risk Officer and Lead Post-Mortem Analyst for an institutional AI-driven hedge fund.
Review the provided weekly performance payload.
Analyze:
1. Overall Performance Summary (Win rate, net R-multiple, realized PnL).
2. Asset-by-Asset Breakdown (Which pairs performed best/worst).
3. Shadow Ledger Analysis (Theoretical predictive accuracy vs actual executions).
4. Root Cause Analysis of Failures (Regime misalignment, chop, volatility spikes).
5. Actionable CRO Directives for next week.
Format in clear, institutional Markdown without wrapping the entire output in code blocks.`;

        try {
          const aiResponse = await fetch("https://api.openai.com/v1/chat/completions", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${OPENAI_API_KEY}`,
            },
            body: JSON.stringify({
              model: "gpt-4o",
              messages: [
                { role: "system", content: systemPrompt },
                { role: "user", content: `Weekly Performance Data:\n${JSON.stringify(llmPayload, null, 2)}` },
              ],
              temperature: 0.3,
            }),
          });

          if (aiResponse.ok) {
            const aiData = await aiResponse.json();
            reflectionReport = aiData.choices?.[0]?.message?.content || "";
            if (reflectionReport) {
              const header = `🧠 *AI WEEKLY POST-MORTEM & RISK REPORT* 🧠\n\n`;
              await notifyTelegram(header + reflectionReport, "Markdown");
              croReportSent = true;
            }
          } else {
            console.error("[Agent Post-Mortem] OpenAI API error:", await aiResponse.text());
          }
        } catch (aiErr) {
          console.error("[Agent Post-Mortem] LLM reflection failed:", aiErr);
        }
      }
    }

    // ─────────────────────────────────────────────────────────────
    // 5. Audit Logging
    // ─────────────────────────────────────────────────────────────
    await insertAuditLog(supabase, {
      action: "WEEKLY_POST_MORTEM_GENERATED",
      actor_type: "SYSTEM",
      entity_type: "analytics",
      payload_json: {
        mode,
        summary: summaryPayload,
        executiveMessageSent,
        croReportSent,
      },
    });

    return new Response(
      JSON.stringify({
        success: true,
        mode,
        summary: summaryPayload,
        executive_broadcast: executiveMessageSent,
        cro_report: croReportSent,
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  } catch (error: any) {
    console.error("[Agent Post-Mortem] Exception:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});
