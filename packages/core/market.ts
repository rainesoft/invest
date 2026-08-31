export function isCrypto(symbol: string): boolean {
  if (!symbol) return false;
  const upper = symbol.toUpperCase();
  const cryptoBases = ["BTC", "ETH", "SOL", "XRP", "DOGE", "LTC", "ADA"];
  return cryptoBases.some(c => upper.startsWith(c)) || upper.endsWith("USDT");
}

export function isMarketOpen(symbol: string): boolean {
  if (isCrypto(symbol)) {
    return true; // Crypto is 24/7
  }

  const now = new Date();
  const day = now.getUTCDay();
  const hour = now.getUTCHours();

  // 1. Weekend Closure (Friday 22:00 UTC to Sunday 22:00 UTC)
  const isWeekend = (day === 5 && hour >= 22) || (day === 6) || (day === 0 && hour < 22);
  if (isWeekend) {
    return false;
  }

  // 2. Weekday Daily Rollover Closure (22:00 UTC to 23:00 UTC)
  // Major markets (Asia/London/NY) are 24/5, but there is a 1-hour rollover gap
  if (hour === 22) {
    return false;
  }

  return true;
}
