export function isCrypto(symbol: string): boolean {
  if (!symbol) return false;
  const upper = symbol.toUpperCase();
  const cryptoBases = ["BTC", "ETH", "SOL", "XRP", "DOGE", "LTC", "ADA"];
  return cryptoBases.some(c => upper.startsWith(c)) || upper.endsWith("USDT");
}

export function isUsEquity(symbol: string): boolean {
  if (!symbol) return false;
  const upper = symbol.toUpperCase();
  const equities = ["AAPL", "MSFT", "NVDA", "AMZN", "TSLA", "META", "GOOGL", "GOOG", "NFLX", "AMD"];
  return equities.includes(upper);
}

export function isCommodity(symbol: string): boolean {
  if (!symbol) return false;
  const upper = symbol.toUpperCase();
  return ["XAUUSD", "XAGUSD", "UKOIL", "USOIL"].includes(upper);
}

export function isIndex(symbol: string): boolean {
  if (!symbol) return false;
  const upper = symbol.toUpperCase();
  return ["US30", "NAS100", "USTEC", "SPX500", "US500", "GER30", "GER40", "DE30", "JP225"].includes(upper);
}

export function isAsianOrPacificAsset(symbol: string): boolean {
  if (!symbol) return false;
  const upper = symbol.toUpperCase();
  if (isCrypto(upper)) return true;
  const asianKeywords = ["JPY", "AUD", "NZD", "JP225", "NIKKEI", "HK50", "CHINA50"];
  return asianKeywords.some(k => upper.includes(k));
}

export function isMarketOpen(symbol: string): boolean {
  if (!symbol) return false;
  const upper = symbol.toUpperCase();

  // 1. Crypto is 24/7/365
  if (isCrypto(upper)) {
    return true;
  }

  const now = new Date();
  const day = now.getUTCDay(); // 0 = Sunday, 1 = Monday, ..., 5 = Friday, 6 = Saturday
  const hour = now.getUTCHours();
  const minute = now.getUTCMinutes();
  const totalMinutes = hour * 60 + minute;

  // 2. Saturday is completely closed for all traditional markets
  if (day === 6) {
    return false;
  }

  // 3. US Equities (Monday - Friday 13:35 UTC to 19:55 UTC)
  if (isUsEquity(upper)) {
    if (day === 0 || day === 6) return false;
    // 13:35 UTC = 815 mins, 19:55 UTC = 1195 mins
    return totalMinutes >= 815 && totalMinutes <= 1195;
  }

  // 4. Commodities (XAUUSD, XAGUSD, UKOIL, USOIL)
  if (isCommodity(upper)) {
    // Friday: closes at 21:00 UTC (1260 mins)
    if (day === 5 && totalMinutes >= 1260) return false;
    // Sunday: opens at 23:00 UTC (1380 mins)
    if (day === 0 && totalMinutes < 1380) return false;
    // Weekday daily rollover break (21:00 UTC to 22:15 UTC = 1260 to 1335 mins)
    if (day >= 1 && day <= 4 && totalMinutes >= 1260 && totalMinutes < 1335) return false;
    return true;
  }

  // 5. Equity Indices (US30, NAS100/USTEC, SPX500/US500, GER30/DE30, JP225)
  if (isIndex(upper)) {
    // Friday: closes at 21:00 UTC (1260 mins)
    if (day === 5 && totalMinutes >= 1260) return false;
    // Sunday: closed until Sunday 23:00 UTC / Asian session open
    if (day === 0 && totalMinutes < 1380) return false;
    // Weekday rollover break (21:15 UTC to 22:15 UTC)
    if (day >= 1 && day <= 4 && totalMinutes >= 1275 && totalMinutes < 1335) return false;
    return true;
  }

  // 6. Forex (Standard 24/5: Sunday 22:05 UTC to Friday 21:00 UTC)
  // Friday: closes at 21:00 UTC (1260 mins)
  if (day === 5 && totalMinutes >= 1260) return false;
  // Sunday: opens at 22:05 UTC (1325 mins)
  if (day === 0 && totalMinutes < 1325) return false;
  // Weekday daily rollover break (21:55 UTC to 22:05 UTC = 1315 to 1325 mins)
  if (day >= 1 && day <= 4 && totalMinutes >= 1315 && totalMinutes < 1325) return false;

  return true;
}

