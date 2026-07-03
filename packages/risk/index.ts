export function sizeByVol(equityUSD: number, atrUSD: number, maxRiskPct = 0.01) {
  const maxRiskUSD = equityUSD * maxRiskPct;
  if (atrUSD <= 0) return 0;
  const qty = Math.floor(maxRiskUSD / atrUSD);
  return Math.max(qty, 0);
}

export function sizeWithRiskCaps(
  equityUSD: number,
  atrUSD: number,
  dayRiskUSD: number,
  weekRiskUSD: number,
  perTradePct = 0.01,
  dayPct = 0.02,
  weekPct = 0.05,
  maxVolume?: number,
) {
  // base position by volatility
  const baseQty = sizeByVol(equityUSD, atrUSD, perTradePct);
  if (atrUSD <= 0) return 0;
  // remaining risk capital for day and week
  const remainingDay = Math.max(equityUSD * dayPct - dayRiskUSD, 0);
  const remainingWeek = Math.max(equityUSD * weekPct - weekRiskUSD, 0);
  const dayQty = Math.floor(remainingDay / atrUSD);
  const weekQty = Math.floor(remainingWeek / atrUSD);
  const qty = Math.max(Math.min(baseQty, dayQty, weekQty), 0);
  return maxVolume ? Math.min(qty, maxVolume) : qty;
}

/** ---------- Risk tracking & aggregation ---------- */
export interface ClosedTrade {
  pnl: number;
  closedAt: string | Date;
}

export function dailyPnL(trades: ClosedTrade[], date = new Date()): number {
  const start = new Date(date);
  start.setUTCHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 1);
  return trades
    .filter((t) => {
      const ts = new Date(t.closedAt).getTime();
      return ts >= start.getTime() && ts < end.getTime();
    })
    .reduce((sum, t) => sum + t.pnl, 0);
}

export function weeklyPnL(trades: ClosedTrade[], date = new Date()): number {
  const start = new Date(date);
  start.setUTCHours(0, 0, 0, 0);
  start.setUTCDate(start.getUTCDate() - start.getUTCDay());
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 7);
  return trades
    .filter((t) => {
      const ts = new Date(t.closedAt).getTime();
      return ts >= start.getTime() && ts < end.getTime();
    })
    .reduce((sum, t) => sum + t.pnl, 0);
}

export interface Position {
  group: string;
  qty: number;
  price: number;
}

export function exposureByCorrelationGroup(
  positions: Position[],
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const p of positions) {
    const exposure = p.qty * p.price;
    out[p.group] = (out[p.group] ?? 0) + exposure;
  }
  return out;
}

export interface OpenRisk {
  side: 'LONG' | 'SHORT';
  qty: number;
  entry: number;
  stop: number;
}

export function totalOpenRisk(trades: OpenRisk[]): number {
  return trades.reduce((sum, t) => {
    const risk =
      t.side === 'LONG'
        ? Math.max(0, t.entry - t.stop) * t.qty
        : Math.max(0, t.stop - t.entry) * t.qty;
    return sum + risk;
  }, 0);
}

/** ---------- Trailing stop utilities ---------- */
// Determine the next trailing stop level in 0.5R increments.
export function nextTrailLevel(rMultiple: number, lastLevel = 0) {
  const step = 0.5;
  const level = Math.floor(rMultiple / step) * step;
  return level > lastLevel ? level : null;
}

// Calculate a new stop price based on the trail level.
export function trailStop(
  entry: number,
  initialStop: number,
  level: number,
  side: 'LONG' | 'SHORT',
) {
  const r = Math.abs(entry - initialStop);
  const move = Math.max(0, level - 0.5) * r;
  return side === 'LONG' ? entry + move : entry - move;
}

export function shouldTightenTrail(rMultiple: number, lastLevel = 0) {
  // tighten when we cross discrete thresholds like +0.5R, +1R, etc.
  return nextTrailLevel(rMultiple, lastLevel) !== null;
}