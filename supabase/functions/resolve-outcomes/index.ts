import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2.108.2";
import { insertAuditLog } from "../../../packages/core/audit.ts";
import { isMarketOpen } from "../../../packages/core/market.ts";
serve(async (req) => {

  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const openaiKey = Deno.env.get("OPENAI_API_KEY");
  
  if (!url || !key || !openaiKey) {
    return new Response(JSON.stringify({ ok: false, error: "Missing env vars" }), { status: 500 });
  }

  const authHeader = req.headers.get("Authorization");
  const cronSecretHeader = req.headers.get("x-cron-secret");
  const cronSecretEnv = Deno.env.get("CRON_SECRET");
  
  const isAuthorized = 
    authHeader === `Bearer ${key}` || 
    (cronSecretHeader && cronSecretEnv && cronSecretHeader === cronSecretEnv);

  if (!isAuthorized) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { "Content-Type": "application/json" } });
  }
  
  const supabase = createClient(url, key);

  // 1. Fetch active signals
  const { data: openSignals, error: fetchError } = await supabase
    .from("trade_opportunities")
    .select("*")
    .eq("status", "APPROVED");

  if (fetchError || !openSignals || openSignals.length === 0) {
    return new Response(JSON.stringify({ ok: true, message: "No active signals to evaluate" }), { status: 200 });
  }

  const results = [];

  // 2. The Price Action Check (The Simulator)
  for (const signal of openSignals) {
    const { symbol, side, timeframe, created_at, entry_plan_json, stop_plan_json, take_profit_json } = signal;
    
    if (req.method === "POST" && !isMarketOpen(symbol)) {
      continue;
    }
    
    const entryPrice = entry_plan_json?.price ?? entry_plan_json?.limit_price ?? entry_plan_json?.entry_price;
    // Safety check
    if (entryPrice === undefined || entryPrice === null || !stop_plan_json?.stop || !take_profit_json?.tp) {
      continue;
    }
    
    const stopLoss = stop_plan_json.stop;
    const takeProfit = take_profit_json.tp;

    // Fetch subsequent candles for this symbol from market_data_pti
    const { data: candles } = await supabase
      .from("market_data_pti")
      .select("ts, o, h, l, c")
      .eq("symbol", symbol)
      .eq("timeframe", timeframe)
      .gt("ts", created_at)
      .order("ts", { ascending: true });

    if (!candles || candles.length === 0) {
      continue; // No new market data yet
    }

    let outcome: 'WON' | 'LOST' | 'EXPIRED' | null = null;
    let rMultiple = 0;
    let closedAt = null;
    let state: 'PENDING' | 'ACTIVE' = 'PENDING';

    // Calculate actual risk in price units to compute real R-multiple
    const riskPerUnit = Math.abs(entryPrice - stopLoss);
    const catastrophicBuffer = riskPerUnit * 2.0;

    for (let i = 0; i < candles.length; i++) {
      const candle = candles[i];

      // Enforce 20-Period Anticipation Horizon: Expire setup if 20 bars elapsed without conclusion
      if (i >= 20 && outcome === null) {
        outcome = 'EXPIRED';
        closedAt = candle.ts;
        break;
      }

      if (side === 'BULLISH' || side === 'LONG') {
        if (state === 'PENDING') {
          // Has price reached our Entry?
          if ((candle.l <= entryPrice && candle.h >= entryPrice) || 
              (entry_plan_json.type?.includes("Limit") ? candle.l <= entryPrice : candle.h >= entryPrice)) {
            state = 'ACTIVE';
          }
        }

        if (state === 'ACTIVE') {
          // 1. Did the candle hit TP? (Take Profit is a limit order -> wick touch triggers WON)
          if (candle.h >= takeProfit) {
            outcome = 'WON';
            rMultiple = riskPerUnit > 0 ? (takeProfit - entryPrice) / riskPerUnit : 2.0;
            closedAt = candle.ts;
            break;
          }
          // 2. Bar-Close Stop Loss (Trading Central Institutional Rule):
          // Evaluated strictly on confirmed bar close (candle.c), allowing intra-bar wicks to breathe
          // Catastrophic safety threshold (2x ATR beyond stop) also triggers
          else if (candle.c <= stopLoss || (candle.l <= stopLoss - catastrophicBuffer)) {
            outcome = 'LOST';
            rMultiple = riskPerUnit > 0 ? -((entryPrice - stopLoss) / riskPerUnit) : -1.0;
            closedAt = candle.ts;
            break;
          }
        }
      } else if (side === 'BEARISH' || side === 'SHORT') {
        if (state === 'PENDING') {
          // Has price reached our Entry?
          if ((candle.h >= entryPrice && candle.l <= entryPrice) ||
              (entry_plan_json.type?.includes("Limit") ? candle.h >= entryPrice : candle.l <= entryPrice)) {
            state = 'ACTIVE';
          }
        }

        if (state === 'ACTIVE') {
          // 1. Did the candle hit TP? (Take Profit is a limit order -> wick touch triggers WON)
          if (candle.l <= takeProfit) {
            outcome = 'WON';
            rMultiple = riskPerUnit > 0 ? (entryPrice - takeProfit) / riskPerUnit : 2.0;
            closedAt = candle.ts;
            break;
          }
          // 2. Bar-Close Stop Loss (Trading Central Institutional Rule):
          // Evaluated strictly on confirmed bar close (candle.c), allowing intra-bar wicks to breathe
          // Catastrophic safety threshold (2x ATR beyond stop) also triggers
          else if (candle.c >= stopLoss || (candle.h >= stopLoss + catastrophicBuffer)) {
            outcome = 'LOST';
            rMultiple = riskPerUnit > 0 ? -((stopLoss - entryPrice) / riskPerUnit) : -1.0;
            closedAt = candle.ts;
            break;
          }
        }
      }
    }

    // 3. Real-Time AI Post-Mortem (Feedback Loop)
    let finalAiSummary = signal.ai_summary;
    if (outcome === 'LOST') {
      try {
        console.log(`[Post-Mortem] Triggering real-time reflection for ${symbol}...`);
        const recentCandles = candles.slice(-10); // Last 10 candles leading to the stop loss
        const prompt = `You are a Post-Mortem AI for an algorithmic trading desk.
A recent ${side} trade on ${symbol} just hit its Stop Loss.

[ORIGINAL AI REASONING]:
${signal.ai_summary}

[TRADE PARAMETERS]:
Entry: ${entryPrice}
Stop Loss: ${stopLoss}
Take Profit: ${takeProfit}

[LAST 10 CANDLES BEFORE STOP LOSS]:
${JSON.stringify(recentCandles)}

Analyze the failure. Was the original reasoning flawed? Did we buy into resistance? Was it just market noise?
Provide a concise, 1-2 sentence post-mortem explanation. Do not use markdown.`;

        const res = await fetch("https://api.openai.com/v1/chat/completions", {
          method: "POST",
          headers: { "Content-Type": "application/json", "Authorization": `Bearer ${openaiKey}` },
          body: JSON.stringify({
            model: "gpt-4o-mini",
            messages: [{ role: "user", content: prompt }],
            temperature: 0.2
          })
        });

        if (res.ok) {
          const json = await res.json();
          const reflection = json.choices?.[0]?.message?.content?.trim();
          if (reflection) {
            finalAiSummary = `${signal.ai_summary}\n\n[POST-MORTEM]: ${reflection}`;
            console.log(`[Post-Mortem] Generated reflection: ${reflection}`);
          }
        }
      } catch (err: any) {
        console.error(`[Post-Mortem] Error generating reflection for ${symbol}: ${err.message}`);
      }
    }

    // 4. The Ledger Update
    if (outcome) {
      const { error: updateError } = await supabase
        .from("trade_opportunities")
        .update({
          status: outcome,
          r_multiple: rMultiple,
          ai_summary: finalAiSummary,
          closed_at: closedAt
        })
        .eq("id", signal.id);

      if (!updateError) {
        results.push({ id: signal.id, outcome, rMultiple });
        
        await insertAuditLog(supabase, {
          actor_type: "SYSTEM",
          action: "OUTCOME_RESOLVED",
          entity_type: "trade_opportunity",
          entity_id: signal.id,
          payload_json: { outcome, r_multiple: rMultiple, closed_at: closedAt }
        });
      }
    }
  }

  return new Response(JSON.stringify({ ok: true, resolved: results }), { headers: { "content-type": "application/json" } });
});
