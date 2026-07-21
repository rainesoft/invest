import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient, SupabaseClient } from "npm:@supabase/supabase-js@2.108.2";
import { fetchPaperBars, Bar } from "../_shared/execution.ts";
import { sma, rsi, detectRegime } from "../_shared/strategy.ts";
import { insertAuditLog } from "../_shared/audit.ts";
import { isMarketOpen } from "../_shared/market.ts";
import { netEdge, transactionCost, slippage } from "../../../packages/strategy/index.ts";
import { getContextSnapshot, LogicContext } from "../../../packages/strategy/indicators.ts";
import { validateGlobalSignal } from "../../../packages/strategy/riskManager.ts";
import { fetchMacroEvents } from "../_shared/news.ts";
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
    "suggested_stop_loss": number | null,
    "suggested_take_profit": number | null
  },
  "confidence_score": number,
  "institutional_rationale": {
    "directional_bias": "Explain why the recommended direction is the path of least resistance based on EMAs and key levels.",
    "execution_trigger": "Specify the exact lower-timeframe price action required at the entry price to trigger the trade.",
    "invalidation_point": "Explain exactly why the stop loss is placed where it is structurally.",
    "take_profit_target": "Specify at least one concrete Take Profit price level and the projected Risk:Reward ratio (minimum 1:1.5).",
    "fundamental_alignment": "State how the technical setup aligns with or fights current macro drivers."
  }
}

[RISK EVALUATION RULES]
1. DYNAMIC STRATEGY SELECTION: Do not default to pullbacks. First, identify the market structure. If the asset is trending heavily (Price > 50 & 200 EMA), prioritize MOMENTUM_CONTINUATION setups using minor retracements. If the asset is trapped between major support and resistance, prioritize MEAN_REVERSION setups targeting the range boundaries.
2. THE 'EMPTY AIR' CHECK: Before suggesting a direction, evaluate the distance to the next major liquidity zone. If the current price is floating in 'empty air' midway between support and resistance with no clear edge, set \`recommended_direction\` to \`NONE\` and protect capital.
3. STOP LOSS & VOLATILITY (ATR): The snapshot provides \`safe_long_stop_loss\`, \`safe_short_stop_loss\`, and \`atr_14\`. 
   - Your \`suggested_stop_loss\` MUST exactly match the price point at which your setup is technically invalidated.
   - VOLATILITY CHECK: Your stop loss distance MUST be wide enough to survive the \`atr_14\` (Average True Range) but MUST NOT exceed 3x the \`atr_14\`. If the structural stop required is greater than 3x the ATR, the setup is mathematically untradeable. REJECT it by setting recommended_direction to NONE.
4. FUNDAMENTAL REALITY CHECK: You MUST heavily weigh the provided \`fundamental_context\`. If significant macro news opposes the technical setup, REJECT the setup immediately. If no major news exists, explicitly note that the market is driven by technicals, but NEVER say 'Without fundamental context'.
   - Do NOT invent generic macro platitudes (like 'geopolitical tensions' or 'inflation'). If you assess the macro environment, focus on the actual dominant drivers pushing the asset's current trend (e.g. hawkish Fed policy, strong DXY causing a massive drop).
   - If fundamental reality is BEARISH, REJECT any LONG setups. If BULLISH, REJECT any SHORT setups.
5. COUNTER-TREND MOMENTUM CHECK: 
   - Strict Technical Definitions: Price > 50 EMA and > 200 EMA = BULLISH momentum. Price < 50 EMA and < 200 EMA = BEARISH momentum. Do not contradict this.
   - Do not blindly buy assets that are crashing well below both the 50 EMA and 200 EMA just because RSI is low. REJECT long setups if the asset is in heavy bearish momentum unless price is within 0.1% to 0.25% of a major, higher-timeframe support level.
6. INSTITUTIONAL TONE: 
   - Never use apologetic, weak, or observational phrasing regarding missing data. If fundamental data is missing, do NOT claim there is a "lack of fundamental catalysts" (as macro is always active). Instead, dictate authoritatively: "Without fundamental context, this must be treated as a purely technical setup."
   - Write with bulletproof brevity. Do NOT repeat your rationale. Never state the moving average conditions (price above 50/200 EMA) or RSI targets multiple times in the same output. Combine your thoughts into a single, sharp thesis.
7. RSI DYNAMICS IN TRENDS: In a strong uptrend (Price > 50 EMA and > 200 EMA), the daily RSI rarely drops all the way to 30. A pullback to the 40-45 range is typically sufficient to reset momentum. Do NOT demand a drop to 30 if the asset is in heavy bullish momentum.
8. DIRECTIONAL MATH & SUPPORT VALIDATION: You MUST perform basic directional math. If Current Price < Support, the support has been BROKEN and is now Resistance. If Current Price > Resistance, it is now Support. Do not suggest a "pullback to support" if price has already broken below it. If structural support has failed, a pullback entry is invalid unless price fully reclaims the level.
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

/**
 * Research run generates simple trade opportunities for one or more symbols.
 *
 * Query parameters:
 * - `symbols`   Comma-separated stock symbols (default AAPL)
 * - `timeframe` 1D or 1H (default 1D)
 * - `model_id`  Optional model identifier (for audit)
 * - `model_version` Optional model version (for audit)
 */
serve((req) => {
  const { searchParams } = new URL(req.url);
  const isCron = req.method === "POST";
  const timeframe = searchParams.get("timeframe") ?? (isCron ? "4H" : "1D");
  const modelId = searchParams.get("model_id") ?? undefined;
  const modelVersion = searchParams.get("model_version") ?? undefined;
  const newsContext = searchParams.get("news") ?? undefined;
  const symbolsParam =
    searchParams.get("symbols") || Deno.env.get("RESEARCH_SYMBOLS") || "AAPL";
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

  const body = new ReadableStream({
    async start(controller) {
      function sendEvent(data: any) {
        try {
          controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(data)}\n\n`));
        } catch (e) {
          console.error("Stream closed", e);
        }
      }

      const results: any[] = [];
      const rejections: any[] = [];
      
      try {
        console.log(`[Research Run] Starting pipeline for symbols: ${symbols.join(", ")}`);
        sendEvent({ type: 'progress', message: `Starting analysis pipeline for: ${symbols.join(", ")}` });
        
        for (const symbol of symbols) {
          if (isCron && !isMarketOpen(symbol)) {
            console.log(`[Market Hours] Skipping ${symbol}: Market is closed.`);
            sendEvent({ type: 'progress', message: `[Market Hours] Skipping ${symbol}: Market is closed.` });
            continue;
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
              continue;
            }
            
            console.log(`\n[Info] [Data Fetch] Successfully fetched ${bars.length} bars from ${source} for ${symbol}.`);
            sendEvent({ type: 'progress', message: `[Data Fetch] Successfully acquired ${bars.length} data points from ${source}.` });

            // Store fetched bars in PTI database asynchronously
            saveBars(supabase, symbol, timeframe, bars).catch(err => 
              console.error(`[Error] Failed to save bars for ${symbol}:`, err)
            );

            // LAYER A: Deterministic Evaluation Guard
            sendEvent({ type: 'progress', message: `[Layer A: Deterministic Guard] Evaluating mathematical momentum and regime...` });
            const rawSnapshot = getContextSnapshot(
              bars.map((b) => b.t),
              bars.map((b) => b.h),
              bars.map((b) => b.l),
              bars.map((b) => b.c)
            );
            
            // Inject macro context if provided via URL params
            let fundamental_context = newsContext;
            if (!fundamental_context) {
              sendEvent({ type: 'progress', message: `[Macro Data] Fetching economic calendar catalysts for ${symbol}...` });
              fundamental_context = await fetchMacroEvents(symbol);
            }

            const snapshot = {
              ...rawSnapshot,
              fundamental_context
            };

            console.log(`[Strategy Eval] Market snapshot for ${symbol}: Trend=${snapshot.trend_alignment}, RSI=${snapshot.rsi_14.toFixed(2)}, CurrentPrice=${snapshot.current_price}`);
            
            // LAYER A: Deterministic Guard
            if (snapshot.trend_alignment === 'CHOP') {
              console.log(`[Layer A: Deterministic Guard] REJECTED ${symbol}: Market is in CHOP regime. No clear trend.`);
              sendEvent({ type: 'progress', message: `[Layer A: Deterministic Guard] REJECTED ${symbol}: Market is in CHOP regime.` });
              await insertAuditLog(supabase, {
                actor_type: "SYSTEM",
                action: "RESEARCH_HALTED",
                entity_type: "research",
                payload_json: { symbol, reason: "CHOP_REGIME", context: snapshot },
              });
              rejections.push({
                symbol,
                reason: "Deterministic Guard: Market is in CHOP regime. No clear trend.",
                layer: "A"
              });
              continue;
            }

            // --- AI MEMORY CALIBRATION ---
            console.log(`[Data Fetch] Querying historical ledger for ${symbol}...`);
            sendEvent({ type: 'progress', message: `[AI Memory] Pulling last 5 trades to calibrate bias for ${symbol}...` });
            const { data: pastTrades } = await supabase
              .from("trade_opportunities")
              .select("status, side, ai_summary, r_multiple")
              .eq("symbol", symbol)
              .in("status", ["WON", "LOST", "REJECTED"])
              .order("created_at", { ascending: false })
              .limit(5);

            let historicalMemory = "";
            if (pastTrades && pastTrades.length > 0) {
              historicalMemory = pastTrades.map((t, i) => 
                `Past Decision ${i+1} (${t.side} -> ${t.status}, ${t.r_multiple !== null ? t.r_multiple + 'R' : 'N/A'}): "${t.ai_summary || 'No rationale logged'}"`
              ).join("\n");
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
              continue;
            }

            let is_valid = evaluation.recommended_direction !== "NONE";
            
            let dbSide = evaluation.recommended_direction === "NONE" 
              ? (snapshot.trend_alignment.startsWith('BULLISH') ? 'LONG' : 'SHORT') 
              : evaluation.recommended_direction;
            
            let entry_price = evaluation.execution_parameters?.suggested_entry_price || snapshot.current_price;
            let stop_loss = evaluation.execution_parameters?.suggested_stop_loss || (dbSide === "LONG" ? snapshot.safe_long_stop_loss : snapshot.safe_short_stop_loss);
            const confidence_score = evaluation.confidence_score || 50;
            
            const rationaleObj = evaluation.institutional_rationale || {};
            let institutional_rationale = [
              `[${evaluation.market_structure} -> ${evaluation.strategy_applied}]`,
              rationaleObj.directional_bias,
              rationaleObj.execution_trigger,
              rationaleObj.invalidation_point,
              rationaleObj.take_profit_target,
              rationaleObj.fundamental_alignment
            ].filter(Boolean).join(" ");

            console.log(`[Layer B: Cognitive Guard] AI Response for ${symbol}: Valid Setup = ${is_valid}, Direction = ${evaluation.recommended_direction}`);
            console.log(`[Layer B] AI Rationale: ${institutional_rationale}`);

            if (!is_valid) {
              console.log(`[Layer B: Cognitive Guard] REJECTED ${symbol} by AI Risk Officer (No Edge / Empty Air).`);
              sendEvent({ type: 'progress', message: `[Layer B: AI Risk Officer] REJECTED ${symbol} based on institutional logic (No Edge).` });
              await insertAuditLog(supabase, {
                actor_type: "SYSTEM",
                action: "REJECTED_BY_AI",
                entity_type: "research",
                payload_json: { symbol, reason: institutional_rationale, context: snapshot },
              });
              rejections.push({
                symbol,
                reason: institutional_rationale,
                layer: "Cognitive AI"
              });
              await supabase.from("trade_opportunities").insert({
                symbol,
                side: dbSide,
                timeframe: timeframe.toLowerCase(),
                status: "REJECTED",
                ai_summary: institutional_rationale,
                ai_risks: "Rejected by AI Risk Officer",
                model_id: modelId,
                model_version: modelVersion,
                risk_summary: `RSI ${snapshot.rsi_14}`
              });
              continue;
            }

            console.log(`[Layer B: Cognitive Guard] APPROVED ${symbol} by AI Risk Officer.`);
            sendEvent({ type: 'progress', message: `[Layer B: Cognitive Guard] APPROVED by AI Risk Officer.` });

            // LAYER C: Deterministic Risk/Reward Math (Force exactly 1:2 R:R)
            const risk = Math.abs(entry_price - stop_loss);
            const take_profit = dbSide === 'LONG' ? entry_price + (risk * 2) : entry_price - (risk * 2);

            // AI is now a pure signal generator. We don't calculate user-specific volume or riskAmount here.
            
            // LAYER C: Risk Manager (Global Asset Isolation)
            sendEvent({ type: 'progress', message: `[Layer C: Risk Manager] Validating global signal constraints...` });
            const riskValidation = await validateGlobalSignal(supabase, symbol);
            const rrRatio = 2.0; // Mathematically forced above
            const expectedReturnPct = Math.abs(take_profit - entry_price) / entry_price;
            
            const stopLossPercentage = risk / entry_price;
            let maxAllowedRiskPct = 0.05; // 5% default for macro
            if (timeframe.toLowerCase().includes("min") || timeframe === "1H") {
              maxAllowedRiskPct = 0.015; // 1.5% max for short intraday
            } else if (timeframe === "4H") {
              maxAllowedRiskPct = 0.03; // 3% max for 4H swing
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
              continue;
            }

            if (!riskValidation.valid) {
              console.log(`[Layer C: Risk Manager] REJECTED ${symbol}: ${riskValidation.reason}`);
              sendEvent({ type: 'progress', message: `[Layer C: Risk Manager] REJECTED ${symbol}: Exposure constraints violated.` });
              await insertAuditLog(supabase, {
                actor_type: "SYSTEM",
                action: "REJECTED_BY_RISK",
                entity_type: "research",
                payload_json: { symbol, reason: riskValidation.reason, context: snapshot },
              });

              // Trade is rejected by Risk Manager, we only keep it in the audit log.
              rejections.push({
                symbol,
                reason: riskValidation.reason,
                rationale: institutional_rationale,
                layer: "Risk Manager"
              });
              await supabase.from("trade_opportunities").insert({
                symbol,
                side: dbSide,
                timeframe: timeframe.toLowerCase(),
                status: "REJECTED",
                ai_summary: institutional_rationale,
                ai_risks: riskValidation.reason,
                model_id: modelId,
                model_version: modelVersion,
                risk_summary: `RSI ${snapshot.rsi_14}`
              });
              continue;
            }

            console.log(`[Layer C: Execution Desk] APPROVED ${symbol}: Generating pending opportunity...`);
            sendEvent({ type: 'progress', message: `[Execution] Creating opportunity for ${symbol}...` });
            const { data, error } = await supabase
              .from("trade_opportunities")
              .insert({
                symbol,
                side: dbSide,
                timeframe: timeframe.toLowerCase(),
                status: "PENDING_APPROVAL",
                entry_plan_json: {
                  price: entry_price,
                },
                stop_plan_json: { stop: stop_loss },
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
              
              let order_type = dbSide === 'LONG' ? 'BUY MARKET' : 'SELL MARKET';
              if (Math.abs(entry_price - snapshot.current_price) / snapshot.current_price > 0.0005) {
                  if (dbSide === 'LONG') {
                      order_type = entry_price < snapshot.current_price ? 'BUY LIMIT' : 'BUY STOP';
                  } else {
                      order_type = entry_price > snapshot.current_price ? 'SELL LIMIT' : 'SELL STOP';
                  }
              }

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
                action: "OPPORTUNITY_CREATED",
                entity_type: "trade_opportunity",
                entity_id: data.id,
                payload_json: { symbol, timeframe, model_id: modelId, model_version: modelVersion },
              });
            } else if (error) {
              console.error(`[Database Error] Failed to insert opportunity for ${symbol}: ${error.message}`);
              sendEvent({ type: 'progress', message: `[Database Error] ${error.message}` });
            }
          } catch (globalErr: any) {
            console.error(`[Global Error] Unexpected error processing ${symbol}: ${globalErr.message}`);
            sendEvent({ type: 'progress', message: `[System Error] ${globalErr.message}` });
            rejections.push({
              symbol,
              reason: `System Error: ${globalErr.message}`,
              layer: "System"
            });
            continue;
          }
        }

        sendEvent({ type: 'complete', opportunities: results, rejections });
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