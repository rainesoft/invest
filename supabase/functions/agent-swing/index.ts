import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient, SupabaseClient } from "npm:@supabase/supabase-js@2.108.2";
import { fetchPaperBars, Bar } from "../../../packages/execution/index.ts";
import { insertAuditLog } from "../../../packages/core/audit.ts";
import { fetchAllMacroEvents, generateMacroContext, fetchRealtimeNews } from "../../../packages/core/news.ts";
import { isAutoTradingEnabled } from "../../../packages/core/settings.ts";

import { revalidateOpportunity } from "../../../packages/strategy/revalidation.ts";

import { getContextSnapshot, LogicContext, isBullishEngulfing, isBearishRejection } from "../../../packages/strategy/indicators.ts";
import { validateGlobalSignal } from "../../../packages/strategy/riskManager.ts";
import OpenAI from "npm:openai";
import { z } from "npm:zod";

// ============================================================
// FIBONACCI ENGINE
// Finds the dominant swing high/low over the full lookback
// period and computes the standard retracement + extension
// levels used by institutions.
// ============================================================
export type FibLevels = {
  swing_high: number;
  swing_low: number;
  swing_range: number;
  direction: "BULLISH_RETRACEMENT" | "BEARISH_RETRACEMENT";
  levels: {
    label: string;
    price: number;
    pct: number;
  }[];
  extensions: {
    label: string;
    price: number;
    pct: number;
  }[];
};

export function calculateFibonacciLevels(high: number[], low: number[], close: number[]): FibLevels {
  // Identify the dominant swing: look at full history for the major high and low
  const swing_high = Math.max(...high);
  const swing_low = Math.min(...low);
  const swing_range = swing_high - swing_low;
  const current_price = close[close.length - 1];

  // Determine if we are in a bullish retracement (came from low, pulled back from high)
  // or bearish retracement (came from high, bouncing from low)
  const highIdx = high.indexOf(swing_high);
  const lowIdx = low.indexOf(swing_low);
  const direction: "BULLISH_RETRACEMENT" | "BEARISH_RETRACEMENT" =
    highIdx > lowIdx ? "BULLISH_RETRACEMENT" : "BEARISH_RETRACEMENT";

  // Standard Fibonacci retracement ratios
  const retracementRatios = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1.0];

  let levels;
  if (direction === "BULLISH_RETRACEMENT") {
    // Price moved UP from low to high, now retracing DOWN
    levels = retracementRatios.map((r) => ({
      label: `${(r * 100).toFixed(1)}%`,
      price: Number((swing_high - swing_range * r).toFixed(2)),
      pct: r,
    }));
  } else {
    // Price moved DOWN from high to low, now retracing UP
    levels = retracementRatios.map((r) => ({
      label: `${(r * 100).toFixed(1)}%`,
      price: Number((swing_low + swing_range * r).toFixed(2)),
      pct: r,
    }));
  }

  // Fibonacci extensions (targets beyond the swing)
  const extensionRatios = [1.272, 1.414, 1.618, 2.0, 2.618];
  let extensions;
  if (direction === "BULLISH_RETRACEMENT") {
    extensions = extensionRatios.map((r) => ({
      label: `${(r * 100).toFixed(1)}% ext`,
      price: Number((swing_low - swing_range * (r - 1)).toFixed(2)),
      pct: r,
    }));
  } else {
    extensions = extensionRatios.map((r) => ({
      label: `${(r * 100).toFixed(1)}% ext`,
      price: Number((swing_high + swing_range * (r - 1)).toFixed(2)),
      pct: r,
    }));
  }

  return { swing_high, swing_low, swing_range, direction, levels, extensions };
}

// Find the nearest Fib level acting as support/resistance for the current price
export function findNearestFibLevels(fib: FibLevels, current_price: number, count = 3) {
  const all = [...fib.levels, ...fib.extensions];
  const sorted = all
    .map((l) => ({ ...l, distance: Math.abs(l.price - current_price) }))
    .sort((a, b) => a.distance - b.distance);
  return sorted.slice(0, count);
}

// ============================================================
// SWING TRADE SCHEMA
// More expressive than the scalper: allows multi-target TPs,
// scaled entries, and explicit Fibonacci rationale.
// ============================================================
const SwingTradeSchema = z.object({
  thought_process: z.string().describe(
    "Step-by-step: (1) Identify swing high/low, (2) Map Fib levels, (3) Identify current price position relative to key Fib levels, (4) Determine entry zone, (5) Set SL below/above next Fib level, (6) Set TP1 at first Fib target, TP2 at second, TP3 at third, (7) Verify R:R for each target.",
  ),
  calculated_rr_to_tp1: z.number().nullable(),
  calculated_rr_to_tp2: z.number().nullable(),
  calculated_rr_to_tp3: z.number().nullable(),
  fibonacci_rationale: z.string().describe(
    "Which specific Fib level is the entry anchored to and why it is high-confluence (e.g. 61.8% + structure support + weekly EMA).",
  ),
  market_structure: z.enum(["BULLISH_TREND", "BEARISH_TREND", "RANGING", "DISTRIBUTION", "ACCUMULATION"]),
  recommended_direction: z.enum(["LONG", "SHORT", "NONE"]),
  strategy_applied: z.enum([
    "FIB_RETRACEMENT_LONG",
    "FIB_RETRACEMENT_SHORT",
    "FIB_EXTENSION_TARGET",
    "MACRO_REVERSAL_LONG",
    "MACRO_REVERSAL_SHORT",
    "RANGE_BOUNDARY",
    "NONE",
  ]),
  execution_parameters: z.object({
    entry_type: z.enum(["Buy Limit", "Sell Limit", "Buy Stop", "Sell Stop", "Market", "NONE"]),
    suggested_entry_price: z.number().nullable(),
    suggested_stop_loss: z.number().nullable(),
    take_profit_1: z.number().nullable().describe("Conservative target — first Fib confluence zone"),
    take_profit_2: z.number().nullable().describe("Primary target — strong Fib level or structure"),
    take_profit_3: z.number().nullable().describe(
      "Stretch/runner target — major Fib extension or psychological level",
    ),
  }),
  confidence_score: z.number().describe("0-100. S-Tier = 90+. Requires multi-confluence: Fib + structure + macro"),
  swing_rationale: z.object({
    fib_entry_level: z.string().describe("e.g. '61.8% retracement at $3,950'"),
    structural_confirmation: z.string().describe("e.g. 'Weekly support zone, daily wick rejection'"),
    macro_alignment: z.string().describe("e.g. 'Central bank demand, USD weakness cycle'"),
    invalidation_level: z.string().describe("e.g. 'Daily close below $3,880 invalidates thesis'"),
    tp1_rationale: z.string(),
    tp2_rationale: z.string(),
    tp3_rationale: z.string(),
  }),
});

type SwingTrade = z.infer<typeof SwingTradeSchema>;

// ============================================================
// AI EVALUATOR
// ============================================================

// ============================================================
// CANDLESTICK PATTERN RECOGNITION (From Agent-Sniper)
// ============================================================





// ============================================================
// AI ACTIVE SIGNAL REVALIDATOR (From Agent-Scalper)
// ============================================================


async function evaluateSwingOpportunity(
  symbol: string,
  snapshot: LogicContext,
  fib: FibLevels,
  timeframe: string,
  historicalMemory: string,
  macroContext: string,
): Promise<SwingTrade> {
  const openaiKey = Deno.env.get("OPENAI_API_KEY");
  const azureKey = Deno.env.get("AZURE_OPENAI_API_KEY");

  let openai: OpenAI;
  if (openaiKey) {
    openai = new OpenAI({ apiKey: openaiKey });
  } else if (azureKey) {
    openai = new OpenAI({
      apiKey: azureKey,
      baseURL: `${Deno.env.get("AZURE_OPENAI_ENDPOINT")}/openai/deployments/${Deno.env.get("AZURE_OPENAI_DEPLOYMENT")}`,
      defaultQuery: { "api-version": Deno.env.get("AZURE_OPENAI_API_VERSION") || "2023-07-01-preview" },
      defaultHeaders: { "api-key": azureKey },
    });
  } else {
    throw new Error("No OpenAI or Azure OpenAI keys found");
  }

  // Format Fib levels for AI consumption
  const fibSummary = fib.levels
    .map((l) => `  ${l.label} → $${l.price.toLocaleString()}`)
    .join("\n");
  const fibExtSummary = fib.extensions
    .map((l) => `  ${l.label} → $${l.price.toLocaleString()}`)
    .join("\n");

  const systemPrompt = `You are a Senior Institutional Swing Trader and Fibonacci Analyst. You specialize in identifying high-confluence, multi-week positional setups using Fibonacci retracement/extension levels, macro alignment, and multi-timeframe structure.

You respond EXCLUSIVELY in raw JSON. You are NOT a scalper. Minimum trade duration is 3-10 days.

[HISTORICAL PERFORMANCE FOR ${symbol}]
${historicalMemory || "No historical data available for this asset yet."}

[FIBONACCI ANALYSIS — Pre-computed for ${symbol}]
Dominant Swing: $${fib.swing_low.toLocaleString()} → $${fib.swing_high.toLocaleString()} (Range: $${fib.swing_range.toLocaleString()})
Direction Context: ${fib.direction}

Retracement Levels (key zones to watch):
${fibSummary}

Extension Levels (profit targets):
${fibExtSummary}

Current Price: ${snapshot.current_price?.toLocaleString()}
Candlestick Pattern: ${snapshot.candlestick_pattern}

[MARKET SNAPSHOT — ${timeframe} Timeframe]
${JSON.stringify(snapshot, null, 2)}

[MACRO & FUNDAMENTAL CONTEXT]
${macroContext || "No major macro events in the window."}

[SWING TRADE RULES — READ CAREFULLY]

1. FIBONACCI CONFLUENCE IS MANDATORY FOR S-TIER:
   An S-Tier (confidence >= 90) setup REQUIRES at least 3 of the following to align:
   - Price is at or within 1.5% of a key Fib level (38.2%, 50%, 61.8%, 78.6%)
   - A daily/weekly structural support or resistance zone overlaps the Fib level
   - RSI is showing divergence or approaching oversold/overbought (< 35 or > 65)
   - Candlestick pattern confirms reversal (e.g. BULLISH_ENGULFING, MORNING_STAR, BEARISH_REJECTION_PINBAR at support/resistance)
   - Macro fundamentals explicitly support the direction (MACRO SENTIMENT SCORE >= +5 for longs, or <= -5 for shorts)
   - Higher timeframe (Weekly) EMA (50 or 200) is perfectly aligned with the Fib level (see weekly_ema_50 / weekly_ema_200 in snapshot)
   If fewer than 3 align, maximum confidence is A-Tier (85). Never inflate confidence.

2. STOP LOSS PLACEMENT — SWING RULES:
   - Place SL BELOW the next significant Fib level or structural support (for longs)
   - Place SL ABOVE the next significant Fib level or structural resistance (for shorts)
   - Minimum SL distance: 1.5× daily ATR. Do not set stops tighter than this.
   - Maximum SL distance: 8% of entry price (swing trades can breathe)
   - For precious metals (XAUUSD, XAGUSD): Maximum SL is 10% of entry price

3. TAKE PROFIT STRUCTURE — THREE TARGETS:
   - TP1 (Conservative, 40% position close): Next Fib level in direction of trade
   - TP2 (Primary, 35% position close): Second major Fib level or structural zone
   - TP3 (Runner, 25% position close): Fib extension or psychological round number
   - ALL THREE targets must be mathematically achievable from the entry

4. R:R REQUIREMENTS FOR SWING:
   - S-Tier (≥90 confidence): TP2 must yield minimum 1:2.5 R:R
   - A-Tier (80–89): TP2 must yield minimum 1:2 R:R
   - B-Tier (70–79): TP2 must yield minimum 1:1.5 R:R
   - If R:R to TP2 does not meet threshold, set recommended_direction to "NONE"

5. COUNTER-TREND IS ALLOWED FOR SWING:
   - A mean-reversion long in a bearish market IS valid if price has reached a major Fib level (61.8% or 78.6%)
   - A counter-trend trade requires macro alignment: even if short-term bearish, the macro must support the reversal direction
   - Counter-trend setups cap at A-Tier (88 confidence max) unless ALL 5 confluence factors align

6. FOMC / HIGH-IMPACT EVENTS:
   - If a FOMC meeting is within 10 days and the trade direction depends on rate policy, reduce confidence by 10 points and note the risk.

7. NEVER FORCE A TRADE:
   - If the price is in the middle of the Fib range with no clear level to anchor to, output recommended_direction = "NONE"
   - If the macro fundamentally contradicts the technical thesis, output "NONE"

8. DIRECTIONAL BIAS FILTERING (CRITICAL):
   - If the Macro Sentiment Score is explicitly BEARISH (score < 0), you MUST REJECT any LONG technical setups and output "NONE" for recommended_direction, UNLESS you find a valid SHORT setup at HTF resistance (e.g. 61.8% Fib).
   - If the Macro Sentiment Score is explicitly BULLISH (score > 0), you MUST REJECT any SHORT technical setups and output "NONE" for recommended_direction, UNLESS you find a valid LONG setup at HTF support.
   - Confluence is non-negotiable for S-Tier. Do not output contradicting setups as A-Tier; reject them instead.

9. LTF CONFIRMATION REQUIRED FOR S-TIER:
   - Do not enter blindly at a HTF support/resistance level. An S-Tier setup REQUIRES a confirmed Lower Timeframe (LTF) Break of Structure (BOS) in your direction.
   - For LONG setups, 'ltf_bos_bullish' MUST be true in the snapshot.
   - For SHORT setups, 'ltf_bos_bearish' MUST be true in the snapshot.
   - If LTF BOS confirmation is missing, downgrade confidence to A-Tier (max 85) or reject.

Output ONLY the raw JSON object — no markdown, no backticks, no explanation outside the JSON. You MUST strictly adhere to the following JSON schema:

{
  "thought_process": "String. Step-by-step math and reasoning for entry, SL, and TP.",
  "calculated_rr_to_tp1": 0.0,
  "calculated_rr_to_tp2": 0.0,
  "calculated_rr_to_tp3": 0.0,
  "fibonacci_rationale": "String.",
  "market_structure": "BULLISH_TREND | BEARISH_TREND | RANGING | DISTRIBUTION | ACCUMULATION",
  "recommended_direction": "LONG | SHORT | NONE",
  "strategy_applied": "FIB_RETRACEMENT_LONG | FIB_RETRACEMENT_SHORT | FIB_EXTENSION_TARGET | MACRO_REVERSAL_LONG | MACRO_REVERSAL_SHORT | RANGE_BOUNDARY | NONE",
  "execution_parameters": {
    "entry_type": "Buy Limit | Sell Limit | Buy Stop | Sell Stop | Market | NONE",
    "suggested_entry_price": 0.0,
    "suggested_stop_loss": 0.0,
    "take_profit_1": 0.0,
    "take_profit_2": 0.0,
    "take_profit_3": 0.0
  },
  "confidence_score": 0,
  "swing_rationale": {
    "fib_entry_level": "String",
    "structural_confirmation": "String",
    "macro_alignment": "String",
    "invalidation_level": "String",
    "tp1_rationale": "String",
    "tp2_rationale": "String",
    "tp3_rationale": "String"
  }
}
`;;

  const userPrompt = `Analyze ${symbol} on the ${timeframe} timeframe. The pre-computed Fibonacci levels are provided above. Identify the highest-probability swing trade setup if one exists. Calculate your R:R for all three TP levels in your thought_process before filling in the execution_parameters. Return the required JSON.`;

  let messages: any[] = [
    { role: "system", content: systemPrompt },
    { role: "user", content: userPrompt },
  ];

  for (let attempt = 1; attempt <= 3; attempt++) {
    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      messages,
      response_format: { type: "json_object" },
      temperature: 0.15,
    });

    const content = response.choices[0].message.content;
    if (!content) throw new Error("No content returned from AI");

    let parsedJson: any;
    try {
      parsedJson = JSON.parse(content);
    } catch (e: any) {
      messages.push({ role: "assistant", content });
      messages.push({
        role: "user",
        content: `Your response was not valid JSON: ${e.message}. Respond ONLY with the raw JSON object.`,
      });
      continue;
    }

    const parsed = SwingTradeSchema.safeParse(parsedJson);
    if (!parsed.success) {
      messages.push({ role: "assistant", content });
      messages.push({
        role: "user",
        content: `Your JSON failed schema validation: ${parsed.error.message}. Fix all issues and resubmit.`,
      });
      continue;
    }

    const data = parsed.data;

    // Verify R:R math independently for TP2 (primary target)
    if (
      data.recommended_direction !== "NONE" &&
      data.execution_parameters.suggested_entry_price &&
      data.execution_parameters.suggested_stop_loss &&
      data.execution_parameters.take_profit_2
    ) {
      const entry = data.execution_parameters.suggested_entry_price;
      const sl = data.execution_parameters.suggested_stop_loss;
      const tp2 = data.execution_parameters.take_profit_2;
      const risk = Math.abs(entry - sl);
      const reward = Math.abs(entry - tp2);
      const rr = risk > 0 ? reward / risk : 0;

      let requiredRR = 1.5;
      if (data.confidence_score >= 90) requiredRR = 2.5;
      else if (data.confidence_score >= 80) requiredRR = 2.0;
      else if (data.confidence_score >= 70) requiredRR = 1.5;

      if (rr < requiredRR - 0.1) {
        messages.push({ role: "assistant", content });
        messages.push({
          role: "user",
          content: `Your TP2 yields a R:R of 1:${rr.toFixed(2)}, but your confidence of ${data.confidence_score} requires a minimum R:R of 1:${requiredRR} to TP2. You must either widen your TP2 target, tighten your stop loss, or lower your confidence score. Recalculate and resubmit.`,
        });
        continue;
      }
    }

    return data;
  }

  throw new Error("Swing AI failed to produce valid JSON after 3 attempts");
}

// ============================================================
// TIER & LABEL HELPERS
// ============================================================
function getTier(confidence: number): string {
  if (confidence >= 90) return "S-Tier";
  if (confidence >= 80) return "A-Tier";
  if (confidence >= 70) return "B-Tier";
  return "C-Tier";
}

// ============================================================
// MAIN HANDLER
// ============================================================
serve(async (req) => {
  const { searchParams } = new URL(req.url);
  const isCron = req.method === "POST";

  let reqBody: any = {};
  if (req.method === "POST" && req.headers.get("content-type")?.includes("application/json")) {
    try {
      reqBody = await req.json();
    } catch (_) {}
  }

  // Swing pipeline always runs on 1D bars for maximum context
  const timeframe = reqBody.timeframe ?? searchParams.get("timeframe") ?? "1D";
  const lookback = Number(reqBody.lookback ?? searchParams.get("lookback") ?? 300);
  const symbolsParam =
    reqBody.symbols?.join(",") ||
    searchParams.get("symbols") ||
    Deno.env.get("SWING_SYMBOLS") ||
    "XAUUSD,XAGUSD,BTCUSD,UKOIL,EURUSD,GBPUSD,USDJPY,US30,NAS100";
  const symbols = symbolsParam.split(",").map((s: string) => s.trim()).filter(Boolean);
  const newsContext = searchParams.get("news") ?? undefined;

  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!url || !key) {
    return new Response(JSON.stringify({ ok: false, error: "missing env" }), {
      status: 500,
      headers: { "content-type": "application/json" },
    });
  }

  const authHeader = req.headers.get("Authorization");
  const cronSecretHeader = req.headers.get("x-cron-secret");
  const cronSecretEnv = Deno.env.get("CRON_SECRET");

  const isAuthorized =
    authHeader === `Bearer ${key}` ||
    (cronSecretHeader && cronSecretEnv && cronSecretHeader === cronSecretEnv);

  if (!isAuthorized) {
    return new Response(JSON.stringify({ ok: false, error: "Unauthorized" }), {
      status: 401,
      headers: { "content-type": "application/json" },
    });
  }

  const supabase = createClient(url, key, {
    auth: { persistSession: false },
    global: { headers: { Authorization: `Bearer ${key}` } },
  });

  const traceId = crypto.randomUUID();

  async function runSwingPipeline(sendEvent: (data: any) => void) {
    const results: any[] = [];
    const rejections: any[] = [];

    try {
      console.log(`[Swing Pipeline] [Trace: ${traceId}] Starting for symbols: ${symbols.join(", ")}`);
      sendEvent({ type: "progress", message: `[Swing Pipeline] [Trace: ${traceId}] Starting macro Fibonacci analysis for: ${symbols.join(", ")}` });

      // Guard: Volatility Lockout
      const { data: lockout } = await supabase
        .from("market_context")
        .select("id")
        .eq("macro_bias", "VOLATILITY_LOCKOUT")
        .gt("expires_at", new Date().toISOString())
        .limit(1);

      if (lockout && lockout.length > 0) {
        console.log(`[Swing Pipeline] [Trace: ${traceId}] VOLATILITY LOCKOUT active — skipping technical analysis to avoid fundamental chaos`);
        sendEvent({ type: "progress", message: `[Guard] VOLATILITY LOCKOUT active — skipping technical evaluation.` });
        return;
      }

      // Fetch macro events once
      const allEvents = await fetchAllMacroEvents().catch(() => null);

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
              const result = await fetchPaperBars(signal.symbol, signal.timeframe === '1d' ? '1D' : signal.timeframe, 100, supabase);
              const snapshot = getContextSnapshot(
                result.map((b: any) => b.t),
                result.map((b: any) => b.o),
                result.map((b: any) => b.h),
                result.map((b: any) => b.l),
                result.map((b: any) => b.c)
              );

              // 3. Math Validation (Stop Loss Hit)
              const stopLoss = signal.stop_plan_json?.stop;
              if (stopLoss) {
                if ((signal.side === 'LONG' && snapshot.current_price <= stopLoss) || 
                    (signal.side === 'SHORT' && snapshot.current_price >= stopLoss)) {
                  await supabase.from("trade_opportunities").update({ status: "LOST", r_multiple: -1, ai_risks: "Technical Invalidation: Stop Loss crossed." }).eq("id", signal.id);
                  // await cancelBrokerOrdersForOpportunity(supabase, signal.id);
                  console.log(`[Validation] LOST ${signal.symbol}: Stop loss crossed by live price.`);
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


      for (const symbol of symbols) {
        try {
          sendEvent({ type: "progress", message: `[${symbol}] Fetching ${lookback} daily bars...` });

          let bars: Bar[];
          try {
            bars = await fetchPaperBars(symbol, timeframe, lookback, supabase);
          } catch (err: any) {
            console.error(`[Data Error] [Trace: ${traceId}] ${symbol}: ${err.message}`);
            rejections.push({ symbol, reason: `Data fetch failed: ${err.message}`, layer: "Data" });
            continue;
          }

          if (bars.length < 100) {
            rejections.push({ symbol, reason: `Insufficient data (${bars.length} bars, need 100+)`, layer: "Data" });
            sendEvent({ type: "progress", message: `[${symbol}] Skipped: insufficient data` });
            continue;
          }

          sendEvent({ type: "progress", message: `[${symbol}] ${bars.length} bars loaded. Computing Fibonacci levels...` });

          const open = bars.map((b) => b.o);
          const timestamps = bars.map((b) => b.t);
          const high = bars.map((b) => b.h);
          const low = bars.map((b) => b.l);
          const close = bars.map((b) => b.c);

          // === FIBONACCI ENGINE ===
          const fib = calculateFibonacciLevels(high, low, close);
          const currentPrice = close[close.length - 1];
          const nearestFibs = findNearestFibLevels(fib, currentPrice, 3);

          sendEvent({
            type: "progress",
            message: `[${symbol}] Fib range: $${fib.swing_low.toLocaleString()} → $${fib.swing_high.toLocaleString()}. Nearest key levels: ${nearestFibs.map((f) => f.label + " @ $" + f.price.toLocaleString()).join(", ")}`,
          });

          // === MARKET SNAPSHOT ===
          const snapshot = getContextSnapshot(timestamps, open, high, low, close);

          // === ASSET ISOLATION (PYRAMIDING) GUARD ===
          sendEvent({ type: "progress", message: `[Pre-AI Guard] Validating global signal constraints for ${symbol}...` });
          const riskValidation = await validateGlobalSignal(supabase, symbol, snapshot);
          if (!riskValidation.valid) {
            console.log(`[Pre-AI Guard] [Trace: ${traceId}] REJECTED ${symbol}: ${riskValidation.reason}`);
            sendEvent({ type: "progress", message: `[Pre-AI Guard] Skipped ${symbol}: Exposure constraints violated.` });
            await insertAuditLog(supabase, {
              actor_type: "SYSTEM",
              action: "REJECTED_BY_RISK_PRE_AI",
              entity_type: "swing_research",
              payload_json: { symbol, reason: riskValidation.reason },
            });
            rejections.push({ symbol, reason: riskValidation.reason, layer: "Pre-AI Guard" });
            continue;
          }

          // Enrich with MTFA (weekly) if available
          try {
            const weeklyBars = await fetchPaperBars(symbol, "1W", 52, supabase);
            if (weeklyBars.length > 10) {
              const weeklySnap = getContextSnapshot(
                weeklyBars.map((b) => b.t),
                weeklyBars.map((b) => b.o),
                weeklyBars.map((b) => b.h),
                weeklyBars.map((b) => b.l),
                weeklyBars.map((b) => b.c),
              );
              (snapshot as any).weekly_trend = weeklySnap.trend_alignment;
              (snapshot as any).weekly_ema_50 = weeklySnap.ema_50;
              (snapshot as any).weekly_ema_200 = weeklySnap.ema_200;
              (snapshot as any).weekly_rsi = weeklySnap.rsi_14;
            }
          } catch (_) {
            console.warn(`[${symbol}] [Trace: ${traceId}] Weekly MTFA fetch failed, continuing without it.`);
          }

          // Enrich with LTF (1H or 30m) for BOS confirmation
          try {
            const ltfTimeframe = timeframe.toLowerCase() === "1d" ? "1h" : "30m";
            const ltfBars = await fetchPaperBars(symbol, ltfTimeframe, 100, supabase);
            if (ltfBars.length > 20) {
              const ltfSnap = getContextSnapshot(
                ltfBars.map((b) => b.t),
                ltfBars.map((b) => b.o),
                ltfBars.map((b) => b.h),
                ltfBars.map((b) => b.l),
                ltfBars.map((b) => b.c),
              );
              (snapshot as any).ltf_timeframe = ltfTimeframe;
              (snapshot as any).ltf_trend = ltfSnap.trend_alignment;
              (snapshot as any).ltf_bos_bullish = ltfSnap.bos_bullish;
              (snapshot as any).ltf_bos_bearish = ltfSnap.bos_bearish;
            }
          } catch (err: any) {
            console.warn(`[${symbol}] [Trace: ${traceId}] LTF fetch failed, continuing without it: ${err.message}`);
          }

          // === MACRO CONTEXT & SENTIMENT SCORING ===
          const headlines = await fetchRealtimeNews(symbol).catch(() => []);
          
          let sentimentScore = 0;
          if (headlines && headlines.length > 0) {
            try {
              const openaiKey = Deno.env.get("OPENAI_API_KEY");
              const azureKey = Deno.env.get("AZURE_OPENAI_API_KEY");
              let sentimentOpenAI: OpenAI;
              if (openaiKey) {
                sentimentOpenAI = new OpenAI({ apiKey: openaiKey });
              } else if (azureKey) {
                sentimentOpenAI = new OpenAI({
                  apiKey: azureKey,
                  baseURL: `${Deno.env.get("AZURE_OPENAI_ENDPOINT")}/openai/deployments/${Deno.env.get("AZURE_OPENAI_DEPLOYMENT")}`,
                  defaultQuery: { "api-version": Deno.env.get("AZURE_OPENAI_API_VERSION") || "2023-07-01-preview" },
                  defaultHeaders: { "api-key": azureKey },
                });
              } else {
                throw new Error("No OpenAI or Azure OpenAI keys found");
              }

              const sentimentResponse = await sentimentOpenAI.chat.completions.create({
                model: "gpt-4o-mini", // fast model for sentiment
                messages: [
                  { role: "system", content: "You are a quantitative news analyst. Score the following headlines for the given financial asset strictly from -10 (extremely bearish) to +10 (extremely bullish). Output ONLY the integer score." },
                  { role: "user", content: `Asset: ${symbol}\nHeadlines:\n${headlines.join('\n')}` }
                ],
                temperature: 0
              });

              const parsedScore = parseInt(sentimentResponse.choices[0].message?.content?.trim() || "0", 10);
              if (!isNaN(parsedScore)) sentimentScore = parsedScore;
              sendEvent({ type: "progress", message: `[${symbol}] Sentiment Score: ${sentimentScore}/10` });
            } catch (err: any) {
              console.error(`[Sentiment Error] Failed to evaluate sentiment for ${symbol}: ${err.message}`);
            }
          }

          let macroContext = generateMacroContext(symbol, allEvents, headlines);
          macroContext += `\n\nMACRO SENTIMENT SCORE: ${sentimentScore} / 10`;

          // === HISTORICAL MEMORY ===
          const { data: pastTrades } = await supabase
            .from("trade_opportunities")
            .select("status, side, ai_summary, ai_risks, r_multiple, timeframe")
            .eq("symbol", symbol)
            .in("status", ["WON", "LOST", "REJECTED"])
            .in("timeframe", ["1d", "1D", "1w", "1W"])
            .order("created_at", { ascending: false })
            .limit(5);

          let historicalMemory = "";
          if (pastTrades && pastTrades.length > 0) {
            historicalMemory = pastTrades.map((t, i) => {
              return `Swing Decision ${i + 1} (${t.side} on ${t.timeframe} → ${t.status}, ${t.r_multiple !== null ? t.r_multiple + "R" : "N/A"}): "${t.ai_summary || "No rationale"}"`;
            }).join("\n");
          }

          // === PUBLISH TO MARKET CONTEXT (Shared Intelligence Layer) ===
          // Write Fibonacci levels and macro structure to the shared context table
          // so the Scalper (and future agents) can use them regardless of AI outcome.
          try {
            // Expire any stale entries for this symbol from this agent
            await supabase
              .from("market_context")
              .update({ expires_at: new Date().toISOString() })
              .eq("symbol", symbol)
              .eq("agent_persona", "SWING_TRADER")
              .gt("expires_at", new Date().toISOString());

            // Insert fresh Fib context — valid for 7 days (one weekly candle)
            const { error: ctxErr } = await supabase.from("market_context").insert({
              symbol,
              agent_persona: "SWING_TRADER",
              timeframe: timeframe.toLowerCase(),
              expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
              key_levels: {
                fib_levels: fib.levels,
                fib_extensions: fib.extensions,
                swing_high: fib.swing_high,
                swing_low: fib.swing_low,
                nearest_fibs: nearestFibs,
                direction: fib.direction,
              },
              macro_bias: (snapshot as any).weekly_trend?.startsWith("BULLISH")
                ? "BULLISH"
                : (snapshot as any).weekly_trend?.startsWith("BEARISH")
                ? "BEARISH"
                : "NEUTRAL",
              invalidation_price: null, // will be set after AI evaluation below
              narrative: `Swing range $${fib.swing_low.toLocaleString()} → $${fib.swing_high.toLocaleString()} (${fib.direction}). Nearest Fib levels: ${nearestFibs.map((f) => f.label + " @ $" + f.price.toLocaleString()).join(", ")}. Weekly trend: ${(snapshot as any).weekly_trend ?? "unknown"}.`,
              trace_id: traceId,
            });

            if (ctxErr) {
              console.warn(`[Market Context] [Trace: ${traceId}] Write failed for ${symbol}: ${ctxErr.message}`);
            } else {
              console.log(`[Market Context] [Trace: ${traceId}] Published Fib levels for ${symbol} (7-day TTL)`);
              sendEvent({ type: "progress", message: `[Market Context] Fibonacci zones published for ${symbol} — Scalper will now use these levels` });
            }
          } catch (ctxWriteErr: any) {
            console.warn(`[Market Context] [Trace: ${traceId}] Unexpected error for ${symbol}: ${ctxWriteErr.message}`);
          }

          // === AI EVALUATION ===
          sendEvent({ type: "progress", message: `[${symbol}] Submitting to Swing AI for Fibonacci analysis...` });

          let evaluation: SwingTrade;
          try {
            evaluation = await evaluateSwingOpportunity(symbol, snapshot, fib, timeframe, historicalMemory, macroContext);
          } catch (err: any) {
            console.error(`[AI Error] [Trace: ${traceId}] ${symbol}: ${err.message}`);
            rejections.push({ symbol, reason: `AI evaluation failed: ${err.message}`, layer: "AI" });
            sendEvent({ type: "progress", message: `[${symbol}] AI evaluation failed: ${err.message}` });
            continue;
          }

          const confidence = evaluation.confidence_score;
          const tier = getTier(confidence);

          if (evaluation.recommended_direction === "NONE" || confidence < 70) {
            const reason = evaluation.recommended_direction === "NONE"
              ? `No valid swing setup identified: ${evaluation.thought_process?.slice(0, 200)}`
              : `Confidence too low (${confidence}) — below 70 threshold`;

            sendEvent({ type: "progress", message: `[${symbol}] No trade: ${reason.slice(0, 120)}` });
            await supabase.from("trade_opportunities").insert({
              symbol,
              side: "LONG", // placeholder — no trade
              timeframe: timeframe.toLowerCase(),
              status: "REJECTED",
              ai_summary: `[SWING][${tier}] ${evaluation.recommended_direction === "NONE" ? "No setup" : "Low confidence"}: ${evaluation.thought_process?.slice(0, 400)}`,
              ai_risks: `Rejected by Swing AI: ${reason.slice(0, 200)}`,
              confidence,
              trace_id: traceId,
            });
            rejections.push({ symbol, reason, layer: "Swing AI" });
            continue;
          }

          // === BACKFILL INVALIDATION PRICE IN MARKET CONTEXT ===
          // Now that the AI has computed the stop loss, update the context row
          // so the Scalper knows exactly where the swing thesis is invalidated.
          const aiSl = evaluation.execution_parameters.suggested_stop_loss;
          if (aiSl) {
            supabase
              .from("market_context")
              .update({
                invalidation_price: aiSl,
                macro_bias: evaluation.recommended_direction === "LONG" ? "BULLISH"
                          : evaluation.recommended_direction === "SHORT" ? "BEARISH" : "NEUTRAL",
                narrative: evaluation.fibonacci_rationale,
              })
              .eq("symbol", symbol)
              .eq("agent_persona", "SWING_TRADER")
              .gt("expires_at", new Date().toISOString())
              .then(({ error }) => {
                if (error) console.warn(`[Market Context] [Trace: ${traceId}] Backfill failed for ${symbol}: ${error.message}`);
                else console.log(`[Market Context] [Trace: ${traceId}] Invalidation price backfilled for ${symbol}: ${aiSl}`);
              });
          }

          // === LAYER C: STRUCTURAL RISK VALIDATION ===
          const entry = evaluation.execution_parameters.suggested_entry_price!;
          const sl = evaluation.execution_parameters.suggested_stop_loss!;
          const tp1 = evaluation.execution_parameters.take_profit_1;
          const tp2 = evaluation.execution_parameters.take_profit_2;
          const tp3 = evaluation.execution_parameters.take_profit_3;

          if (!entry || !sl || !tp2) {
            rejections.push({ symbol, reason: "Missing entry, SL, or TP2", layer: "Execution Desk" });
            continue;
          }

          const riskPct = Math.abs(entry - sl) / entry;
          const maxRiskPct = ["XAUUSD", "XAGUSD"].includes(symbol) ? 0.10 : 0.08;

          if (riskPct > maxRiskPct) {
            const msg = `Stop loss ${(riskPct * 100).toFixed(2)}% exceeds swing maximum of ${(maxRiskPct * 100).toFixed(0)}%`;
            sendEvent({ type: "progress", message: `[${symbol}] REJECTED: ${msg}` });
            await supabase.from("trade_opportunities").insert({
              symbol,
              side: evaluation.recommended_direction,
              timeframe: timeframe.toLowerCase(),
              status: "REJECTED",
              ai_summary: `[SWING][${tier}] ${evaluation.fibonacci_rationale}`,
              ai_risks: msg,
              confidence,
              trace_id: traceId,
            });
            rejections.push({ symbol, reason: msg, layer: "Execution Desk" });
            continue;
          }

          const rrToTp2 = Math.abs(tp2 - entry) / Math.abs(entry - sl);
          let requiredRR = 1.5;
          if (confidence >= 90) requiredRR = 3.0;
          else if (confidence >= 80) requiredRR = 2.0;

          if (rrToTp2 < requiredRR - 0.1) {
            const msg = `R:R to TP2 is 1:${rrToTp2.toFixed(2)}, below required 1:${requiredRR} for ${tier}`;
            sendEvent({ type: "progress", message: `[${symbol}] REJECTED: ${msg}` });
            await supabase.from("trade_opportunities").insert({
              symbol,
              side: evaluation.recommended_direction,
              timeframe: timeframe.toLowerCase(),
              status: "REJECTED",
              ai_summary: `[SWING][${tier}] ${evaluation.fibonacci_rationale}`,
              ai_risks: `Rejected by Swing Desk: ${msg}`,
              confidence,
              trace_id: traceId,
            });
            rejections.push({ symbol, reason: msg, layer: "Execution Desk" });
            continue;
          }

          // === APPROVED — SAVE TO DB ===
          const r = evaluation.swing_rationale;
          const aiSummary = [
            `[SWING][${tier}] [${evaluation.market_structure} → ${evaluation.strategy_applied}]`,
            evaluation.fibonacci_rationale,
            r.structural_confirmation,
            r.macro_alignment,
            r.invalidation_level,
            tp1 ? `TP1 @ $${tp1.toLocaleString()}: ${r.tp1_rationale}` : null,
            tp2 ? `TP2 @ $${tp2.toLocaleString()}: ${r.tp2_rationale}` : null,
            tp3 ? `TP3 @ $${tp3.toLocaleString()}: ${r.tp3_rationale}` : null,
            `R:R to TP2: 1:${rrToTp2.toFixed(1)} | Fib Swing: $${fib.swing_low.toLocaleString()} → $${fib.swing_high.toLocaleString()}`,
          ].filter(Boolean).join(" | ");

          let order_type = evaluation.recommended_direction === "LONG" ? "BUY MARKET" : "SELL MARKET";
          if (Math.abs(entry - currentPrice) / currentPrice > 0.002) {
            if (evaluation.recommended_direction === "LONG") {
              order_type = entry < currentPrice ? "BUY LIMIT" : "BUY STOP";
            } else {
              order_type = entry > currentPrice ? "SELL LIMIT" : "SELL STOP";
            }
          }

          const { data: dbData, error: dbError } = await supabase
            .from("trade_opportunities")
            .insert({
              symbol,
              side: evaluation.recommended_direction,
              timeframe: timeframe.toLowerCase(),
              status: "APPROVED",
              entry_plan_json: {
                price: entry,
                order_type,
                scaled_entries: null,
              },
              stop_plan_json: {
                stop: sl,
                initial: sl,
                atr: snapshot.atr_14,
              },
              take_profit_json: {
                tp: tp2, // primary TP drives execution
                tp1,
                tp2,
                tp3,
              },
              risk_summary: `RSI ${snapshot.rsi_14} | ATR ${snapshot.atr_14}`,
              confidence,
              ai_summary: aiSummary,
              ai_risks: "Managed by Swing AI Risk Officer",
              trace_id: traceId,
            })
            .select("id")
            .single();

          if (dbError) {
            console.error(`[DB Error] [Trace: ${traceId}] ${symbol}: ${dbError.message}`);
            rejections.push({ symbol, reason: dbError.message, layer: "Database" });
            continue;
          }

          console.log(`[Swing] [Trace: ${traceId}] APPROVED ${symbol} — ID: ${dbData.id} | ${tier} | R:R 1:${rrToTp2.toFixed(1)} to TP2`);
          sendEvent({
            type: "progress",
            message: `[${symbol}] ✅ SWING SIGNAL APPROVED — ${tier} | Entry: $${entry.toLocaleString()} | SL: $${sl.toLocaleString()} | TP2: $${tp2.toLocaleString()} | R:R 1:${rrToTp2.toFixed(1)}`,
          });

          await insertAuditLog(supabase, {
            actor_type: "SYSTEM",
            action: "SWING_SIGNAL_APPROVED",
            entity_type: "research",
            entity_id: dbData.id,
            payload_json: {
              symbol,
              tier,
              entry,
              sl,
              tp1,
              tp2,
              tp3,
              rr_to_tp2: rrToTp2,
              fib_swing_high: fib.swing_high,
              fib_swing_low: fib.swing_low,
              fibonacci_rationale: evaluation.fibonacci_rationale,
            },
          });

          // Telegram notification for S-Tier swing signals
          if (confidence >= 90) {
            const botToken = Deno.env.get("TELEGRAM_BOT_TOKEN");
            const chatId = Deno.env.get("TELEGRAM_CHAT_ID");
            if (botToken && chatId) {
              const direction = evaluation.recommended_direction === "LONG" ? "📈 LONG" : "📉 SHORT";
              const msg = `🏆 *S-TIER SWING SIGNAL — ${symbol}*\n\n${direction} | ${order_type}\n\n📌 *Entry:* $${entry.toLocaleString()}\n🛑 *Stop Loss:* $${sl.toLocaleString()}\n🎯 *TP1:* $${tp1?.toLocaleString() ?? "N/A"}\n🎯 *TP2:* $${tp2.toLocaleString()}\n🚀 *TP3:* $${tp3?.toLocaleString() ?? "N/A"}\n\n📐 *R:R to TP2:* 1:${rrToTp2.toFixed(1)}\n\n*Fibonacci Basis:* ${evaluation.fibonacci_rationale}\n*Macro:* ${r.macro_alignment}\n*Invalidation:* ${r.invalidation_level}`;
              await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ chat_id: chatId, text: msg, parse_mode: "Markdown" }),
              }).catch((e) => console.error("Telegram error:", e));
            }
          }

          results.push({ symbol, id: dbData.id, tier, entry, sl, tp1, tp2, tp3, rr_to_tp2: rrToTp2 });
        } catch (symbolErr: any) {
          console.error(`[Global Error] [Trace: ${traceId}] ${symbol}: ${symbolErr.message}`);
          rejections.push({ symbol, reason: symbolErr.message, layer: "System" });
        }
      }

      sendEvent({ type: "complete", opportunities: results, rejections });
      return { opportunities: results, rejections };
    } catch (pipelineErr: any) {
      console.error(`[Pipeline Error] [Trace: ${traceId}] ${pipelineErr.message}`);
      return { error: pipelineErr.message };
    }
  }

  if (isCron) {
    const data = await runSwingPipeline(() => {});
    return new Response(JSON.stringify(data), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }

  // SSE stream for manual invocations
  const body = new ReadableStream({
    async start(controller) {
      function sendEvent(data: any) {
        try {
          controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(data)}\n\n`));
        } catch (_) {}
      }
      try {
        await runSwingPipeline(sendEvent);
      } finally {
        controller.close();
      }
    },
  });

  return new Response(body, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
});
