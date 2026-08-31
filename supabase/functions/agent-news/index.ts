import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2.108.2";

/**
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║           MACRO SCOUT — Event-Driven News Trader                         ║
 * ║  Scheduled via pg_cron.                                                ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 *
 * Polls the free Forex Factory JSON feed for high-impact economic events.
 * Uses hardcoded numeric execution logic (Actual vs Forecast) to eliminate 
 * LLM latency and execute trades within milliseconds of data dropping.
 */

const SUPABASE_URL             = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const META_TOKEN               = Deno.env.get("META_API_TOKEN") ?? "";
const META_ACCOUNT             = Deno.env.get("META_API_ACCOUNT_ID") ?? "";
const REGION                   = Deno.env.get("METAAPI_REGION") ?? "new-york";
const WEBHOOK_SECRET           = Deno.env.get("WEBHOOK_SECRET") ?? "";
const TG_TOKEN                 = Deno.env.get("TELEGRAM_BOT_TOKEN") ?? "";
const TG_CHAT                  = Deno.env.get("TELEGRAM_CHAT_ID") ?? "";
const RISK_USD                 = parseFloat(Deno.env.get("SCOUT_RISK_USD") ?? "500");
const DRY_RUN                  = Deno.env.get("SCOUT_DRY_RUN") === "true";
const OPENAI_API_KEY           = Deno.env.get("OPENAI_API_KEY") ?? "";
const TAVILY_API_KEY           = Deno.env.get("TAVILY_API_KEY") ?? "";

async function pingHFTDirector(supabase: any, symbol: string, bias: string) {
  try {
    const { data: riskSettings } = await supabase
      .from("user_risk_settings")
      .select("hft_bias")
      .eq("user_id", "912d249b-9be8-4691-a11b-5b00f386a804")
      .single();

    let currentBiasMap: Record<string, string> = {};
    if (riskSettings && typeof riskSettings.hft_bias === "object" && riskSettings.hft_bias !== null) {
      currentBiasMap = { ...(riskSettings.hft_bias as Record<string, string>) };
    }
    currentBiasMap[symbol] = bias;

    await supabase
      .from("user_risk_settings")
      .update({ hft_bias: currentBiasMap })
      .neq("user_id", "00000000-0000-0000-0000-000000000000");

    console.log(`[Hive Mind] Synchronized ${symbol} HFT bias to ${bias}`);
  } catch (e) {
    console.error(`[Hive Mind] Failed to synchronize HFT bias for ${symbol}:`, e);
  }
}

async function pingAgentSwing(symbol: string) {
  try {
    const webhookUrl = (SUPABASE_URL || "").replace(/\/$/, "") + "/functions/v1/agent-swing";
    await fetch(webhookUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`
      },
      body: JSON.stringify({ symbols: [symbol] })
    });
    console.log(`[Hive Mind] Woke up agent-swing for real-time analysis of ${symbol}`);
  } catch (e) {
    console.error(`[Hive Mind] Failed to wake up agent-swing for ${symbol}:`, e);
  }
}

// ── MACRO RULES ──────────────────────────────────────────────────────────────
// Define exactly which events to trade, and how much deviation from the forecast
// is required to trigger a trade.
// e.g. If Non-Farm Payrolls drops and it's 50K higher than forecast, buy USDJPY.
const MACRO_RULES = [
  {
    id: "USD_NFP",
    titlePattern: /Non-Farm Employment Change/i,
    country: "USD",
    impact: "High",
    triggerThreshold: 50, // Needs to beat forecast by 50K
    onBeat: { symbol: "USDJPY", side: "BUY", slDistance: 0.300 }, // Better than expected -> USD Strong
    onMiss: { symbol: "USDJPY", side: "SELL", slDistance: 0.300 } // Worse than expected -> USD Weak
  },
  {
    id: "USD_CPI",
    titlePattern: /CPI y\/y/i,
    country: "USD",
    impact: "High",
    triggerThreshold: 0.2, // Needs to beat forecast by 0.2%
    onBeat: { symbol: "USDJPY", side: "BUY", slDistance: 0.300 },
    onMiss: { symbol: "USDJPY", side: "SELL", slDistance: 0.300 }
  },
  {
    id: "USD_FED_RATE",
    titlePattern: /Federal Funds Rate/i,
    country: "USD",
    impact: "High",
    triggerThreshold: 0.25, // Typically 25bps (0.25%) hikes/cuts
    onBeat: { symbol: "USDJPY", side: "BUY", slDistance: 0.300 }, // Higher rate -> USD Strong
    onMiss: { symbol: "USDJPY", side: "SELL", slDistance: 0.300 } // Lower rate -> USD Weak
  },
  {
    id: "EUR_ECB_RATE",
    titlePattern: /Main Refinancing Rate/i,
    country: "EUR",
    impact: "High",
    triggerThreshold: 0.25,
    onBeat: { symbol: "EURUSD", side: "BUY", slDistance: 0.003 }, // Higher rate -> EUR Strong
    onMiss: { symbol: "EURUSD", side: "SELL", slDistance: 0.003 } // Lower rate -> EUR Weak
  },
  {
    id: "GBP_BOE_RATE",
    titlePattern: /Official Bank Rate/i,
    country: "GBP",
    impact: "High",
    triggerThreshold: 0.25,
    onBeat: { symbol: "GBPUSD", side: "BUY", slDistance: 0.003 }, // Higher rate -> GBP Strong
    onMiss: { symbol: "GBPUSD", side: "SELL", slDistance: 0.003 } // Lower rate -> GBP Weak
  },
  {
    id: "USD_RETAIL_SALES",
    titlePattern: /Retail Sales m\/m/i,
    country: "USD",
    impact: "High",
    triggerThreshold: 0.4, // 0.4% deviation
    onBeat: { symbol: "USDJPY", side: "BUY", slDistance: 0.300 },
    onMiss: { symbol: "USDJPY", side: "SELL", slDistance: 0.300 }
  },
  {
    id: "USD_GDP",
    titlePattern: /Advance GDP q\/q/i,
    country: "USD",
    impact: "High",
    triggerThreshold: 0.3, // 0.3% deviation
    onBeat: { symbol: "USDJPY", side: "BUY", slDistance: 0.300 },
    onMiss: { symbol: "USDJPY", side: "SELL", slDistance: 0.300 }
  },
  {
    id: "USD_UNEMPLOYMENT_CLAIMS",
    titlePattern: /Unemployment Claims/i,
    country: "USD",
    impact: "High",
    triggerThreshold: 15, // 15K deviation
    // Note: Unemployment claims are inverted. Numerically higher = economically worse.
    onBeat: { symbol: "USDJPY", side: "SELL", slDistance: 0.300 }, // Higher claims -> USD Weak
    onMiss: { symbol: "USDJPY", side: "BUY", slDistance: 0.300 }   // Lower claims -> USD Strong
  }
];

// ── UTILITIES ─────────────────────────────────────────────────────────────────

// Converts strings like "28.3K", "1.2%", "18.2B" into floats
function parseNumericString(val: string): number | null {
  if (!val) return null;
  const numStr = val.replace(/[^0-9.-]/g, "");
  const num = parseFloat(numStr);
  if (isNaN(num)) return null;

  if (val.includes("K")) return num * 1000;
  if (val.includes("M")) return num * 1000000;
  if (val.includes("B")) return num * 1000000000;
  return num; // % and regular numbers
}

async function notify(text: string) {
  if (!TG_TOKEN || !TG_CHAT) return;
  const url = `https://api.telegram.org/bot${TG_TOKEN}/sendMessage`;
  await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: TG_CHAT, text, parse_mode: "HTML" }),
  }).catch(() => {});
}

async function mtPost(path: string, body: any) {
  const url = `https://mt-client-api-v1.${REGION}.agiliumtrade.ai/users/current/accounts/${META_ACCOUNT}${path}`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "auth-token": META_TOKEN,
      "Content-Type": "application/json",
      "Accept": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`MetaAPI POST Error [${res.status}]: ${text}`);
  }
  return res.json();
}

async function mtGet(path: string) {
  const url = `https://mt-client-api-v1.${REGION}.agiliumtrade.ai/users/current/accounts/${META_ACCOUNT}${path}`;
  const res = await fetch(url, {
    headers: {
      "auth-token": META_TOKEN,
      "Accept": "application/json",
    },
  });
  if (!res.ok) throw new Error(`MetaAPI GET Error [${res.status}]`);
  return res.json();
}

function calcLots(symbol: string, entryPx: number, slPx: number): number {
  const slDistance = Math.abs(entryPx - slPx);

  const minVolumes: Record<string, number> = {
    US30: 0.1, NAS100: 0.1, SPX500: 0.1, GER30: 0.1,
    BTCUSD: 0.01, UKOIL: 0.01, XAUUSD: 0.01, XAGUSD: 0.01
  };
  const volumeStep = minVolumes[symbol] || 0.01;

  if (slDistance === 0) return volumeStep;
  
  let pointValue = 1; // Default
  if (symbol.includes("JPY")) {
    pointValue = 1000 / entryPx; // standard lot 100k JPY converted to USD
  } else if (symbol.includes("USD") && symbol.length === 6) {
    pointValue = 100000; // standard lot 100k
  } else if (symbol.length === 6) {
    pointValue = 100000; // standard cross-pair lot 100k
  }

  const riskPerLot = slDistance * pointValue;
  if (riskPerLot <= 0) return volumeStep;
  const rawLots = RISK_USD / riskPerLot;
  return Math.max(volumeStep, Math.min(100.0, Math.floor(rawLots / volumeStep) * volumeStep));
}

async function verifyWithTavily(query: string): Promise<string | null> {
  if (!TAVILY_API_KEY) return null;
  try {
    const res = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: TAVILY_API_KEY,
        query: `Context and latest updates on: ${query}`,
        search_depth: "advanced",
        include_answer: true,
        days: 3
      })
    });
    if (!res.ok) return null;
    const data = await res.json();
    let context = data.answer || "";
    if (data.results && data.results.length > 0) {
      context += "\n\nSources Context:\n" + data.results.slice(0, 3).map((r: any) => `- ${r.title}: ${r.content}`).join("\n");
    }
    return context;
  } catch (err) {
    console.error("[Macro Scout] Tavily Fetch Error:", err);
    return null;
  }
}

// ── MAIN HANDLER ──────────────────────────────────────────────────────────────
serve(async (req) => {
  const secret = req.headers.get("x-webhook-secret");
  const authHeader = req.headers.get("Authorization") || req.headers.get("authorization");
  const cronSecretHeader = req.headers.get("x-cron-secret");
  const cronSecretEnv = Deno.env.get("CRON_SECRET");

  const isCronAuthorized = cronSecretHeader && cronSecretEnv && cronSecretHeader === cronSecretEnv;
  const isBearerAuthorized = authHeader === `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`;
  const isWebhookAuthorized = WEBHOOK_SECRET && secret === WEBHOOK_SECRET;

  if (!isCronAuthorized && !isBearerAuthorized && !isWebhookAuthorized) {
    return new Response(JSON.stringify({ ok: false, error: "Unauthorized" }), { status: 401 });
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const traceId = crypto.randomUUID();
  console.log(`[Macro Scout] [Trace: ${traceId}] Poll started — ${new Date().toISOString()}`);

  try {
    // Log heartbeat for System Health Checklist
    await supabase.from("audit_log").insert({
      action: "RESEARCH_RUN",
      actor_type: "SYSTEM",
      payload_json: { agent: "agent-news", symbol: "MACRO" }
    });

    // 1. Fetch Forex Factory JSON
    const ffResponse = await fetch("https://nfs.faireconomy.media/ff_calendar_thisweek.json");
    if (!ffResponse.ok) throw new Error("Failed to fetch Forex Factory calendar");
    const events = await ffResponse.json();

    // 1b. Write to Macro Oracle (System Settings)
    await supabase.from("system_settings").upsert({
      key: "macro_oracle_context",
      value: events,
      updated_at: new Date().toISOString()
    });

    const now = new Date();
    const results = [];

    const speechEventsToScrape: string[] = [];
    // 2. Scan events
    for (const event of events) {
      const eventTime = new Date(event.date);
      const diffMinutes = (now.getTime() - eventTime.getTime()) / 60000;

      // Central Bank Speech Tracker: If a high-impact speech fired within the last 90 mins or is scheduled within 30 mins
      if (event.impact === "High" && (/Speaks/i.test(event.title) || /Speech/i.test(event.title) || /Testimony/i.test(event.title) || /Press Conference/i.test(event.title))) {
        if (diffMinutes >= -30 && diffMinutes <= 90) {
          speechEventsToScrape.push(`${event.country} ${event.title}`);
        }
      }
      
      // Skip future events or events older than 15 mins for numeric rules
      if (diffMinutes < 0 || diffMinutes > 15) continue;
      
      // Needs to have 'actual' published for numeric deviation rules
      if (!event.actual) continue;

      // Check against our rules
      for (const rule of MACRO_RULES) {
        if (rule.country === event.country && rule.impact === event.impact && rule.titlePattern.test(event.title)) {
          
          const actualVal = parseNumericString(event.actual);
          const forecastVal = parseNumericString(event.forecast);
          
          if (actualVal === null || forecastVal === null) continue;

          // Check if we already processed this event today
          const eventIdentifier = `[MACRO:${rule.id}_${eventTime.toISOString().split('T')[0]}]`;
          const { count } = await supabase
            .from("trade_opportunities")
            .select("id", { count: "exact", head: true })
            .like("risk_summary", `${eventIdentifier}%`);
            
          if ((count ?? 0) > 0) {
            console.log(`[Macro Scout] [Trace: ${traceId}] Already processed ${eventIdentifier}`);
            continue;
          }

          const deviation = actualVal - forecastVal;
          let action = null;
          let summaryText = "";

          // Did it beat or miss?
          if (deviation >= rule.triggerThreshold) {
            action = rule.onBeat;
            summaryText = `Beat forecast by ${deviation.toFixed(2)}`;
          } else if (deviation <= -rule.triggerThreshold) {
            action = rule.onMiss;
            summaryText = `Missed forecast by ${deviation.toFixed(2)}`;
          }

          if (action) {
            console.log(`[Macro Scout] [Trace: ${traceId}] TRIGGERED ${rule.id}: ${event.title} (${summaryText})`);
            
            // Get live price to execute
            const priceData = await mtGet(`/symbols/${action.symbol}/current-price`);
            const entryPx = action.side === "BUY" ? priceData.ask : priceData.bid;
            const slPx = action.side === "BUY" ? entryPx - action.slDistance : entryPx + action.slDistance;
            
            const volume = calcLots(action.symbol, entryPx, slPx);

            const opportunityData = {
              symbol: action.symbol,
              side: action.side,
              status: "APPROVED", // Route to agent-trade execution engine
              source_agent: "agent-news",
              timeframe: "M1",
              entry_plan_json: { price: entryPx, order_type: action.side === "BUY" ? "Market" : "Market" },
              stop_plan_json: { stop: slPx, stop_price: slPx, initial: slPx },
              // Dummy take profit; agent-trade Quick Exit logic will override this to 1.0R
              take_profit_json: { tp: action.side === "BUY" ? entryPx + action.slDistance : entryPx - action.slDistance },
              ai_summary: `[S-Tier] [MACRO] Fast-Execution: ${event.title}. Actual: ${event.actual}, Forecast: ${event.forecast}. ${summaryText}.`,
              risk_summary: `${eventIdentifier} Automated news trade execution.`,
              created_at: new Date().toISOString(),
              trace_id: traceId
            };

            const { data: opp, error: oppError } = await supabase
              .from("trade_opportunities")
              .insert(opportunityData)
              .select("id")
              .single();

            if (oppError) {
               console.error(`[Macro Scout] [Trace: ${traceId}] Opportunity Insert Error:`, oppError);
               continue;
            }

            // Hive Mind: Instantly align the HFT Director with the news catalyst
            const hftBias = action.side === "BUY" ? "LONG" : "SHORT";
            await pingHFTDirector(supabase, action.symbol, hftBias);

            // Write Volatility Lockout flag to prevent other agents from trading in chaos
            await supabase.from("market_context").insert({
              symbol: "GLOBAL",
              agent_persona: "MACRO_SCOUT",
              timeframe: "M1",
              macro_bias: "VOLATILITY_LOCKOUT",
              narrative: `High impact news event fired: ${event.title}`,
              expires_at: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(), // 2 hours
              trace_id: traceId
            });

            if (!DRY_RUN) {
              await notify(
                `⚡ <b>MACRO EVENT TRIGGERED</b>\n` +
                `<b>${event.title}</b>\n` +
                `Forecast: ${event.forecast} | Actual: ${event.actual}\n\n` +
                `Signal: <b>${action.side} ${action.symbol}</b>\n` +
                `<i>Queued for PAMM Execution Engine...</i>`
              );
              
              results.push({ rule: rule.id, action: action.side, symbol: action.symbol });
            } else {
              console.log(`[Macro Scout] [Trace: ${traceId}] DRY RUN: Would queue execution for`, action);
              results.push({ rule: rule.id, action: action.side, symbol: action.symbol, dry_run: true });
            }
          }
        }
      }
    }



    let debugInfo: any = {};
    // === SENTIMENT SCOUT ===
    if (OPENAI_API_KEY) {
      try {
        let headlinesToProcess: string[] = [];

        // 1. Proactive Tavily Macro, Central Bank & Commodity Queries
        if (TAVILY_API_KEY) {
          const tavilyQueries = [
            "Federal Reserve Fed Chair speakers comments inflation interest rates USD breaking",
            "Gold XAUUSD price reaction Treasury yields US dollar breaking",
            "BOJ Bank of Japan interest rate policy yen JPY intervention breaking",
            "ECB European Central Bank interest rate monetary policy EUR breaking",
            "Crude oil Brent WTI OPEC geopolitical supply disruption breaking",
            "BTCUSD crypto breaking news market sentiment"
          ];

          const allTavilyQueries = [
            ...tavilyQueries,
            ...speechEventsToScrape.map(s => `${s} statements remarks key quotes market reaction live breaking`)
          ];

          for (const query of allTavilyQueries) {
            try {
              console.log(`[Macro Scout] [Trace: ${traceId}] Proactively querying Tavily: "${query}"...`);
              const tavilyRes = await fetch("https://api.tavily.com/search", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  api_key: TAVILY_API_KEY,
                  query,
                  search_depth: "basic",
                  days: 1
                })
              });
              if (tavilyRes.ok) {
                const tavilyData = await tavilyRes.json();
                if (tavilyData.results && tavilyData.results.length > 0) {
                  for (let i = 0; i < Math.min(2, tavilyData.results.length); i++) {
                    if (tavilyData.results[i].title) {
                      headlinesToProcess.push(tavilyData.results[i].title);
                    }
                  }
                }
              }
            } catch (tErr: any) {
              console.warn(`[Macro Scout] Tavily Query Error for "${query}":`, tErr.message);
            }
          }
        }

        // 2. Fallback / Complementary Multi-Source RSS Feeds
        const rssFeeds = [
          "https://cointelegraph.com/rss",
          "https://www.forexlive.com/feed/news",
          "https://feeds.content.dowjones.io/public/rss/mw_topstories"
        ];

        for (const feedUrl of rssFeeds) {
          try {
            const rssRes = await fetch(feedUrl);
            if (rssRes.ok) {
              const xml = await rssRes.text();
              const items = xml.match(/<item>[\s\S]*?<\/item>/g) || [];
              for (let i = 0; i < Math.min(3, items.length); i++) {
                const titleMatch = items[i].match(/<title>(.*?)<\/title>/);
                if (titleMatch) {
                  const cleanedTitle = titleMatch[1].replace("<![CDATA[", "").replace("]]>", "").trim();
                  if (cleanedTitle && !headlinesToProcess.includes(cleanedTitle)) {
                    headlinesToProcess.push(cleanedTitle);
                  }
                }
              }
            }
          } catch (rssErr: any) {
            console.warn(`[Macro Scout] RSS Fetch Error for ${feedUrl}:`, rssErr.message);
          }
        }
        
        // Fetch processed news cache from system_settings to prevent table pollution
        const { data: cacheRow } = await supabase
          .from("system_settings")
          .select("value")
          .eq("key", "macro_scout_processed_news")
          .maybeSingle();

        let processedHeadlines: string[] = Array.isArray(cacheRow?.value) ? cacheRow.value : [];
        const processedSet = new Set(processedHeadlines);

        debugInfo.headlines = headlinesToProcess;
        for (const title of headlinesToProcess) {
          const headlineIdentifier = `[SENTIMENT] ${title}`;
          
          // Check if already processed via cache
          if (processedSet.has(headlineIdentifier)) continue;
          
          console.log(`[Macro Scout] [Trace: ${traceId}] Evaluating Sentiment: ${title}`);
          
          const prompt = `You are a high-frequency quantitative macro and sentiment API. 
Analyze this news headline and return ONLY a JSON object.
Format: { 
  "sentiment": "BULLISH" | "BEARISH" | "NEUTRAL", 
  "confidence": 0-100, 
  "symbol": "EURJPY" | "EURUSD" | "GBPUSD" | "USDJPY" | "AUDUSD" | "NZDUSD" | "AUDJPY" | "CADJPY" | "EURGBP" | "BTCUSD" | "XAUUSD" | "XAGUSD" | "UKOIL" | "USOIL" | "US30" | "NAS100" | "NONE", 
  "requires_verification": boolean 
}
CRITICAL RULES:
- If news indicates Hawkish Fed commentary, sticky inflation, higher Treasury yields, or USD strength: Map symbol to "XAUUSD" with BEARISH sentiment (Gold falls on high yields/strong dollar) or "USDJPY" with BULLISH sentiment (USD rises vs JPY) with Confidence >= 85.
- If news indicates Dovish Fed commentary, cooling inflation, rate cut acceleration, or USD weakness: Map symbol to "XAUUSD" with BULLISH sentiment (Gold rises on rate cuts) or "USDJPY" with BEARISH sentiment (USD falls vs JPY) with Confidence >= 85.
- If news indicates BOJ rate hike or JPY intervention/strength, map symbol to "EURJPY" or "USDJPY" with BEARISH sentiment.
- If news indicates ECB rate cuts or Euro weakness, map symbol to "EURUSD" or "EURJPY" with BEARISH sentiment.
- If news indicates Middle East / geopolitical escalation or crude oil supply disruption, map symbol to "UKOIL" or "USOIL" with BULLISH sentiment.
- If the news is ambiguous, a rumor, or confidence is below 85, set requires_verification to true.
- If the headline is a generic homepage index title (e.g. "Bitcoin News Today", "Latest Updates", "Live News"), you MUST set sentiment to NEUTRAL, confidence to 0, and symbol to NONE. Only process specific, actionable macroeconomic catalysts.
Headline: "${title}"`;

          const aiRes = await fetch("https://api.openai.com/v1/chat/completions", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Authorization": `Bearer ${OPENAI_API_KEY}`
            },
            body: JSON.stringify({
              model: "gpt-4o-mini",
              messages: [{ role: "user", content: prompt }],
              temperature: 0.0
            })
          });

          const aiData = await aiRes.json();
          debugInfo.ai_errors = debugInfo.ai_errors || [];
          if (!aiData.choices || !aiData.choices[0]) {
             console.error(`[Macro Scout] [Trace: ${traceId}] Invalid OpenAI response:`, aiData);
             debugInfo.ai_errors.push(aiData);
             continue;
          }

          let resultText = aiData.choices[0].message.content.trim();
          if (resultText.startsWith("```json")) {
             resultText = resultText.replace(/^```json\n?/, "").replace(/\n?```$/, "").trim();
          }
          const parsed = JSON.parse(resultText);

          // Mark headline as processed in cache
          processedSet.add(headlineIdentifier);
          processedHeadlines = [headlineIdentifier, ...processedHeadlines.filter(h => h !== headlineIdentifier)].slice(0, 300);
          await supabase.from("system_settings").upsert({
            key: "macro_scout_processed_news",
            value: processedHeadlines,
            updated_at: new Date().toISOString()
          });

          let finalParsed = parsed;
          let verifiedContext = "Tier 1 Instant";

          // TIER 2: TAVILY VERIFICATION
          if (finalParsed.requires_verification && TAVILY_API_KEY) {
             console.log(`[Macro Scout] [Trace: ${traceId}] Tier 2 Verification Triggered for: ${title}`);
             const tavilyContext = await verifyWithTavily(title);
             
             if (tavilyContext) {
               const verifyPrompt = `You are a high-frequency quantitative macro and sentiment API.
Original Headline: "${title}"
Web Search Context:
${tavilyContext}

Based on this additional context, provide a final evaluation. Return ONLY a JSON object.
Format: { 
  "sentiment": "BULLISH" | "BEARISH" | "NEUTRAL", 
  "confidence": 0-100, 
  "symbol": "EURJPY" | "EURUSD" | "GBPUSD" | "USDJPY" | "AUDUSD" | "NZDUSD" | "AUDJPY" | "CADJPY" | "EURGBP" | "BTCUSD" | "XAUUSD" | "XAGUSD" | "UKOIL" | "USOIL" | "US30" | "NAS100" | "NONE" 
}
CRITICAL RULES:
- If news indicates Hawkish Fed commentary, sticky inflation, higher yields, or USD strength: Map symbol to "XAUUSD" with BEARISH sentiment (Gold falls) or "USDJPY" with BULLISH sentiment (USD rises).
- If news indicates Dovish Fed commentary, cooling inflation, or USD weakness: Map symbol to "XAUUSD" with BULLISH sentiment (Gold rises) or "USDJPY" with BEARISH sentiment (USD falls).
- If the headline and context refer to a generic homepage index without a specific underlying catalyst, set sentiment to NEUTRAL, confidence to 0, and symbol to NONE.`;

               const verifyRes = await fetch("https://api.openai.com/v1/chat/completions", {
                  method: "POST",
                  headers: {
                    "Content-Type": "application/json",
                    "Authorization": `Bearer ${OPENAI_API_KEY}`
                  },
                  body: JSON.stringify({
                    model: "gpt-4o-mini",
                    messages: [{ role: "user", content: verifyPrompt }],
                    temperature: 0.0
                  })
               });
               const verifyData = await verifyRes.json();
               if (verifyData.choices && verifyData.choices[0]) {
                  let vt = verifyData.choices[0].message.content.trim();
                  if (vt.startsWith("```json")) {
                     vt = vt.replace(/^```json\n?/, "").replace(/\n?```$/, "").trim();
                  }
                  finalParsed = JSON.parse(vt);
                  verifiedContext = `Tavily Verified: ${finalParsed.sentiment} (${finalParsed.confidence}%)`;
                  console.log(`[Macro Scout] [Trace: ${traceId}] Tavily Verification Complete:`, finalParsed);
               }
             }
          }

          // Execute & Publish ONLY if threshold met across valid trading universe
          const validSymbols = ["EURJPY", "EURUSD", "GBPUSD", "USDJPY", "AUDUSD", "NZDUSD", "AUDJPY", "CADJPY", "EURGBP", "BTCUSD", "XAUUSD", "XAGUSD", "UKOIL", "USOIL", "US30", "NAS100"];
          if (finalParsed.confidence >= 85 && (finalParsed.sentiment === "BULLISH" || finalParsed.sentiment === "BEARISH") && validSymbols.includes(finalParsed.symbol)) {
            
            const side = finalParsed.sentiment === "BULLISH" ? "LONG" : "SHORT";
            
            // Insert cleanly into trade_opportunities as PUBLISHED
            const { data: opp, error: oppErr } = await supabase.from("trade_opportunities").insert({
              symbol: finalParsed.symbol,
              side,
              status: "PUBLISHED",
              timeframe: "M1",
              ai_summary: headlineIdentifier,
              risk_summary: `Sentiment evaluation: ${finalParsed.sentiment} (${finalParsed.confidence}%). Context: ${verifiedContext}`,
              created_at: new Date().toISOString(),
              trace_id: traceId
            }).select("id").single();

            if (oppErr) {
              console.error(`[Macro Scout] Opportunity Insert Error:`, oppErr);
              continue;
            }

            // Wake up agent-swing immediately for Event-Driven Technical Confluence
            await pingAgentSwing(finalParsed.symbol);

            console.log(`[Macro Scout] [Trace: ${traceId}] Signal queued for technical confluence:`, side, finalParsed.symbol);
            await notify(
              `📰 <b>SENTIMENT SIGNAL DETECTED</b>\n` +
              `<b>${title}</b>\n` +
              `Sentiment: ${finalParsed.sentiment} (${finalParsed.confidence}%)\n` +
              `Context: ${verifiedContext}\n\n` +
              `Signal queued for <b>${side} ${finalParsed.symbol}</b> pending technical confluence.`
            );
            results.push({ rule: "SENTIMENT", action: side, symbol: finalParsed.symbol });
          }
        }
      } catch (err: any) {
        console.error(`[Macro Scout] [Trace: ${traceId}] Sentiment Error:`, err.message);
        debugInfo.error = err.message;
      }
    }

    return new Response(JSON.stringify({ ok: true, processed: results, debug: debugInfo }), {
      headers: { "Content-Type": "application/json" },
    });

  } catch (error: any) {
    console.error(`[Macro Scout] [Trace: ${traceId}] Error:`, error);
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }
});
