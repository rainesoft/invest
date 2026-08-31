export interface FFEvent {
  title: string;
  country: string;
  date: string;
  impact: string;
  forecast: string;
  previous: string;
}

export async function fetchRealtimeNews(symbol: string): Promise<string[] | null> {
  try {
    // 1. Check if we should use Targeted Fundamental Data Providers (Tavily)
    const TAVILY_API_KEY = Deno.env.get("TAVILY_API_KEY");
    if (TAVILY_API_KEY) {
      let tavilyQuery = "";
      if (symbol.includes("OIL")) {
        tavilyQuery = "Crude oil Brent WTI OPEC+ supply geopolitical tensions EIA inventories global oil demand breaking";
      } else if (symbol.includes("XAU") || symbol.includes("XAG")) {
        tavilyQuery = "Gold XAUUSD Federal Reserve interest rates, US 10-year Treasury yields, US Dollar Index DXY, inflation data, breaking market analysis";
      } else if (symbol.includes("BTC") || symbol.includes("ETH")) {
        tavilyQuery = "Bitcoin Ethereum ETF flows, regulatory news, crypto institutional adoption, halving impact";
      } else if (symbol.includes("USD") || symbol.includes("EUR") || symbol.includes("GBP") || symbol.includes("JPY")) {
        tavilyQuery = `${symbol} central bank policy, Federal Reserve ECB BOJ interest rates, Treasury yields, breaking forex`;
      }

      if (tavilyQuery) {
        console.log(`[News] Using Targeted Fundamental Data Provider (Tavily) for ${symbol}`);
        const res = await fetch("https://api.tavily.com/search", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            api_key: TAVILY_API_KEY,
            query: `Latest market context and specific data points for: ${tavilyQuery}`,
            search_depth: "advanced",
            include_answer: true,
            days: 3
          })
        });
        if (res.ok) {
          const data = await res.json();
          let context = data.answer || "";
          if (data.results && data.results.length > 0) {
            context += "\n\nSources Context:\n" + data.results.slice(0, 3).map((r: any) => `- ${r.title}: ${r.content}`).join("\n");
          }
          if (context) return [context];
        } else {
          console.warn(`[News] Tavily fallback to RSS. Status: ${res.status}`);
        }
      }
    }

    // 2. Fallback to generic Google News RSS
    // Map symbols to good search terms
    let query = symbol;
    if (symbol.includes("US30") || symbol.includes("NAS") || symbol.includes("SPX")) {
      query = "US Stock Market Dow Jones Nasdaq S&P500";
    } else if (symbol.includes("XAU") || symbol.includes("XAG")) {
      query = "Gold Silver Precious Metals Market";
    } else if (symbol.includes("BTC") || symbol.includes("ETH")) {
      query = "Crypto Bitcoin Ethereum Market";
    } else if (symbol.includes("OIL")) {
      query = "Crude Oil Brent OPEC Strait Hormuz supply disruption";
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000);
    
    const url = `https://news.google.com/rss/search?q=${encodeURIComponent(query)}+Financial+News&hl=en-US&gl=US&ceid=US:en`;
    const response = await fetch(url, { signal: controller.signal });
    clearTimeout(timeoutId);
    
    if (!response.ok) return null;
    
    const text = await response.text();
    const regex = /<item>\s*<title>(.*?)<\/title>/g;
    let match;
    const headlines: string[] = [];
    
    // Get top 5 breaking headlines
    while ((match = regex.exec(text)) !== null && headlines.length < 5) {
      // Decode HTML entities roughly
      let cleanTitle = match[1]
        .replace(/&apos;/g, "'")
        .replace(/&quot;/g, '"')
        .replace(/&amp;/g, '&');
      headlines.push(cleanTitle);
    }
    
    return headlines.length > 0 ? headlines : null;
  } catch (error: any) {
    console.error(`[Realtime News Error] ${error.message}`);
    return null;
  }
}

export async function fetchAllMacroEvents(): Promise<FFEvent[] | null> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000);

    const response = await fetch('https://nfs.faireconomy.media/ff_calendar_thisweek.json', {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      },
      signal: controller.signal
    });
    
    clearTimeout(timeoutId);
    
    if (!response.ok) {
      console.warn(`[Macro News] Failed to fetch ForexFactory calendar: ${response.status}`);
      return null;
    }

    return await response.json();
  } catch (error: any) {
    console.error(`[Macro News Error] ${error.message}`);
    return null;
  }
}

export function generateMacroContext(symbol: string, events: FFEvent[] | null, headlines: string[] | null): string {
  let report = "";

  // 1. Live Breaking News Headlines
  if (headlines && headlines.length > 0) {
    report += `[LIVE BREAKING HEADLINES (LAST 24H) FOR ${symbol}]:\n`;
    headlines.forEach(h => report += `- ${h}\n`);
    report += `\nCRITICAL DIRECTIVE: 
1. If these headlines indicate severe geopolitical shocks, unannounced rate hikes, or sudden crashes that OPPOSE the technical trend, you MUST abort the setup. 
2. INTERMARKET DOLLAR & YIELD DIRECTIVE FOR GOLD/METALS: Gold (XAUUSD) and Silver (XAGUSD) are fundamentally priced against US 10-Year Real Yields and the US Dollar Index (DXY). If Fed speakers or macro headlines indicate hawkish policy, sticky inflation, higher-for-longer yields, or DXY strength: You MUST treat the macro bias for XAUUSD/XAGUSD as BEARISH. Long setups are strictly forbidden during active USD/yield surges.
3. SENTIMENT DECAY CURVE: Markets price in news quickly. If a news event or headline appears to be older than 24 hours, its sentiment impact is decaying (50% Relevance). If it is older than 48 hours, it is fully priced in (10% Relevance) and MUST NOT invalidate structural technical setups.
4. LINGERING MACRO NARRATIVES: If there is no breaking news today, but recent macro data sets a clear fundamental narrative, you MUST use that narrative to provide fundamental confluence.\n\n`;
  }

  if (!events) {
    return report + "No fundamental calendar events provided (API Error).";
  }

  // Determine target currencies from symbol
  const targetCurrencies: string[] = [];
  if (symbol.includes("USD")) targetCurrencies.push("USD");
  if (symbol.includes("EUR")) targetCurrencies.push("EUR");
  if (symbol.includes("GBP")) targetCurrencies.push("GBP");
  if (symbol.includes("JPY")) targetCurrencies.push("JPY");
  if (symbol.includes("AUD")) targetCurrencies.push("AUD");
  if (symbol.includes("CAD")) targetCurrencies.push("CAD");
  if (symbol.includes("CHF")) targetCurrencies.push("CHF");
  if (symbol.includes("NZD")) targetCurrencies.push("NZD");
  if (symbol.includes("XAU") || symbol.includes("XAG") || symbol.includes("BTC") || symbol.includes("ETH") || symbol.includes("OIL") || symbol.includes("US30") || symbol.includes("NAS") || symbol.includes("SPX")) {
    // For commodities, crypto, and indices priced in USD, we care heavily about USD macro
    if (!targetCurrencies.includes("USD")) targetCurrencies.push("USD");
  }

  if (targetCurrencies.length === 0) {
    return report + "No specific macro data tracked for this asset class.";
  }

  const now = new Date();
  const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);

  const relevantEvents = events.filter(e => {
    // Only High or Medium impact
    if (e.impact !== "High" && e.impact !== "Medium") return false;
    
    // Only relevant currencies
    if (!targetCurrencies.includes(e.country)) return false;

    const eventDate = new Date(e.date);
    // Only future events within the next 24 hours
    return eventDate > now && eventDate <= tomorrow;
  });

  if (relevantEvents.length === 0) {
    return report + "No major macroeconomic catalysts scheduled for the relevant currencies within the next 24 hours. The market is likely driven purely by technicals.";
  }

  report += "Upcoming Macro Catalysts (Next 24 Hours):\n";
  let hasHighImpact = false;
  for (const e of relevantEvents) {
    if (e.impact === "High") hasHighImpact = true;
    const eventTime = new Date(e.date).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', timeZoneName: 'short' });
    report += `- [${e.impact} Impact] ${e.country}: ${e.title} at ${eventTime} (Forecast: ${e.forecast || 'N/A'}, Prev: ${e.previous || 'N/A'})\n`;
  }

  if (hasHighImpact) {
    report += "\n[CRITICAL MACRO DIRECTIVE]: High-impact events are scheduled today. If the fundamentals are heavily skewed and overwhelming the market (e.g. extremely weak demand + supply glut for Oil), you MUST classify the macro bias as EXTREMELY_BULLISH or EXTREMELY_BEARISH instead of standard bullish/bearish, which authorizes Breakout Logic.";
  }

  return report;
}

// ============================================================
// FOMC / CENTRAL BANK EVENT DETECTION
// Returns whether a high-impact central bank event has fired
// within the last `windowHours` hours. Used by agent-swing to
// activate Volatility Expansion Mode (wider INFLECTION threshold).
// ============================================================
export interface CentralBankEventStatus {
  isActive: boolean;
  events: FFEvent[];
  windowHours: number;
}

const CENTRAL_BANK_PATTERNS = [
  /Federal Funds Rate/i,
  /FOMC/i,
  /Fed Rate/i,
  /Fed Chair/i,
  /Powell/i,
  /Warsh/i,
  /Waller/i,
  /Speaks/i,
  /Speech/i,
  /Testimony/i,
  /Press Conference/i,
  /Remarks/i,
  /Main Refinancing Rate/i,
  /ECB Rate/i,
  /ECB President/i,
  /Lagarde/i,
  /Official Bank Rate/i,
  /BOE Rate/i,
  /Bailey/i,
  /BOJ Rate/i,
  /BOJ Gov/i,
  /Ueda/i,
  /Cash Rate/i,
  /Overnight Rate/i,
  /Interest Rate Decision/i,
  /Monetary Policy/i,
];

export function detectCentralBankEvent(
  events: FFEvent[] | null,
  windowHours = 6
): CentralBankEventStatus {
  if (!events || events.length === 0) {
    return { isActive: false, events: [], windowHours };
  }

  const now = Date.now();
  const windowMs = windowHours * 60 * 60 * 1000;

  const matched = events.filter((e) => {
    if (e.impact !== "High") return false;
    const eventTime = new Date(e.date).getTime();
    const msAgo = now - eventTime;
    // Central bank rate decision OR high-impact speaker event within the past windowHours
    return msAgo >= 0 && msAgo <= windowMs && CENTRAL_BANK_PATTERNS.some((p) => p.test(e.title));
  });

  return {
    isActive: matched.length > 0,
    events: matched,
    windowHours,
  };
}

// ============================================================
// FOMC PRE-EVENT DETECTION
// Returns whether a high-impact Fed/central bank event is
// scheduled to fire within the next `lookAheadMinutes` minutes.
// Used by agent-day and agent-swing to activate FOMC Pre-Event
// Mode — boosting AI confidence and position sizing before the
// volatility catalyst hits rather than reacting after.
// ============================================================
export interface UpcomingFedEvent {
  isPending: boolean;
  minutesUntil: number | null;
  event: FFEvent | null;
}

export function detectUpcomingFedEvent(
  events: FFEvent[] | null,
  lookAheadMinutes = 90
): UpcomingFedEvent {
  if (!events || events.length === 0) {
    return { isPending: false, minutesUntil: null, event: null };
  }

  const now = Date.now();
  const windowMs = lookAheadMinutes * 60 * 1000;

  // Find the nearest upcoming FOMC/Fed event within the look-ahead window
  const upcoming = events
    .filter((e) => {
      if (e.impact !== "High") return false;
      const eventTime = new Date(e.date).getTime();
      const msUntil = eventTime - now;
      // Event is in the future and within the look-ahead window
      return msUntil >= 0 && msUntil <= windowMs && CENTRAL_BANK_PATTERNS.some((p) => p.test(e.title));
    })
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

  if (upcoming.length === 0) {
    return { isPending: false, minutesUntil: null, event: null };
  }

  const nearest = upcoming[0];
  const minutesUntil = Math.round((new Date(nearest.date).getTime() - now) / (60 * 1000));

  return {
    isPending: true,
    minutesUntil,
    event: nearest,
  };
}

// ============================================================
// NEWS-ENHANCED CONFIDENCE BOOST
// Returns 0–8 bonus confidence points when a high-impact macro
// event has recently fired AND aligns with the technical direction
// of the proposed trade. This is the macro-technical convergence
// trigger that pushes A-Tier setups to S-Tier.
// ============================================================
const USD_BULLISH_PATTERNS = [
  /Non-Farm Employment/i,
  /NFP/i,
  /CPI y\/y/i,
  /Federal Funds Rate/i,
  /GDP/i,
  /Retail Sales/i,
];

// Symbols where USD strength → asset weakness (inverse correlation)
const USD_INVERSE_SYMBOLS = ["XAUUSD", "XAGUSD", "BTCUSD", "EURUSD", "GBPUSD"];
// Symbols where USD strength → asset strength or no direct inverse
const USD_DIRECT_SYMBOLS = ["USDJPY", "USDCHF", "USDCAD", "UKOIL"];

export function computeMacroConfidenceBoost(
  symbol: string,
  direction: "LONG" | "SHORT" | string,
  events: FFEvent[] | null,
  headlines: string[] | null
): number {
  if (!events || events.length === 0) return 0;

  const now = Date.now();
  const threeHoursMs = 3 * 60 * 60 * 1000;

  // Check for a recently-fired high-impact event (actual data published within 3H)
  const recentHighImpact = events.filter((e) => {
    if (e.impact !== "High") return false;
    const eventTime = new Date(e.date).getTime();
    const msAgo = now - eventTime;
    // Has actual data and fired within 3 hours
    return msAgo >= 0 && msAgo <= threeHoursMs;
  });

  if (recentHighImpact.length === 0) return 0;

  // Check headline sentiment for alignment signal
  const bullishSignals = [
    /beat/i, /surged/i, /stronger/i, /hawkish/i, /rally/i, /breakout/i, /bullish/i,
    /higher than expected/i, /above forecast/i,
  ];
  const bearishSignals = [
    /miss/i, /fell/i, /weaker/i, /dovish/i, /sell.off/i, /crash/i, /bearish/i,
    /lower than expected/i, /below forecast/i,
  ];

  let headlineBullish = 0;
  let headlineBearish = 0;
  if (headlines && headlines.length > 0) {
    for (const h of headlines) {
      if (bullishSignals.some((p) => p.test(h))) headlineBullish++;
      if (bearishSignals.some((p) => p.test(h))) headlineBearish++;
    }
  }

  // Determine macro directional bias for this symbol
  const isUsdInverse = USD_INVERSE_SYMBOLS.includes(symbol);
  const isUsdDirect = USD_DIRECT_SYMBOLS.includes(symbol);
  const isOil = symbol.includes("OIL");

  // For oil: bullish macro (strong demand, Middle East tension) → bullish oil
  // For gold/silver/BTC (USD inverse): USD weakness (dovish/miss) → bullish
  // For USDJPY: USD strength (hawkish/beat) → bullish

  let macroAlignsBullish = false;
  let macroAlignsBearish = false;

  if (isUsdInverse) {
    // USD weakness = LONG on Gold/Silver/BTC
    macroAlignsBullish = headlineBearish > headlineBullish; // bearish USD news → bullish asset
    macroAlignsBearish = headlineBullish > headlineBearish;
  } else if (isUsdDirect) {
    macroAlignsBullish = headlineBullish > headlineBearish;
    macroAlignsBearish = headlineBearish > headlineBullish;
  } else if (isOil) {
    // Oil has complex drivers — use net headline sentiment directly
    macroAlignsBullish = headlineBullish > headlineBearish;
    macroAlignsBearish = headlineBearish > headlineBullish;
  }

  const tradeIsLong = direction === "LONG";
  const tradeIsShort = direction === "SHORT";

  // Boost if macro aligns with trade direction
  if ((tradeIsLong && macroAlignsBullish) || (tradeIsShort && macroAlignsBearish)) {
    console.log(
      `[MacroBoost] +8 confidence for ${symbol} ${direction}: macro event alignment confirmed (${recentHighImpact.map((e) => e.title).join(", ")})`
    );
    return 8;
  }

  return 0;
}

// ============================================================
// ETF FLOW SENTIMENT
// For BTC and ETH, fetches the latest ETF net flow data via
// Tavily and parses it into a structured sentiment signal.
// A large inflow creates an institutional demand floor (bullish),
// while large outflows indicate distribution (bearish).
// Returns NEUTRAL when no flow data is available.
// ============================================================
export interface ETFFlowSentiment {
  signal: "BULLISH" | "BEARISH" | "NEUTRAL";
  amount_usd_millions: number | null;
  summary: string;
}

export async function fetchETFFlowSentiment(
  symbol: string
): Promise<ETFFlowSentiment> {
  const neutral: ETFFlowSentiment = { signal: "NEUTRAL", amount_usd_millions: null, summary: "No ETF flow data available." };

  // Only applicable for crypto assets with spot ETFs
  const isBTC = symbol.includes("BTC");
  const isETH = symbol.includes("ETH");
  if (!isBTC && !isETH) return neutral;

  const TAVILY_API_KEY = Deno.env.get("TAVILY_API_KEY");
  if (!TAVILY_API_KEY) return neutral;

  try {
    const assetName = isBTC ? "Bitcoin" : "Ethereum";
    const res = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: TAVILY_API_KEY,
        query: `${assetName} spot ETF net inflows outflows today USD million`,
        search_depth: "advanced",
        include_answer: true,
        days: 1,
      }),
    });

    if (!res.ok) return neutral;
    const data = await res.json();
    const text: string = (data.answer || "") + " " + (data.results || []).slice(0, 3).map((r: any) => r.content).join(" ");

    // Parse dollar amounts: match patterns like "$297.6 million", "$1.2B", "-$150M"
    const amounts: number[] = [];
    const amountPattern = /([+-]?\$?\s?[\d,.]+)\s*(billion|million|B|M)\s*(inflow|outflow|net flow|outflows|inflows)?/gi;
    let match;
    while ((match = amountPattern.exec(text)) !== null) {
      const raw = parseFloat(match[1].replace(/[$,\s]/g, ""));
      const unit = match[2].toLowerCase();
      const multiplier = unit === "billion" || unit === "b" ? 1000 : 1;
      const direction = match[3] ? (/(outflow|outflows)/i.test(match[3]) ? -1 : 1) : 1;
      amounts.push(raw * multiplier * direction);
    }

    // Net the parsed amounts
    const netFlow = amounts.length > 0 ? amounts.reduce((a, b) => a + b, 0) : null;

    // Check for qualitative signals if no amounts were parsed
    const hasInflow = /inflow|bought|purchased/i.test(text);
    const hasOutflow = /outflow|redemption|sold/i.test(text);

    let signal: "BULLISH" | "BEARISH" | "NEUTRAL";
    if (netFlow !== null) {
      if (netFlow >= 100) signal = "BULLISH";
      else if (netFlow <= -100) signal = "BEARISH";
      else signal = "NEUTRAL";
    } else if (hasInflow && !hasOutflow) {
      signal = "BULLISH";
    } else if (hasOutflow && !hasInflow) {
      signal = "BEARISH";
    } else {
      signal = "NEUTRAL";
    }

    const summary = netFlow !== null
      ? `${assetName} ETF net flow today: ${netFlow >= 0 ? "+" : ""}$${netFlow.toFixed(0)}M (${signal})`
      : `${assetName} ETF flow signal: ${signal} (qualitative).`;

    console.log(`[ETF Flow] ${symbol}: ${summary}`);
    return { signal, amount_usd_millions: netFlow, summary };
  } catch (err: any) {
    console.error(`[ETF Flow Error] ${symbol}: ${err.message}`);
    return neutral;
  }
}
