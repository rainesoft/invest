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
  if (slDistance === 0) return 0.01;
  
  let pointValue = 1; // Default
  if (symbol.includes("JPY")) {
    pointValue = 1000 / entryPx; // rough approximation for JPY pairs
  } else if (symbol.includes("USD") && symbol.length === 6) {
    pointValue = 100000; // standard lot 100k
  }

  const riskPerLot = slDistance * pointValue;
  if (riskPerLot <= 0) return 0.01;
  const rawLots = RISK_USD / riskPerLot;
  return Math.max(0.01, Math.min(100.0, Math.floor(rawLots * 100) / 100));
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
  const auth   = req.headers.get("authorization");

  if (WEBHOOK_SECRET && secret !== WEBHOOK_SECRET) {
    if (!auth?.startsWith("Bearer ")) {
      return new Response("Unauthorized", { status: 401 });
    }
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const traceId = crypto.randomUUID();
  console.log(`[Macro Scout] [Trace: ${traceId}] Poll started — ${new Date().toISOString()}`);

  try {
    // 1. Fetch Forex Factory JSON
    const ffResponse = await fetch("https://nfs.faireconomy.media/ff_calendar_thisweek.json");
    if (!ffResponse.ok) throw new Error("Failed to fetch Forex Factory calendar");
    const events = await ffResponse.json();

    const now = new Date();
    const results = [];

    // 2. Scan events
    for (const event of events) {
      // We only care about events happening roughly right now (within the last 15 mins)
      // to avoid triggering off old data.
      const eventTime = new Date(event.date);
      const diffMinutes = (now.getTime() - eventTime.getTime()) / 60000;
      
      // Skip future events or events older than 15 mins
      if (diffMinutes < 0 || diffMinutes > 15) continue;
      
      // Needs to have 'actual' published
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
              status: "ACTIVE",
              timeframe: "M1",
              ai_summary: `[S-Tier] [MACRO] Fast-Execution: ${event.title}. Actual: ${event.actual}, Forecast: ${event.forecast}. ${summaryText}.`,
              risk_summary: `${eventIdentifier} Automated news trade execution.`,
              tp1_hit: false,
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
              const body = {
                symbol: action.symbol,
                actionType: action.side === "BUY" ? "ORDER_TYPE_BUY" : "ORDER_TYPE_SELL",
                volume: volume,
                stopLoss: slPx,
                stopLossUnits: "ABSOLUTE_PRICE",
                clientId: `mac_${opp.id.substring(0, 8)}`,
              };

              const orderRes = await mtPost("/trade", body);
              
              await supabase.from("user_trades").insert({
                 user_id: "00000000-0000-0000-0000-000000000000",
                 opportunity_id: opp.id,
                 status: "OPEN",
                 execution_price: entryPx,
                 size: volume
              });

              await notify(
                `⚡ <b>MACRO EVENT TRIGGERED</b>\n` +
                `<b>${event.title}</b>\n` +
                `Forecast: ${event.forecast} | Actual: ${event.actual}\n\n` +
                `Executed: <b>${action.side} ${action.symbol}</b>\n` +
                `Volume: ${volume} lots`
              );
              
              results.push({ rule: rule.id, action: action.side, symbol: action.symbol });
            } else {
              console.log(`[Macro Scout] [Trace: ${traceId}] DRY RUN: Would execute`, action);
              results.push({ rule: rule.id, action: action.side, symbol: action.symbol, dry_run: true });
            }
          }
        }
      }
    }



    // === SENTIMENT SCOUT ===
    if (OPENAI_API_KEY) {
      try {
        const rssRes = await fetch("https://cointelegraph.com/rss");
        const xml = await rssRes.text();
        const items = xml.match(/<item>[\s\S]*?<\/item>/g) || [];
        
        for (let i = 0; i < Math.min(3, items.length); i++) {
          const item = items[i];
          const titleMatch = item.match(/<title>(.*?)<\/title>/);
          if (!titleMatch) continue;
          
          let title = titleMatch[1].replace("<![CDATA[", "").replace("]]>", "").trim();
          const headlineIdentifier = `[SENTIMENT] ${title}`;
          
          // Check if already processed
          const { count } = await supabase
            .from("trade_opportunities")
            .select("id", { count: "exact", head: true })
            .eq("ai_summary", headlineIdentifier);
            
          if ((count ?? 0) > 0) continue; // Already processed
          
          console.log(`[Macro Scout] [Trace: ${traceId}] Evaluating Sentiment: ${title}`);
          
          const prompt = `You are a high-frequency trading Sentiment API. 
Analyze this news headline and return ONLY a JSON object.
Format: { "sentiment": "BULLISH" | "BEARISH" | "NEUTRAL", "confidence": 0-100, "symbol": "BTCUSD" | "NONE", "requires_verification": boolean }
If the news is ambiguous, a rumor, or confidence is below 85, set requires_verification to true.
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
          if (!aiData.choices || !aiData.choices[0]) {
             console.error(`[Macro Scout] [Trace: ${traceId}] Invalid OpenAI response:`, aiData);
             continue;
          }

          const resultText = aiData.choices[0].message.content.trim();
          const parsed = JSON.parse(resultText);
          
          // Mark as processed regardless of execution so we don't spam API
          await supabase.from("trade_opportunities").insert({
            symbol: parsed.symbol !== "NONE" ? parsed.symbol : "BTCUSD",
            side: "BUY", // Dummy
            status: "REJECTED", // default
            timeframe: "M1",
            ai_summary: headlineIdentifier,
            risk_summary: `Sentiment evaluation: ${parsed.sentiment} (${parsed.confidence}%)`,
            tp1_hit: false,
            created_at: new Date().toISOString(),
            trace_id: traceId
          }).select("id").single().then(async ({ data: opp }) => {
            if (!opp) return;

            let finalParsed = parsed;
            let verifiedContext = "Tier 1 Instant";

            // TIER 2: TAVILY VERIFICATION
            if (finalParsed.requires_verification && TAVILY_API_KEY) {
               console.log(`[Macro Scout] [Trace: ${traceId}] Tier 2 Verification Triggered for: ${title}`);
               const tavilyContext = await verifyWithTavily(title);
               
               if (tavilyContext) {
                 const verifyPrompt = `You are a high-frequency trading Sentiment API.
Original Headline: "${title}"
Web Search Context:
${tavilyContext}

Based on this additional context, provide a final evaluation. Return ONLY a JSON object.
Format: { "sentiment": "BULLISH" | "BEARISH" | "NEUTRAL", "confidence": 0-100, "symbol": "BTCUSD" | "NONE" }`;

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
                    finalParsed = JSON.parse(verifyData.choices[0].message.content.trim());
                    verifiedContext = `Tavily Verified: ${finalParsed.sentiment} (${finalParsed.confidence}%)`;
                    console.log(`[Macro Scout] [Trace: ${traceId}] Tavily Verification Complete:`, finalParsed);
                 }
               }
            }

            // Execute if threshold met
            if (finalParsed.confidence >= 85 && (finalParsed.sentiment === "BULLISH" || finalParsed.sentiment === "BEARISH") && finalParsed.symbol === "BTCUSD") {
              
              const side = finalParsed.sentiment === "BULLISH" ? "BUY" : "SELL";
              const priceData = await mtGet(`/symbols/${finalParsed.symbol}/current-price`);
              const entryPx = side === "BUY" ? priceData.ask : priceData.bid;
              const slPx = side === "BUY" ? entryPx - 500 : entryPx + 500; // rough 500 point SL for BTC
              const volume = calcLots(finalParsed.symbol, entryPx, slPx);

              // Update opportunity to ACTIVE
              await supabase.from("trade_opportunities").update({
                side,
                status: "ACTIVE",
                risk_summary: `Sentiment execution: ${finalParsed.sentiment} (${finalParsed.confidence}%). Context: ${verifiedContext}`
              }).eq("id", opp.id);

              if (!DRY_RUN) {
                const body = {
                  symbol: finalParsed.symbol,
                  actionType: side === "BUY" ? "ORDER_TYPE_BUY" : "ORDER_TYPE_SELL",
                  volume: volume,
                  stopLoss: slPx,
                  stopLossUnits: "ABSOLUTE_PRICE",
                  clientId: `mac_${opp.id.substring(0, 8)}`,
                };
                await mtPost("/trade", body);
                
                await supabase.from("user_trades").insert({
                   user_id: "00000000-0000-0000-0000-000000000000",
                   opportunity_id: opp.id,
                   status: "OPEN",
                   execution_price: entryPx,
                   size: volume
                });

                await notify(
                  `📰 <b>SENTIMENT EVENT TRIGGERED</b>\n` +
                  `<b>${title}</b>\n` +
                  `Sentiment: ${finalParsed.sentiment} (${finalParsed.confidence}%)\n` +
                  `Context: ${verifiedContext}\n\n` +
                  `Executed: <b>${side} ${finalParsed.symbol}</b>\n` +
                  `Volume: ${volume} lots`
                );
              } else {
                console.log(`[Macro Scout] [Trace: ${traceId}] DRY RUN SENTIMENT: Would execute`, side, finalParsed.symbol);
              }
              results.push({ rule: "SENTIMENT", action: side, symbol: finalParsed.symbol });
            }
          });
        }
      } catch (err: any) {
        console.error(`[Macro Scout] [Trace: ${traceId}] Sentiment Error:`, err.message);
      }
    }

    return new Response(JSON.stringify({ ok: true, processed: results }), {
      headers: { "Content-Type": "application/json" },
    });

  } catch (error: any) {
    console.error(`[Macro Scout] [Trace: ${traceId}] Error:`, error);
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }
});
