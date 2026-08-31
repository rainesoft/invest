import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient, SupabaseClient } from "npm:@supabase/supabase-js@2.108.2";
import { fetchPaperBars, Bar } from "../../../packages/execution/index.ts";
import { insertAuditLog } from "../../../packages/core/audit.ts";
import { fetchAllMacroEvents, generateMacroContext, fetchRealtimeNews, detectCentralBankEvent, detectUpcomingFedEvent, computeMacroConfidenceBoost, fetchETFFlowSentiment } from "../../../packages/core/news.ts";
import { isAutoTradingEnabled, getTradingSymbols } from "../../../packages/core/settings.ts";
import { isMarketOpen } from "../../../packages/core/market.ts";

import { revalidateOpportunity } from "../../../packages/strategy/revalidation.ts";

import { getContextSnapshot, LogicContext, isBullishEngulfing, isBearishRejection, computeHtfFibAlignment, calibrateProbability, computeLiquiditySweepScore, calculateInstitutionalTradingCentralLevels, calculateFibonacciProjections, FibonacciProjection, FibonacciProjectionsResult } from "../../../packages/strategy/indicators.ts";
import { validateGlobalSignal } from "../../../packages/strategy/agent-risk.ts";
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
  projections?: {
    label: string;
    price: number;
    pct: number;
  }[];
  projections_narrative?: string;
};

export function calculateFibonacciLevels(high: number[], low: number[], close: number[]): FibLevels {
  // Limit to the last 80 bars for Fibonacci to avoid massive macro swings on 300-bar datasets
  let lookbackBars = 80;
  let recentHigh = high.slice(-lookbackBars);
  let recentLow = low.slice(-lookbackBars);

  // Identify the dominant swing: look at recent history for the major high and low
  let swing_high = Math.max(...recentHigh);
  let swing_low = Math.min(...recentLow);
  let swing_range = swing_high - swing_low;
  const current_price = close[close.length - 1];

  // Dynamic Lookback Expansion: If volatility is extremely low (range < 0.5% of price), expand lookback to find the real structural range
  if (swing_range / current_price < 0.005 && high.length >= 150) {
    lookbackBars = 150;
    recentHigh = high.slice(-lookbackBars);
    recentLow = low.slice(-lookbackBars);
    swing_high = Math.max(...recentHigh);
    swing_low = Math.min(...recentLow);
    swing_range = swing_high - swing_low;
  }

  // Determine if we are in a bullish retracement (came from low, pulled back from high)
  // or bearish retracement (came from high, bouncing from low)
  const highIdx = recentHigh.indexOf(swing_high);
  const lowIdx = recentLow.indexOf(swing_low);
  const direction: "BULLISH_RETRACEMENT" | "BEARISH_RETRACEMENT" =
    highIdx > lowIdx ? "BULLISH_RETRACEMENT" : "BEARISH_RETRACEMENT";

  // Standard Fibonacci retracement ratios
  const retracementRatios = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1.0];

  let levels;
  if (direction === "BULLISH_RETRACEMENT") {
    // Price moved UP from low to high, now retracing DOWN
    levels = retracementRatios.map((r) => ({
      label: `${(r * 100).toFixed(1)}%`,
      price: Number((swing_high - swing_range * r).toFixed(5)),
      pct: r,
    }));
  } else {
    // Price moved DOWN from high to low, now retracing UP
    levels = retracementRatios.map((r) => ({
      label: `${(r * 100).toFixed(1)}%`,
      price: Number((swing_low + swing_range * r).toFixed(5)),
      pct: r,
    }));
  }

  // Fibonacci extensions (targets beyond the swing)
  const extensionRatios = [1.272, 1.414, 1.618, 2.0, 2.618];
  let extensions;
  if (direction === "BULLISH_RETRACEMENT") {
    extensions = extensionRatios.map((r) => ({
      label: `${(r * 100).toFixed(1)}% ext`,
      price: Number((swing_low - swing_range * (r - 1)).toFixed(5)),
      pct: r,
    }));
  } else {
    extensions = extensionRatios.map((r) => ({
      label: `${(r * 100).toFixed(1)}% ext`,
      price: Number((swing_high + swing_range * (r - 1)).toFixed(5)),
      pct: r,
    }));
  }

  // 3-Point Fibonacci Projections / Expansions (Trading Central)
  const projResult = calculateFibonacciProjections(high, low, close, lookbackBars);
  const projections = projResult.has_valid_abc
    ? projResult.projections.map((p) => ({
        label: p.label,
        price: p.price,
        pct: p.ratio,
      }))
    : [];

  return {
    swing_high,
    swing_low,
    swing_range,
    direction,
    levels,
    extensions,
    projections,
    projections_narrative: projResult.has_valid_abc ? projResult.narrative : undefined,
  };
}

// Find the nearest Fib level acting as support/resistance for the current price
export function findNearestFibLevels(fib: FibLevels, current_price: number, count = 3) {
  const all = [...fib.levels, ...fib.extensions, ...(fib.projections || [])];
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
  recommended_direction: z.enum(["LONG", "SHORT", "NONE", "REQUIRE_LTF_DRILLDOWN"]),
  strategy_applied: z.enum([
    "FIB_RETRACEMENT_LONG",
    "FIB_RETRACEMENT_SHORT",
    "FIB_EXTENSION_TARGET",
    "MACRO_REVERSAL_LONG",
    "MACRO_REVERSAL_SHORT",
    "MACRO_MOMENTUM_BREAKOUT_LONG",
    "MACRO_MOMENTUM_BREAKOUT_SHORT",
    "LIQUIDITY_SWEEP_LONG",
    "LIQUIDITY_SWEEP_SHORT",
    "RANGE_BOUNDARY",
    "NONE",
  ]),
  execution_parameters: z.object({
    entry_type: z.enum(["Buy Limit", "Sell Limit", "Buy Stop", "Sell Stop", "Market", "NONE"]),
    suggested_entry_price: z.number().nullable(),
    atr_multiplier_sl: z.number().nullable().describe("Multiplier for ATR to calculate Stop Loss distance (e.g. 1.5). Required to be 1.0 to 3.0."),
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
  fomcModeActive: boolean,
  inflectionThresholdPct: number,
): Promise<SwingTrade> {
  const openaiKey = Deno.env.get("OPENAI_API_KEY");
  if (!openaiKey) throw new Error("No OpenAI key found");

  const headers = {
    "Authorization": `Bearer ${openaiKey}`,
    "Content-Type": "application/json"
  };

  // Format Fib levels for AI consumption
  const fibSummary = fib.levels
    .map((l) => `  ${l.label} → $${l.price.toLocaleString()}`)
    .join("\n");
  const fibExtSummary = fib.extensions
    .map((l) => `  ${l.label} → $${l.price.toLocaleString()}`)
    .join("\n");
  const fibProjSummary = fib.projections && fib.projections.length > 0
    ? fib.projections.map((l) => `  ${l.label} → $${l.price.toLocaleString()}`).join("\n")
    : "  No completed 3-point ABC swing formation established yet";

  const isWeekend = new Date().getDay() === 0 || new Date().getDay() === 6;
  const isCrypto = ["BTCUSD"].includes(symbol);
  const weekendCryptoDirective = (isWeekend && isCrypto) ? `\nCRITICAL WEEKEND CRYPTO DIRECTIVE: It is currently the weekend. Crypto volume is naturally lower. Do NOT reject setups due to 'low volume' or 'choppy ADX' compared to weekday forex baselines. Utilize a lower-volatility baseline for your momentum and breakout criteria.` : "";

  const userContent = `Analyze ${symbol} on the ${timeframe} timeframe. Identify the highest-probability swing trade setup if one exists. Calculate your R:R for all three TP levels in your thought_process before filling in the execution_parameters. Return the required execution profile using the provided tools.
${weekendCryptoDirective}
[HISTORICAL PERFORMANCE FOR ${symbol}]
${historicalMemory || "No historical data available for this asset yet."}

[FIBONACCI ANALYSIS — Pre-computed for ${symbol}]
Dominant Swing: $${fib.swing_low.toLocaleString()} → $${fib.swing_high.toLocaleString()} (Range: $${fib.swing_range.toLocaleString()})
Direction Context: ${fib.direction}

Retracement Levels (key zones to watch):
${fibSummary}

Extension Levels (2-point targets):
${fibExtSummary}

3-Point Projection / Expansion Levels (Swing A -> B from Retracement C):
${fibProjSummary}
${fib.projections_narrative ? `Narrative: ${fib.projections_narrative}` : ""}

Current Price: ${snapshot.current_price?.toLocaleString()}
Candlestick Pattern: ${snapshot.candlestick_pattern}

[MARKET SNAPSHOT — ${timeframe} Timeframe]
${JSON.stringify(snapshot, null, 2)}

[MACRO & FUNDAMENTAL CONTEXT]
${macroContext || "No major macro events in the window."}
CRITICAL MACRO DIRECTIVE: If there are no major macroeconomic catalysts, the macro sentiment is NEUTRAL (score 0). This is a highly stable environment for technical trading. You MUST originate S-Tier and A-Tier trades based purely on technicals in this environment. Do NOT reject a setup simply because there is 'no macro catalyst'.

[SWING TRADE RULES — READ CAREFULLY]

0. ORDER OF OPERATIONS (CRITICAL PRIORITY):
   - STEP 1: Always check for MACRO OVERRIDES (Rule 3) and SNIPER OVERRIDES (Rule 4) FIRST. If Macro Sentiment is 10/10 or a Liquidity Sweep is present, you MUST originate the trade. Do NOT look for reasons to reject.
   - STEP 2: If no overrides apply, calculate your Fib distances.
   - STEP 3: Only if distance is <= ${inflectionThresholdPct}% (current mode: ${fomcModeActive ? 'POST-EVENT VOLATILITY — threshold EXPANDED' : 'standard'}) and overrides are absent, you may consider an INFLECTION_POINT_WAIT rejection.
   - NEVER invoke a rejection guardrail without explicitly explaining why the Overrides in Step 1 did not apply.

1. FIBONACCI, CHARTIST & SMC CONFLUENCE:
   An S-Tier (confidence >= 90) setup REQUIRES at least 3 of the following to align:
   - Price is at or within 1.5% of a key Fib level
   - SMART MONEY CONCEPTS (SMC): Price has mitigated a FVG or swept liquidity into an OB
   - CHARTIST PATTERNS: Respecting Trend Channel boundaries (snapshot.trend_channel) or confirming Geometric Patterns (snapshot.chart_pattern: Triangles, Wedges, Double Tops/Bottoms, Head & Shoulders)
   - A daily/weekly structural support/resistance zone overlaps the Fib level
   - RSI or MACD divergence (snapshot.rsi_divergence / snapshot.macd_divergence) confirming exhaustion or trend continuation
   - Macro fundamentals explicitly support the direction

2. DYNAMIC LTF STOP-LOSS COMPRESSION & BAR-CLOSE MANAGEMENT:
   - Trading Central Invalidation Rule: Stop loss / Pivot point levels are managed at the confirmed CLOSE of a daily bar. Price may temporarily pierce the level intra-day without invalidating the preferred scenario.
   - Scan the LTF timeframe (1H or 30m) provided in the snapshot. Find the nearest SMC Order Block (ltf_bullish_ob_nearest / ltf_bearish_ob_nearest) or FVG.
   - Anchor your Stop Loss directly behind the LTF Order Block or structural swing pivot with >= 1.0x ATR buffer.
   - CRITICAL REQUIREMENT: Calculate your R:R mathematically before returning your parameters. Your TP2 MUST be at least 1.70x your Stop Loss distance. If current market price gives R:R < 1.70, calculate an optimal pullback Limit Order at the nearest Fib discount level to enforce an institutional >= 1:1.75 R:R.
   - EXACT PRICE FORMAT REQUIRED: Output suggested_entry_price, suggested_stop_loss, take_profit_1, take_profit_2, and take_profit_3.

3. MACRO-BACKED MOMENTUM BREAKOUT STRATEGIES (IGNORING FIBS):
   - If the MACRO CONTEXT indicates an overwhelming fundamental trend (e.g., extremely bearish due to weak demand and supply increases), you are authorized to IGNORE Fibonacci retracements.
   - In a massive fundamental run, price will not pull back to 61.8%.
   - If macro is extremely BULLISH and price is within 1% of the swing_high, approve an S-Tier MACRO_MOMENTUM_BREAKOUT_LONG. Set entry_type to "Buy Stop" placed just above the swing_high.
   - If macro is extremely BEARISH and price is within 1% of the swing_low, approve an S-Tier MACRO_MOMENTUM_BREAKOUT_SHORT. Set entry_type to "Sell Stop" placed just below the swing_low.
   - You MUST use "Buy Stop" or "Sell Stop" so the execution layer only enters IF the breakout actually triggers.

4. LIQUIDITY SWEEP "SNIPER" MODE (TURTLESOUP):
   - Institutional algorithms buy below support after retail stops are hunted, and sell above resistance.
   - Definition: 'liquidity_sweep_bullish' = Swept lows, prepare for a LONG reversal.
   - Definition: 'liquidity_sweep_bearish' = Swept highs, prepare for a SHORT reversal. DO NOT go long on a bearish sweep.
   - If you detect a Liquidity Sweep where price pierced a Daily low/high and immediately closed back inside the range (wick rejection), flag this as an IMMEDIATE S-Tier reversal.
   - EXECUTION DIRECTIVE: Jump in before the retail market reacts. You MUST use a MARKET order with 'suggested_entry_price' set exactly to the 'current_price'.

5. KELLY CRITERION & ASYMMETRIC EXPECTED VALUE:
   - Provide your honest 'probability_estimate' (1-99) of the trade hitting TP2.
   - Standard requirement is minimum 1:1.70 R:R against Target 2 (TP2).
   - If the trade has high conviction and Win Probability, verify that Expected Value remains positive: EV = (Probability * Reward) - (LossProb * Risk).

6. DIRECTIONAL BIAS FILTERING (CONTRARIAN VALUE OVERRIDE):
   - If the Macro Sentiment actively contradicts your technical setup, generally DOWNGRADE the setup to B-Tier or REJECT.
   - CONTRARIAN VALUE OVERRIDE: If price is resting exactly on a deep Fibonacci discount (61.8% or 78.6%) and the macro sentiment is only mildly contradictory (scores between -4 and +4), you are AUTHORIZED to ignore the news sentiment and originate the trade as S-Tier or A-Tier. Institutions buy deep discounts when retail is panicking over mild news.
   - Do NOT apply this override if the macro news is catastrophic or extreme (scores of -8 to -10 or +8 to +10).

7. TAKE PROFIT STRUCTURE — THREE TARGETS:
   - TP1 (Conservative): First Fib retracement/structure zone (50% target)
   - TP2 (Primary): Second major Fib level (minimum 1:1.70 R:R benchmark)
   - TP3 (Runner): Major Fib extension (127.2% / 161.8%) or psychological round number

8. INFLECTION POINT AMBIGUITY GUARD (CRITICAL):
   - BEFORE invoking this guard, you MUST calculate the percentage distance between the Current Price and the nearest Fibonacci or Structural level. (Formula: abs(Current Price - Nearest Level) / Nearest Level * 100)
   - [CURRENT THRESHOLD = ${inflectionThresholdPct}%] ${fomcModeActive ? '[POST-EVENT VOLATILITY MODE ACTIVE: A central bank event fired recently. Threshold expanded to ' + inflectionThresholdPct + '% to account for wider ATR. Do NOT reject setups that are merely within the standard 0.5% zone — the market needs room to breathe.]' : 'Standard 0.5% threshold applies.'}
   - If the Percentage Distance is > ${inflectionThresholdPct}%, the price is NOT resting on a level. You CANNOT use INFLECTION_POINT_WAIT.
   - If price is resting squarely on a boundary (<= ${inflectionThresholdPct}%) AND momentum indicators (RSI flat, ADX low) do not provide overwhelming confirmation, do NOT instantly reject it as 'chop'. Instead, look for a Momentum Breakout setup using Buy-Stop or Sell-Stop orders just outside the Fib zone to catch the inevitable volatility expansion.
   - Invoke the reject_trade tool with the exact reason: 'INFLECTION_POINT_WAIT' to sideline capital until a definitive bounce or breakdown is confirmed via a candle close.
   - LIMIT ORDERS FOR MID-RANGE MARKETS: If price is floating mid-range between key Fibonacci levels (e.g., between 38.2% and 50%), do NOT reject the setup as 'No setup'. Instead, originate a 'Buy Limit' or 'Sell Limit' order exactly at the optimal Fibonacci level to catch the wick when the price retraces.

9. DYNAMIC ADX OSCILLATOR THRESHOLDS (EXHAUSTION VS CONTINUATION):
   - In a strong runaway trend where ADX > 25, you are FORBIDDEN from taking a Mean Reversion trade against the trend.
   - LOW ADX EXHAUSTION: If ADX is low (< 20), do NOT automatically reject the trade as "choppy". Low ADX during a pullback to the 61.8% or 78.6% Fib levels is HIGHLY DESIRABLE—it indicates the opposing trend is exhausted and ready to reverse.
   - MEAN REVERSION IN CHOP: If ADX is low (< 20) and the market is in a 'CHOP' regime, do NOT automatically reject the setup. You are explicitly authorized to use a MEAN_REVERSION strategy to buy the bottom or sell the top of the chop range, provided there is a Liquidity Sweep or SMC confirmation.
   - Expand your RSI rejection bounds to > 90 (or < 10 for shorts) if ADX confirms strong momentum.

10. LOWER TIMEFRAME (LTF) DRILLING:
    - If the macro environment is ripe, but the 30m chart price is hovering near a HTF boundary without a clear FVG or entry trigger, DO NOT reject the setup.
    - Instead, set status to APPROVED and recommended_direction to "REQUIRE_LTF_DRILLDOWN" to instruct the Sniper agent to hunt for a precision entry on the 5m chart.

11. CONFIDENCE CALIBRATION (CRITICAL):
    - A confidence score of 100 is STATISTICALLY IMPOSSIBLE in trading. Do not ever output a confidence of 100.
    - A "perfect" structural setup should realistically max out around 85-90.
    - You MUST actively deduct points for mixed signals, such as low ADX, choppy price action, or imperfect Fib alignment.

12. CRYPTO COUNTER-TREND & MOMENTUM SCALPING (CRITICAL):
    - EXPLICIT COUNTER-TREND AUTHORIZATION: For crypto assets (e.g. BTCUSD, ETHUSD), you are EXPLICITLY AUTHORIZED to originate "Mean Reversion Shorts" when the RSI exceeds 85 AND strong bearish divergence is present on the MACD. Do not reject simply due to 'bullish macro trend' if these extreme overbought conditions exist.
    - SHORT-TERM PULLBACK LOGIC: When generating a counter-trend short, do NOT wait for a massive macro structural swing. Generate a quick A-Tier short setup targeting a pullback to the nearest Fibonacci retracement level (e.g., the 0.382 or 0.5 level) for TP1/TP2.
    - DYNAMIC RSI WEIGHTING (MOMENTUM SCALPS): If the news sentiment is overwhelmingly positive (via agent-news), IGNORE the overbought RSI up to 90. Instead of rejecting the setup, look for 'continuation momentum scalps' targeting immediate structural highs.

13. SMART MONEY ORDER FLOW & VOLUME PROFILE CONFLUENCE:
    - HIGH-VOLUME NODES (HVN) & POC: An Order Block or Fibonacci level is 2x higher conviction if it aligns with the Point of Control (poc_price) or nearest High-Volume Node (nearest_hvn).
    - BREAKOUT VOLUME VALIDATION: S-Tier MACRO_MOMENTUM_BREAKOUT setups require expanding volume (volume_surge: true or volume_ratio >= 1.4). If breakout volume is ANEMIC (< 0.8x), reject the setup as a fakeout liquidity trap.
    - VALUE AREA VALUE: Pullbacks to Value Area Low (val_price) in a Bullish Trend, or Value Area High (vah_price) in a Bearish Trend, provide asymmetric risk entries.
14. CHARTIST PATTERNS, DIVERGENCES & UNFILLED GAPS (TRADING CENTRAL METHODOLOGY):
    - If snapshot.trend_channel is present (ASCENDING_CHANNEL / DESCENDING_CHANNEL / HORIZONTAL_CHANNEL), respect channel boundaries (buy lower boundary, sell upper boundary).
    - If snapshot.chart_pattern is detected (TRIANGLES, WEDGES, DOUBLE TOPS/BOTTOMS, HEAD & SHOULDERS), align execution with pattern breakout/reversal target (+10 confidence).
    - If snapshot.rsi_divergence or snapshot.macd_divergence is 'REGULAR_BULLISH' or 'REGULAR_BEARISH', treat it as institutional macro reversal confirmation (+10 confidence).
    - If snapshot.rsi_divergence or snapshot.macd_divergence is 'HIDDEN_BULLISH' or 'HIDDEN_BEARISH', treat it as trend continuation confirmation (+5 confidence).
    - If snapshot.has_unfilled_gap is true, prioritize the unfilled gap level (snapshot.unfilled_gap_target) as an institutional magnetic target.
15. 20-BAR SWING HORIZON & ASYMMETRIC R:R (TARGET 2 >= 1:1.70):
    - Daily swing setups operate on a maximum horizon of 20 bars (20 trading days).
    - Target 2 (TP2) is your primary benchmark for institutional R:R (minimum 1:1.70). If current price yields < 1.70 R:R, calculate an optimal pullback Limit Order at the nearest Fib level.`;

  console.log(`[Responses API] Submitting ${symbol} analysis...`);
  
  const body = {
    model: "gpt-4o",
    input: userContent,
    tools: [
      {
        type: "function",
        name: "approve_trade",
        description: "Submit this action when the trade meets all criteria and confluence.",
        parameters: {
          type: "object",
          properties: {
            thought_process: { type: "string", description: "Step-by-step reasoning for the approval. You MUST calculate the exact R:R for TP1, TP2, and TP3 here before filling in the execution parameters. You MUST verify that the suggested_entry_price exactly matches the chosen Fib level or SMC zone." },
            confidence_score: { type: "number", description: "Score 0-100" },
            recommended_direction: { type: "string", enum: ["LONG", "SHORT", "REQUIRE_LTF_DRILLDOWN"] },
            fib_entry_level: { type: "string", description: "e.g. 61.8% or 78.6%" },
            structural_confirmation: { type: "string" },
            market_structure: { type: "string" },
            strategy_applied: { type: "string" },
            suggested_entry_price: { type: "number" },
            suggested_stop_loss: { type: "number" },
            take_profit_1: { type: "number" },
            take_profit_2: { type: "number" },
            take_profit_3: { type: "number" },
            rationale: { type: "string" },
            order_type: { type: "string" },
            direction: { type: "string" },
            entry_price: { type: "number" },
            stop_loss: { type: "number" },
            probability_estimate: { type: "number", description: "Estimated win probability 1-99" }
          },
          required: [
            "thought_process", "confidence_score", "recommended_direction", "fib_entry_level", "structural_confirmation",
            "market_structure", "strategy_applied", "suggested_entry_price", "suggested_stop_loss",
            "take_profit_2", "rationale", "probability_estimate"
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
            thought_process: { type: "string", description: "Step-by-step reasoning for the rejection. You MUST explicitly state why the MOMENTUM BREAKOUT (Rule 3) and SNIPER (Rule 4) overrides did not apply before rejecting." },
            rejection_math_proof: { type: "string", description: "You MUST calculate the boundary percentage distance step-by-step here BEFORE outputting the reason. Do NOT output a lazy INFLECTION_POINT_WAIT without proving the math first." },
            distance_to_level_percent: { type: "number", description: "The calculated percentage distance from the current price to the nearest Fib/Structural level. Must be calculated BEFORE invoking INFLECTION_POINT_WAIT." },
            reason: { type: "string" }
          },
          required: ["thought_process", "rejection_math_proof", "distance_to_level_percent", "reason"]
        }
      }
    ],
    tool_choice: "required",
    parallel_tool_calls: false,
    max_output_tokens: 1500
  };

  let responseData: any = null;
  let lastError: any = null;
  const maxRetries = 2;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const responseRes = await fetch("https://api.openai.com/v1/responses", {
        method: "POST",
        headers,
        body: JSON.stringify(body)
      });
      responseData = await responseRes.json();
      if (responseData.error) {
        throw new Error(`Responses API Error: ${responseData.error.message}`);
      }
      lastError = null;
      break;
    } catch (err: any) {
      lastError = err;
      console.warn(`[Responses API] Attempt ${attempt + 1}/${maxRetries + 1} failed for ${symbol}: ${err.message}`);
      if (attempt < maxRetries) {
        await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
      }
    }
  }

  if (lastError || !responseData) {
    throw lastError || new Error("Failed to obtain response from Responses API after retries");
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
      thought_process: args.thought_process || args.reason || args.rationale || JSON.stringify(args),
      institutional_rationale: { directional_bias: args.reason + mathProof },
      confidence_score: 0
    } as any;
  }

  if (toolCall.name === "approve_trade") {
      const data: SwingTrade = {
        thought_process: args.thought_process || args.rationale || args.reasoning || "Technical setup evaluated",
        calculated_rr_to_tp1: null,
        calculated_rr_to_tp2: null,
        calculated_rr_to_tp3: null,
        fibonacci_rationale: args.fib_entry_level || "",
        market_structure: args.market_structure,
        recommended_direction: args.direction || args.recommended_direction,
        strategy_applied: args.strategy_applied,
        execution_parameters: {
          entry_type: args.order_type,
          suggested_entry_price: args.entry_price || args.suggested_entry_price,
          suggested_stop_loss: args.stop_loss || args.suggested_stop_loss,
          take_profit_1: args.take_profit_1,
          take_profit_2: args.take_profit_2,
          take_profit_3: args.take_profit_3
        },
        confidence_score: args.confidence_score,
        swing_rationale: {
          fib_entry_level: args.fib_entry_level || "",
          structural_confirmation: args.structural_confirmation || "",
          macro_alignment: "",
          invalidation_level: "",
          tp1_rationale: args.tp1_rationale || "",
          tp2_rationale: args.tp2_rationale || "",
          tp3_rationale: args.tp3_rationale || ""
        }
      };

      // Verify R:R math independently for TP2 (primary target)
      if (
        data.recommended_direction !== "NONE" &&
        data.execution_parameters.suggested_entry_price &&
        data.execution_parameters.suggested_stop_loss &&
        data.execution_parameters.take_profit_2
      ) {
        let entry = data.execution_parameters.suggested_entry_price;
        const sl = data.execution_parameters.suggested_stop_loss;
        const tp2 = data.execution_parameters.take_profit_2;
        let risk = Math.abs(entry - sl);
        let reward = Math.abs(entry - tp2);
        let rr = risk > 0 ? reward / risk : 0;
        
        const prob = (args.probability_estimate || 50) / 100;

        // Trading Central Minimum R:R 1:1.70 on Target 2 (TP2)
        let requiredRR = 1.70;

        // 1. Adaptive Limit Solver for Swings when R:R < 1.70
        if (rr < requiredRR && data.execution_parameters.entry_type === "Market") {
          const targetRR = 1.75;
          const solvedEntry = (tp2 + (targetRR * sl)) / (1 + targetRR);
          const isIndexOrCrypto = ['US30', 'NAS100', 'GER30', 'SPX500', 'JP225', 'BTCUSD', 'ETHUSD'].includes(symbol);
          const decimals = isIndexOrCrypto ? 2 : 5;
          const formattedEntry = Number(solvedEntry.toFixed(decimals));

          const isLong = data.recommended_direction === "LONG";
          const isEntryValidLong = isLong && formattedEntry < entry && formattedEntry > sl;
          const isEntryValidShort = !isLong && formattedEntry > entry && formattedEntry < sl;

          if (isEntryValidLong || isEntryValidShort) {
            console.log(`[Swing Desk] Adaptive Limit: Adjusted ${symbol} entry to ${formattedEntry} to lock in 1:${targetRR.toFixed(2)} R:R.`);
            data.execution_parameters.suggested_entry_price = formattedEntry;
            data.execution_parameters.entry_type = isLong ? "Buy Limit" : "Sell Limit";
            data.swing_rationale.fib_entry_level += ` [Adaptive Limit Solver: Adjusted entry to $${formattedEntry} to guarantee 1:${targetRR.toFixed(2)} R:R on Target 2]`;
            entry = formattedEntry;
            risk = Math.abs(entry - sl);
            reward = Math.abs(entry - tp2);
            rr = risk > 0 ? reward / risk : 0;
          }
        }

        // Expected Value check: EV = (Probability * Reward) - (LossProb * Risk)
        const expectedValueR = (prob * rr) - ((1 - prob) * 1);

        if (rr < 1.50 && expectedValueR < 0.3) {
          // Enforce LTF Stop Loss Compression (Drilldown)
          if (data.confidence_score >= 85) {
            console.warn(`[Swing Guard] AI approved but R:R of 1:${rr.toFixed(2)} fails requirement. Sending to Sniper for LTF Drilldown.`);
            data.recommended_direction = "REQUIRE_LTF_DRILLDOWN";
            data.fibonacci_rationale += ` [System Guard: R:R too low (1:${rr.toFixed(2)}), requesting LTF entry compression]`;
          } else {
            console.warn(`[Swing Guard] AI approved but R:R of 1:${rr.toFixed(2)} fails minimum 1:1.70 requirement. Rejecting.`);
            return {
              recommended_direction: "NONE",
              fibonacci_rationale: `Rejected post-AI: TP2 R:R of 1:${rr.toFixed(2)} does not meet the institutional 1:1.70 requirement`,
              confidence_score: 0
            } as any;
          }
        }
      }

      return data;
    }
  throw new Error(`Unexpected tool call: ${toolCall.name}`);
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

  const isManual = reqBody.is_manual === true || searchParams.get("is_manual") === "true";

  // Swing pipeline always runs on 1D bars for maximum context
  const timeframe = reqBody.timeframe ?? searchParams.get("timeframe") ?? "1D";
  const lookback = Number(reqBody.lookback ?? searchParams.get("lookback") ?? 300);
  const symbolsParam =
    reqBody.symbols?.join(",") ||
    searchParams.get("symbols") ||
    Deno.env.get("SWING_SYMBOLS") ||
    "XAUUSD,XAGUSD,BTCUSD,ETHUSD,UKOIL,USOIL,EURUSD,GBPUSD,USDJPY,AUDUSD,USDCAD,USDCHF,NZDUSD,EURJPY,GBPJPY,US30,NAS100,SPX500,GER30,JP225,AAPL,MSFT,NVDA,GOOGL,AMZN,TSLA,META";
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
  const webhookSecretHeader = req.headers.get("x-webhook-secret");
  const cronSecretEnv = Deno.env.get("CRON_SECRET");
  const webhookSecretEnv = Deno.env.get("WEBHOOK_SECRET");

  const isAuthorized =
    authHeader === `Bearer ${key}` ||
    (cronSecretHeader && cronSecretEnv && cronSecretHeader === cronSecretEnv) ||
    (webhookSecretHeader && webhookSecretEnv && webhookSecretHeader === webhookSecretEnv);

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

  const dbSymbols = await getTradingSymbols(supabase);
  const isExplicitSymbolRequest = !!(reqBody.symbols || searchParams.get("symbols"));
  const symbols = isExplicitSymbolRequest 
      ? symbolsParam.split(",").map((s: string) => s.trim()).filter(Boolean)
      : (dbSymbols && dbSymbols.length > 0 ? dbSymbols : symbolsParam.split(",").map((s: string) => s.trim()).filter(Boolean));
      
  symbols.sort((a, b) => {
    if (a === 'BTCUSD' && b !== 'BTCUSD') return -1;
    if (b === 'BTCUSD' && a !== 'BTCUSD') return 1;
    const aOpen = isMarketOpen(a);
    const bOpen = isMarketOpen(b);
    if (aOpen && !bOpen) return -1;
    if (!aOpen && bOpen) return 1;
    return 0;
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
      // Fetch macro events from Oracle
      let allEvents = null;
      sendEvent({ type: 'progress', message: `[Macro Oracle] Reading global economic calendar from Central Oracle...` });
      const { data: oracleData } = await supabase.from("system_settings").select("value").eq("key", "macro_oracle_context").single();
      if (oracleData && oracleData.value) {
        allEvents = oracleData.value;
      } else {
        allEvents = await fetchAllMacroEvents().catch(() => null);
      }

      // === FEATURE 1: FOMC VOLATILITY EXPANSION MODE ===
      // Detect if a central bank event fired in the last 6 hours and expand
      // the INFLECTION_POINT_WAIT threshold from 0.5% → 1.5% accordingly.
      const cbStatus = detectCentralBankEvent(allEvents, 6);
      let fomcModeActive = cbStatus.isActive;
      let fomcPreEventActive = false;
      const inflectionThresholdPct = fomcModeActive ? 1.5 : 0.5;
      if (fomcModeActive) {
        const cbNames = cbStatus.events.map((e: any) => e.title).join(", ");
        console.log(`[FOMC Mode] Central bank event detected: ${cbNames}. Expanding INFLECTION threshold to 1.5%.`);
        sendEvent({ type: 'progress', message: `[POST-EVENT VOLATILITY MODE] Central bank event within 6H: ${cbNames}. INFLECTION threshold expanded to 1.5% for all symbols.` });
      }
      // Pre-event: firing within next 90 minutes
      const upcomingFed = detectUpcomingFedEvent(allEvents, 90);
      if (upcomingFed.isPending && upcomingFed.event) {
        fomcPreEventActive = true;
        fomcModeActive = true;
        console.log(`[FOMC Pre-Event] ${upcomingFed.event.title} firing in ${upcomingFed.minutesUntil} minutes.`);
        sendEvent({ type: 'progress', message: `[PRE-EVENT MODE] ${upcomingFed.event.title} fires in ${upcomingFed.minutesUntil} min. AI confidence boosted. Size multiplier (1.5x) ACTIVE.` });
      }
      // Persist the FOMC window flag so agent-trade can apply 1.5x size multiplier
      const { error: persistError } = await supabase.from("system_settings").upsert(
        { key: "fomc_window_active", value: String(fomcModeActive) },
        { onConflict: "key" }
      );
      if (persistError) console.warn("[FOMC] Failed to persist fomc_window_active:", persistError.message);

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
          await Promise.all(activeSignals.map(async (signal) => {
            try {
              // 1. Math Validation (20-Period Daily Horizon TTL: 20 Trading Days = 480 Hours)
              const hoursElapsed = (Date.now() - new Date(signal.created_at).getTime()) / (1000 * 60 * 60);
              if (hoursElapsed > 480) {
                await supabase.from("trade_opportunities").update({ status: "EXPIRED", ai_risks: "Expired: 20-period daily swing anticipation horizon (20 days) reached without execution." }).eq("id", signal.id);
                // await cancelBrokerOrdersForOpportunity(supabase, signal.id);
                console.log(`[Validation] EXPIRED ${signal.symbol}: 20-day swing horizon reached.`);
                return;
              }

              // 2. Fetch Live Snapshot
              const result = await fetchPaperBars(signal.symbol, signal.timeframe === '1d' ? '1D' : signal.timeframe, 100, supabase);
              const snapshot = getContextSnapshot(
                result.map((b: any) => b.t),
                result.map((b: any) => b.o),
                result.map((b: any) => b.h),
                result.map((b: any) => b.l),
                result.map((b: any) => b.c),
                result.map((b: any) => b.v),
                signal.symbol
              );

              // 3. Math Validation (Bar-Close Stop Loss & Take Profit Hit)
              const currentClose = result.length > 0 ? result[result.length - 1].c : snapshot.current_price;
              const currentHigh = result.length > 0 ? result[result.length - 1].h : snapshot.current_price;
              const currentLow = result.length > 0 ? result[result.length - 1].l : snapshot.current_price;
              const stopLoss = signal.stop_plan_json?.stop;
              const takeProfit = signal.take_profit_json?.tp;
              const atr = snapshot.atr_14 || Math.abs(currentClose * 0.01);
              const catastrophicSlLong = stopLoss ? stopLoss - (atr * 2.0) : null;
              const catastrophicSlShort = stopLoss ? stopLoss + (atr * 2.0) : null;
              
              if (stopLoss) {
                // Trading Central Bar-Close Stop Loss Rule:
                // Evaluated strictly on confirmed daily bar close, allowing intra-day wicks to breathe unless catastrophic emergency stop is breached
                const isBarCloseLostLong = signal.side === 'LONG' && (currentClose <= stopLoss || (catastrophicSlLong !== null && currentLow <= catastrophicSlLong));
                const isBarCloseLostShort = signal.side === 'SHORT' && (currentClose >= stopLoss || (catastrophicSlShort !== null && currentHigh >= catastrophicSlShort));

                if (isBarCloseLostLong || isBarCloseLostShort) {
                  await supabase.from("trade_opportunities").update({ 
                    status: "LOST", 
                    r_multiple: -1, 
                    ai_risks: "Technical Invalidation: Confirmed daily bar close beyond Stop Loss / Pivot level." 
                  }).eq("id", signal.id);
                  console.log(`[Validation] LOST ${signal.symbol}: Confirmed daily bar close beyond stop loss.`);
                  return;
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
                  return;
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
                await supabase.from("trade_opportunities").update({ status: "REJECTED", ai_risks: `Invalidated by agent-risk: ${evalResult.reason}` }).eq("id", signal.id);
                // await cancelBrokerOrdersForOpportunity(supabase, signal.id);
                console.log(`[Validation] REJECTED ${signal.symbol} by AI: ${evalResult.reason}`);
              } else if (evalResult.action === "TAKE_PROFIT") {
                await supabase.from("trade_opportunities").update({ status: "REJECTED", ai_risks: `Profit Secured by agent-risk: ${evalResult.reason}` }).eq("id", signal.id);
                console.log(`[Validation] TAKE_PROFIT ${signal.symbol} by AI: ${evalResult.reason}`);
                if (!isManual) {
                  try {
                    await fetch(`${Deno.env.get("WEBHOOK_URL")}/execution/cancel`, { method: "POST", body: JSON.stringify({ signal_id: signal.id }) });
                  } catch (fallbackErr) {
                    console.error(`[Fallback Webhook Error] ${fallbackErr}`);
                  }
                }
              } else if (evalResult.action === "TIGHTEN_STOP" || evalResult.action === "REDUCE_RISK") {
                console.log(`[Validation] ${evalResult.action} ${signal.symbol} by AI: ${evalResult.reason}`);
                const isLong = signal.side === "LONG";
                const newSl = evalResult.action === "TIGHTEN_STOP" 
                   ? (isLong ? snapshot.current_price - snapshot.atr_14 : snapshot.current_price + snapshot.atr_14) // Tighten to current price - 1 ATR
                   : null;
                   
                try {
                   await fetch(`${Deno.env.get("WEBHOOK_URL")}/agent-trade`, { 
                       method: "POST", 
                       headers: { 
                           "Content-Type": "application/json",
                           "x-webhook-secret": Deno.env.get("WEBHOOK_SECRET") || ""
                       },
                       body: JSON.stringify({ 
                           action: "MODIFY_ORDER", 
                           opportunity_id: signal.id,
                           modification_type: evalResult.action,
                           new_sl: newSl ? Number(newSl.toFixed(5)) : undefined
                       }) 
                   });
                } catch (fallbackErr) {
                   console.error(`[Webhook Error] Failed to modify order: ${fallbackErr}`);
                }
              } else {
                console.log(`[Validation] MAINTAIN ${signal.symbol}: Thesis remains intact.`);
              }
            } catch (err: any) {
               console.error(`[Validation Error] Failed to revalidate ${signal.symbol}:`, err.message);
               if (err.message === "META_API_FAILURE") {
                 await sendMetaApiAlert();
               }
            }
          }));
        }

      const chunkArray = <T>(arr: T[], size: number): T[][] => arr.length > 0 ? [arr.slice(0, size), ...chunkArray(arr.slice(size), size)] : [];
      const symbolChunks = chunkArray(symbols, 3);

      for (const chunk of symbolChunks) {
        await Promise.all(chunk.map(async (symbol) => {
        // --- LOG RESEARCH RUN ---
        await insertAuditLog(supabase, {
          actor_type: "SYSTEM",
          action: "RESEARCH_RUN",
          payload_json: { symbol, timeframe, agent: "agent-swing" }
        }).catch(e => console.warn(`[Audit] Failed to log RESEARCH_RUN for ${symbol}: ${e.message}`));

        // --- FETCH PENDING NEWS (from agent-news) ---
        let pendingNewsSide: string | null = null;
        let pendingNewsId: string | null = null;
        try {
          const { data: pendingSentiment } = await supabase
            .from("trade_opportunities")
            .select("id, side, risk_summary")
            .eq("symbol", symbol)
            .eq("status", "PUBLISHED")
            .order("created_at", { ascending: false })
            .limit(1);
          
          if (pendingSentiment && pendingSentiment.length > 0) {
             const pending = pendingSentiment[0];
             pendingNewsSide = pending.side;
             pendingNewsId = pending.id;
          }
        } catch (pendingErr: any) {
           console.warn(`[${symbol}] Error checking PUBLISHED: ${pendingErr.message}`);
        }

        // --- LAYER -1: MARKET HOURS CHECK ---
        if (!isMarketOpen(symbol)) {
          console.log(`[Market Hours] Skipping ${symbol} as market is currently closed.`);
          sendEvent({ type: 'progress', message: `[Market Hours] Skipping ${symbol}: Market Closed.` });
          rejections.push({ symbol, reason: "Market is currently closed", layer: "Market Hours" });
          if (pendingNewsId) await supabase.from("trade_opportunities").update({ status: "REJECTED", risk_summary: "Rejected: Market is currently closed." }).eq("id", pendingNewsId);
          return;
        }

        // --- LAYER 0: MACRO BLACKOUT WINDOW ---
        if (["XAUUSD", "XAGUSD", "BTCUSD", "UKOIL"].includes(symbol) && allEvents) {
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
             if (pendingNewsId) await supabase.from("trade_opportunities").update({ status: "REJECTED", risk_summary: `Rejected: Macro Blackout Window (${evNames}).` }).eq("id", pendingNewsId);
             return; // Skip this symbol completely
          }
        }

        try {
          sendEvent({ type: "progress", message: `[${symbol}] Fetching ${lookback} daily bars...` });

          let bars: Bar[];
          try {
            bars = await fetchPaperBars(symbol, timeframe, lookback, supabase);
          } catch (err: any) {
            console.error(`[Data Error] [Trace: ${traceId}] ${symbol}: ${err.message}`);
            rejections.push({ symbol, reason: `Data fetch failed: ${err.message}`, layer: "Data" });
            if (pendingNewsId) await supabase.from("trade_opportunities").update({ status: "REJECTED", risk_summary: `Rejected: Data fetch failed.` }).eq("id", pendingNewsId);
            return;
          }

          if (bars.length < 100) {
            rejections.push({ symbol, reason: `Insufficient data (${bars.length} bars, need 100+)`, layer: "Data" });
            sendEvent({ type: "progress", message: `[${symbol}] Skipped: insufficient data` });
            if (pendingNewsId) await supabase.from("trade_opportunities").update({ status: "REJECTED", risk_summary: `Rejected: Insufficient data.` }).eq("id", pendingNewsId);
            return;
          }

          sendEvent({ type: "progress", message: `[${symbol}] ${bars.length} bars loaded. Computing Fibonacci levels...` });

          const open = bars.map((b) => b.o);
          const timestamps = bars.map((b) => b.t);
          const high = bars.map((b) => b.h);
          const low = bars.map((b) => b.l);
          const close = bars.map((b) => b.c);
          const volume = bars.map((b) => b.v);

          // === FIBONACCI ENGINE ===
          const fib = calculateFibonacciLevels(high, low, close);
          const currentPrice = close[close.length - 1];
          const nearestFibs = findNearestFibLevels(fib, currentPrice, 3);

          sendEvent({
            type: "progress",
            message: `[${symbol}] Fib range: $${fib.swing_low.toLocaleString()} → $${fib.swing_high.toLocaleString()}. Nearest key levels: ${nearestFibs.map((f) => f.label + " @ $" + f.price.toLocaleString()).join(", ")}`,
          });

          // === MARKET SNAPSHOT ===
          const snapshot = getContextSnapshot(timestamps, open, high, low, close, volume, symbol);

          // === ASSET ISOLATION (PYRAMIDING) GUARD ===
          sendEvent({ type: "progress", message: `[Pre-AI Guard] Validating global signal constraints for ${symbol}...` });
          const riskValidation = await validateGlobalSignal(supabase, symbol, snapshot, isManual);
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
            if (pendingNewsId) await supabase.from("trade_opportunities").update({ status: "REJECTED", risk_summary: `Rejected (Pre-AI Guard): ${riskValidation.reason}` }).eq("id", pendingNewsId);
            return;
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
                weeklyBars.map((b) => b.v),
                symbol
              );
              (snapshot as any).weekly_trend = weeklySnap.trend_alignment;
              (snapshot as any).weekly_ema_50 = weeklySnap.ema_50;
              (snapshot as any).weekly_ema_200 = weeklySnap.ema_200;
              (snapshot as any).weekly_rsi = weeklySnap.rsi_14;
            }
          } catch (_) {
            console.warn(`[${symbol}] [Trace: ${traceId}] Weekly MTFA fetch failed, continuing without it.`);
          }

          // Enrich with LTF (30m / 15m) for SMC Order Block & FVG precision anchoring
          try {
            const ltfTimeframe = timeframe.toLowerCase() === "1d" ? "30m" : "15m";
            const ltfBars = await fetchPaperBars(symbol, ltfTimeframe, 150, supabase);
            if (ltfBars.length > 20) {
              const ltfSnap = getContextSnapshot(
                ltfBars.map((b) => b.t),
                ltfBars.map((b) => b.o),
                ltfBars.map((b) => b.h),
                ltfBars.map((b) => b.l),
                ltfBars.map((b) => b.c),
                ltfBars.map((b) => b.v),
                symbol
              );
              (snapshot as any).ltf_timeframe = ltfTimeframe;
              (snapshot as any).ltf_trend = ltfSnap.trend_alignment;
              (snapshot as any).ltf_bos_bullish = ltfSnap.ltf_bos === 'BULLISH';
              (snapshot as any).ltf_bos_bearish = ltfSnap.ltf_bos === 'BEARISH';
              (snapshot as any).ltf_atr_14 = ltfSnap.atr_14;
              
              // Map LTF SMC Context
              (snapshot as any).ltf_bullish_fvg_nearest = ltfSnap.bullish_fvg_nearest;
              (snapshot as any).ltf_bearish_fvg_nearest = ltfSnap.bearish_fvg_nearest;
              (snapshot as any).ltf_bullish_ob_nearest = ltfSnap.bullish_ob_nearest;
              (snapshot as any).ltf_bearish_ob_nearest = ltfSnap.bearish_ob_nearest;
              (snapshot as any).ltf_liquidity_sweep_bullish = ltfSnap.liquidity_sweep_bullish;
              (snapshot as any).ltf_liquidity_sweep_bearish = ltfSnap.liquidity_sweep_bearish;
            }
          } catch (err: any) {
            console.warn(`[${symbol}] [Trace: ${traceId}] LTF fetch failed, continuing without it: ${err.message}`);
          }

          // === FEATURE 3: HTF WEEKLY FIBONACCI ALIGNMENT ===
          // Compute weekly Fib and check if it aligns with the daily Fib within 0.3%.
          // If aligned, set htf_fib_alignment = true and apply +5 confidence bonus post-AI.
          let weeklyFibLevels: any[] = [];
          try {
            const weeklyBarsForFib = await fetchPaperBars(symbol, "1W", 52, supabase);
            if (weeklyBarsForFib.length > 10) {
              const wHigh = weeklyBarsForFib.map((b) => b.h);
              const wLow = weeklyBarsForFib.map((b) => b.l);
              const wClose = weeklyBarsForFib.map((b) => b.c);
              const weeklyFib = calculateFibonacciLevels(wHigh, wLow, wClose);
              weeklyFibLevels = weeklyFib.levels;
            }
          } catch (_) {
            console.warn(`[${symbol}] Weekly Fib computation failed, skipping HTF alignment check.`);
          }

          const fibAlignment = computeHtfFibAlignment(fib.levels, weeklyFibLevels, currentPrice, 0.003);
          (snapshot as any).htf_fib_alignment = fibAlignment.aligned;
          (snapshot as any).htf_fib_daily_level = fibAlignment.dailyLevel;
          (snapshot as any).htf_fib_weekly_level = fibAlignment.weeklyLevel;
          (snapshot as any).htf_fib_overlap_pct = fibAlignment.overlapPct !== null
            ? Number((fibAlignment.overlapPct * 100).toFixed(3))
            : null;

          if (fibAlignment.aligned) {
            sendEvent({ type: 'progress', message: `[HTF Fib Alignment] Daily ${fibAlignment.dailyLevel?.toFixed(2)} ≈ Weekly ${fibAlignment.weeklyLevel?.toFixed(2)} (${((fibAlignment.overlapPct ?? 0) * 100).toFixed(3)}% overlap) → +5 confidence queued` });
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
              if (!isNaN(parsedScore)) {
                sentimentScore = parsedScore;
                // NLP Override for Momentum Breakouts
                if (sentimentScore >= 7) snapshot.momentum_spike = 'BULLISH';
                else if (sentimentScore <= -7) snapshot.momentum_spike = 'BEARISH';
              }
              sendEvent({ type: "progress", message: `[${symbol}] Sentiment Score: ${sentimentScore}/10` });
            } catch (err: any) {
              console.error(`[Sentiment Error] Failed to evaluate sentiment for ${symbol}: ${err.message}`);
            }
          }

          let macroContext = generateMacroContext(symbol, allEvents, headlines);
          macroContext += `\n\nMACRO SENTIMENT SCORE: ${sentimentScore} / 10`;

          if (pendingNewsSide && pendingNewsId) {
             // Retrieve the original pending details if needed to inject into macroContext
             // (We fetched pendingNewsId/Side at the top of the loop)
             try {
               const { data: pendingSentiment } = await supabase.from("trade_opportunities").select("risk_summary").eq("id", pendingNewsId).single();
               if (pendingSentiment) {
                 macroContext += `\n\n[URGENT SENTIMENT OVERRIDE]\nA live Tier-1 macro sentiment event has just fired for this asset, requesting a ${pendingNewsSide} position. Details: ${pendingSentiment.risk_summary}. YOU MUST STRONGLY CONSIDER ALIGNING YOUR TECHNICAL SETUP WITH THIS FUNDAMENTAL DIRECTION.`;
                 sendEvent({ type: "progress", message: `[${symbol}] Detected PUBLISHED signal (${pendingNewsSide}) from agent-news. Injecting as urgent confluence.` });
               }
             } catch (err: any) {
                 // Ignore
             }
          }

          // === HISTORICAL MEMORY ===
          const { data: pastTrades } = await supabase
            .from("trade_opportunities")
            .select("status, side, ai_summary, ai_risks, r_multiple, timeframe")
            .eq("symbol", symbol)
            .in("status", ["WON", "LOST"])
            .in("timeframe", ["1d", "1D", "1w", "1W"])
            .order("created_at", { ascending: false })
            .limit(5);

          let historicalMemory = "";
          if (pastTrades && pastTrades.length > 0) {
            historicalMemory = pastTrades.map((t, i) => {
              return `Swing Decision ${i + 1} (${t.side} on ${t.timeframe} → ${t.status}, ${t.r_multiple !== null ? t.r_multiple + "R" : "N/A"}): "${t.ai_summary || "No rationale"}"`;
            }).join("\n");
          }

          // === INTRADAY CROSS-AGENT CONFLUENCE CHECK ===
          // Query recent intraday rejections from agent-day on this symbol (last 4 hours)
          let recentIntradayRejections: any[] = [];
          try {
            const fourHoursAgoIso = new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString();
            const { data: recentIntraday } = await supabase
              .from("trade_opportunities")
              .select("id, side, status, ai_summary, ai_risks, timeframe, source")
              .eq("symbol", symbol)
              .in("timeframe", ["30m", "15m", "1h", "5m"])
              .gte("created_at", fourHoursAgoIso)
              .order("created_at", { ascending: false })
              .limit(5);

            if (recentIntraday && recentIntraday.length > 0) {
              recentIntradayRejections = recentIntraday.filter(r => r.status === "REJECTED");
            }
          } catch (intraErr: any) {
            console.warn(`[${symbol}] [Trace: ${traceId}] Failed to check intraday confluence: ${intraErr.message}`);
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
            evaluation = await evaluateSwingOpportunity(symbol, snapshot, fib, timeframe, historicalMemory, macroContext, fomcModeActive, inflectionThresholdPct);
            
            // --- SHADOW LEDGER: Log raw AI prediction instantly ---
            if (evaluation && evaluation.recommended_direction !== "NONE") {
               let rawEntry = Number(evaluation.execution_parameters?.suggested_entry_price);
               let rawTP = Number(evaluation.execution_parameters?.take_profit_2 || evaluation.execution_parameters?.take_profit_1);
               let rawSL = Number(evaluation.execution_parameters?.suggested_stop_loss);
               
               // Fallback to snapshot if AI omitted them
               if (!rawEntry) rawEntry = snapshot.current_price;
               if (!rawSL) rawSL = evaluation.recommended_direction === "LONG" ? snapshot.safe_long_stop_loss : snapshot.safe_short_stop_loss;
               
               const { error: shadowErr } = await supabase.from("shadow_ledger").insert({
                  symbol: symbol,
                  timeframe: timeframe.toLowerCase(),
                  side: (evaluation.recommended_direction === "NONE" || !evaluation.recommended_direction) ? "LONG" : evaluation.recommended_direction.trim().toUpperCase(),
                  entry_price: rawEntry,
                  take_profit: rawTP || null,
                  stop_loss: rawSL || null,
                  status: "PENDING"
               });
               if (shadowErr) {
                 console.error(`[Shadow Ledger] Failed to insert raw signal for ${symbol}: ${shadowErr.message}`);
               }
            }
          } catch (err: any) {
            console.error(`[AI Error] [Trace: ${traceId}] ${symbol}: ${err.message}`);
            rejections.push({ symbol, reason: `AI evaluation failed: ${err.message}`, layer: "AI" });
            sendEvent({ type: "progress", message: `[${symbol}] AI evaluation failed: ${err.message}` });
            if (pendingNewsId) await supabase.from("trade_opportunities").update({ status: "REJECTED", risk_summary: `Rejected (AI Error): ${err.message}` }).eq("id", pendingNewsId);
            return;
          }

          const confidence = evaluation.confidence_score;
          let adjustedConfidence = confidence;
          const confidenceAdjustments: string[] = [];

          // === FEATURE 4: NEWS-ENHANCED CONFIDENCE BOOST (+8) ===
          // Applies when a high-impact macro event aligns with the trade direction.
          const newsBoost = computeMacroConfidenceBoost(
            symbol,
            evaluation.recommended_direction,
            allEvents,
            headlines
          );
          if (newsBoost > 0) {
            adjustedConfidence = Math.min(100, adjustedConfidence + newsBoost);
            confidenceAdjustments.push(`+${newsBoost} News-Macro Alignment`);
            sendEvent({ type: 'progress', message: `[${symbol}] News-Macro Boost: +${newsBoost} (macro event aligns with ${evaluation.recommended_direction} direction)` });
          }

          // === FEATURE 4B: FOMC WINDOW CONFIDENCE BOOST (+8) ===
          // Extra boost when FOMC window is active, compounding with macro alignment.
          if (fomcModeActive && evaluation.recommended_direction !== "NONE") {
            const fomcBoost = computeMacroConfidenceBoost(symbol, evaluation.recommended_direction, allEvents, headlines);
            if (fomcBoost > 0) {
              adjustedConfidence = Math.min(100, adjustedConfidence + 8);
              confidenceAdjustments.push(`+8 FOMC Window Alignment (${fomcPreEventActive ? "pre-event" : "post-event"})`);
              sendEvent({ type: 'progress', message: `[${symbol}] FOMC Window Boost: +8 (${fomcPreEventActive ? "pre-event" : "post-event"} macro alignment)` });
            }
          }

          // === FEATURE 3 (applied): HTF FIB ALIGNMENT BONUS (+5) ===
          if ((snapshot as any).htf_fib_alignment === true) {
            adjustedConfidence = Math.min(100, adjustedConfidence + 5);
            confidenceAdjustments.push(`+5 HTF Fib Alignment (Daily ${(snapshot as any).htf_fib_daily_level?.toFixed(2)} ≈ Weekly ${(snapshot as any).htf_fib_weekly_level?.toFixed(2)})`);
            sendEvent({ type: 'progress', message: `[${symbol}] HTF Fib Alignment Bonus: +5 (daily/weekly Fib zones overlap within 0.3%)` });
          }

          // === PUBLISHED (agent-news) ALIGNMENT BONUS (+20) ===
          if (pendingNewsSide && evaluation.recommended_direction === pendingNewsSide) {
             adjustedConfidence = Math.min(100, adjustedConfidence + 20);
             confidenceAdjustments.push(`+20 agent-news Fundamental Confluence (${pendingNewsSide})`);
             sendEvent({ type: 'progress', message: `[${symbol}] MASSIVE BOOST: Technicals align perfectly with pending agent-news sentiment (${pendingNewsSide})` });
          } else if (pendingNewsSide && evaluation.recommended_direction !== "NONE") {
             // Technicals conflict with news
             adjustedConfidence = Math.max(0, adjustedConfidence - 30);
             confidenceAdjustments.push(`-30 CONFLICT: Technicals contradict pending agent-news sentiment (${pendingNewsSide})`);
             sendEvent({ type: 'progress', message: `[${symbol}] PENALTY: Technicals contradict pending agent-news sentiment (${pendingNewsSide})` });
             
             // Reject the pending news signal due to conflict
             if (pendingNewsId) {
                await supabase.from("trade_opportunities").update({ status: "REJECTED", risk_summary: "Rejected: Technicals contradicted fundamental sentiment." }).eq("id", pendingNewsId);
             }
          } else if (pendingNewsId && evaluation.recommended_direction === "NONE") {
             // Technical setup was too weak to trade
             // Reject the pending news signal due to lack of technical confluence
             await supabase.from("trade_opportunities").update({ status: "REJECTED", risk_summary: "Rejected: Failed to find technical confluence." }).eq("id", pendingNewsId);
          }

          // === FEATURE 5: KELLY CRITERION PROBABILITY CALIBRATION ===
          // Query historical WON/LOST counts for this symbol and calibrate AI's probability estimate.
          let calibratedProbability = 50; // default
          try {
            const { data: wonLostCounts } = await supabase
              .from('trade_opportunities')
              .select('status')
              .eq('symbol', symbol)
              .in('status', ['WON', 'LOST']);

            const wonCount = wonLostCounts?.filter((r: any) => r.status === 'WON').length ?? 0;
            const lostCount = wonLostCounts?.filter((r: any) => r.status === 'LOST').length ?? 0;
            const rawProbability = (evaluation as any).probability_estimate ?? 50;
            calibratedProbability = calibrateProbability(rawProbability, wonCount, lostCount);

            if (wonCount + lostCount >= 5) {
              // Only log the calibration adjustment if we have meaningful history
              const delta = calibratedProbability - rawProbability;
              if (Math.abs(delta) > 1) {
                confidenceAdjustments.push(`Kelly: P(win) ${rawProbability.toFixed(1)}% → ${calibratedProbability.toFixed(1)}% (n=${wonCount + lostCount})`);
                sendEvent({ type: 'progress', message: `[${symbol}] Kelly Calibration: AI probability adjusted ${rawProbability.toFixed(1)}% → ${calibratedProbability.toFixed(1)}%` });
              }
            }
          } catch (kellyErr: any) {
            console.warn(`[Kelly] Failed to calibrate probability for ${symbol}: ${kellyErr.message}`);
          }

          if (confidenceAdjustments.length > 0) {
            sendEvent({ type: 'progress', message: `[${symbol}] Confidence adjusted: ${confidence} → ${adjustedConfidence} (${confidenceAdjustments.join(', ')})` });
          }

          const tier = getTier(adjustedConfidence);

          // FALLBACK LOGIC FOR RATIONALE (Fixes the "0.0%" bug)
          let safeRationale = evaluation.fibonacci_rationale;
          if (!safeRationale || safeRationale.length < 10 || /^[0-9.\s%]+$/.test(safeRationale.trim())) {
              safeRationale = evaluation.thought_process || "No rationale provided.";
          }

          // --- OVERRIDE: ADX FILTER FOR MEAN REVERSION ---
          if (evaluation.recommended_direction !== "NONE" && evaluation.strategy_applied === "MEAN_REVERSION" && (snapshot as any).adx_14 && (snapshot as any).adx_14 > 25) {
             evaluation.recommended_direction = "NONE";
             evaluation.thought_process = `[Execution Desk Override] Attempted Mean Reversion in high-momentum environment (ADX > 25). Strategy blocked.`;
          }

          // === GUARDRAIL #3: S-TIER OB/FVG STRUCTURAL CONFIRMATION ===
          // Per ICT/SMC methodology, an S-Tier signal (confidence >= 90) MUST have at least one
          // institutional footprint visible on the LTF snapshot: an Order Block, Fair Value Gap,
          // or Liquidity Sweep. The AI prompt encourages this, but we enforce it as a hard rule.
          // Without a structural anchor, the signal is downgraded to a hard cap of A-Tier (89).
          if (adjustedConfidence >= 90 && evaluation.recommended_direction !== "NONE") {
            const isLong = evaluation.recommended_direction === "LONG";
            const hasOB = isLong
              ? !!(snapshot as any).ltf_bullish_ob_nearest
              : !!(snapshot as any).ltf_bearish_ob_nearest;
            const hasFVG = isLong
              ? !!(snapshot as any).ltf_bullish_fvg_nearest
              : !!(snapshot as any).ltf_bearish_fvg_nearest;
            const hasSweep = isLong
              ? !!(snapshot as any).ltf_liquidity_sweep_bullish
              : !!(snapshot as any).ltf_liquidity_sweep_bearish;

            if (!hasOB && !hasFVG && !hasSweep) {
              const prevTier = getTier(adjustedConfidence);
              adjustedConfidence = Math.min(adjustedConfidence, 89);
              confidenceAdjustments.push(`[S-Tier Guard] No LTF OB/FVG/Sweep detected — capped at A-Tier (was ${prevTier})`); 
              sendEvent({ type: 'progress', message: `[${symbol}] S-Tier OB/FVG Guard: No institutional footprint found on LTF. Signal downgraded from ${prevTier} → A-Tier. Add an LTF OB/FVG entry for full S-Tier.` });
              console.log(`[S-Tier Guard] [Trace: ${traceId}] ${symbol}: Downgraded from S-Tier — no LTF OB, FVG or Liquidity Sweep present.`);
            } else {
              const footprint = [hasOB ? 'OB' : '', hasFVG ? 'FVG' : '', hasSweep ? 'Sweep' : ''].filter(Boolean).join(' + ');
              sendEvent({ type: 'progress', message: `[${symbol}] S-Tier OB/FVG Guard PASSED ✅ — Institutional footprint confirmed: ${footprint}` });
            }
          }

          if (evaluation.recommended_direction === "NONE" || evaluation.recommended_direction === "REQUIRE_LTF_DRILLDOWN" || confidence < 70) {
            let reason = "";
            if (evaluation.recommended_direction === "REQUIRE_LTF_DRILLDOWN") {
              reason = `LTF_ENTRY_WAIT: Macro trend is strong but price is overextended. Waiting for LTF pullback.`;
              
              const expiresAt = new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString();
              const targetDirection = snapshot.trend_alignment.startsWith("BULLISH") ? "LONG" : "SHORT";
              
              await supabase.from("trade_watchlists").update({ status: 'CANCELLED' }).eq('symbol', symbol).eq('status', 'WATCHING');
              await supabase.from("trade_watchlists").insert({
                symbol,
                direction: targetDirection,
                status: "WATCHING",
                macro_score: String(confidence),
                source_agent: "agent-swing",
                current_price: snapshot.current_price,
                context: snapshot,
                expires_at: expiresAt
              });
            }

            const thoughtSnippet = evaluation.thought_process || (evaluation as any).rationale || (evaluation as any).reasoning || (typeof evaluation === "object" ? JSON.stringify(evaluation) : "No setup identified");
            if (evaluation.recommended_direction === "REQUIRE_LTF_DRILLDOWN") {
              reason = "REQUIRE_LTF_DRILLDOWN: Price at HTF boundary. Sending to Sniper for 5m precision entry.";
            } else {
              reason = evaluation.recommended_direction === "NONE"
                ? `No valid swing setup identified: ${thoughtSnippet.slice(0, 200)}`
                : `Confidence too low (${confidence}) — below 70 threshold`;
            }

            sendEvent({ type: "progress", message: `[${symbol}] No trade: ${reason.slice(0, 120)}` });
            const rejectedObj = {
              symbol,
              side: "LONG", // placeholder — no trade
              timeframe: timeframe.toLowerCase(),
              status: "REJECTED",
              source: "agent-swing",
              ai_summary: `[SWING][${tier}] ${evaluation.recommended_direction === "NONE" ? "No setup" : "Low confidence"}: ${thoughtSnippet.slice(0, 400)}`,
              ai_risks: `Rejected by Swing AI: ${reason.slice(0, 200)}`,
              confidence,
              trace_id: traceId,
            };
            if (pendingNewsId) {
              await supabase.from("trade_opportunities").update(rejectedObj).eq("id", pendingNewsId);
            } else {
              await supabase.from("trade_opportunities").insert(rejectedObj);
            }
            rejections.push({ symbol, reason, layer: "Swing AI" });
            return;
          }

          // === DYNAMIC SMC / LTF PRECISION ENTRY & STOP LOSS ANCHORING ===
          const isLong = evaluation.recommended_direction === "LONG";
          const ltfOb = isLong ? (snapshot as any).ltf_bullish_ob_nearest : (snapshot as any).ltf_bearish_ob_nearest;
          const ltfFvg = isLong ? (snapshot as any).ltf_bullish_fvg_nearest : (snapshot as any).ltf_bearish_fvg_nearest;
          const dailyAtr = (snapshot as any).atr_14 || 10;
          const ltfAtr = (snapshot as any).ltf_atr_14 || (dailyAtr * 0.35);

          let entry = evaluation.execution_parameters.suggested_entry_price || snapshot.current_price || 0;
          
          // If an LTF Order Block or FVG is nearby (within 3%), anchor entry directly inside the LTF zone
          if (ltfOb && Math.abs(ltfOb - currentPrice) / currentPrice < 0.03) {
            entry = Number(ltfOb.toFixed(5));
          } else if (ltfFvg && Math.abs(ltfFvg - currentPrice) / currentPrice < 0.03) {
            entry = Number(ltfFvg.toFixed(5));
          }

          // Invalidation / Stop Loss: Prioritize structural LTF OB invalidation over wide daily ATR
          let aiSl = evaluation.execution_parameters.suggested_stop_loss;
          if (!aiSl || isNaN(aiSl)) {
            if (ltfOb) {
              aiSl = isLong ? ltfOb - (ltfAtr * 1.25) : ltfOb + (ltfAtr * 1.25);
            } else {
              const atrSlMultiplier = (evaluation.execution_parameters as any).atr_multiplier_sl || 1.5;
              const slDistance = dailyAtr * atrSlMultiplier;
              aiSl = isLong ? entry - slDistance : entry + slDistance;
            }
          }
          aiSl = Number(aiSl.toFixed(5));
          
          if (aiSl) {
            const isHighConfidencePrime = evaluation.confidence_score >= 80;
            supabase
              .from("market_context")
              .update({
                invalidation_price: aiSl,
                macro_bias: evaluation.recommended_direction === "LONG" ? "BULLISH"
                          : evaluation.recommended_direction === "SHORT" ? "BEARISH" : "NEUTRAL",
                narrative: `[Daily Macro Prime: ${evaluation.recommended_direction} (Conf: ${evaluation.confidence_score}%)] Entry: $${entry} | SL: $${aiSl} | TP: $${evaluation.execution_parameters?.take_profit_2 || evaluation.execution_parameters?.take_profit_1}. ${safeRationale}`,
                key_levels: {
                  ...(isHighConfidencePrime ? {
                    daily_macro_prime: {
                      direction: evaluation.recommended_direction,
                      entry,
                      invalidation: aiSl,
                      confidence: evaluation.confidence_score,
                      timeframe: timeframe.toLowerCase(),
                    }
                  } : {})
                }
              })
              .eq("symbol", symbol)
              .eq("agent_persona", "SWING_TRADER")
              .gt("expires_at", new Date().toISOString())
              .then(({ error }) => {
                if (error) console.warn(`[Market Context] [Trace: ${traceId}] Backfill failed for ${symbol}: ${error.message}`);
                else console.log(`[Market Context] [Trace: ${traceId}] Daily macro prime backfilled for ${symbol}: ${aiSl} (${evaluation.recommended_direction}, Conf: ${evaluation.confidence_score}%)`);
              });
          }

          // === LAYER C: STRUCTURAL RISK VALIDATION & SWING ATR FLOOR ===
          let sl = aiSl;

          // Swing ATR Floor: Daily swing trades must maintain an SL distance of >= 1.25x Daily ATR
          // to prevent being flushed out by standard intraday commodity/forex noise.
          const minSwingSlDist = Number((dailyAtr * 1.25).toFixed(5));
          const currentSlDist = Math.abs(entry - sl);
          if (currentSlDist < minSwingSlDist) {
            const widenedSl = isLong
              ? Number((entry - minSwingSlDist).toFixed(5))
              : Number((entry + minSwingSlDist).toFixed(5));
            console.log(`[${symbol}] [Swing Volatility Guard] SL distance (${currentSlDist.toFixed(4)}) was tighter than 1.25x Daily ATR (${minSwingSlDist.toFixed(4)}). Widening SL: ${sl} → ${widenedSl}`);
            sl = widenedSl;
            evaluation.execution_parameters.suggested_stop_loss = sl;
          }

          evaluation.execution_parameters.suggested_stop_loss = sl;
          let tp1 = evaluation.execution_parameters.take_profit_1;
          let tp2 = evaluation.execution_parameters.take_profit_2;
          let tp3 = evaluation.execution_parameters.take_profit_3;

          if (!entry || !sl || !tp2) {
            rejections.push({ symbol, reason: "Missing entry, SL, or TP2", layer: "Execution Desk" });
            if (pendingNewsId) await supabase.from("trade_opportunities").update({ status: "REJECTED", source: "agent-swing", risk_summary: "Rejected: Incomplete trade parameters." }).eq("id", pendingNewsId);
            return;
          }

          // === CROSS-AGENT CONFLUENCE & DYNAMIC ORDER TYPE ROUTING ===
          let intradayHasOpposingRejection = false;
          let intradayRejectionDetail = "";

          if (recentIntradayRejections.length > 0) {
            for (const r of recentIntradayRejections) {
              const summary = (r.ai_summary || "").toUpperCase();
              const risks = (r.ai_risks || "").toUpperCase();
              
              if (isLong) {
                if (summary.includes("BEARISH_TREND") || summary.includes("BEARISH BREAKDOWN") || summary.includes("STRONG DOWNWARD") ||
                    risks.includes("BEARISH BREAKDOWN") || risks.includes("STRONG DOWNWARD")) {
                  intradayHasOpposingRejection = true;
                  intradayRejectionDetail = r.ai_summary?.slice(0, 140) || "Intraday bearish breakdown detected";
                  break;
                }
              } else {
                if (summary.includes("BULLISH_TREND") || summary.includes("BULLISH BREAKOUT") || summary.includes("STRONG UPWARD") ||
                    risks.includes("BULLISH BREAKOUT") || risks.includes("STRONG UPWARD")) {
                  intradayHasOpposingRejection = true;
                  intradayRejectionDetail = r.ai_summary?.slice(0, 140) || "Intraday bullish breakout detected";
                  break;
                }
              }
            }
          }

          let order_type = isLong ? "BUY MARKET" : "SELL MARKET";
          const pendingOrderThreshold = (dailyAtr && dailyAtr > 0) ? (dailyAtr * 0.15) : (currentPrice * 0.001);

          if (intradayHasOpposingRejection) {
            // Intraday agent detected active breakdown or opposing momentum.
            // Strictly block blind Market order to prevent buying/selling into a falling knife.
            console.log(`[${symbol}] [Cross-Agent Confluence] Intraday agent rejected ${symbol} (${intradayRejectionDetail}). Converting to pullback LIMIT order entry.`);
            const maxLimitOffset = (dailyAtr && dailyAtr > 0) ? (dailyAtr * 0.30) : (currentPrice * 0.005);
            const deepFib = nearestFibs.find(f => isLong ? f.price < currentPrice : f.price > currentPrice);
            let targetLimit = deepFib ? deepFib.price : (isLong ? currentPrice - maxLimitOffset : currentPrice + maxLimitOffset);
            
            // Clamp target limit within reachable 0.35x ATR
            if (isLong && currentPrice - targetLimit > maxLimitOffset) targetLimit = currentPrice - maxLimitOffset;
            if (!isLong && targetLimit - currentPrice > maxLimitOffset) targetLimit = currentPrice + maxLimitOffset;

            entry = Number(targetLimit.toFixed(5));
            order_type = isLong ? "BUY LIMIT" : "SELL LIMIT";
            
            // Expand SL to 1.35x Daily ATR to withstand intraday momentum
            const wideSlDist = Number((dailyAtr * 1.35).toFixed(5));
            sl = isLong ? Number((entry - wideSlDist).toFixed(5)) : Number((entry + wideSlDist).toFixed(5));
            evaluation.execution_parameters.suggested_entry_price = entry;
            evaluation.execution_parameters.suggested_stop_loss = sl;
            safeRationale += ` [Multi-Timeframe Protection: Intraday counter-momentum (${intradayRejectionDetail}) — Market entry converted to pullback Limit @ $${entry} with 1.35x ATR SL]`;
          } else if (Math.abs(entry - currentPrice) >= pendingOrderThreshold) {
            // Dynamic limit clamping: prevent placing limit orders excessively far (>0.35x ATR) which causes missed fills
            const maxLimitDist = (dailyAtr && dailyAtr > 0) ? (dailyAtr * 0.30) : (currentPrice * 0.005);
            const rawLimitDist = Math.abs(entry - currentPrice);
            if (rawLimitDist > maxLimitDist) {
              const clampedEntry = isLong ? (currentPrice - maxLimitDist) : (currentPrice + maxLimitDist);
              entry = Number(clampedEntry.toFixed(5));
              console.log(`[${symbol}] [Limit Clamping] Limit order entry tightened from distance ${rawLimitDist.toFixed(4)} to ${maxLimitDist.toFixed(4)} @ ${entry} to maximize fill probability.`);
              evaluation.execution_parameters.suggested_entry_price = entry;
            }

            if (isLong) {
              order_type = entry < currentPrice ? "BUY LIMIT" : "BUY STOP";
            } else {
              order_type = entry > currentPrice ? "SELL LIMIT" : "SELL STOP";
            }
          } else {
            // Convert to market order and adjust SL/TP proportionally
            const entryShift = currentPrice - entry;
            entry = currentPrice;
            sl = Number((sl + entryShift).toFixed(5));
            evaluation.execution_parameters.suggested_stop_loss = sl;
            if (tp1) tp1 = Number((tp1 + entryShift).toFixed(5));
            if (tp2) tp2 = Number((tp2 + entryShift).toFixed(5));
            if (tp3) tp3 = Number((tp3 + entryShift).toFixed(5));
            console.log(`[${symbol}] Entry too close to live price (Dist: ${Math.abs(entryShift).toFixed(5)}). Converted to ${order_type} to prevent Error 10016. SL/TP adjusted.`);
          }

          // === COMMODITY & HIGH-BETA VOLATILITY DISCIPLINE (PULLBACK LIMIT MANDATE) ===
          // High-beta commodities (UKOIL, XAGUSD, XAUUSD, US30) experience aggressive intraday mean-reversion.
          // Forbid aggressive market order chasing; force passive Limit orders at structural discount levels.
          const volatileCommodities = ["UKOIL", "XAGUSD", "XAUUSD", "US30", "NAS100"];
          if (volatileCommodities.includes(symbol) && order_type.includes("MARKET")) {
            const limitOffset = (dailyAtr && dailyAtr > 0) ? (dailyAtr * 0.35) : (currentPrice * 0.005);
            entry = isLong ? Number((currentPrice - limitOffset).toFixed(5)) : Number((currentPrice + limitOffset).toFixed(5));
            order_type = isLong ? "BUY LIMIT" : "SELL LIMIT";
            evaluation.execution_parameters.suggested_entry_price = entry;
            safeRationale += ` [Commodity Volatility Discipline: Market entry converted to pullback Limit @ $${entry} to prevent wick-chasing]`;
          }

          // === ASSET-CLASS CONTRACT MULTIPLIER & MAX DOLLAR RISK GOVERNOR ===
          // Prevent raw trade origination from exceeding the 10% account blowout cap ($150 on $1,500 capital)
          // on large contract assets (e.g., XAGUSD with 5000 contract size, UKOIL with 1000 contract size).
          const assetContractSizes: Record<string, number> = {
            XAGUSD: 5000,
            UKOIL: 1000,
            XAUUSD: 100,
            US30: 1,
            NAS100: 1,
            SPX500: 1,
            GER30: 1,
            BTCUSD: 1,
            EURUSD: 100000,
            GBPUSD: 100000,
            USDJPY: 100000,
          };
          const contractSize = assetContractSizes[symbol] || 1;
          const minLot = 0.01;
          const maxPermissibleCapitalRisk = 150.0; // 10% cap on $1,500 standard base portfolio
          const maxAllowableStopDistance = maxPermissibleCapitalRisk / (minLot * contractSize);

          if (maxAllowableStopDistance > 0 && Math.abs(entry - sl) > maxAllowableStopDistance) {
            const rawRisk = Math.abs(entry - sl) * minLot * contractSize;
            console.log(`[${symbol}] [Origination Risk Governor] Raw risk ($${rawRisk.toFixed(2)}) exceeds $150 cap. Anchoring entry to structural discount ($${entry} → ${isLong ? (sl + maxAllowableStopDistance).toFixed(5) : (sl - maxAllowableStopDistance).toFixed(5)}).`);
            
            // Re-anchor limit entry so total dollar risk is strictly capped at $150
            entry = isLong
              ? Number((sl + maxAllowableStopDistance).toFixed(5))
              : Number((sl - maxAllowableStopDistance).toFixed(5));
            order_type = isLong ? "BUY LIMIT" : "SELL LIMIT";
            evaluation.execution_parameters.suggested_entry_price = entry;
            safeRationale += ` [Origination Risk Governor: Entry anchored to $${entry} so 0.01 lot dollar risk ($${maxPermissibleCapitalRisk.toFixed(2)}) stays strictly within the 10% capital cap]`;
          }

          // === TAKE PROFIT DIRECTION & MONOTONIC R-MULTIPLE SANITIZATION ===
          const swingRiskDist = Math.abs(entry - sl);
          if (swingRiskDist > 0) {
            if (isLong) {
              // Strictly above entry
              if (!tp1 || tp1 <= entry) tp1 = Number((entry + swingRiskDist * 1.0).toFixed(5));
              if (!tp2 || tp2 <= tp1) tp2 = Number((tp1 + swingRiskDist * 1.0).toFixed(5));
              if (!tp3 || tp3 <= tp2) tp3 = Number((tp2 + swingRiskDist * 1.5).toFixed(5));
            } else {
              // Strictly below entry
              if (!tp1 || tp1 >= entry) tp1 = Number((entry - swingRiskDist * 1.0).toFixed(5));
              if (!tp2 || tp2 >= tp1) tp2 = Number((tp1 - swingRiskDist * 1.0).toFixed(5));
              if (!tp3 || tp3 >= tp2) tp3 = Number((tp2 - swingRiskDist * 1.5).toFixed(5));
            }
          }
          evaluation.execution_parameters.take_profit_1 = tp1;
          evaluation.execution_parameters.take_profit_2 = tp2;
          evaluation.execution_parameters.take_profit_3 = tp3;

          const riskPct = Math.abs(entry - sl) / entry;
          const maxRiskPct = ["XAUUSD", "XAGUSD", "BTCUSD", "UKOIL"].includes(symbol) ? 0.15 : 0.10;

          if (riskPct > maxRiskPct) {
            const msg = `Stop loss ${(riskPct * 100).toFixed(2)}% exceeds swing maximum of ${(maxRiskPct * 100).toFixed(0)}%`;
            sendEvent({ type: "progress", message: `[${symbol}] REJECTED: ${msg}` });
            const rejectedObj = {
              symbol,
              side: (evaluation.recommended_direction === "NONE" || !evaluation.recommended_direction) ? "LONG" : evaluation.recommended_direction.trim().toUpperCase(),
              timeframe: timeframe.toLowerCase(),
              status: "REJECTED",
              source: "agent-swing",
              entry_plan_json: { price: entry, order_type, scaled_entries: null },
              stop_plan_json: { stop: sl, initial: sl, atr: snapshot.atr_14 },
              take_profit_json: { tp: tp2, tp1, tp2, tp3 },
              ai_summary: `[SWING][${tier}] ${safeRationale}`,
              ai_risks: msg,
              confidence: adjustedConfidence,
              trace_id: traceId,
            };
            if (pendingNewsId) {
              await supabase.from("trade_opportunities").update(rejectedObj).eq("id", pendingNewsId);
            } else {
              await supabase.from("trade_opportunities").insert(rejectedObj);
            }
            rejections.push({ symbol, reason: msg, layer: "Execution Desk" });
            return;
          }

          const swingRisk = Math.abs(entry - sl);
          const rewardTp2 = tp2 ? Math.abs(tp2 - entry) : 0;
          const rrToTp2 = swingRisk > 0 ? Number((rewardTp2 / swingRisk).toFixed(2)) : 0;
          const requiredRR = 1.70;

          const tcLevels = calculateInstitutionalTradingCentralLevels(
            currentPrice,
            sl,
            tp1 || Number((entry + (isLong ? swingRisk : -swingRisk)).toFixed(5)),
            tp2 || Number((entry + (isLong ? swingRisk * 2.0 : -swingRisk * 2.0)).toFixed(5)),
            isLong ? "LONG" : "SHORT",
            1.70
          );

          if (rrToTp2 < requiredRR - 0.1) {
            // Adaptive Trading Central Limit Entry Optimization:
            const isReachable = Math.abs(tcLevels.suggested_entry_price - currentPrice) <= ((snapshot.atr_14 || Math.abs(currentPrice - sl)) * 2.5);
            if ((tier === "S-Tier" || tier === "A-Tier" || confidence >= 80) && isReachable) {
              entry = tcLevels.suggested_entry_price;
              order_type = isLong ? "BUY LIMIT" : "SELL LIMIT";
              evaluation.execution_parameters.suggested_entry_price = entry;
              safeRationale += ` [Trading Central Limit Optimizer: Adjusted entry to pullback limit @ $${entry} to enforce institutional 1:1.75 R:R to TP2]`;
            } else {
              const msg = `R:R to TP2 is 1:${rrToTp2.toFixed(2)}, below required 1:${requiredRR} for ${tier}`;
              sendEvent({ type: "progress", message: `[${symbol}] REJECTED: ${msg}` });
              const rejectedObj = {
                symbol,
                side: (evaluation.recommended_direction === "NONE" || !evaluation.recommended_direction) ? "LONG" : evaluation.recommended_direction.trim().toUpperCase(),
                timeframe: timeframe.toLowerCase(),
                status: "REJECTED",
                source: "agent-swing",
                entry_plan_json: { price: entry, order_type, scaled_entries: null, max_holding_bars: 20, horizon_days: 20 },
                stop_plan_json: { stop: sl, initial: sl, atr: snapshot.atr_14 },
                take_profit_json: { tp: tp2, tp1, tp2, tp3 },
                ai_summary: `[SWING][${tier}] ${safeRationale}`,
                ai_risks: `Rejected by Swing Desk: ${msg}`,
                confidence: adjustedConfidence,
                trace_id: traceId,
              };
              if (pendingNewsId) {
                await supabase.from("trade_opportunities").update(rejectedObj).eq("id", pendingNewsId);
              } else {
                await supabase.from("trade_opportunities").insert(rejectedObj);
              }
              rejections.push({ symbol, reason: msg, layer: "Execution Desk" });
              return;
            }
          }

          // === APPROVED — SAVE TO DB ===
          const r = evaluation.swing_rationale;
          const aiSummary = [
            `[SWING][${tier}] [${evaluation.market_structure} → ${evaluation.strategy_applied}]`,
            safeRationale,
            r.structural_confirmation,
            r.macro_alignment,
            r.invalidation_level,
            tp1 ? `TP1 @ $${tp1.toLocaleString()}: ${r.tp1_rationale}` : null,
            tp2 ? `TP2 @ $${tp2.toLocaleString()}: ${r.tp2_rationale}` : null,
            tp3 ? `TP3 @ $${tp3.toLocaleString()}: ${r.tp3_rationale}` : null,
            `R:R to TP2: 1:${rrToTp2.toFixed(1)} | Fib Swing: $${fib.swing_low.toLocaleString()} → $${fib.swing_high.toLocaleString()}`,
          ].filter(Boolean).join(" | ");

          const approvedObj = {
              symbol,
              side: (evaluation.recommended_direction === "NONE" || !evaluation.recommended_direction) ? "LONG" : evaluation.recommended_direction.trim().toUpperCase(),
              timeframe: timeframe.toLowerCase(),
              status: isManual ? "PENDING_APPROVAL" : "APPROVED",
              source: "agent-swing",
              entry_plan_json: {
                price: entry,
                order_type,
                scaled_entries: null,
                max_holding_bars: 20,
                horizon_days: 20,
                trading_central_levels: tcLevels,
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
              risk_summary: `RSI ${snapshot.rsi_14}${snapshot.rsi_divergence && snapshot.rsi_divergence !== 'NONE' ? ` | Div: ${snapshot.rsi_divergence}` : ''} | ATR ${snapshot.atr_14}`,
              confidence: adjustedConfidence,
              ai_summary: aiSummary,
              ai_risks: "Managed by agent-risk",
              trace_id: traceId,
            };

          let dbData, dbError;
          if (pendingNewsId) {
            const res = await supabase.from("trade_opportunities").update(approvedObj).eq("id", pendingNewsId).select("id").single();
            dbData = res.data;
            dbError = res.error;
          } else {
            const res = await supabase.from("trade_opportunities").insert(approvedObj).select("id").single();
            dbData = res.data;
            dbError = res.error;
          }

          if (dbError) {
            console.error(`[DB Error] [Trace: ${traceId}] ${symbol}: ${dbError.message}`);
            rejections.push({ symbol, reason: dbError.message, layer: "Database" });
            return;
          }

          console.log(`[Swing] [Trace: ${traceId}] APPROVED ${symbol} — ID: ${dbData.id} | ${tier} | R:R 1:${rrToTp2.toFixed(1)} to TP2`);
          sendEvent({
            type: "progress",
            message: `[Success] Opportunity generated for ${symbol}`,
          });
          
          // Clean up any active sniper watchlists for this symbol to prevent duplicate execution
          await supabase.from("trade_watchlists").update({ status: 'CANCELLED' }).eq('symbol', symbol).eq('status', 'WATCHING');
          
        sendEvent({
            type: "progress",
            message: `[${symbol}] ✅ SWING SIGNAL APPROVED — ${tier} | Entry: $${entry.toLocaleString()} | SL: $${sl.toLocaleString()} | TP2: $${tp2.toLocaleString()} | R:R 1:${rrToTp2.toFixed(1)}`,
          });

          // Update market_context with the approved macro prime and bifurcated scenario tree
          await supabase
            .from("market_context")
            .update({
              invalidation_price: sl,
              macro_bias: evaluation.recommended_direction === "LONG" ? "BULLISH"
                        : evaluation.recommended_direction === "SHORT" ? "BEARISH" : "NEUTRAL",
              narrative: `[Daily Macro Prime: ${evaluation.recommended_direction} (Conf: ${adjustedConfidence}%)] Entry: $${entry} | SL/Pivot: $${sl} | TP2: $${tp2}. ${safeRationale}`,
              key_levels: {
                fib_levels: fib.levels,
                fib_extensions: fib.extensions,
                swing_high: fib.swing_high,
                swing_low: fib.swing_low,
                nearest_fibs: nearestFibs,
                direction: fib.direction,
                pivot_point: sl,
                preferred_scenario: {
                  direction: evaluation.recommended_direction,
                  entry,
                  targets: [tp1, tp2, tp3].filter(Boolean),
                  invalidation: sl,
                },
                alternative_scenario: tcLevels.alternative_scenario,
              }
            })
            .eq("symbol", symbol)
            .eq("agent_persona", "SWING_TRADER")
            .gt("expires_at", new Date().toISOString());

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
              raw_confidence: confidence,
              adjusted_confidence: adjustedConfidence,
              confidence_adjustments: confidenceAdjustments,
              calibrated_probability: calibratedProbability,
              htf_fib_alignment: (snapshot as any).htf_fib_alignment,
              fomc_mode_active: fomcModeActive,
              fib_swing_high: fib.swing_high,
              fib_swing_low: fib.swing_low,
              fibonacci_rationale: safeRationale,
            },
          });

          // Note: Telegram broadcasting is handled universally via DB trigger by the telegram-broadcast Edge Function.
          results.push({ symbol, id: dbData.id, tier, entry, sl, tp1, tp2, tp3, rr_to_tp2: rrToTp2 });
        } catch (symbolErr: any) {
          console.error(`[Global Error] [Trace: ${traceId}] ${symbol}: ${symbolErr.message}`);
          rejections.push({ symbol, reason: symbolErr.message, layer: "System" });
        }
      }));
    }

      // Note: pendingNewsId resolution is handled per-symbol inside the for-loop above.

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
