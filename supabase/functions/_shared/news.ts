export interface FFEvent {
  title: string;
  country: string;
  date: string;
  impact: string;
  forecast: string;
  previous: string;
}

export async function fetchAllMacroEvents(): Promise<FFEvent[] | null> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);

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

export function generateMacroContext(symbol: string, events: FFEvent[] | null): string {
  if (!events) {
    return "No fundamental news provided (API Error).";
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
    return "No specific macro data tracked for this asset class.";
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
    return "No major macroeconomic catalysts scheduled for the relevant currencies within the next 24 hours. The market is likely driven purely by technicals.";
  }

  let report = "Upcoming Macro Catalysts (Next 24 Hours):\n";
  let hasHighImpact = false;
  for (const e of relevantEvents) {
    if (e.impact === "High") hasHighImpact = true;
    const eventTime = new Date(e.date).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', timeZoneName: 'short' });
    report += `- [${e.impact} Impact] ${e.country}: ${e.title} at ${eventTime} (Forecast: ${e.forecast || 'N/A'}, Prev: ${e.previous || 'N/A'})\n`;
  }

  if (hasHighImpact) {
    report += "\n[CRITICAL MACRO DIRECTIVE]: High-impact events are scheduled today. If your technical bias (B-Tier or A-Tier) aligns with the anticipated volatility of these events (e.g. going LONG on USD pairs during hawkish Fed data), you MUST upgrade the setup to S-Tier.";
  }

  return report;
}
