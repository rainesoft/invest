import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient, SupabaseClient } from "npm:@supabase/supabase-js@2.108.2";
import { fetchPaperBars, Bar, placePaperOrder, makeClientOrderId } from "../../../packages/execution/index.ts";
import { sma, rsi, detectRegime } from "../../../packages/strategy/index.ts";
import { insertAuditLog } from "../../../packages/core/audit.ts";
import { isMarketOpen } from "../../../packages/core/market.ts";
import { netEdge, transactionCost, slippage } from "../../../packages/strategy/index.ts";
import { getContextSnapshot, LogicContext, calculatePivotPoints, computeLiquiditySweepScore } from "../../../packages/strategy/indicators.ts";
import { validateGlobalSignal } from "../../../packages/strategy/agent-risk.ts";
import { fetchAllMacroEvents, generateMacroContext, fetchRealtimeNews, detectCentralBankEvent, detectUpcomingFedEvent, computeMacroConfidenceBoost, fetchETFFlowSentiment } from "../../../packages/core/news.ts";
import { isAutoTradingEnabled } from "../../../packages/core/settings.ts";

import { revalidateOpportunity } from "../../../packages/strategy/revalidation.ts";

import { sizeWithRiskCaps } from "../../../packages/risk/index.ts";
import OpenAI from "npm:openai";
import { z } from "npm:zod";

async function hashBar(b: Bar) {
  const str = `${b.t}|${b.o}|${b.h}|${b.l}|${b.c}|${b.v}`;
  const buf = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(str),
  );
  return Array.from(new Uint8Array(buf))
    .map((n) => n.toString(16).padStart(2, "0"))
    .join("");
}

async function saveBars(
  supabase: SupabaseClient,
  symbol: string,
  timeframe: string,
  bars: Bar[],
) {
  for (const b of bars) {
    const hash = await hashBar(b);
    const { data: existing } = await supabase
      .from("market_data_pti")
      .select("hash, revision")
      .eq("symbol", symbol)
      .eq("timeframe", timeframe.toLowerCase())
      .eq("ts", b.t)
      .order("revision", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (existing && existing.hash === hash) continue;

    const revision = existing ? existing.revision + 1 : 0;
    await supabase.from("market_data_pti").insert({
      symbol,
      timeframe: timeframe.toLowerCase(),
      ts: b.t,
      o: b.o,
      h: b.h,
      l: b.l,
      c: b.c,
      v: b.v,
      revision,
      hash,
    });
  }
}

async function pingHFTDirector(symbol: string, bias: string) {
  try {
    const webhookUrl = (Deno.env.get("SUPABASE_URL") || "").replace(/\/$/, "") + "/functions/v1/agent-hft-director";
    await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ symbol, bias })
    });
    console.log(`[Hive Mind] Synchronized ${symbol} HFT bias to ${bias}`);
  } catch (e) {
    console.error(`[Hive Mind] Failed to synchronize HFT bias for ${symbol}:`, e);
  }
}

const TradeEvaluationSchema = z.object({
  thought_process: z.string().describe("Briefly evaluate the EMAs, state the LTF BOS, calculate the Entry, SL, TP, and verify the R:R ratio mathematically BEFORE returning parameters."),
  calculated_rr: z.number().nullable().describe("The mathematical R:R calculated in the thought_process"),
  technical_audit: z.object({
    current_price: z.number(),
    ema_50: z.number(),
    ema_200: z.number(),
    price_position: z.enum(["ABOVE_BOTH", "BELOW_BOTH", "BETWEEN_EMAS"]),
    ltf_bos: z.enum(["BULLISH", "BEARISH", "NONE"])
  }),
  market_structure: z.enum(["BULLISH_TREND", "BEARISH_TREND", "RANGING", "BREAKOUT"]),
  recommended_direction: z.enum(["LONG", "SHORT", "NONE"]),
  strategy_applied: z.enum(["PULLBACK", "MOMENTUM_CONTINUATION", "MEAN_REVERSION", "MOMENTUM_BREAKOUT", "NONE"]),
  execution_parameters: z.object({
    entry_type: z.enum(["Buy Limit", "Sell Limit", "Buy Stop", "Sell Stop", "Market", "NONE"]),
    suggested_entry_price: z.number().describe("The exact numeric price level to enter the trade. MUST be provided."),
    scaled_entries: z.array(z.object({ price: z.number(), weight: z.number() })).nullable().optional(),
    suggested_stop_loss: z.number().describe("The exact numeric price level for the stop loss. MUST be provided."),
    suggested_take_profit: z.number().describe("The exact numeric price level for the take profit. MUST be provided.")
  }),
  confidence_score: z.number(),
  institutional_rationale: z.object({
    directional_bias: z.string(),
    execution_trigger: z.string(),
    invalidation_point: z.string(),
    take_profit_target: z.string(),
    fundamental_alignment: z.string()
  })
});

async function evaluateOpportunity(symbol: string, snapshot: LogicContext & { agent_context?: any[] }, timeframe: string, historicalMemory: string) {
  const openaiKey = Deno.env.get("OPENAI_API_KEY");
  if (!openaiKey) throw new Error("No OpenAI key found");

  const headers = {
    "Authorization": `Bearer ${openaiKey}`,
    "Content-Type": "application/json"
  };

  console.log(`[Responses API] Submitting ${symbol} analysis...`);
  
  const body = {
    model: "gpt-4o",
    input: `Evaluate the raw market data for ${symbol} on the ${timeframe} timeframe at current price ${snapshot.current_price} and autonomously originate the highest probability trade setup, if any. Return the required execution profile using the provided tools.
    
CRITICAL RULES:

0. ORDER OF OPERATIONS (CRITICAL PRIORITY):
   - STEP 1: Determine the Intraday Pivot Regime. If Current Price > htf_pivot, your regime is BULLISH. If Current Price < htf_pivot, your regime is BEARISH.
   - STEP 2: Consult the Indicators. Check MACD (macd_line, macd_signal, macd_histogram) and moving averages (ema_20 and ema_50, or ema_50 and ema_200). 
   - STEP 3: Ensure Indicator Confluence. If Regime is BEARISH, ensure MACD is negative and price is below MA 50 before shorting. If Regime is BULLISH, ensure MACD is positive and price is above MA 50 before longing.

1. PIVOT DIRECTIONAL BIAS: You are trading the 30-minute Intraday timeframe. You MUST align your direction with the Pivot Regime. Do NOT force a LONG trade if the price is below the Daily Pivot (htf_pivot), regardless of the 1D macro trend. If price breaks below the Pivot, it is a SHORT setup.
2. TARGETS (ASYMMETRIC RISK): If originating a LONG trade, you MUST target the second liquidity pool (Resistance 2) as your primary suggested_take_profit to ensure high R:R. If originating a SHORT trade, target Support 2 as your primary take_profit.
3. INVALIDATION (SAFE STOPS): Your stop loss MUST be placed safely outside the ATR buffer and behind major HTF structural pivots. Do NOT place overly tight stops just to maximize R:R. A safe stop with a 1.5 R:R is far superior to a tight stop that gets hunted.
4. If indicators are completely conflicting (e.g., Price > Pivot but MACD deeply negative and price < MA200), invoke 'reject_trade' to stay flat.
5. NO MEAN REVERSION AGAINST PIVOT: Do not buy a dip if it breaks below the pivot. A break below the pivot is a trend reversal, not a pullback.
6. REQUIRED PARAMETERS: You MUST provide a numeric suggested_entry_price, suggested_stop_loss, and suggested_take_profit for ANY trade setup. Do not return nulls for these fields.
7. LIMIT ORDERS FOR BETTER ENTRIES: If the price is hovering mid-range between the Pivot and Support/Resistance, do not reject the setup. Instead, issue a BUY LIMIT or SELL LIMIT at the Pivot to catch the wick.
8. HIGH-LEVERAGE ASSETS (VOLATILITY): Indices (US30, NAS100) and Metals (XAGUSD) have massive volatility wicks. You MUST use wider structural stops for these assets to survive normal market noise. Do not use tight stops.
9. MEAN REVERSION STRICT GUARD: You are ONLY authorized to use a MEAN_REVERSION strategy if ADX < 25 (Choppy/Ranging). If ADX > 25, the market has strong momentum—DO NOT attempt mean reversion against strong momentum, as you will be run over.
10. PROXIMITY RULES: Do not reject a trade for being 'too close' to resistance/support unless the distance is < 0.1% for Forex pairs, or < 0.015% for Indices (US30, NAS100) and Metals.
11. NO COUNTER-TREND HEROICS: Do not attempt to catch "short-term retracements" against the dominant macro trend. If the HTF Trend is BEARISH, you may ONLY look for SHORT setups. If BULLISH, ONLY look for LONG setups.
12. SMART MONEY ORDER FLOW & VWAP VALUE DISCIPLINE:
    - VWAP PULLBACKS: In a BULLISH regime, optimal long entries occur when price is testing Session VWAP, POC, or bouncing off the lower VWAP band (lower1). Do NOT chase breakout longs if price is already at EXTREME_OVERBOUGHT (> upper2).
    - BREAKOUT VOLUME REQUIREMENT: For MOMENTUM_BREAKOUT or Stop orders (Buy Stop / Sell Stop), you MUST verify that volume_surge is true or volume_ratio >= 1.4. If volume is LOW or ANEMIC, reject the breakout as a false trap or place a LIMIT order pullback at the POC (poc_price) / HVN (nearest_hvn).
    - VALUE AREA ACCEPTANCE: When price is within the Value Area (in_value_area: true), expect mean reversion toward POC. Trend continuations require acceptance outside VAH/VAL on expanding volume.

Historical Memory:
${historicalMemory || "None"}

Current Market Context:
${JSON.stringify(snapshot, null, 2)}`,
    tools: [
      {
        type: "function",
        name: "approve_trade",
        description: "Submit this action when the trade meets all criteria and confluence.",
        parameters: {
          type: "object",
          properties: {
            thought_process: { type: "string", description: "Step-by-step reasoning for the approval. You MUST calculate your R:R before filling in the execution parameters. You MUST verify that the suggested_entry_price exactly matches the chosen structural or SMC zone." },
            confidence_score: { type: "number", description: "Score 0-100" },
            recommended_direction: { type: "string", enum: ["LONG", "SHORT", "REQUIRE_LTF_DRILLDOWN"] },
            structural_confirmation: { type: "string" },
            market_structure: { type: "string" },
            strategy_applied: { type: "string" },
            suggested_entry_price: { type: "number" },
            suggested_stop_loss: { type: "number" },
            take_profit_1: { type: "number", description: "Target 1 (e.g., S1 or R1)" },
            take_profit_2: { type: "number", description: "Target 2 (e.g., S2 or R2)" },
            rationale: { type: "string" },
            order_type: { type: "string" },
            direction: { type: "string" },
            entry_price: { type: "number" },
            stop_loss: { type: "number" },
            take_profit: { type: "number" }
          },
          required: [
            "thought_process", "confidence_score", "recommended_direction", "structural_confirmation",
            "market_structure", "strategy_applied", "suggested_entry_price", "suggested_stop_loss",
            "take_profit_1", "take_profit_2", "rationale"
          ]
        }
      },
      {
        type: "function",
        name: "reject_trade",
        description: "Submit this action when the trade contradicts macro bias or is technically weak.",
        parameters: {
          type: "object",
          properties: {
            thought_process: { type: "string", description: "Step-by-step reasoning for the rejection. You MUST explicitly state why the MACRO SENSITIVITY (Rule 4) override did not apply before rejecting." },
            rejection_math_proof: { type: "string", description: "You MUST calculate the boundary percentage distance step-by-step here BEFORE outputting the reason. Do NOT output a lazy INFLECTION_POINT_WAIT without proving the math first." },
            distance_to_level_percent: { type: "number", description: "The calculated percentage distance from the current price to the nearest Fib/Structural level. Must be calculated BEFORE invoking INFLECTION_POINT_WAIT." },
            reason: { type: "string" }
          },
          required: ["thought_process", "rejection_math_proof", "distance_to_level_percent", "reason"]
        }
      }
    ],
    tool_choice: "required",
    parallel_tool_calls: false
  };

  const responseRes = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers,
    body: JSON.stringify(body)
  });

  const responseData = await responseRes.json();
  
  if (responseData.error) {
    throw new Error(`Responses API Error: ${responseData.error.message}`);
  }

  const output = responseData.output;
  if (!output || output.length === 0) {
    throw new Error("No output returned from Responses API");
  }

  // Look for a function_call in the output array
  const toolCall = output.find((item: any) => item.type === "function_call");

  if (!toolCall) {
    throw new Error(`No tool call returned from AI. Full output: ${JSON.stringify(output)}`);
  }

  console.log(`[Responses API] Tool called: ${toolCall.name}`);
  const args = JSON.parse(toolCall.arguments);

  if (toolCall.name === "reject_trade") {
    const mathProof = args.rejection_math_proof ? `\n[Math Proof]: ${args.rejection_math_proof}` : "";
    return {
      recommended_direction: "NONE",
      market_structure: "NONE",
      strategy_applied: "NONE",
      thought_process: args.thought_process || args.reason || args.rationale || JSON.stringify(args),
      institutional_rationale: { directional_bias: args.reason + mathProof },
      confidence_score: 0
    };
  }

  if (toolCall.name === "approve_trade") {
      return {
        thought_process: args.rationale,
        market_structure: args.market_structure,
        recommended_direction: args.direction || args.recommended_direction,
        strategy_applied: args.strategy_applied,
        execution_parameters: {
          entry_type: args.order_type,
          suggested_entry_price: args.entry_price || args.suggested_entry_price,
          suggested_stop_loss: args.stop_loss || args.suggested_stop_loss,
          suggested_take_profit: args.take_profit || args.take_profit_1 || args.take_profit_2,
          take_profit_1: args.take_profit_1,
          take_profit_2: args.take_profit_2
        },
        confidence_score: args.confidence_score,
        institutional_rationale: {
          directional_bias: args.rationale,
          execution_trigger: "",
          invalidation_point: "",
          take_profit_target: "",
          fundamental_alignment: ""
        }
      };
    }
  throw new Error(`Unexpected tool call: ${toolCall.name}`);
}



/**
 * Research run generates simple trade opportunities for one or more symbols.
 *
 * Query parameters:
 * - `symbols`   Comma-separated stock symbols (default AAPL)
 * - `timeframe` 1D or 1H (default 1D)
 * - `model_id`  Optional model identifier (for audit)
 * - `model_version` Optional model version (for audit)
 */
serve(async (req) => {
  const { searchParams } = new URL(req.url);
  const isCron = req.method === "POST";
  let reqBody = {};
  if (req.method === "POST" && req.headers.get("content-type")?.includes("application/json")) {
    try {
      reqBody = await req.json();
    } catch (e) {}
  }
  const timeframe = (reqBody as any).timeframe ?? searchParams.get("timeframe") ?? (isCron ? "30m" : "30m");
  const modelId = searchParams.get("model_id") ?? undefined;
  const modelVersion = searchParams.get("model_version") ?? undefined;
  const newsContext = searchParams.get("news") ?? undefined;
  const symbolsParam =
    (reqBody as any).symbols?.join(",") || searchParams.get("symbols") || Deno.env.get("RESEARCH_SYMBOLS") || "XAUUSD,XAGUSD,BTCUSD,UKOIL,EURUSD,GBPUSD,USDJPY,EURJPY,GBPJPY,AUDUSD,NZDUSD,AUDJPY,CADJPY,EURGBP,US30,NAS100";
  const symbols = symbolsParam.split(",").map((s: string) => s.trim()).filter(Boolean);

  symbols.sort((a, b) => {
    if (a === 'BTCUSD' && b !== 'BTCUSD') return -1;
    if (b === 'BTCUSD' && a !== 'BTCUSD') return 1;
    const aOpen = isMarketOpen(a);
    const bOpen = isMarketOpen(b);
    if (aOpen && !bOpen) return -1;
    if (!aOpen && bOpen) return 1;
    return 0;
  });

  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!url || !key) {
    return new Response(
      JSON.stringify({ ok: false, error: "missing env" }),
      { status: 500, headers: { "content-type": "application/json" } },
    );
  }

  const authHeader = req.headers.get("Authorization");
  const cronSecretHeader = req.headers.get("x-cron-secret");
  const cronSecretEnv = Deno.env.get("CRON_SECRET");
  
  const isAuthorized = 
    authHeader === `Bearer ${key}` || 
    (cronSecretHeader && cronSecretEnv && cronSecretHeader === cronSecretEnv);

  if (!isAuthorized) {
    return new Response(
      JSON.stringify({ ok: false, error: "Unauthorized" }),
      { status: 401, headers: { "content-type": "application/json" } },
    );
  }
  
  const supabase = createClient(url, key, {
    auth: { persistSession: false },
    global: { headers: { Authorization: `Bearer ${key}` } },
  });

  async function runPipeline(sendEvent: (data: any) => void) {
      const results: any[] = [];
      const rejections: any[] = [];
      
      try {
        console.log(`[Research Run] Starting pipeline for symbols: ${symbols.join(", ")}`);
        sendEvent({ type: 'progress', message: `Starting analysis pipeline for: ${symbols.join(", ")}` });
        
        // Guard: Volatility Lockout
        const { data: lockout } = await supabase
          .from("market_context")
          .select("id")
          .eq("macro_bias", "VOLATILITY_LOCKOUT")
          .gt("expires_at", new Date().toISOString())
          .limit(1);

        if (lockout && lockout.length > 0) {
          console.log(`[Research Run] VOLATILITY LOCKOUT active — skipping technical analysis to avoid fundamental chaos`);
          sendEvent({ type: 'progress', message: `[Guard] VOLATILITY LOCKOUT active — skipping technical evaluation.` });
          return;
        }
        
        let allEvents = null;
        if (!newsContext) {
          sendEvent({ type: 'progress', message: `[Macro Oracle] Reading global economic calendar from Central Oracle...` });
          const { data: oracleData } = await supabase.from("system_settings").select("value").eq("key", "macro_oracle_context").single();
          if (oracleData && oracleData.value) {
            allEvents = oracleData.value;
          } else {
            allEvents = await fetchAllMacroEvents(); // Fallback
          }

          if (allEvents && allEvents.length > 0) {
            // ==========================================
            // MACRO EVENT BREAKER (Limit Order Protection)
            // ==========================================
            const nowMs = Date.now();
            const thirtyMins = 30 * 60 * 1000;
            const imminentHighImpactEvents = allEvents.filter((e: any) => {
               const eventTime = new Date(e.date).getTime();
               const timeDiff = eventTime - nowMs;
               return e.impact === "High" && timeDiff > 0 && timeDiff <= thirtyMins;
            });

            // --- MANUAL TRADING PAUSE ---
            // User requested to pause all functions that can stop or kill live/pending trades.
            // Temporarily disabling the Macro Breaker limit-order cancellation.
            /*
            if (imminentHighImpactEvents.length > 0) {
            */
            if (false) {
            // ----------------------------
               const affectedCurrencies = new Set(imminentHighImpactEvents.map((e: any) => e.currency));
               console.log(`[Macro Breaker] Imminent High-Impact events detected for: ${Array.from(affectedCurrencies).join(", ")}. Force-expiring soft pending orders.`);
               sendEvent({ type: 'progress', message: `[Macro Breaker] Imminent High-Impact events detected for ${Array.from(affectedCurrencies).join(", ")}. Force-canceling pending limit orders.` });
               
               for (const currency of affectedCurrencies) {
                  // Find all PENDING user_trades where symbol includes this currency
                  const { data: pendingTrades } = await supabase.from("user_trades")
                    .select("id, symbol")
                    .eq("status", "PENDING")
                    .like("symbol", `%${currency}%`);
                    
                  if (pendingTrades && pendingTrades.length > 0) {
                    const tradeIds = pendingTrades.map((t: any) => t.id);
                    await supabase.from("user_trades").update({ 
                      status: "REJECTED", 
                      error_message: "Macro Event Breaker: High-Impact news within 30 minutes." 
                    }).in("id", tradeIds);
                    console.log(`[Macro Breaker] Canceled ${tradeIds.length} pending orders for ${currency} pairs.`);
                  }
               }
            }
          }
        }

        // ==========================================
        // FOMC / CENTRAL BANK INTELLIGENCE
        // Detect both pre-event (imminent) and post-event
        // windows. Sets a system_settings flag so agent-trade
        // can apply the 1.5x size multiplier at execution time.
        // ==========================================
        let fomcModeActive = false;
        let fomcPreEventActive = false;
        if (allEvents) {
          // Post-event: fired within last 6 hours
          const cbStatus = detectCentralBankEvent(allEvents, 6);
          if (cbStatus.isActive) {
            fomcModeActive = true;
            const names = cbStatus.events.map((e: any) => e.title).join(", ");
            console.log(`[FOMC Mode] Post-event window active: ${names}`);
            sendEvent({ type: 'progress', message: `[POST-EVENT VOLATILITY MODE] Central bank event within 6H: ${names}. FOMC size multiplier (1.5x) ACTIVE.` });
          }
          // Pre-event: firing within next 90 minutes
          const upcoming = detectUpcomingFedEvent(allEvents, 90);
          if (upcoming.isPending && upcoming.event) {
            fomcPreEventActive = true;
            fomcModeActive = true;
            console.log(`[FOMC Pre-Event] ${upcoming.event.title} firing in ${upcoming.minutesUntil} minutes. Pre-positioning mode active.`);
            sendEvent({ type: 'progress', message: `[PRE-EVENT MODE] ${upcoming.event.title} fires in ${upcoming.minutesUntil} min. AI confidence boosted for macro-aligned setups. Size multiplier (1.5x) ACTIVE.` });
          }
          // Persist the FOMC window flag to system_settings so agent-trade can read it
          const { error: persistError } = await supabase.from("system_settings").upsert(
            { key: "fomc_window_active", value: String(fomcModeActive) },
            { onConflict: "key" }
          );
          if (persistError) console.warn("[FOMC] Failed to persist fomc_window_active:", persistError.message);
        }

        // ==========================================
        // PHASE 1: ACTIVE SIGNAL VALIDATION SWEEP
        // ==========================================
        console.log(`[Phase 1] Sweeping active APPROVED signals for revalidation...`);
        sendEvent({ type: 'progress', message: `[Phase 1] Validating active signals against live market conditions...` });
        
        let metaApiFailedAlertSent = false;
        const sendMetaApiAlert = async () => {
          if (metaApiFailedAlertSent) return;
          metaApiFailedAlertSent = true;
          const botToken = Deno.env.get("TELEGRAM_BOT_TOKEN");
          const chatId = Deno.env.get("TELEGRAM_CHAT_ID");
          if (botToken && chatId) {
            await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ chat_id: chatId, text: `🚨 *CRITICAL DATA FAILURE*\n\nMetaAPI broker feed failed to authenticate or connect.\n\nSignal generation for Forex/Crypto has been aborted to prevent execution misalignment. Please check your broker token.` })
            }).catch(e => console.error("Failed to send telegram alert:", e));
          }
        };
        
        const { data: activeSignals } = await supabase
          .from("trade_opportunities")
          .select("*")
          .eq("status", "APPROVED");

        if (activeSignals && activeSignals.length > 0) {
          for (const signal of activeSignals) {
            try {
              // 1. Math Validation (TTL)
              const hoursElapsed = (Date.now() - new Date(signal.created_at).getTime()) / (1000 * 60 * 60);
              if (hoursElapsed > 12) {
                await supabase.from("trade_opportunities").update({ status: "EXPIRED", ai_risks: "Expired: 12h TTL exceeded without execution." }).eq("id", signal.id);
                // await cancelBrokerOrdersForOpportunity(supabase, signal.id);
                console.log(`[Validation] EXPIRED ${signal.symbol}: 12h TTL expired.`);
                continue;
              }

              // 2. Fetch Live Snapshot
              const result = await fetchPaperBars(signal.symbol, signal.timeframe, 300, supabase);
              const snapshot = getContextSnapshot(
                result.map((b: any) => b.t),
                result.map((b: any) => b.o),
                result.map((b: any) => b.h),
                result.map((b: any) => b.l),
                result.map((b: any) => b.c),
                result.map((b: any) => b.v),
                signal.symbol
              );

              // 3. Math Validation (Stop Loss & Take Profit Hit)
              const currentHigh = result.length > 0 ? result[result.length - 1].h : snapshot.current_price;
              const currentLow = result.length > 0 ? result[result.length - 1].l : snapshot.current_price;
              const stopLoss = signal.stop_plan_json?.stop;
              const takeProfit = signal.take_profit_json?.tp;
              
              if (stopLoss) {
                if ((signal.side === 'LONG' && currentLow <= stopLoss) || 
                    (signal.side === 'SHORT' && currentHigh >= stopLoss)) {
                  await supabase.from("trade_opportunities").update({ status: "LOST", r_multiple: -1, ai_risks: "Technical Invalidation: Stop Loss crossed." }).eq("id", signal.id);
                  console.log(`[Validation] LOST ${signal.symbol}: Stop loss crossed by live price.`);
                  continue;
                }
              }

              if (takeProfit) {
                if ((signal.side === 'LONG' && currentHigh >= takeProfit) || 
                    (signal.side === 'SHORT' && currentLow <= takeProfit)) {
                  const entryPrice = signal.entry_plan_json?.price || signal.entry_plan_json?.limit_price;
                  let rMult = 2.0; // fallback
                  if (entryPrice && stopLoss) {
                    const risk = Math.abs(entryPrice - stopLoss);
                    if (risk > 0) rMult = Math.abs(takeProfit - entryPrice) / risk;
                  }
                  await supabase.from("trade_opportunities").update({ status: "WON", r_multiple: Number(rMult.toFixed(2)), ai_risks: "Technical Validation: Take Profit hit!" }).eq("id", signal.id);
                  console.log(`[Validation] WON ${signal.symbol}: Take Profit crossed by live price. (+${rMult.toFixed(2)}R)`);
                  continue;
                }
              }

              // 4. Fundamental / AI Revalidation
              let currentContext = newsContext;
              if (!currentContext) {
                const headlines = await fetchRealtimeNews(signal.symbol);
                currentContext = generateMacroContext(signal.symbol, allEvents, headlines);
              }
              
              const evalResult = await revalidateOpportunity(signal, snapshot, currentContext);
              
              if (evalResult.action === "REJECT") {
                await supabase.from("trade_opportunities").update({ status: "REJECTED", ai_risks: `Invalidated by AI Risk Officer: ${evalResult.reason}` }).eq("id", signal.id);
                // await cancelBrokerOrdersForOpportunity(supabase, signal.id);
                console.log(`[Validation] REJECTED ${signal.symbol} by AI: ${evalResult.reason}`);
              } else if (evalResult.action === "TAKE_PROFIT") {
                // For scalping, if AI decides to secure profits early, we mark it as WON (or REJECTED with profit info) 
                // Since 'REJECTED' triggers auto-eject, we can update it to REJECTED but state it's a profit take.
                // Wait, if we mark it as REJECTED, it triggers auto-eject to close the live positions.
                await supabase.from("trade_opportunities").update({ status: "REJECTED", ai_risks: `Profit Secured by AI Risk Officer: ${evalResult.reason}` }).eq("id", signal.id);
                // await cancelBrokerOrdersForOpportunity(supabase, signal.id);
                console.log(`[Validation] TAKE_PROFIT ${signal.symbol} by AI: ${evalResult.reason}`);
              } else {
                console.log(`[Validation] MAINTAIN ${signal.symbol}: Thesis remains intact.`);
              }
            } catch (err: any) {
               console.error(`[Validation Error] Failed to revalidate ${signal.symbol}:`, err.message);
               if (err.message === "META_API_FAILURE") {
                 await sendMetaApiAlert();
               }
            }
          }
        }
        // ==========================================
        // PHASE 1B: RUNNER HANDOFF (SCALP -> SWING)
        // ==========================================
        console.log(`[Phase 1B] Scanning active scalps for +2.0R Runner Handoff...`);
        const { data: openScalps } = await supabase
          .from("user_trades")
          .select("*, trade_opportunities!inner(*)")
          .eq("status", "OPEN")
          .eq("trade_opportunities.model_id", "agent-day");

        if (openScalps && openScalps.length > 0) {
           for (const trade of openScalps) {
              const opp = trade.trade_opportunities;
              const entryPrice = opp?.entry_plan_json?.price || opp?.entry_plan_json?.entry_price || opp?.entry_plan_json?.limit_price;
              const stopLoss = opp?.stop_plan_json?.stop;
              
              if (entryPrice && stopLoss) {
                 const riskDistance = Math.abs(entryPrice - stopLoss);
                 if (riskDistance > 0) {
                    try {
                        const result = await fetchPaperBars(trade.symbol, opp.timeframe || "5Min", 10, supabase);
                        if (result && result.length > 0) {
                           const currentPrice = result[result.length - 1].c;
                           let rMultiple = 0;
                           if (trade.side === "LONG") rMultiple = (currentPrice - entryPrice) / riskDistance;
                           else rMultiple = (entryPrice - currentPrice) / riskDistance;
    
                           if (rMultiple >= 2.0) {
                              console.log(`[Runner Handoff] ${trade.symbol} hit +${rMultiple.toFixed(2)}R! Handing off to Execution Desk...`);
                              sendEvent({ type: 'progress', message: `[Runner Handoff] Scalp on ${trade.symbol} reached +2.0R. Sending to Execution Desk for Break-Even adjustment.` });
                              
                              const webhookUrl = (Deno.env.get("SUPABASE_URL") || "").replace(/\/$/, "") + "/functions/v1/agent-trade";
                              await fetch(webhookUrl, {
                                 method: "POST",
                                 headers: { "Content-Type": "application/json", "x-webhook-secret": Deno.env.get("WEBHOOK_SECRET") || "FALLBACK_SECRET_123" },
                                 body: JSON.stringify({ action: "RUNNER_HANDOFF", trade_id: trade.id })
                              }).catch(e => console.error("Failed to ping agent-trade:", e));
                           }
                        }
                    } catch (e) {
                        console.error("[Runner Handoff] Failed to check price for", trade.symbol, e.message);
                    }
                 }
              }
           }
        }

        const chunkSize = 10;
        for (let i = 0; i < symbols.length; i += chunkSize) {
          const chunk = symbols.slice(i, i + chunkSize);
          await Promise.all(chunk.map(async (symbol) => {
          try {
            if (isCron && !isMarketOpen(symbol)) {
              console.log(`[Market Hours] Skipping ${symbol}: Market is closed.`);
              sendEvent({ type: 'progress', message: `[Market Hours] Skipping ${symbol}: Market is closed.` });
              return;
            }
            await insertAuditLog(supabase, {
              actor_type: "SYSTEM",
              action: "RESEARCH_RUN",
              entity_type: "research",
              payload_json: { symbol, timeframe, agent: "agent-day", model_id: modelId, model_version: modelVersion },
            });

            // --- LAYER 0: MACRO BLACKOUT WINDOW ---
            if (["XAUUSD", "XAGUSD", "BTCUSD"].includes(symbol) && allEvents) {
              const nowMs = Date.now();
              const thirtyMins = 30 * 60 * 1000;
              const blackoutEvents = allEvents.filter((e: any) => {
                 if (e.impact !== "High" || e.country !== "USD") return false;
                 const eventTime = new Date(e.date).getTime();
                 const timeDiff = Math.abs(eventTime - nowMs);
                 return timeDiff <= thirtyMins;
              });

              if (blackoutEvents.length > 0) {
                 const evNames = blackoutEvents.map((e: any) => e.title).join(", ");
                 console.log(`[Layer 0] Macro Blackout Window Active: Halting ${symbol} due to ${evNames}`);
                 sendEvent({ type: 'progress', message: `[Layer 0] Macro Blackout Window Active: Halting ${symbol} due to High-Impact USD event within ±30m.` });
                 rejections.push({
                   symbol,
                   reason: `Macro Blackout Window: Halting origination due to High-Impact USD event within ±30m (${evNames})`,
                   layer: "Layer 0"
                 });
                 return; // Halt this execution completely for this symbol
              }
            }

            let bars: Bar[];
            let source: string;
            try {
              console.log(`[Data Fetch] Fetching market data for ${symbol}...`);
              sendEvent({ type: 'progress', message: `[Data Fetch] Fetching historical price data for ${symbol}...` });
              const result = await fetchPaperBars(symbol, timeframe, 300, supabase);
              bars = result;
              source = "Broker API";
            } catch (err: any) {
              console.error(`[Data Fetch Error] Failed to fetch data for ${symbol}: ${err.message}`);
              if (err.message === "META_API_FAILURE") {
                await sendMetaApiAlert();
              }
              await insertAuditLog(supabase, {
                actor_type: "SYSTEM",
                action: "API_TIMEOUT",
                entity_type: "research",
                payload_json: { symbol, reason: "Market data fetch failed", error: err.message },
              });
              rejections.push({
                symbol,
                reason: `Data Fetch Error: ${err.message}`,
                layer: "Data"
              });
              return;
            }
            
            console.log(`\n[Info] [Data Fetch v2] Successfully fetched ${bars.length} bars from ${source} for ${symbol}.`);
            sendEvent({ type: 'progress', message: `[Data Fetch v2] Successfully acquired ${bars.length} data points from ${source}.` });

            // Store fetched bars in PTI database asynchronously
            // [TEMPORARILY DISABLED] This is causing WORKER_RESOURCE_LIMIT due to thousands of unawaited N+1 queries.
            // saveBars(supabase, symbol, timeframe, bars).catch(err => 
            //   console.error(`[Error] Failed to save bars for ${symbol}:`, err)
            // );

            if (bars.length < 50) {
              rejections.push({ symbol, reason: `Insufficient historical data (${bars.length} bars)`, layer: "Data" });
              sendEvent({ type: 'progress', message: `[Rejected] Insufficient data for ${symbol}.` });
              return;
            }

            // LAYER A: Deterministic Evaluation Guard
            sendEvent({ type: 'progress', message: `[Layer A: Deterministic Guard] Evaluating mathematical momentum and regime...` });
            
            // Fetch 1D Macro Trend & HTF Support/Resistance
            let htf_trend: 'BULLISH' | 'BEARISH' | 'CHOP' = 'CHOP';
            let htf_support: number[] = [];
            let htf_resistance: number[] = [];
            let htf_pivot: number | null = null;
            
            let mtfa_trend: 'BULLISH' | 'BEARISH' | 'CHOP' | undefined;
            let mtfa_ema_50: number | null = null;
            let mtfa_ema_200: number | null = null;

            if (timeframe !== '1D') {
              try {
                const result = await fetchPaperBars(symbol, '1D', 300, supabase);
                const dailySnapshot = getContextSnapshot(
                  result.map((b: any) => b.t),
                  result.map((b: any) => b.o),
                  result.map((b: any) => b.h),
                  result.map((b: any) => b.l),
                  result.map((b: any) => b.c),
                  result.map((b: any) => b.v),
                  symbol
                );
                if (dailySnapshot.trend_alignment.startsWith('BULLISH')) htf_trend = 'BULLISH';
                else if (dailySnapshot.trend_alignment.startsWith('BEARISH')) htf_trend = 'BEARISH';
                
                if (result.length > 0) {
                  const lastBar = result[result.length - 1];
                  const pivots = calculatePivotPoints(lastBar.h, lastBar.l, lastBar.c);
                  htf_support = pivots.support;
                  htf_resistance = pivots.resistance;
                  htf_pivot = pivots.pivot;
                }
                
                // Fetch MTFA (1H or 4H) for confluence
                const mtfaTf = timeframe === '15Min' ? '1H' : '4H';
                const mtfaResult = await fetchPaperBars(symbol, mtfaTf, 300, supabase);
                const mtfaSnapshot = getContextSnapshot(
                  mtfaResult.map((b: any) => b.t),
                  mtfaResult.map((b: any) => b.o),
                  mtfaResult.map((b: any) => b.h),
                  mtfaResult.map((b: any) => b.l),
                  mtfaResult.map((b: any) => b.c),
                  mtfaResult.map((b: any) => b.v),
                  symbol
                );
                if (mtfaSnapshot.trend_alignment.startsWith('BULLISH')) mtfa_trend = 'BULLISH';
                else if (mtfaSnapshot.trend_alignment.startsWith('BEARISH')) mtfa_trend = 'BEARISH';
                else mtfa_trend = 'CHOP';
                
                mtfa_ema_50 = mtfaSnapshot.ema_50;
                mtfa_ema_200 = mtfaSnapshot.ema_200;
              } catch (e) {
                console.warn(`[Macro Fetch] Failed to fetch 1D/MTFA trend for ${symbol}`);
              }
            }

            const rawSnapshot = getContextSnapshot(
              bars.map((b) => b.t),
              bars.map((b) => b.o),
              bars.map((b) => b.h),
              bars.map((b) => b.l),
              bars.map((b) => b.c),
              bars.map((b) => b.v),
              symbol
            );
            if (htf_pivot) rawSnapshot.htf_pivot = htf_pivot;
            rawSnapshot.htf_trend = htf_trend;
            rawSnapshot.mtfa_trend = mtfa_trend;
            rawSnapshot.mtfa_ema_50 = mtfa_ema_50;
            rawSnapshot.mtfa_ema_200 = mtfa_ema_200;
            if (htf_support.length > 0) {
              rawSnapshot.htf_support = htf_support;
              rawSnapshot.htf_resistance = htf_resistance;
            }
            
            // Inject macro context if provided via URL params
            let fundamental_context = newsContext;
            if (!fundamental_context) {
              const headlines = await fetchRealtimeNews(symbol);
              fundamental_context = generateMacroContext(symbol, allEvents, headlines);
              // FOMC context injection
              if (fomcModeActive) {
                const fomcTag = fomcPreEventActive ? `[FOMC_PRE_EVENT: Firing soon — high volatility expected]` : `[FOMC_JUST_FIRED: Post-event volatility window active]`;
                fundamental_context = fomcTag + "\n" + fundamental_context;
              }
              // Macro confidence boost
              const headlines2 = headlines || [];
              const macroBoost = computeMacroConfidenceBoost(symbol, "LONG", allEvents, headlines2);
              if (macroBoost > 0 && fomcModeActive) {
                fundamental_context += `\n[FOMC MACRO BOOST: +8 confidence authorized for macro-aligned setup]`;
              }
            }

            // ETF flow sentiment for crypto assets
            let etf_flow_context: string | undefined;
            if (symbol.includes("BTC") || symbol.includes("ETH")) {
              try {
                const etfFlow = await fetchETFFlowSentiment(symbol);
                if (etfFlow.signal !== "NEUTRAL") {
                  etf_flow_context = `[ETF FLOW INTELLIGENCE]\n${etfFlow.summary}\nDirective: ${etfFlow.signal === "BULLISH" ? "Institutional demand floor detected. Favour LONG setups with strong technical confluence." : "Distribution signal detected. Favour SHORT setups or tighter risk management on LONG."}\n`;
                  sendEvent({ type: 'progress', message: `[ETF Flow] ${symbol}: ${etfFlow.summary}` });
                }
              } catch (etfErr: any) {
                console.warn(`[ETF Flow] ${symbol}: ${etfErr.message}`);
              }
            }

            // Fetch swing/positional agent context from market_context table
            let agent_context: any[] = [];
            try {
              const { data: ctxRows } = await supabase
                .from('market_context')
                .select('agent_persona, macro_bias, key_levels, invalidation_price, narrative')
                .eq('symbol', symbol)
                .gt('expires_at', new Date().toISOString())
                .order('created_at', { ascending: false })
                .limit(5);
              if (ctxRows && ctxRows.length > 0) {
                agent_context = ctxRows;
                console.log(`[Market Context] Loaded ${ctxRows.length} agent context entries for ${symbol}`);
                sendEvent({ type: 'progress', message: `[Market Context] Swing Trader Fib levels loaded for ${symbol}: ${ctxRows.map(c => c.agent_persona + ' → ' + c.macro_bias).join(', ')}` });
              }
            } catch (ctxErr: any) {
              console.warn(`[Market Context] Failed to load agent context for ${symbol}: ${ctxErr.message}`);
            }

            const snapshot = {
              ...rawSnapshot,
              fundamental_context: etf_flow_context ? (fundamental_context + "\n" + etf_flow_context) : fundamental_context,
              agent_context: agent_context.length > 0 ? agent_context : undefined,
              liquidity_sweep_directive: computeLiquiditySweepScore(rawSnapshot, (rawSnapshot as any).mtfa_trend).directive || undefined,
            };

            // PRE-EVALUATION ASSET ISOLATION (with candle-duration caching)
            // Check if this symbol was already isolated on this cron cycle's candle
            const tfMinutes: Record<string, number> = { '30M': 30, '1H': 60, '4H': 240, '1D': 1440 };
            const candleDurationMs = (tfMinutes[timeframe.toUpperCase()] || 240) * 60 * 1000;
            const { data: recentIsolation } = await supabase
              .from('audit_log')
              .select('created_at')
              .eq('action', 'REJECTED_BY_RISK_PRE_AI')
              .eq('entity_type', 'research')
              .filter('payload_json->>symbol', 'eq', symbol)
              .gte('created_at', new Date(Date.now() - candleDurationMs).toISOString())
              .limit(1);

            if (recentIsolation && recentIsolation.length > 0) {
              console.log(`[Pre-AI Guard] Cached skip for ${symbol}: Already isolated within this ${timeframe} candle.`);
              sendEvent({ type: 'progress', message: `[Pre-AI Guard] Cached skip for ${symbol}: Isolated this candle.` });
              rejections.push({ symbol, reason: 'Cached isolation skip (already checked this candle)', layer: 'Pre-AI Guard' });
              return;
            }

            sendEvent({ type: 'progress', message: `[Pre-AI Guard] Validating global signal constraints for ${symbol}...` });
            const riskValidation = await validateGlobalSignal(supabase, symbol, snapshot);
            if (!riskValidation.valid) {
              console.log(`[Pre-AI Guard] REJECTED ${symbol}: ${riskValidation.reason}`);
              sendEvent({ type: 'progress', message: `[Pre-AI Guard] Skipped ${symbol}: Exposure constraints violated.` });
              await insertAuditLog(supabase, {
                actor_type: "SYSTEM",
                action: "REJECTED_BY_RISK_PRE_AI",
                entity_type: "research",
                payload_json: { symbol, reason: riskValidation.reason },
              });
              
              rejections.push({
                symbol,
                reason: riskValidation.reason,
                layer: "Pre-AI Guard"
              });
              // We skip AI evaluation entirely and DO NOT save a database signal to prevent C-Tier spam in the Vault
              return;
            }

            console.log(`[Strategy Eval] Market snapshot for ${symbol}: Trend=${snapshot.trend_alignment}, RSI=${snapshot.rsi_14?.toFixed(2) ?? 'N/A'}, CurrentPrice=${snapshot.current_price}`);
            
            // LAYER A: Deterministic Guard
            // [MODIFIED]: CHOP regimes now bypass the halt and proceed to the AI for Mean Reversion evaluation.
            if ((snapshot.trend_alignment as string) === 'UNTRADEABLE') {
              // Reserve for future hard mathematical rejects (e.g. extreme volatility halts)
              return;
            }

            // --- AI MEMORY CALIBRATION ---
            console.log(`[Data Fetch] Querying historical ledger for ${symbol}...`);
            sendEvent({ type: 'progress', message: `[AI Memory] Pulling last 5 trades to calibrate bias for ${symbol}...` });
            const { data: pastTrades } = await supabase
              .from("trade_opportunities")
              .select("status, side, ai_summary, ai_risks, r_multiple")
              .eq("symbol", symbol)
              .in("status", ["WON", "LOST", "REJECTED"])
              .order("created_at", { ascending: false })
              .limit(5);

            let historicalMemory = "";
            if (pastTrades && pastTrades.length > 0) {
              historicalMemory = pastTrades.map((t, i) => {
                let text = `Past Decision ${i+1} (${t.side} -> ${t.status}, ${t.r_multiple !== null ? t.r_multiple + 'R' : 'N/A'}): "${t.ai_summary || 'No rationale logged'}"`;
                if (t.status === 'REJECTED' && t.ai_risks && t.ai_risks.includes('Invalidated')) {
                  text += `\n   -> [CRITICAL] REASON FOR INVALIDATION: "${t.ai_risks}" - You must learn from this and avoid similar structural setups.`;
                }
                return text;
              }).join("\n");
            }

            // === SIGNAL SLEEP MODE ===
            // If this symbol has 3+ consecutive INFLECTION_POINT_WAIT rejections in the last 2 hours,
            // skip AI evaluation to reduce compute waste and database noise.
            const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
            const { data: recentRejections } = await supabase
              .from('trade_opportunities')
              .select('ai_summary')
              .eq('symbol', symbol)
              .eq('status', 'REJECTED')
              .gte('created_at', twoHoursAgo)
              .order('created_at', { ascending: false })
              .limit(3);
            
            if (recentRejections && recentRejections.length >= 3) {
              const allInflectionWait = recentRejections.every((r: any) => 
                r.ai_summary?.includes('INFLECTION_POINT_WAIT')
              );
              if (allInflectionWait) {
                console.log(`[Sleep Mode] ${symbol}: 3 consecutive INFLECTION_POINT_WAIT rejections. Entering 2-hour sleep mode.`);
                sendEvent({ type: 'progress', message: `[Sleep Mode] ${symbol}: Market is in tight consolidation. Skipping for 2 hours to reduce noise.` });
                rejections.push({ symbol, reason: 'Sleep mode: 3 consecutive INFLECTION_POINT_WAIT in 2h window', layer: 'Sleep Mode' });
                return;
              }
            }

            // LAYER B: Cognitive Guard (Senior Risk Officer)

            let evaluation;
            try {
              console.log(`[Layer B: Cognitive Guard] Requesting AI evaluation for ${symbol}...`);
              sendEvent({ type: 'progress', message: `[Layer B: AI Risk Officer] Evaluating institutional rationale and key levels for ${snapshot.trend_alignment} setup...` });
              evaluation = await evaluateOpportunity(symbol, snapshot, timeframe, historicalMemory);
              
              // --- SHADOW LEDGER: Log raw AI prediction instantly ---
              if (evaluation && evaluation.recommended_direction !== "NONE") {
                 let rawEntry = Number(evaluation.execution_parameters?.suggested_entry_price);
                 let rawTP = Number(evaluation.execution_parameters?.suggested_take_profit);
                 let rawSL = Number(evaluation.execution_parameters?.suggested_stop_loss);
                 
                 // Fallback to snapshot if AI omitted them
                 if (!rawEntry) rawEntry = snapshot.current_price;
                 if (!rawSL) rawSL = evaluation.recommended_direction === "LONG" ? snapshot.safe_long_stop_loss : snapshot.safe_short_stop_loss;
                 
                 try {
                   await supabase.from("shadow_ledger").insert({
                      symbol: symbol,
                      timeframe: timeframe.toLowerCase(),
                      side: evaluation.recommended_direction,
                      entry_price: rawEntry,
                      take_profit: rawTP || null,
                      stop_loss: rawSL || null,
                      status: "PENDING"
                   });
                 } catch (err) {
                   console.error(`[Shadow Ledger] Failed to insert raw signal for ${symbol}: ${err.message}`);
                 }
              }
            } catch (err: any) {
              console.error(`[Layer B Error] AI evaluation failed for ${symbol}: ${err.message}`);
              sendEvent({ type: 'progress', message: `[Layer B: AI Risk Officer] Evaluation failed: ${err.message}` });
              await insertAuditLog(supabase, {
                actor_type: "SYSTEM",
                action: "API_TIMEOUT",
                entity_type: "research",
                payload_json: { symbol, reason: "OpenAI evaluation failed or timed out", error: err.message },
              });
              rejections.push({
                symbol,
                reason: `AI Evaluation Error: ${err.message}`,
                layer: "B"
              });
              return;
            }

            let is_valid = evaluation.recommended_direction !== "NONE" && evaluation.recommended_direction !== "REQUIRE_LTF_DRILLDOWN";
            
            // FIX: Use RSI + Bollinger Band position to determine fallback direction.
            // Previously defaulted to SHORT when trend was CHOP, causing systematic SHORT bias.
            // Now: RSI < 40 or price near lower BB => LONG bias. RSI > 60 or price near upper BB => SHORT bias.
            const rsi = snapshot.rsi_14 ?? 50;
            const bbUpper = snapshot.bb_upper ?? Infinity;
            const bbLower = snapshot.bb_lower ?? 0;
            const price = snapshot.current_price;
            const nearLowerBB = bbLower > 0 && Math.abs(price - bbLower) / bbLower < 0.005;
            const nearUpperBB = bbUpper < Infinity && Math.abs(price - bbUpper) / bbUpper < 0.005;
            
            let fallbackSide: 'LONG' | 'SHORT';
            if (snapshot.trend_alignment.startsWith('BULLISH') || rsi < 40 || nearLowerBB) {
              fallbackSide = 'LONG';
            } else if (snapshot.trend_alignment.startsWith('BEARISH') || rsi > 60 || nearUpperBB) {
              fallbackSide = 'SHORT';
            } else {
              // True neutral — use HTF trend as tiebreaker
              fallbackSide = (snapshot.htf_trend === 'BULLISH') ? 'LONG' : 'SHORT';
            }
            
            let dbSide = (!is_valid) ? fallbackSide : evaluation.recommended_direction;
            
            let entry_price = Number((evaluation.execution_parameters?.suggested_entry_price || snapshot.current_price).toFixed(3));
            let stop_loss = Number((evaluation.execution_parameters?.suggested_stop_loss || (dbSide === "LONG" ? snapshot.safe_long_stop_loss : snapshot.safe_short_stop_loss)).toFixed(3));
            // --- TRUST AI STRUCTURAL STOPS (No Dynamic ATR Override) ---
            // The AI is trained to tuck stops tightly behind structural order blocks to achieve > 1.75 R:R.
            // We explicitly do NOT mechanically widen the stop loss here, as doing so artificially inflates risk
            // and corrupts the mathematical R:R calculation, causing valid asymmetric setups to be rejected.
            
            let raw_confidence = evaluation.confidence_score || 50;
            const confidence_score = raw_confidence <= 1.0 ? raw_confidence * 100 : raw_confidence;
            let tier = "C-Tier";
            if (confidence_score >= 90) tier = "S-Tier";
            else if (confidence_score >= 80) tier = "A-Tier";
            else if (confidence_score >= 70) tier = "B-Tier";
            
            const rationaleObj = evaluation.institutional_rationale || {};
            let institutional_rationale = [
              `[${tier}] [${evaluation.market_structure} -> ${evaluation.strategy_applied}]`,
              rationaleObj.directional_bias,
              rationaleObj.execution_trigger,
              rationaleObj.invalidation_point,
              rationaleObj.take_profit_target,
              rationaleObj.fundamental_alignment
            ].filter(Boolean).join(" ");

            console.log(`[Layer B: Cognitive Guard] AI Response for ${symbol}: Valid Setup = ${is_valid}, Direction = ${evaluation.recommended_direction}`);
            console.log(`[Layer B] AI Rationale: ${institutional_rationale}`);

            // --- OVERRIDE: ADX FILTER FOR MEAN REVERSION ---
            if (is_valid && evaluation.strategy_applied === "MEAN_REVERSION" && snapshot.adx_14 && snapshot.adx_14 > 25) {
               is_valid = false;
               institutional_rationale = `Execution Desk Rejected: Attempted Mean Reversion in high-momentum environment (ADX > 25).`;
            }

            if (!is_valid || confidence_score < 70) {
              let rejectReason = "";
              if (evaluation.recommended_direction === "REQUIRE_LTF_DRILLDOWN") {
                rejectReason = `LTF_ENTRY_WAIT: Macro trend is strong but price is overextended. Waiting for LTF pullback.`;
                
                const expiresAt = new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString();
                const targetDirection = snapshot.trend_alignment.startsWith("BULLISH") ? "LONG" : "SHORT";
                
                await supabase.from("trade_watchlists").update({ status: 'CANCELLED' }).eq('symbol', symbol).eq('status', 'WATCHING');
                await supabase.from("trade_watchlists").insert({
                  symbol,
                  direction: targetDirection,
                  status: "WATCHING",
                  macro_score: String(confidence_score),
                  source_agent: "agent-day",
                  current_price: snapshot.current_price,
                  context: snapshot,
                  expires_at: expiresAt
                });
              } else {
                rejectReason = !is_valid 
                  ? institutional_rationale 
                  : `AI Confidence Score (${confidence_score}) below 70 threshold.`;
              }
                
              console.log(`[Layer B: Cognitive Guard] REJECTED ${symbol} by AI Risk Officer: ${rejectReason}`);
              sendEvent({ type: 'progress', message: `[Layer B: AI Risk Officer] REJECTED ${symbol}: ${rejectReason}` });
              await insertAuditLog(supabase, {
                actor_type: "SYSTEM",
                action: "REJECTED_BY_AI",
                entity_type: "research",
                payload_json: { symbol, reason: rejectReason, context: snapshot },
              });
              rejections.push({
                symbol,
                reason: rejectReason,
                layer: "Cognitive AI"
              });

              await supabase.from("trade_opportunities").insert({
                symbol,
                side: dbSide,
                timeframe: timeframe.toLowerCase(),
                status: "REJECTED",
                source: "agent-day",
                ai_summary: rejectReason,
                ai_risks: "Rejected by AI Risk Officer",
                model_id: modelId,
                model_version: modelVersion,
                risk_summary: `RSI ${snapshot.rsi_14}`,
                confidence: confidence_score
              });
              
              // Hive Mind: Reset HFT bias on major AI rejection
              await pingHFTDirector(symbol, "NEUTRAL");
              return;
            }

            console.log(`[Layer B: Cognitive Guard] APPROVED ${symbol} by AI Risk Officer.`);
            sendEvent({ type: 'progress', message: `[Layer B: Cognitive Guard] APPROVED by AI Risk Officer.` });

            // LAYER C: Structural Risk/Reward Validation
            const risk = Math.abs(entry_price - stop_loss);
            let take_profit = evaluation.execution_parameters?.suggested_take_profit;
            if (take_profit) take_profit = Number(take_profit.toFixed(3));
            
            if (!take_profit) {
               console.log(`[Layer C: Execution Desk] REJECTED ${symbol}: AI failed to provide a structural take profit.`);
               rejections.push({ symbol, reason: "Missing Take Profit parameter", layer: "Execution Desk" });
               return;
            }

            const reward = Math.abs(take_profit - entry_price);
            let rrRatio = reward / risk;

            // --- OVERRIDE: CAP SCALPING R:R TO 3.0 ---
            if (rrRatio > 3.0) {
               console.log(`[Layer C: Execution Desk] OVERRIDE ${symbol}: Capping R:R from ${rrRatio.toFixed(2)} down to 3.0 max for Scalping.`);
               institutional_rationale += ` [Execution Desk overrode Take Profit to hard cap 1:3 R:R for Scalp.]`;
               if (dbSide === "LONG") {
                  take_profit = Number((entry_price + (risk * 3.0)).toFixed(3));
               } else {
                  take_profit = Number((entry_price - (risk * 3.0)).toFixed(3));
               }
               rrRatio = 3.0;
            }

            if (rrRatio < 1.20) {
               console.log(`[Layer C: Execution Desk] WARNING ${symbol}: R:R ratio (${rrRatio.toFixed(2)}) is below 1.2 optimal threshold, but publishing anyway.`);
               institutional_rationale += ` [NOTE: Structural Risk:Reward is suboptimal at 1:${rrRatio.toFixed(1)}.]`;
            }

            // Append actual math to AI rationale
            institutional_rationale += ` Execution Math: Structural target set at ${take_profit} yielding a 1:${rrRatio.toFixed(1)} Risk:Reward ratio.`;

            // AI is now a pure signal generator. We don't calculate user-specific volume or riskAmount here.
            
            const expectedReturnPct = Math.abs(take_profit - entry_price) / entry_price;
            
            const stopLossPercentage = risk / entry_price;
            let defaultStaticPct = 0.05; // 5% default for macro
            if (timeframe.toLowerCase().includes("min") || timeframe === "1H") {
              defaultStaticPct = 0.025; // 2.5% max for 1H intraday
            } else if (timeframe === "4H") {
              defaultStaticPct = 0.03; // 3% max for 4H swing
            }
            
            // Asset-class-specific ATR multipliers
            const preciousMetals = ['XAUUSD', 'XAGUSD'];
            const atrMultiplier = preciousMetals.includes(symbol) ? 3.0 : 2.0;
            
            let maxAllowedRiskPct = defaultStaticPct;
            if (snapshot.atr_14 && snapshot.current_price) {
              const dynamicAtrPct = (snapshot.atr_14 * atrMultiplier) / snapshot.current_price;
              maxAllowedRiskPct = Math.max(defaultStaticPct, dynamicAtrPct);
            }

            if (stopLossPercentage > maxAllowedRiskPct) {
              console.log(`[Layer C: Execution Desk] REJECTED ${symbol}: Stop loss percentage (${(stopLossPercentage*100).toFixed(2)}%) exceeds allowed maximum of ${(maxAllowedRiskPct*100).toFixed(2)}% for timeframe ${timeframe}.`);
              sendEvent({ type: 'progress', message: `[Layer C: Execution Desk] REJECTED: Structural mismatch. Stop loss (${(stopLossPercentage*100).toFixed(2)}%) too wide for ${timeframe}.` });
              rejections.push({
                symbol,
                reason: `Structural timeframe mismatch: A stop loss of ${(stopLossPercentage*100).toFixed(2)}% is too wide for an intraday timeframe (${timeframe}). Max allowed is ${(maxAllowedRiskPct*100).toFixed(2)}%.`,
                layer: "Execution Desk"
              });
              await supabase.from("trade_opportunities").insert({
                symbol,
                side: dbSide,
                timeframe: timeframe.toLowerCase(),
                status: "REJECTED",
                source: "agent-day",
                ai_summary: institutional_rationale,
                ai_risks: `Stop loss ${(stopLossPercentage*100).toFixed(2)}% exceeds max ${(maxAllowedRiskPct*100).toFixed(2)}%`,
                model_id: modelId,
                model_version: modelVersion,
                risk_summary: `RSI ${snapshot.rsi_14}`
              });
              return;
            }
            
            // --- Risk:Reward Check ---
            const riskPoints = Math.abs(entry_price - stop_loss);
            const rewardPoints = Math.abs(take_profit - entry_price);
            const riskRewardRatio = riskPoints > 0 ? (rewardPoints / riskPoints) : 0;
            
            let deskRequiredRR = 1.5;
            if (symbol === 'XAGUSD' || symbol === 'UKOIL') {
              deskRequiredRR = 1.0; // Lower threshold due to high volatility and wider stops
            } else if (symbol === 'BTCUSD' || symbol === 'US30' || symbol === 'NAS100') {
              deskRequiredRR = 1.25; // Indices/Crypto have wider swings, need wider stops
            } else {
              if (confidence_score >= 90) deskRequiredRR = 1.75;
              else if (confidence_score >= 80) deskRequiredRR = 1.5;
            }

            // --- Regime Enforcement ---
            if (snapshot.trend_alignment === "CHOP") {
              if (evaluation.strategy_applied !== "MEAN_REVERSION" && confidence_score < 90) {
                console.log(`[Layer C: Execution Desk] REJECTED ${symbol}: Structural Regime Mismatch (Attempting non-mean-reversion in CHOP).`);
                sendEvent({ type: 'progress', message: `[Layer C: Execution Desk] REJECTED: Structural Regime Mismatch in CHOP.` });
                rejections.push({
                  symbol,
                  reason: `Structural Regime Mismatch: The market is in a CHOP regime, but the AI proposed a ${evaluation.strategy_applied} strategy. Only MEAN_REVERSION is structurally permitted in chop unless confidence is S-Tier.`,
                  layer: "Execution Desk"
                });
                await supabase.from("trade_opportunities").insert({
                  symbol,
                  side: dbSide,
                  timeframe: timeframe.toLowerCase(),
                  status: "REJECTED",
                  source: "agent-day",
                  ai_summary: institutional_rationale,
                  ai_risks: `Rejected by Execution Desk: Structural Regime Mismatch (${evaluation.strategy_applied} in CHOP)`,
                  model_id: modelId,
                  model_version: modelVersion,
                  risk_summary: `RSI ${snapshot.rsi_14}`
                });
                return;
              }
              // Loosen R:R strictness for mean reversion range trades
              if (deskRequiredRR > 1.2) deskRequiredRR = 1.2;
            }

            if (riskRewardRatio < deskRequiredRR - 0.05) {
              console.log(`[Layer C: Execution Desk] REJECTED ${symbol}: Risk:Reward ratio (${riskRewardRatio.toFixed(2)}) is below the institutional minimum of ${deskRequiredRR} for Tier score ${confidence_score}.`);
              sendEvent({ type: 'progress', message: `[Layer C: Execution Desk] REJECTED: Structural mismatch. R:R ratio (${riskRewardRatio.toFixed(2)}) is below minimum of ${deskRequiredRR}.` });
              rejections.push({
                symbol,
                reason: `Structural R:R mismatch: Risk:Reward ratio is ${riskRewardRatio.toFixed(2)}, which is below the required 1:${deskRequiredRR} threshold for a ${confidence_score} confidence score.`,
                layer: "Execution Desk"
              });
              await supabase.from("trade_opportunities").insert({
                symbol,
                side: dbSide,
                timeframe: timeframe.toLowerCase(),
                status: "REJECTED",
                source: "agent-day",
                ai_summary: institutional_rationale,
                ai_risks: `Rejected by Execution Desk: R:R ratio ${riskRewardRatio.toFixed(2)} < ${deskRequiredRR}`,
                model_id: modelId,
                model_version: modelVersion,
                risk_summary: `RSI ${snapshot.rsi_14}`
              });
              
              // Hive Mind: Reset HFT bias on Execution Desk structural rejection
              await pingHFTDirector(symbol, "NEUTRAL");
              return;
            }

            console.log(`[Layer C: Execution Desk] APPROVED ${symbol}: Generating pending opportunity...`);
            sendEvent({ type: 'progress', message: `[Execution] Creating opportunity for ${symbol}...` });
            
            let order_type = dbSide === 'LONG' ? 'BUY MARKET' : 'SELL MARKET';
            if (Math.abs(entry_price - snapshot.current_price) / snapshot.current_price > 0.0005) {
                if (dbSide === 'LONG') {
                    order_type = entry_price < snapshot.current_price ? 'BUY LIMIT' : 'BUY STOP';
                } else {
                    order_type = entry_price > snapshot.current_price ? 'SELL LIMIT' : 'SELL STOP';
                }
            }

            const { data, error } = await supabase
              .from("trade_opportunities")
              .insert({
                symbol,
                side: dbSide,
                timeframe: timeframe.toLowerCase(),
                status: "APPROVED",
                source: "agent-day",
                entry_plan_json: {
                  price: entry_price,
                  order_type: order_type,
                  scaled_entries: evaluation.execution_parameters?.scaled_entries || null
                },
                stop_plan_json: { stop: stop_loss, initial: stop_loss, atr: snapshot.atr_14 },
                take_profit_json: { tp: take_profit },
                risk_summary: `RSI ${snapshot.rsi_14}`,
                confidence: confidence_score,
                ai_summary: institutional_rationale,
                ai_risks: "Managed by AI Risk Officer",
                model_id: "agent-day",
                model_version: modelVersion,
              })
              .select("id")
              .single();

            if (!error && data) {
              console.log(`[Success] Opportunity generated for ${symbol}: ID ${data.id}`);
              sendEvent({ type: 'progress', message: `[Success] Opportunity generated for ${symbol}` });
              
              // Hive Mind: Align HFT Director with the new macro thesis!
              await pingHFTDirector(symbol, dbSide);
              
              // Clean up any active sniper watchlists for this symbol to prevent duplicate execution
              await supabase.from("trade_watchlists").update({ status: 'CANCELLED' }).eq('symbol', symbol).eq('status', 'WATCHING');
              
              // order_type is now pre-calculated and saved to the database!

              // Execution is now entirely delegated to the exness-executor webhook, 
              // which automatically listens for INSERTs with status: 'APPROVED'.


              results.push({ 
                symbol, 
                id: data.id,
                order_type,
                entry_price,
                take_profit,
                stop_loss
              });

              await insertAuditLog(supabase, {
                actor_type: "SYSTEM",
                action: "TRADE_SIGNAL_APPROVED",
                entity_type: "research",
                entity_id: data.id,
                payload_json: { symbol, rationale: institutional_rationale, execution: { order_type, entry_price, stop_loss, take_profit } },
              });
            } else if (error) {
              console.error(`[Layer C: Execution Desk] FATAL DB ERROR for ${symbol}: ${error.message}`);
              sendEvent({ type: 'progress', message: `[Database] Failed to save signal for ${symbol}: ${error.message}` });
            }
          } catch (globalErr: any) {
            console.error(`[Global Error] Unexpected error processing ${symbol}: ${globalErr.message}`);
            sendEvent({ type: 'progress', message: `[System Error] ${globalErr.message}` });
            rejections.push({
              symbol,
              reason: `System Error: ${globalErr.stack}`,
              layer: "System"
            });
            return;
          }
        }));
      }

        sendEvent({ type: 'complete', opportunities: results, rejections });
        return { opportunities: results, rejections };
      } catch (err: any) {
        console.error(`[Pipeline Error] ${err.message}`);
        await insertAuditLog(supabase, {
          actor_type: "SYSTEM",
          action: "AGENT_CRASH",
          payload_json: { agent: "agent-day", error: err.message, stack: err.stack },
        });
        return { error: err.message };
      }
  }

  if (isCron) {
    const data = await runPipeline(() => {});
    return new Response(JSON.stringify(data), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });
  }

  const body = new ReadableStream({
    async start(controller) {
      function sendEvent(data: any) {
        try { controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(data)}\n\n`)); } catch (e) {}
      }
      try {
        await runPipeline(sendEvent);
      } finally {
        controller.close();
      }
    }
  });

  return new Response(body, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive"
    },
  });
});