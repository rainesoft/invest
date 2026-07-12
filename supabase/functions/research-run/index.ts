import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient, SupabaseClient } from "npm:@supabase/supabase-js@2.108.2";
import { fetchPaperBars, Bar, placePaperOrder, makeClientOrderId } from "../_shared/execution.ts";
import { sma, rsi, detectRegime } from "../_shared/strategy.ts";
import { insertAuditLog } from "../_shared/audit.ts";
import { isMarketOpen } from "../_shared/market.ts";
import { netEdge, transactionCost, slippage } from "../../../packages/strategy/index.ts";
import { getContextSnapshot, LogicContext, calculatePivotPoints } from "../../../packages/strategy/indicators.ts";
import { validateGlobalSignal } from "../../../packages/strategy/riskManager.ts";
import { fetchAllMacroEvents, generateMacroContext, fetchRealtimeNews } from "../_shared/news.ts";
import { sizeWithRiskCaps } from "../../../packages/risk/index.ts";
import OpenAI from "npm:openai";

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

async function evaluateOpportunity(symbol: string, snapshot: LogicContext, timeframe: string, historicalMemory: string) {
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

  const systemPrompt = `You are a Senior Risk Officer for an institutional trading desk. You respond EXCLUSIVELY in raw JSON.

[HISTORICAL PERFORMANCE CALIBRATION]
Review your past decisions on this asset to calibrate your current bias. If you notice a recent losing streak or repeated rejections for the same structural reason, you MUST act defensively and adjust your confidence and action thresholds.
${historicalMemory || "No historical data available for this asset yet."}

[CRITICAL OUTPUT RULE]
You MUST respond strictly with a raw JSON object matching the exact schema below. Do not include any markdown formatting (like \`\`\`json), wrapper text, HTML tags, or conversational preambles. If you include anything other than raw JSON, the system breaks.

{
  "market_structure": "BULLISH_TREND" | "BEARISH_TREND" | "RANGING" | "BREAKOUT",
  "recommended_direction": "LONG" | "SHORT" | "NONE",
  "strategy_applied": "PULLBACK" | "MOMENTUM_CONTINUATION" | "MEAN_REVERSION" | "NONE",
  "execution_parameters": {
    "entry_type": "Buy Limit" | "Sell Limit" | "Buy Stop" | "Sell Stop" | "Market" | "NONE",
    "suggested_entry_price": number | null,
    "scaled_entries": [{"price": number, "weight": number}] | null,
    "suggested_stop_loss": number | null,
    "suggested_take_profit": number | null
  },
  "confidence_score": number,
  "institutional_rationale": {
    "directional_bias": "Explain why the recommended direction is the path of least resistance based on EMAs and key levels.",
    "execution_trigger": "Specify the exact lower-timeframe price action required at the entry price to trigger the trade.",
    "invalidation_point": "Explain exactly why the stop loss is placed where it is structurally.",
    "take_profit_target": "Explain the structural target for the trade (e.g. recent swing high, major resistance). Do NOT calculate the price or R:R ratio, the system will append this automatically.",
    "fundamental_alignment": "State how the technical setup aligns with or fights current macro drivers."
  }
}

[RISK EVALUATION RULES]
1. DYNAMIC STRATEGY SELECTION & TREND ALIGNMENT: Identify the market structure accurately. 
   - Strict Trend Definition: If price is below BOTH the 50 EMA and 200 EMA, the market has a BEARISH bias. If price is above BOTH EMAs, it has a BULLISH bias. Do NOT label a market as "NONE" (ranging) if it is trading cleanly on one side of both EMAs.
   - If trending heavily (Price > 50 & 200 EMA), prioritize MOMENTUM_CONTINUATION setups using minor retracements. 
   - If the market is in a true CHOP or RANGE regime (trend_alignment is CHOP), you MUST prioritize MEAN_REVERSION setups targeting the range boundaries (Buy at Support, Sell at Resistance).
2. THE 'EMPTY AIR' CHECK: Before suggesting a direction, evaluate the distance to the next major liquidity zone. If the current price is floating in 'empty air' midway between support and resistance, do NOT reject the setup automatically! Instead, originate a pending Limit Order (Buy Limit or Sell Limit) exactly at the nearest major support or resistance level to catch the reversion.
3. STOP LOSS SIZING & VOLATILITY (ATR): The snapshot provides \`safe_long_stop_loss\`, \`safe_short_stop_loss\`, and \`atr_14\`. 
   - TIGHT LOCAL STRUCTURE: You MUST optimize your stop loss for the specific timeframe you are evaluating. For example, a 4H swing trade on Forex typically requires a 30 to 60-pip stop. Do not use massive 100+ pip stop losses unless trading highly volatile exotics or crypto. Place the stop loss tight behind the immediate local structure.
   - MANDATORY ATR LIMIT: Your \`suggested_stop_loss\` MUST be the TIGHTER of either your structural stop, or the volatility threshold \`Entry +/- (1.5 * atr_14)\`. 
   - MAX STOP LOSS LIMIT: Your calculated stop loss MUST NEVER exceed a distance of \`3.0 * atr_14\` from the suggested entry price. If the required structural stop is too far away, adjust your Entry Price closer to the invalidation point to shrink the risk!
4. FUNDAMENTAL REALITY CHECK: You MUST heavily weigh the provided \`fundamental_context\`. 
   - Be specific: Do not generically state "there are no geopolitical shocks." Cite specific institutional drivers like Central Bank divergence, upcoming rate decisions, or CPI/NFP data that specifically impacts the asset.
   - [LIVE BREAKING NEWS]: If the \`fundamental_context\` contains live breaking headlines indicating sudden geopolitical shocks (e.g., airstrikes, war), severe equity sector fatigue (e.g., tech sell-off), or unannounced macroeconomic shifts that oppose the technical trend, you MUST abort the setup and return status: "REJECTED".
   - [CRITICAL MACRO DIRECTIVE]: If the technical setup is strong (B-Tier or A-Tier) and aligns perfectly with a High-Impact fundamental catalyst in the \`fundamental_context\`, you MUST upgrade your confidence to S-Tier (90+).
5. COUNTER-TREND MOMENTUM CHECK (MEAN REVERSION): 
   - Strict Technical Definitions: Price > 50 EMA and > 200 EMA = BULLISH momentum. Price < 50 EMA and < 200 EMA = BEARISH momentum.
   - DEEP PULLBACK BUYS: If an asset is crashing well below its EMAs (Bearish momentum), do NOT automatically reject long setups! If price is approaching a major higher-timeframe support level or Bollinger Band lower bound, issue a Buy Limit order at that structural floor.
   - EXHAUSTION SHORTS: If an asset is ripping parabolically well above its EMAs (Bullish momentum), do NOT automatically reject short setups! If price is approaching a major higher-timeframe resistance level or Bollinger Band upper bound, issue a Sell Limit order at that structural ceiling.
6. INSTITUTIONAL TONE: 
   - Never use apologetic, weak, or observational phrasing regarding missing data. Write with bulletproof brevity. Do NOT repeat your rationale. Combine your thoughts into a single, sharp thesis.
7. MULTI-TIMEFRAME ALIGNMENT (COUNTER-TREND PULLBACKS): You are provided with the 'htf_trend' (Daily macro trend). You generally want to align with it. HOWEVER, if the 4H setup contradicts the Daily trend, you MAY originate a "Counter-Trend Pullback" trade IF AND ONLY IF you limit the confidence score to B-Tier (80 max) and mandate a tighter structural stop loss (max 1.5 * atr_14).
8. BOLLINGER BAND EXHAUSTION (LIMIT ORDERS): You are provided with 'bb_upper' and 'bb_lower'. NEVER suggest a Market Entry LONG if the current price is at or above 'bb_upper'. NEVER suggest a Market Entry SHORT if the price is at or below 'bb_lower'. INSTEAD, use the \`execution_trigger\` to prescribe a pending LIMIT ORDER at the 50 EMA or the nearest Support/Resistance level to catch the pullback.
9. RSI DYNAMICS IN TRENDS: In a strong uptrend (Price > 50 EMA and > 200 EMA), the daily RSI rarely drops all the way to 30. A pullback to the 40-45 range is typically sufficient to reset momentum. Do NOT demand a drop to 30 if the asset is in heavy bullish momentum.
10. DIRECTIONAL MATH & SUPPORT VALIDATION: You MUST perform basic directional math. If Current Price < Support, the support has been BROKEN and is now Resistance. If Current Price > Resistance, it is now Support. Do not suggest a "pullback to support" if price has already broken below it.
11. MOMENTUM CONTINUATION ENTRY LOGIC: Never recommend 'immediate market entry' directly underneath a major swing high or resistance. You must either recommend a pullback limit order to a moving average/support, or a pending breakout (Buy Stop/Sell Stop) just beyond the structure. Avoid buying the local top.
12. STRICT STRUCTURAL TARGETS & RISK:REWARD OPTIMIZATION: You MUST output a \`suggested_take_profit\` that matches the exact structural target (e.g. major support/resistance) identified in your rationale. 
    - MINIMUM VIABLE R:R: Institutional setups require a MINIMUM Risk:Reward of 1:1.5, ideally 1:2.0 or higher. 
    - ENTRY PRICING TRADEOFF (SCALING IN): If your setup yields a weak R:R (e.g., 1:1.2), you MUST mathematically optimize your \`suggested_entry_price\`. Instead of moving the entire entry, you MUST split your risk by providing the \`scaled_entries\` array. Provide a primary entry price near the current support/resistance (e.g., \`weight: 0.5\`) and a secondary entry deeper into the retracement zone (e.g., \`weight: 0.5\`) to ensure a blended 1:2.0 R:R is achieved.
13. FRONT-RUNNING LIMIT ORDERS (ENTRY PRICING): When suggesting a Buy Limit at support or a Sell Limit at resistance, do NOT place the exact entry price at the absolute extreme of the structural level. Markets frequently front-run major levels. You MUST adjust your Limit Order slightly closer to the current price (e.g., front-running the support/resistance by 10-20% of the daily ATR) to ensure the order actually gets filled during a shallow pullback.
14. CONFIDENCE SCORING HEURISTICS: You must apply the following baseline scoring criteria:
    - S-Tier (90-100): Perfect technical alignment + High-Impact Macro Catalyst supporting the trade.
    - A-Tier (80-89): Pristine technical setup. Price is trending cleanly on the correct side of the 50 & 200 EMAs, pulling back to a clear structural zone with empty air to the Take Profit target.
    - B-Tier (70-79): Decent setup but possesses a minor flaw (e.g., Counter-Trend, forced to use wide ATR stop, or weak fundamentals).
    - C-Tier (<70): Choppy market, price floating in empty air, or poor R:R. (These will be automatically rejected by the execution desk).
15. COMMODITY GEOPOLITICAL SUPPLY SHOCK OVERRIDE: For commodities (UKOIL, XAUUSD, XAGUSD), technical EMAs are SECONDARY to active supply disruption events. 
    - If the \`fundamental_context\` headlines reference an active military conflict affecting supply routes (e.g., Strait of Hormuz blockade, pipeline sabotage, OPEC emergency cuts), this is a HIGH-IMPACT MACRO CATALYST that OVERRIDES technical ranging/chop classifications.
    - In such scenarios, you MUST NOT default to C-Tier simply because the price sits between EMAs or because the market is highly volatile. GEOPOLITICAL VOLATILITY = AGGRESSIVE TRADING OPPORTUNITY. Do not use "messy volatility" as an excuse to reject the trade. 
    - You must evaluate the geopolitical catalyst as the PRIMARY driver. If it supports a directional bias (e.g., supply disruption = bullish oil), you MUST originate a trade setup with S-Tier confidence (90+) provided the structural R:R is viable. Lean into the asymmetrical upside.
    - Use pending Limit Orders to catch pullbacks within the geopolitically-driven trend rather than chasing market orders at the top of a spike.
    - OPEC production decisions are MEDIUM-IMPACT catalysts. They support a directional bias but alone do not warrant S-Tier unless combined with a supply disruption or demand shock.
16. MAXIMUM ENTRY DISTANCE (EXECUTION PROBABILITY): Your \`suggested_entry_price\` MUST NOT be further than \`2.0 * atr_14\` from the current price. Placing a Buy Limit 10% below current price guarantees zero fills and wastes capital allocation. If your structural level is deeper than 2x ATR from the current price, you MUST use \`scaled_entries\` to split between a near entry (within 1x ATR) and a deep entry (at the structural level).
17. MANDATORY SCALING IN FOR DEEP RETRACEMENTS: If the optimal structural entry is more than \`1.5 * atr_14\` from the current price, you MUST provide \`scaled_entries\` with at least two entries: (1) a primary entry within 1x ATR of the current price with \`weight: 0.5\`, and (2) a secondary entry at the deep structural level with \`weight: 0.5\`. This ensures partial execution on shallow pullbacks while preserving the mathematical edge of the deeper entry.
18. NO RETAIL GURU-SPEAK (SYSTEMIC QUANT TONE ONLY): You are an automated algorithmic signal generator, not a retail trading guru. DO NOT advise the user to wait for "candlestick confirmation", "buying volume", or "price action triggers". The execution desk operates fully autonomously using hard LIMIT/STOP orders. Your rationale must focus purely on mathematical edge, structural levels, liquidity sweeps, and macro catalysts. Trade management (trailing stops, breakeven moves) is handled globally by a separate risk microservice—do not invent or suggest trade management rules in your rationale.

Current Market Context:
${JSON.stringify(snapshot, null, 2)}`;

  const userPrompt = `Evaluate the raw market data for ${symbol} on the ${timeframe} timeframe at current price ${snapshot.current_price} and autonomously originate the highest probability trade setup, if any. Return the required JSON object execution profile.`;

  const response = await openai.chat.completions.create({
    model: "gpt-4o",
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt }
    ],
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "trade_evaluation",
        schema: {
          type: "object",
          properties: {
            market_structure: { type: "string", enum: ["BULLISH_TREND", "BEARISH_TREND", "RANGING", "BREAKOUT"] },
            recommended_direction: { type: "string", enum: ["LONG", "SHORT", "NONE"] },
            strategy_applied: { type: "string", enum: ["PULLBACK", "MOMENTUM_CONTINUATION", "MEAN_REVERSION", "NONE"] },
            execution_parameters: {
              type: "object",
              properties: {
                entry_type: { type: "string", enum: ["Buy Limit", "Sell Limit", "Buy Stop", "Sell Stop", "Market", "NONE"] },
                suggested_entry_price: { type: ["number", "null"] },
                suggested_stop_loss: { type: ["number", "null"] },
                suggested_take_profit: { type: ["number", "null"] }
              },
              required: ["entry_type", "suggested_entry_price", "suggested_stop_loss", "suggested_take_profit"],
              additionalProperties: false
            },
            confidence_score: { type: "number" },
            institutional_rationale: {
              type: "object",
              properties: {
                directional_bias: { type: "string" },
                execution_trigger: { type: "string" },
                invalidation_point: { type: "string" },
                take_profit_target: { type: "string" },
                fundamental_alignment: { type: "string" }
              },
              required: ["directional_bias", "execution_trigger", "invalidation_point", "take_profit_target", "fundamental_alignment"],
              additionalProperties: false
            }
          },
          required: ["market_structure", "recommended_direction", "strategy_applied", "execution_parameters", "confidence_score", "institutional_rationale"],
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
4. If the thesis remains valid and supported by the new context, keep it valid.

You MUST respond strictly with a raw JSON object:
{
  "is_valid": boolean,
  "rejection_reason": "If invalid, concisely explain why the new context destroys the thesis. If valid, return null."
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
            is_valid: { type: "boolean" },
            rejection_reason: { type: ["string", "null"] }
          },
          required: ["is_valid", "rejection_reason"],
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
  const timeframe = searchParams.get("timeframe") ?? (isCron ? "4H" : "1D");
  const modelId = searchParams.get("model_id") ?? undefined;
  const modelVersion = searchParams.get("model_version") ?? undefined;
  const newsContext = searchParams.get("news") ?? undefined;
  const symbolsParam =
    searchParams.get("symbols") || Deno.env.get("RESEARCH_SYMBOLS") || "XAUUSD,XAGUSD,BTCUSD,UKOIL,EURUSD,GBPUSD,USDJPY,US30,NAS100";
  const symbols = symbolsParam.split(",").map((s) => s.trim()).filter(Boolean);

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
        
        let allEvents = null;
        if (!newsContext) {
          sendEvent({ type: 'progress', message: `[Macro Data] Fetching global economic calendar...` });
          allEvents = await fetchAllMacroEvents();
        }

        // ==========================================
        // PHASE 1: ACTIVE SIGNAL VALIDATION SWEEP
        // ==========================================
        console.log(`[Phase 1] Sweeping active APPROVED signals for revalidation...`);
        sendEvent({ type: 'progress', message: `[Phase 1] Validating active signals against live market conditions...` });
        
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
                console.log(`[Validation] EXPIRED ${signal.symbol}: 12h TTL expired.`);
                continue;
              }

              // 2. Fetch Live Snapshot
              const result = await fetchPaperBars(signal.symbol, signal.timeframe);
              const snapshot = getContextSnapshot(
                result.bars.map((b: any) => b.t),
                result.bars.map((b: any) => b.h),
                result.bars.map((b: any) => b.l),
                result.bars.map((b: any) => b.c)
              );

              // 3. Math Validation (Stop Loss Hit)
              const stopLoss = signal.stop_plan_json?.stop;
              if (stopLoss) {
                if ((signal.side === 'LONG' && snapshot.current_price <= stopLoss) || 
                    (signal.side === 'SHORT' && snapshot.current_price >= stopLoss)) {
                  await supabase.from("trade_opportunities").update({ status: "LOST", r_multiple: -1, ai_risks: "Technical Invalidation: Stop Loss crossed." }).eq("id", signal.id);
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
              
              if (!evalResult.is_valid) {
                await supabase.from("trade_opportunities").update({ status: "REJECTED", ai_risks: `Invalidated by AI Risk Officer: ${evalResult.rejection_reason}` }).eq("id", signal.id);
                console.log(`[Validation] REJECTED ${signal.symbol} by AI: ${evalResult.rejection_reason}`);
              } else {
                console.log(`[Validation] VALID ${signal.symbol}: Thesis remains intact.`);
              }
            } catch (err: any) {
               console.error(`[Validation Error] Failed to revalidate ${signal.symbol}:`, err.message);
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
              const result = await fetchPaperBars(symbol, timeframe);
              bars = result.bars;
              source = result.source;
            } catch (err: any) {
              console.error(`[Data Fetch Error] Failed to fetch data for ${symbol}: ${err.message}`);
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
            
            console.log(`\n[Info] [Data Fetch] Successfully fetched ${bars.length} bars from ${source} for ${symbol}.`);
            sendEvent({ type: 'progress', message: `[Data Fetch] Successfully acquired ${bars.length} data points from ${source}.` });

            // Store fetched bars in PTI database asynchronously
            // [TEMPORARILY DISABLED] This is causing WORKER_RESOURCE_LIMIT due to thousands of unawaited N+1 queries.
            // saveBars(supabase, symbol, timeframe, bars).catch(err => 
            //   console.error(`[Error] Failed to save bars for ${symbol}:`, err)
            // );

            // LAYER A: Deterministic Evaluation Guard
            sendEvent({ type: 'progress', message: `[Layer A: Deterministic Guard] Evaluating mathematical momentum and regime...` });
            
            // Fetch 1D Macro Trend & HTF Support/Resistance
            let htf_trend: 'BULLISH' | 'BEARISH' | 'CHOP' = 'CHOP';
            let htf_support: number[] = [];
            let htf_resistance: number[] = [];

            if (timeframe !== '1D') {
              try {
                const result = await fetchPaperBars(symbol, '1D');
                const dailySnapshot = getContextSnapshot(
                  result.bars.map((b: any) => b.t),
                  result.bars.map((b: any) => b.h),
                  result.bars.map((b: any) => b.l),
                  result.bars.map((b: any) => b.c)
                );
                if (dailySnapshot.trend_alignment.startsWith('BULLISH')) htf_trend = 'BULLISH';
                else if (dailySnapshot.trend_alignment.startsWith('BEARISH')) htf_trend = 'BEARISH';
                
                if (result.bars.length > 0) {
                  const lastBar = result.bars[result.bars.length - 1];
                  const pivots = calculatePivotPoints(lastBar.h, lastBar.l, lastBar.c);
                  htf_support = pivots.support;
                  htf_resistance = pivots.resistance;
                }
              } catch (e) {
                console.warn(`[Macro Fetch] Failed to fetch 1D trend for ${symbol}`);
              }
            }

            const rawSnapshot = getContextSnapshot(
              bars.map((b) => b.t),
              bars.map((b) => b.h),
              bars.map((b) => b.l),
              bars.map((b) => b.c)
            );
            rawSnapshot.htf_trend = htf_trend;
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

            const snapshot = {
              ...rawSnapshot,
              fundamental_context
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

            console.log(`[Strategy Eval] Market snapshot for ${symbol}: Trend=${snapshot.trend_alignment}, RSI=${snapshot.rsi_14.toFixed(2)}, CurrentPrice=${snapshot.current_price}`);
            
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
              defaultStaticPct = 0.015; // 1.5% max for short intraday
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