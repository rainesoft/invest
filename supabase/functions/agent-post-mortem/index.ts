import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2.108.2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY") || "";
const TG_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN") ?? "";
const TG_CHAT = Deno.env.get("TELEGRAM_CHAT_ID") ?? "";

async function notifyTelegram(text: string) {
  if (!TG_TOKEN || !TG_CHAT) return;
  const url = `https://api.telegram.org/bot${TG_TOKEN}/sendMessage`;
  await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: TG_CHAT, text, parse_mode: "Markdown" }),
  }).catch(() => {});
}

serve(async (req) => {
  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Get timestamp for 7 days ago
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    const dateString = sevenDaysAgo.toISOString();

    console.log(`[Post-Mortem] Fetching data since ${dateString}...`);

    // 1. Fetch user trades (financial outcomes)
    const { data: closedTrades, error: tradesError } = await supabase
      .from("user_trades")
      .select("symbol, side, status, profit_usd, closed_at, trade_type, created_at, opportunity_id")
      .gte("created_at", dateString)
      .in("status", ["CLOSED", "AUTO_CLOSED", "EXPIRED", "FAILED"]);

    if (tradesError) throw tradesError;

    // 2. Fetch trade opportunities (AI context)
    const { data: opportunities, error: oppsError } = await supabase
      .from("trade_opportunities")
      .select("id, symbol, side, status, ai_summary, ai_risks, created_at")
      .gte("created_at", dateString);

    if (oppsError) throw oppsError;

    // Pre-calculate metrics
    const stats: Record<string, { wins: number, losses: number, total_pnl: number, count: number }> = {};
    let totalWins = 0;
    let totalLosses = 0;
    let totalPnL = 0;

    const completedTrades = closedTrades?.filter(t => t.profit_usd !== null && t.status === "CLOSED") || [];
    
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

    const totalCompleted = totalWins + totalLosses;
    const winRate = totalCompleted > 0 ? ((totalWins / totalCompleted) * 100).toFixed(2) + "%" : "0%";

    // --- SHADOW LEDGER EVALUATION ---
    const { data: shadowPending, error: shadowErr } = await supabase
      .from("shadow_ledger")
      .select("*")
      .eq("status", "PENDING")
      .gte("created_at", dateString);
      
    if (shadowErr) console.error("[Shadow Ledger] Fetch error:", shadowErr);
    
    let shadowStats: Record<string, any> = {};
    const META_TOKEN = Deno.env.get("META_API_TOKEN") || "";
    const META_ACCOUNT = Deno.env.get("META_API_ACCOUNT_ID") || "";
    const META_BASE_URL = Deno.env.get("META_API_BASE_URL") || "https://mt-client-api-v1.london.agiliumtrade.ai";

    if (shadowPending && shadowPending.length > 0 && META_TOKEN && META_ACCOUNT) {
       console.log(`[Shadow Ledger] Evaluating ${shadowPending.length} raw AI signals...`);
       
       for (const sig of shadowPending) {
         try {
           if (!sig.take_profit || !sig.stop_loss) continue;
           
           // Fetch candles since signal creation
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
             await supabase.from("shadow_ledger")
                .update({ status: finalStatus, evaluated_at: new Date().toISOString() })
                .eq("id", sig.id);
           }
         } catch(e) {
            console.error(`[Shadow Ledger] Error evaluating signal ${sig.id}:`, e);
         }
       }
    }

    // Fetch all evaluated shadow records for the week to include in stats
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
        shadowStats[key].win_rate = shadowStats[key].total > 0 ? ((shadowStats[key].wins / shadowStats[key].total) * 100).toFixed(2) + "%" : "0%";
      }
    }

    // Prepare JSON payload for LLM
    const llmPayload = {
      summary: {
        total_trades: totalCompleted,
        total_wins: totalWins,
        total_losses: totalLosses,
        win_rate: winRate,
        overall_pnl_usd: totalPnL.toFixed(2),
        symbol_breakdown: stats
      },
      shadow_ledger_stats: shadowStats, // Pure AI mathematical win rates
      opportunities: opportunities?.map(o => ({
        symbol: o.symbol,
        side: o.side,
        status: o.status,
        rationale: o.ai_summary,
        risks: o.ai_risks
      })).slice(0, 50) // Limit to avoid context window explosion
    };

    console.log("[Post-Mortem] Sending payload to OpenAI for reflection...");

    // 3. LLM Reflection
    const systemPrompt = `You are the Chief Risk Officer and Lead Post-Mortem Analyst for an AI-driven hedge fund.
Your job is to review the week's trading performance across all autonomous agents.
Review the provided JSON payload containing the week's metrics and the AI reasoning behind the signals.

CRITICAL: The payload includes \`shadow_ledger_stats\`. This is the theoretical, mathematical win rate of every raw signal the AI generated (even those rejected by the Execution Desk). Use this to mathematically evaluate the AI's core predictive accuracy across different timeframes (e.g., "The AI is 68% accurate on 4H Gold, but only 42% accurate on 1H BTC").

Generate a comprehensive, professional Markdown report addressing:
1. Overall Performance Summary (Win rate, PnL).
2. Asset-by-Asset Breakdown (Which pairs succeeded/failed?).
3. Theoretical AI Predictive Accuracy (Analyze the shadow_ledger_stats to prove the AI's raw win-rate vs actual executed trades).
4. Root Cause Analysis of Failures (Did the agents misread a regime? Were they chopped out?).
5. Actionable Recommendations (e.g., "Suggest lowering R:R on XAGUSD", "Agents should avoid trading during XYZ regime").

Keep the tone highly analytical, institutional, and concise. Do NOT use markdown code blocks around the entire response. Just standard markdown formatting.`;

    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: "gpt-4o",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: `Weekly Data Payload: \n${JSON.stringify(llmPayload, null, 2)}` }
        ],
        temperature: 0.3
      })
    });

    if (!response.ok) {
      throw new Error(`OpenAI API Error: ${await response.text()}`);
    }

    const aiData = await response.json();
    const reflectionReport = aiData.choices[0].message.content;

    console.log("[Post-Mortem] Report generated successfully. Broadcasting...");

    // 4. Broadcast Report
    const header = `🧠 *AI WEEKLY POST-MORTEM & RISK REPORT* 🧠\n\n`;
    await notifyTelegram(header + reflectionReport);

    return new Response(JSON.stringify({ success: true, message: "Post-mortem completed." }), {
      headers: { "Content-Type": "application/json" }
    });

  } catch (error: any) {
    console.error("Post-mortem error:", error);
    return new Response(`Error: ${error.message}`, { status: 500 });
  }
});
