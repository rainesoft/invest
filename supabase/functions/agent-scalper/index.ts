import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient, SupabaseClient } from "npm:@supabase/supabase-js@2.108.2";
import { fetchPaperBars, Bar, placePaperOrder, makeClientOrderId } from "../../../packages/execution/index.ts";
import { sma, rsi, detectRegime } from "../../../packages/strategy/index.ts";
import { insertAuditLog } from "../../../packages/core/audit.ts";
import { isMarketOpen } from "../../../packages/core/market.ts";
import { netEdge, transactionCost, slippage } from "../../../packages/strategy/index.ts";
import { getContextSnapshot, LogicContext, calculatePivotPoints } from "../../../packages/strategy/indicators.ts";
import { validateGlobalSignal } from "../../../packages/strategy/riskManager.ts";
import { fetchAllMacroEvents, generateMacroContext, fetchRealtimeNews } from "../../../packages/core/news.ts";
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
  strategy_applied: z.enum(["PULLBACK", "MOMENTUM_CONTINUATION", "MEAN_REVERSION", "BREAKOUT", "NONE"]),
  execution_parameters: z.object({
    entry_type: z.enum(["Buy Limit", "Sell Limit", "Buy Stop", "Sell Stop", "Market", "NONE"]),
    suggested_entry_price: z.number().nullable(),
    scaled_entries: z.array(z.object({ price: z.number(), weight: z.number() })).nullable().optional(),
    suggested_stop_loss: z.number().nullable(),
    suggested_take_profit: z.number().nullable()
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
  const azureKey = Deno.env.get("AZURE_OPENAI_API_KEY");
  
  let openai: OpenAI;
  if (openaiKey) {
    openai = new OpenAI({ apiKey: openaiKey });
  } else if (azureKey) {
    openai = new OpenAI({
      apiKey: azureKey,
      baseURL: `${Deno.env.get("AZURE_OPENAI_ENDPOINT")}/openai/deployments/${Deno.env.get("AZURE_OPENAI_DEPLOYMENT")}`,
      defaultQuery: { "api-version": Deno.env.get("AZURE_OPENAI_API_VERSION") || "2023-07-01-preview" },
      defaultHeaders: { "api-key": azureKey }
    });
  } else {
    throw new Error("No OpenAI or Azure OpenAI keys found");
  }

  const systemPrompt = `You are an Aggressive Intraday Scalper for an institutional trading desk. You respond EXCLUSIVELY in raw JSON.

[HISTORICAL PERFORMANCE CALIBRATION]
Review your past decisions on this asset to calibrate your current bias. If you notice a recent losing streak or repeated rejections for the same structural reason, you MUST act defensively and adjust your confidence and action thresholds.
${historicalMemory || "No historical data available for this asset yet."}

[RISK EVALUATION RULES]
1. DYNAMIC STRATEGY SELECTION & TREND ALIGNMENT: Identify the market structure accurately. 
   - Strict Trend Definition: If price is below BOTH the 50 EMA and 200 EMA, the market has a BEARISH bias. If price is above BOTH EMAs, it has a BULLISH bias. Do NOT label a market as "NONE" (ranging) if it is trading cleanly on one side of both EMAs.
   - If trending heavily (Price > 50 & 200 EMA), prioritize MOMENTUM_CONTINUATION setups using minor retracements. 
   - If the market is in a true CHOP or RANGE regime (trend_alignment is CHOP), you MUST prioritize BREAKOUT setups using Buy Stop / Sell Stop orders just outside the range boundaries, OR high-probability MEAN_REVERSION setups targeting the range boundaries.
2. BREAK OF STRUCTURE (BOS) EXECUTION TIMING: You are provided with the \`ltf_bos\` flag which deterministically tracks 5-bar fractal structure breaks on the execution timeframe.
   - If \`ltf_bos\` is 'BULLISH' and the \`htf_trend\` is BULLISH, this is a confirmed Pullback Entry. You MUST originate a LONG trade targeting the next resistance level.
   - If \`ltf_bos\` is 'BEARISH' and the \`htf_trend\` is BEARISH, you MUST originate a SHORT trade targeting the next support level.
   - If \`ltf_bos\` is 'NONE', the structure has not broken yet. Do not guess the reversal. You MUST originate a pending Limit Order at the nearest structural floor/ceiling instead of a Market order.
3. STOP LOSS SIZING & VOLATILITY (ATR): The snapshot provides \`safe_long_stop_loss\`, \`safe_short_stop_loss\`, and \`atr_14\`. 
   - TIGHT LOCAL STRUCTURE: You MUST optimize your stop loss for the specific timeframe you are evaluating. Place the stop loss tight behind the immediate local structure.
   - MANDATORY ATR PADDING: Your \`suggested_stop_loss\` MUST be mathematically padded by exactly \`1.0 * atr_14\` beyond the structural invalidation point (for Crypto pairs like BTCUSD, use \`2.0 * atr_14\`) to avoid liquidity sweeps!
   - MAX STOP LOSS LIMIT: Your calculated stop loss MUST NEVER exceed a distance of \`2.0 * atr_14\` from the suggested entry price (or \`3.0 * atr_14\` for Crypto assets).
4. CONFIDENCE-WEIGHTED R:R (RISK TO REWARD) ENFORCEMENT: 
   - The required Risk/Reward ratio depends on your generated \`confidence_score\`:
     * S-Tier (90-100 confidence): Minimum 1:1.2 R:R
     * A-Tier (80-89 confidence): Minimum 1:1.3 R:R
     * B-Tier (70-79 confidence): Minimum 1:1.5 R:R
   - Before outputting your JSON, mathematically verify that \`abs(Entry - TP) / abs(Entry - SL)\` meets the required threshold for your confidence tier.
   - [CRITICAL MATH RULE]: If your initial structural TP does not yield the required R:R against your SL, you MUST aggressively adjust your trade setup to pass the math. You must extend your TP to the next higher-timeframe liquidity pool, or tighten your SL (while still maintaining at least 1.0 ATR padding) so that the mathematical R:R strictly exceeds the minimum threshold.
   - Only if you absolutely cannot find a logical structure to stretch the R:R to the minimum should you set \`recommended_direction\` to "NONE".
5. RANGING MARKETS & BREAKOUTS (MANDATORY RULE):
   - If the market is RANGING (price between 50 and 200 EMAs), a 'recommended_direction' of NONE is STRICTLY FORBIDDEN unless R:R fails.
   - You MUST always identify the nearest Swing High and Swing Low. Based on the dominant macro bias or HTF trend, place EITHER a Buy Stop 0.1% above the Swing High OR a Sell Stop 0.1% below the Swing Low. Do not place both.
   - [MACRO-ALIGNED MEAN REVERSION]: When forced to use MEAN_REVERSION in a range, you MUST align the direction of the trade with the underlying fundamental macro bias provided in the context.
6. FUNDAMENTAL MACRO OVERRIDE (COMMODITIES & FOREX): Technical EMAs are SECONDARY to dominant macro narratives and active supply/demand shocks.
   - If the \`fundamental_context\` headlines reference overwhelming macro drivers (e.g., active military conflicts, aggressive rate hike rhetoric), this OVERRIDES technical ranging/chop classifications.
   - ANY trade setup you generate (even inside a range) MUST align with this macro bias.
7. MULTI-TIMEFRAME CONFLUENCE (MTFA): You are provided with the HTF (Higher Timeframe) trend. 
   - You MUST align your direction with the HTF trend. If HTF is BEARISH, you only look for SHORT entries on the LTF.
   - Counter-trend trades are only allowed if the setup is A-Tier and R:R > 1.2.
8. SWING TRADER FIBONACCI CONFLUENCE (CRITICAL — READ CAREFULLY):
   The snapshot may include an \`agent_context\` array from longer-timeframe specialist agents.
   This is pre-computed institutional analysis — treat it as senior analyst guidance.
   - DIRECTION ALIGNMENT: If \`agent_context\` contains a SWING_TRADER entry and its \`macro_bias\` matches your intended trade direction → add +5 to your confidence_score before outputting.
   - FIBONACCI LEVEL ALIGNMENT: If your \`suggested_entry_price\` is within 0.3% of any price in \`agent_context[].key_levels.fib_levels\` → add +8 to your confidence_score. This is multi-timeframe Fibonacci confluence — the highest-quality signal in institutional trading.
   - COUNTER-TREND PENALTY: If you are trading LONG but the SWING_TRADER macro_bias is BEARISH, or trading SHORT but macro_bias is BULLISH → subtract 10 from your confidence_score and require minimum A-Tier (80) confidence to proceed.
   - INVALIDATION AWARENESS: If the \`invalidation_price\` field is set and your proposed stop loss is BEYOND it in the wrong direction, you must acknowledge this structural conflict in your thought_process.

[REQUIRED OUTPUT FORMAT]
You must output a single, valid JSON object matching the exact schema below. You MUST use the \`thought_process\` key FIRST to calculate your math and R:R before defining the trade parameters. If you don't calculate the R:R in text first, the numbers will be invalid.
Output strictly the JSON object. Do not wrap your response in markdown formatting or backticks.

{
  "thought_process": "Briefly evaluate the EMAs, state the LTF BOS, calculate the Entry, SL, TP, and verify the R:R ratio mathematically BEFORE returning parameters.",
  "calculated_rr": 0.0,
  "technical_audit": {
    "current_price": 0.0,
    "ema_50": 0.0,
    "ema_200": 0.0,
    "price_position": "ABOVE_BOTH | BELOW_BOTH | BETWEEN_EMAS",
    "ltf_bos": "BULLISH | BEARISH | NONE"
  },
  "market_structure": "BULLISH_TREND | BEARISH_TREND | RANGING | BREAKOUT",
  "recommended_direction": "LONG | SHORT | NONE",
  "strategy_applied": "PULLBACK | MOMENTUM_CONTINUATION | MEAN_REVERSION | BREAKOUT | NONE",
  "execution_parameters": {
    "entry_type": "Buy Limit | Sell Limit | Buy Stop | Sell Stop | Market | NONE",
    "suggested_entry_price": 0.0,
    "suggested_stop_loss": 0.0,
    "suggested_take_profit": 0.0
  },
  "confidence_score": 0,
  "institutional_rationale": {
    "directional_bias": "...",
    "execution_trigger": "...",
    "invalidation_point": "...",
    "take_profit_target": "...",
    "fundamental_alignment": "..."
  }
}

Current Market Context:
${JSON.stringify(snapshot, null, 2)}`;

  let messages = [
    { role: "system", content: systemPrompt },
    { role: "user", content: `Evaluate the raw market data for ${symbol} on the ${timeframe} timeframe at current price ${snapshot.current_price} and autonomously originate the highest probability trade setup, if any. Return the required JSON object execution profile.` }
  ];

  for (let attempt = 1; attempt <= 3; attempt++) {
    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: messages as any,
      response_format: { type: "json_object" },
      temperature: 0.1
    });

    const content = response.choices[0].message.content;
    if (!content) throw new Error("No content returned from AI");
    
    // 0. Native JSON Parsing
    let parsedJson;
    try {
      parsedJson = JSON.parse(content);
    } catch (e: any) {
      console.warn(`[Validation] Attempt ${attempt} failed JSON.parse. Retrying...`);
      messages.push({ role: "assistant", content });
      messages.push({ role: "user", content: `Your response was not valid JSON: ${e.message}. Please respond EXCLUSIVELY with the raw JSON object.` });
      continue;
    }

    // 1. Zod Parsing
    const parsed = TradeEvaluationSchema.safeParse(parsedJson);
    if (!parsed.success) {
      console.warn(`[Validation] Attempt ${attempt} failed Zod schema parsing. Retrying...`);
      messages.push({ role: "assistant", content });
      messages.push({ role: "user", content: `Your JSON failed validation: ${parsed.error.message}. Please fix the structure and try again. Ensure all required fields are present and correctly typed.` });
      continue;
    }

    const data = parsed.data;

    // 2. R:R Mathematical Verification
    if (data.recommended_direction !== "NONE" && data.execution_parameters.suggested_entry_price && data.execution_parameters.suggested_stop_loss && data.execution_parameters.suggested_take_profit) {
      const entry = data.execution_parameters.suggested_entry_price;
      const sl = data.execution_parameters.suggested_stop_loss;
      const tp = data.execution_parameters.suggested_take_profit;
      
      const risk = Math.abs(entry - sl);
      const reward = Math.abs(entry - tp);
      const rr = risk > 0 ? reward / risk : 0;
      
      let requiredRR = 1.5;
      if (data.confidence_score >= 90) requiredRR = 1.2;
      else if (data.confidence_score >= 80) requiredRR = 1.3;
      
      if (rr < requiredRR - 0.05) { // Adding small epsilon tolerance
        console.warn(`[Validation] Attempt ${attempt} failed R:R math (R:R=${rr.toFixed(2)}, Required=${requiredRR}). Retrying...`);
        messages.push({ role: "assistant", content });
        messages.push({ role: "user", content: `Your suggested trade yields a Risk/Reward ratio of 1:${rr.toFixed(2)}, but your confidence score of ${data.confidence_score} requires a minimum R:R of 1:${requiredRR}. You MUST either tighten your stop loss, extend your take profit target, or change recommended_direction to "NONE".` });
        continue;
      }
    }

    return data;
  }
  
  throw new Error(`AI failed to provide a valid JSON response after 3 attempts. Last Warning: ${messages[messages.length - 1]?.content}`);
}

async function revalidateOpportunity(signal: any, snapshot: LogicContext, newsContext: string | null) {
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
      defaultHeaders: { "api-key": azureKey }
    });
  } else {
    throw new Error("No OpenAI or Azure OpenAI keys found");
  }

  const systemPrompt = `You are a Senior Risk Officer re-evaluating a previously published trading signal.
Your job is to determine if the original thesis is still valid given the NEW live market snapshot and NEW breaking news context.

[ORIGINAL SIGNAL THESIS]
Symbol: ${signal.symbol}
Direction: ${signal.side}
Entry Plan: ${JSON.stringify(signal.entry_plan_json)}
Stop Loss Plan: ${JSON.stringify(signal.stop_plan_json)}
Take Profit Plan: ${JSON.stringify(signal.take_profit_json)}
Thesis: ${signal.ai_summary}

[NEW LIVE CONTEXT]
Current Price: ${snapshot.current_price}
Breaking News & Macro: ${newsContext || "No major macro events."}

[VALIDATION RULES]
1. MACRO CONTRADICTION: If the new breaking news fundamentally contradicts the original thesis (e.g. a 'risk-off' geopolitical shock occurs but the signal is LONG equities), you MUST reject the signal.
2. STRUCTURAL DECAY: If the price action has significantly shifted and the original structural rationale no longer makes sense, reject it.
3. DO NOT HALLUCINATE MATH: The system has ALREADY mathematically verified that the current price has NOT hit the stop loss or take profit. Do NOT reject the setup claiming the stop loss was hit. You must only reject based on fundamental macro shifts or severe structural decay.
4. PROFIT SECURING (SCALPING): If the trade is currently in profit, but the momentum has slowed, the market is ranging, or we are approaching a strong structural barrier, issue a TAKE_PROFIT command to secure the bag early. Do not get greedy.
5. If the thesis remains strongly valid and supported by the new context, issue MAINTAIN.

You MUST respond strictly with a raw JSON object:
{
  "action": "MAINTAIN" | "REJECT" | "TAKE_PROFIT",
  "reason": "Explain why you chose this action."
}`;

  const userPrompt = `Re-evaluate the ${signal.symbol} signal.`;

  const response = await openai.chat.completions.create({
    model: "gpt-4o",
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt }
    ],
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "revalidation",
        schema: {
          type: "object",
          properties: {
            action: { type: "string", enum: ["MAINTAIN", "REJECT", "TAKE_PROFIT"] },
            reason: { type: "string" }
          },
          required: ["action", "reason"],
          additionalProperties: false
        },
        strict: true
      }
    },
    temperature: 0.1
  });

  const content = response.choices[0].message.content;
  if (!content) throw new Error("No content returned from AI");
  return JSON.parse(content);
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
  const timeframe = (reqBody as any).timeframe ?? searchParams.get("timeframe") ?? (isCron ? "1H" : "1D");
  const modelId = searchParams.get("model_id") ?? undefined;
  const modelVersion = searchParams.get("model_version") ?? undefined;
  const newsContext = searchParams.get("news") ?? undefined;
  const symbolsParam =
    (reqBody as any).symbols?.join(",") || searchParams.get("symbols") || Deno.env.get("RESEARCH_SYMBOLS") || "XAUUSD,XAGUSD,BTCUSD,UKOIL,EURUSD,GBPUSD,USDJPY,US30,NAS100";
  const symbols = symbolsParam.split(",").map((s: string) => s.trim()).filter(Boolean);

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
          sendEvent({ type: 'progress', message: `[Macro Data] Fetching global economic calendar...` });
          allEvents = await fetchAllMacroEvents();

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
              const result = await fetchPaperBars(signal.symbol, signal.timeframe, 100, supabase);
              const snapshot = getContextSnapshot(
                result.map((b: any) => b.t),
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
        // ==========================================

        const chunkSize = 10;
        for (let i = 0; i < symbols.length; i += chunkSize) {
          const chunk = symbols.slice(i, i + chunkSize);
          await Promise.all(chunk.map(async (symbol) => {
            if (isCron && !isMarketOpen(symbol)) {
            console.log(`[Market Hours] Skipping ${symbol}: Market is closed.`);
            sendEvent({ type: 'progress', message: `[Market Hours] Skipping ${symbol}: Market is closed.` });
            return;
          }
          try {
            await insertAuditLog(supabase, {
              actor_type: "SYSTEM",
              action: "RESEARCH_RUN",
              entity_type: "research",
              payload_json: { symbol, timeframe, model_id: modelId, model_version: modelVersion },
            });

            let bars: Bar[];
            let source: string;
            try {
              console.log(`[Data Fetch] Fetching market data for ${symbol}...`);
              sendEvent({ type: 'progress', message: `[Data Fetch] Fetching historical price data for ${symbol}...` });
              const result = await fetchPaperBars(symbol, timeframe, 100, supabase);
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
            
            let mtfa_trend: 'BULLISH' | 'BEARISH' | 'CHOP' | undefined;
            let mtfa_ema_50: number | null = null;
            let mtfa_ema_200: number | null = null;

            if (timeframe !== '1D') {
              try {
                const result = await fetchPaperBars(symbol, '1D', 100, supabase);
                const dailySnapshot = getContextSnapshot(
                  result.map((b: any) => b.t),
                  result.map((b: any) => b.h),
                  result.map((b: any) => b.l),
                  result.map((b: any) => b.c)
                );
                if (dailySnapshot.trend_alignment.startsWith('BULLISH')) htf_trend = 'BULLISH';
                else if (dailySnapshot.trend_alignment.startsWith('BEARISH')) htf_trend = 'BEARISH';
                
                if (result.length > 0) {
                  const lastBar = result[result.length - 1];
                  const pivots = calculatePivotPoints(lastBar.h, lastBar.l, lastBar.c);
                  htf_support = pivots.support;
                  htf_resistance = pivots.resistance;
                }
                
                // Fetch MTFA (1H or 4H) for confluence
                const mtfaTf = timeframe === '15Min' ? '1H' : '4H';
                const mtfaResult = await fetchPaperBars(symbol, mtfaTf, 100, supabase);
                const mtfaSnapshot = getContextSnapshot(
                  mtfaResult.map((b: any) => b.t),
                  mtfaResult.map((b: any) => b.h),
                  mtfaResult.map((b: any) => b.l),
                  mtfaResult.map((b: any) => b.c)
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
              bars.map((b) => b.h),
              bars.map((b) => b.l),
              bars.map((b) => b.c)
            );
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
              fundamental_context,
              agent_context: agent_context.length > 0 ? agent_context : undefined
            };

            // PRE-EVALUATION ASSET ISOLATION (with candle-duration caching)
            // Check if this symbol was already isolated on this cron cycle's candle
            const tfMinutes: Record<string, number> = { '1H': 60, '4H': 240, '1D': 1440 };
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

            // LAYER B: Cognitive Guard (Senior Risk Officer)
            let evaluation;
            try {
              console.log(`[Layer B: Cognitive Guard] Requesting AI evaluation for ${symbol}...`);
              sendEvent({ type: 'progress', message: `[Layer B: AI Risk Officer] Evaluating institutional rationale and key levels for ${snapshot.trend_alignment} setup...` });
              evaluation = await evaluateOpportunity(symbol, snapshot, timeframe, historicalMemory);
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

            let is_valid = evaluation.recommended_direction !== "NONE";
            
            let dbSide = evaluation.recommended_direction === "NONE" 
              ? (snapshot.trend_alignment.startsWith('BULLISH') ? 'LONG' : 'SHORT') 
              : evaluation.recommended_direction;
            
            let entry_price = Number((evaluation.execution_parameters?.suggested_entry_price || snapshot.current_price).toFixed(3));
            let stop_loss = Number((evaluation.execution_parameters?.suggested_stop_loss || (dbSide === "LONG" ? snapshot.safe_long_stop_loss : snapshot.safe_short_stop_loss)).toFixed(3));
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

            if (!is_valid || confidence_score < 70) {
              const rejectReason = !is_valid 
                ? institutional_rationale 
                : `AI Confidence Score (${confidence_score}) below 70 threshold.`;
                
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
                ai_summary: rejectReason,
                ai_risks: "Rejected by AI Risk Officer",
                model_id: modelId,
                model_version: modelVersion,
                risk_summary: `RSI ${snapshot.rsi_14}`,
                confidence: confidence_score
              });
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
            const rrRatio = reward / risk;

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
            if (confidence_score >= 90) deskRequiredRR = 2.0;
            else if (confidence_score >= 80) deskRequiredRR = 1.75;

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
                ai_summary: institutional_rationale,
                ai_risks: `Rejected by Execution Desk: R:R ratio ${riskRewardRatio.toFixed(2)} < ${deskRequiredRR}`,
                model_id: modelId,
                model_version: modelVersion,
                risk_summary: `RSI ${snapshot.rsi_14}`
              });
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
                model_id: modelId,
                model_version: modelVersion,
              })
              .select("id")
              .single();

            if (!error && data) {
              console.log(`[Success] Opportunity generated for ${symbol}: ID ${data.id}`);
              sendEvent({ type: 'progress', message: `[Success] Opportunity generated for ${symbol}` });
              
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
              reason: `System Error: ${globalErr.message}`,
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