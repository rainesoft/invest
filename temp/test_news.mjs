async function fetchMacroEvents(symbol) {
  try {
    const response = await fetch('https://nfs.faireconomy.media/ff_calendar_thisweek.json');
    if (!response.ok) return "No fundamental news provided (API Error).";
    const events = await response.json();

    const targetCurrencies = [];
    if (symbol.includes("USD")) targetCurrencies.push("USD");
    if (symbol.includes("EUR")) targetCurrencies.push("EUR");
    if (symbol.includes("GBP")) targetCurrencies.push("GBP");
    if (symbol.includes("JPY")) targetCurrencies.push("JPY");
    if (symbol.includes("AUD")) targetCurrencies.push("AUD");
    if (symbol.includes("CAD")) targetCurrencies.push("CAD");
    if (symbol.includes("CHF")) targetCurrencies.push("CHF");
    if (symbol.includes("NZD")) targetCurrencies.push("NZD");
    if (symbol.includes("XAU") || symbol.includes("BTC") || symbol.includes("ETH")) {
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

    if (relevantEvents.length === 0) {
      return "No major macroeconomic catalysts scheduled for the relevant currencies within the next 24 hours. The market is likely driven purely by technicals.";
    }

    let report = "Upcoming Macro Catalysts (Next 24 Hours):\n";
    for (const e of relevantEvents) {
      const eventTime = new Date(e.date).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', timeZoneName: 'short' });
      report += `- [${e.impact} Impact] ${e.country}: ${e.title} at ${eventTime} (Forecast: ${e.forecast || 'N/A'}, Prev: ${e.previous || 'N/A'})\n`;
    }

    return report;

  } catch (error) {
    return "No fundamental news provided (Execution Error).";
  }
}

async function run() {
  console.log("XAUUSD:");
  console.log(await fetchMacroEvents("XAUUSD"));
  console.log("\nEURUSD:");
  console.log(await fetchMacroEvents("EURUSD"));
}
run();
