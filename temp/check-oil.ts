const fs = require('fs');

async function fetchMacroEvents(symbol) {
  try {
    const response = await fetch('https://nfs.faireconomy.media/ff_calendar_thisweek.json');
    if (!response.ok) return "No fundamental news provided (API Error).";
    const events = await response.json();
    
    const targetCurrencies = [];
    if (symbol.includes("USD")) targetCurrencies.push("USD");
    if (symbol.includes("OIL")) {
      if (!targetCurrencies.includes("USD")) targetCurrencies.push("USD");
    }

    if (targetCurrencies.length === 0) return "No specific macro data tracked for this asset class.";

    const now = new Date();
    const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);

    const relevantEvents = events.filter(e => {
      if (e.impact !== "High" && e.impact !== "Medium") return false;
      if (!targetCurrencies.includes(e.country)) return false;
      const eventDate = new Date(e.date);
      return eventDate > now && eventDate <= tomorrow;
    });

    if (relevantEvents.length === 0) return "No major catalysts.";

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
  } catch (error) {
    return error.message;
  }
}

async function run() {
  const result = await fetchMacroEvents("UKOIL");
  console.log("Fundamental News:");
  console.log(result);
}
run();
