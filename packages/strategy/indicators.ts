import { EMA, RSI, ADX, ATR, BollingerBands, MACD } from 'technicalindicators';

export type LogicContext = {
  candlestick_pattern?: string;
  timestamp: string;
  current_price: number;
  ema_50: number | null;
  ema_200: number | null;
  rsi_14: number | null;
  adx_14: number | null;
  atr_14: number | null;
  bb_upper: number | null;
  bb_lower: number | null;
  htf_trend?: 'BULLISH' | 'BEARISH' | 'CHOP';
  ltf_bos?: 'BULLISH' | 'BEARISH' | 'NONE';
  recent_swing_high: number | null;
  recent_swing_low: number | null;
  safe_long_stop_loss: number | null;
  safe_short_stop_loss: number | null;
  trend_alignment: 'BULLISH_TREND' | 'BULLISH_PULLBACK' | 'BEARISH_TREND' | 'BEARISH_PULLBACK' | 'CHOP';
  htf_support?: number[];
  htf_resistance?: number[];
  htf_pivot?: number;
  mtfa_ema_50?: number | null;
  mtfa_ema_200?: number | null;
  mtfa_trend?: 'BULLISH' | 'BEARISH' | 'CHOP';
  
  // MACD
  macd_line?: number | null;
  macd_signal?: number | null;
  macd_histogram?: number | null;
  
  // SMC (Smart Money Concepts)
  bullish_fvg_nearest?: number | null;
  bearish_fvg_nearest?: number | null;
  bullish_ob_nearest?: number | null;
  bearish_ob_nearest?: number | null;
  liquidity_sweep_bullish?: boolean;
  liquidity_sweep_bearish?: boolean;
  momentum_spike?: 'BULLISH' | 'BEARISH' | 'NONE';

  // Smart Money Order Flow & Volume Engine
  vwap?: number | null;
  vwap_upper_1?: number | null;
  vwap_lower_1?: number | null;
  vwap_upper_2?: number | null;
  vwap_lower_2?: number | null;
  vwap_relation?: 'ABOVE_VWAP' | 'BELOW_VWAP' | 'AT_VWAP' | 'EXTREME_OVERBOUGHT' | 'EXTREME_OVERSOLD' | 'NONE';
  poc_price?: number | null;
  vah_price?: number | null;
  val_price?: number | null;
  in_value_area?: boolean;
  volume_ratio?: number | null;
  volume_surge?: boolean;
  volume_regime?: 'VERY_HIGH' | 'HIGH' | 'NORMAL' | 'LOW' | 'ANEMIC';
  nearest_hvn?: number | null;

  // Session & Killzone Engine
  market_session?: string;
  killzone_active?: boolean;
  asian_high?: number | null;
  asian_low?: number | null;
  asian_sweep?: 'SWEPT_HIGH' | 'SWEPT_LOW' | 'NONE';
  mean_reversion_target?: number | null;
};

export function calculateFractals(high: number[], low: number[]) {
  const bullish_fractals: { index: number, price: number }[] = [];
  const bearish_fractals: { index: number, price: number }[] = [];

  for (let i = 2; i < high.length - 2; i++) {
    if (high[i] > high[i-1] && high[i] > high[i-2] && high[i] > high[i+1] && high[i] > high[i+2]) {
      bearish_fractals.push({ index: i, price: high[i] });
    }
    if (low[i] < low[i-1] && low[i] < low[i-2] && low[i] < low[i+1] && low[i] < low[i+2]) {
      bullish_fractals.push({ index: i, price: low[i] });
    }
  }
  return { bullish_fractals, bearish_fractals };
}

export function detectBOS(close: number[], bullish_fractals: { index: number, price: number }[], bearish_fractals: { index: number, price: number }[]) {
  if (close.length === 0) return 'NONE';
  const current_price = close[close.length - 1];
  
  const last_bearish = bearish_fractals.length > 0 ? bearish_fractals[bearish_fractals.length - 1].price : null;
  const last_bullish = bullish_fractals.length > 0 ? bullish_fractals[bullish_fractals.length - 1].price : null;

  if (last_bearish !== null && current_price > last_bearish) return 'BULLISH';
  if (last_bullish !== null && current_price < last_bullish) return 'BEARISH';
  return 'NONE';
}

export function calculatePivotPoints(high: number, low: number, close: number) {
  const p = (high + low + close) / 3;
  const r1 = (2 * p) - low;
  const s1 = (2 * p) - high;
  const r2 = p + (high - low);
  const s2 = p - (high - low);
  
  return {
    support: [s1, s2].sort((a, b) => b - a),
    resistance: [r1, r2].sort((a, b) => a - b),
    pivot: p
  };
}

export function detectFVG(open: number[], high: number[], low: number[], close: number[]) {
  let bullish_fvg_nearest: number | null = null;
  let bearish_fvg_nearest: number | null = null;
  
  const n = high.length;
  const lookback = Math.min(30, n);
  
  for (let i = n - 2; i >= n - lookback; i--) {
    // Bullish FVG: low of i > high of i-2
    if (i >= 2 && low[i] > high[i-2] && close[i-1] > open[i-1]) {
      const gapTop = low[i];
      const gapBottom = high[i-2];
      let filled = false;
      for (let j = i + 1; j < n; j++) {
        if (low[j] <= gapBottom) filled = true;
      }
      if (!filled && !bullish_fvg_nearest) {
        bullish_fvg_nearest = gapTop;
      }
    }
    
    // Bearish FVG: high of i < low of i-2
    if (i >= 2 && high[i] < low[i-2] && close[i-1] < open[i-1]) {
      const gapBottom = high[i];
      const gapTop = low[i-2];
      let filled = false;
      for (let j = i + 1; j < n; j++) {
        if (high[j] >= gapTop) filled = true;
      }
      if (!filled && !bearish_fvg_nearest) {
        bearish_fvg_nearest = gapBottom;
      }
    }
  }
  return { bullish_fvg_nearest, bearish_fvg_nearest };
}

export function detectOrderBlocks(open: number[], high: number[], low: number[], close: number[], volume?: number[]) {
  let bullish_ob_nearest: number | null = null;
  let bearish_ob_nearest: number | null = null;
  
  const n = close.length;
  const lookback = Math.min(30, n);
  const hasVolume = volume && volume.length === n && volume.some(v => v > 0);

  for (let i = n - 2; i >= n - lookback; i--) {
    const body = Math.abs(close[i] - open[i]);
    const prevBody = Math.abs(close[i-1] - open[i-1]);
    
    // Volume validation: ensure the displacement or setup candle has above-average volume
    let volumeConfirmed = true;
    if (hasVolume && i >= 5) {
      let localSum = 0;
      for (let k = i - 5; k < i; k++) localSum += volume![k] || 0;
      const localAvg = localSum / 5;
      if (localAvg > 0) {
        const candidateVol = Math.max(volume![i] || 0, volume![i-1] || 0);
        volumeConfirmed = candidateVol >= localAvg * 1.1;
      }
    }
    
    // Bullish OB
    if (i >= 1 && close[i] > open[i] && body > prevBody * 1.5 && close[i-1] < open[i-1] && volumeConfirmed) {
      const obHigh = high[i-1];
      let mitigated = false;
      for (let j = i + 1; j < n; j++) {
        if (low[j] <= obHigh) mitigated = true;
      }
      if (!mitigated && !bullish_ob_nearest) {
        bullish_ob_nearest = obHigh;
      }
    }
    
    // Bearish OB
    if (i >= 1 && close[i] < open[i] && body > prevBody * 1.5 && close[i-1] > open[i-1] && volumeConfirmed) {
      const obLow = low[i-1];
      let mitigated = false;
      for (let j = i + 1; j < n; j++) {
        if (high[j] >= obLow) mitigated = true;
      }
      if (!mitigated && !bearish_ob_nearest) {
        bearish_ob_nearest = obLow;
      }
    }
  }
  return { bullish_ob_nearest, bearish_ob_nearest };
}

export interface VWAPResult {
  vwap: number | null;
  upper1: number | null;
  lower1: number | null;
  upper2: number | null;
  lower2: number | null;
  relation: 'ABOVE_VWAP' | 'BELOW_VWAP' | 'AT_VWAP' | 'EXTREME_OVERBOUGHT' | 'EXTREME_OVERSOLD' | 'NONE';
}

export function calculateVWAP(
  timestamps: string[],
  high: number[],
  low: number[],
  close: number[],
  volume?: number[]
): VWAPResult {
  const n = close.length;
  if (n === 0) {
    return { vwap: null, upper1: null, lower1: null, upper2: null, lower2: null, relation: 'NONE' };
  }

  const hasVolume = volume && volume.length === n && volume.some(v => v > 0);
  const effectiveVolume = hasVolume ? volume! : new Array(n).fill(1);

  // Session Anchor: Find session start index (UTC day boundary: YYYY-MM-DD change)
  let sessionStartIndex = 0;
  if (timestamps && timestamps.length === n) {
    const lastDate = (timestamps[n - 1] || '').slice(0, 10);
    for (let i = n - 1; i >= 0; i--) {
      if ((timestamps[i] || '').slice(0, 10) !== lastDate) {
        sessionStartIndex = i + 1;
        break;
      }
    }
  }

  // If session has fewer than 3 bars, fallback to rolling last 30 bars for depth
  const startIndex = (n - sessionStartIndex < 3) ? Math.max(0, n - 30) : sessionStartIndex;

  let cumVolume = 0;
  let cumVolTypicalPrice = 0;
  const typicalPrices: number[] = [];
  const sessionVolumes: number[] = [];

  for (let i = startIndex; i < n; i++) {
    const tp = (high[i] + low[i] + close[i]) / 3;
    const v = effectiveVolume[i] > 0 ? effectiveVolume[i] : 1;
    typicalPrices.push(tp);
    sessionVolumes.push(v);
    cumVolume += v;
    cumVolTypicalPrice += tp * v;
  }

  if (cumVolume === 0) {
    return { vwap: null, upper1: null, lower1: null, upper2: null, lower2: null, relation: 'NONE' };
  }

  const currentVWAP = cumVolTypicalPrice / cumVolume;

  // Calculate volume-weighted standard deviation
  let sumWeightedSquaredDiff = 0;
  for (let j = 0; j < typicalPrices.length; j++) {
    const diff = typicalPrices[j] - currentVWAP;
    sumWeightedSquaredDiff += sessionVolumes[j] * (diff * diff);
  }
  const variance = sumWeightedSquaredDiff / cumVolume;
  const stdDev = Math.sqrt(variance);

  const upper1 = currentVWAP + stdDev;
  const lower1 = currentVWAP - stdDev;
  const upper2 = currentVWAP + (2 * stdDev);
  const lower2 = currentVWAP - (2 * stdDev);

  const currentPrice = close[n - 1];
  let relation: VWAPResult['relation'] = 'AT_VWAP';

  if (currentPrice > upper2) relation = 'EXTREME_OVERBOUGHT';
  else if (currentPrice < lower2) relation = 'EXTREME_OVERSOLD';
  else if (currentPrice > upper1) relation = 'ABOVE_VWAP';
  else if (currentPrice < lower1) relation = 'BELOW_VWAP';
  else if (currentPrice >= currentVWAP) relation = 'ABOVE_VWAP';
  else relation = 'BELOW_VWAP';

  return {
    vwap: Number(currentVWAP.toFixed(5)),
    upper1: Number(upper1.toFixed(5)),
    lower1: Number(lower1.toFixed(5)),
    upper2: Number(upper2.toFixed(5)),
    lower2: Number(lower2.toFixed(5)),
    relation
  };
}

export interface VolumeProfileResult {
  poc: number | null;
  vah: number | null;
  val: number | null;
  hvns: number[];
  lvns: number[];
  in_value_area: boolean;
  nearest_hvn: number | null;
}

export function calculateVolumeProfile(
  high: number[],
  low: number[],
  close: number[],
  volume?: number[],
  lookback = 50,
  numBins = 24
): VolumeProfileResult {
  const n = close.length;
  if (n === 0) {
    return { poc: null, vah: null, val: null, hvns: [], lvns: [], in_value_area: false, nearest_hvn: null };
  }

  const start = Math.max(0, n - lookback);
  const effectiveHighs = high.slice(start);
  const effectiveLows = low.slice(start);
  const effectiveCloses = close.slice(start);
  const rawVol = volume ? volume.slice(start) : [];
  const effectiveVols = rawVol.length === effectiveCloses.length ? rawVol : new Array(effectiveCloses.length).fill(1);

  const minPrice = Math.min(...effectiveLows);
  const maxPrice = Math.max(...effectiveHighs);
  const range = maxPrice - minPrice;

  if (range <= 0) {
    const p = close[n - 1];
    return { poc: p, vah: p, val: p, hvns: [p], lvns: [], in_value_area: true, nearest_hvn: p };
  }

  const binSize = range / numBins;
  const bins: { price: number; volume: number }[] = [];
  for (let b = 0; b < numBins; b++) {
    bins.push({ price: minPrice + (b + 0.5) * binSize, volume: 0 });
  }

  let totalVolume = 0;
  for (let i = 0; i < effectiveCloses.length; i++) {
    const barLow = effectiveLows[i];
    const barHigh = effectiveHighs[i];
    const barVol = effectiveVols[i] > 0 ? effectiveVols[i] : 1;
    totalVolume += barVol;

    let touchedBins = 0;
    const touchedIndices: number[] = [];
    for (let b = 0; b < numBins; b++) {
      const binBottom = minPrice + b * binSize;
      const binTop = binBottom + binSize;
      if (barHigh >= binBottom && barLow <= binTop) {
        touchedIndices.push(b);
        touchedBins++;
      }
    }

    if (touchedBins > 0) {
      const volPerBin = barVol / touchedBins;
      for (const idx of touchedIndices) {
        bins[idx].volume += volPerBin;
      }
    } else {
      const idx = Math.min(numBins - 1, Math.max(0, Math.floor((effectiveCloses[i] - minPrice) / binSize)));
      bins[idx].volume += barVol;
    }
  }

  // Find POC
  let maxVol = -1;
  let pocIndex = 0;
  for (let b = 0; b < numBins; b++) {
    if (bins[b].volume > maxVol) {
      maxVol = bins[b].volume;
      pocIndex = b;
    }
  }
  const poc = Number(bins[pocIndex].price.toFixed(5));

  // Compute Value Area (70% total volume centered around POC)
  const targetVaVolume = totalVolume * 0.70;
  let currentVaVol = bins[pocIndex].volume;
  let upIdx = pocIndex;
  let downIdx = pocIndex;

  while (currentVaVol < targetVaVolume && (upIdx < numBins - 1 || downIdx > 0)) {
    const nextUpVol = upIdx < numBins - 1 ? bins[upIdx + 1].volume : -1;
    const nextDownVol = downIdx > 0 ? bins[downIdx - 1].volume : -1;

    if (nextUpVol >= nextDownVol && upIdx < numBins - 1) {
      upIdx++;
      currentVaVol += bins[upIdx].volume;
    } else if (downIdx > 0) {
      downIdx--;
      currentVaVol += bins[downIdx].volume;
    } else if (upIdx < numBins - 1) {
      upIdx++;
      currentVaVol += bins[upIdx].volume;
    } else {
      break;
    }
  }

  const vah = Number((minPrice + (upIdx + 1) * binSize).toFixed(5));
  const val = Number((minPrice + downIdx * binSize).toFixed(5));

  // Identify High Volume Nodes (HVNs) and Low Volume Nodes (LVNs)
  const hvns: number[] = [];
  const lvns: number[] = [];
  const avgBinVol = totalVolume / numBins;

  for (let b = 1; b < numBins - 1; b++) {
    if (bins[b].volume > bins[b-1].volume && bins[b].volume > bins[b+1].volume && bins[b].volume > avgBinVol * 1.1) {
      hvns.push(Number(bins[b].price.toFixed(5)));
    } else if (bins[b].volume < bins[b-1].volume && bins[b].volume < bins[b+1].volume && bins[b].volume < avgBinVol * 0.7) {
      lvns.push(Number(bins[b].price.toFixed(5)));
    }
  }

  if (hvns.length === 0) {
    hvns.push(poc);
  }

  const currentPrice = close[n - 1];
  const in_value_area = currentPrice >= val && currentPrice <= vah;

  // Find nearest HVN
  let nearest_hvn: number | null = null;
  let minDist = Infinity;
  for (const hvn of hvns) {
    const dist = Math.abs(currentPrice - hvn);
    if (dist < minDist) {
      minDist = dist;
      nearest_hvn = hvn;
    }
  }

  return { poc, vah, val, hvns, lvns, in_value_area, nearest_hvn };
}

export interface VolumeSurgeResult {
  volume_ratio: number | null;
  volume_surge: boolean;
  volume_regime: 'VERY_HIGH' | 'HIGH' | 'NORMAL' | 'LOW' | 'ANEMIC';
}

export function detectVolumeSurge(volume?: number[], period = 20): VolumeSurgeResult {
  const n = volume ? volume.length : 0;
  if (n === 0 || !volume || !volume.some(v => v > 0)) {
    return { volume_ratio: 1.0, volume_surge: false, volume_regime: 'NORMAL' };
  }

  const currentVol = volume[n - 1] || 0;
  const lookback = Math.min(period, n - 1);
  if (lookback === 0) {
    return { volume_ratio: 1.0, volume_surge: false, volume_regime: 'NORMAL' };
  }

  let sum = 0;
  for (let i = n - 1 - lookback; i < n - 1; i++) {
    sum += volume[i] || 0;
  }
  const avgVol = sum / lookback;

  if (avgVol <= 0) {
    return { volume_ratio: 1.0, volume_surge: false, volume_regime: 'NORMAL' };
  }

  const ratio = Number((currentVol / avgVol).toFixed(2));
  let volume_regime: VolumeSurgeResult['volume_regime'] = 'NORMAL';

  if (ratio >= 2.0) volume_regime = 'VERY_HIGH';
  else if (ratio >= 1.4) volume_regime = 'HIGH';
  else if (ratio >= 0.7) volume_regime = 'NORMAL';
  else if (ratio >= 0.4) volume_regime = 'LOW';
  else volume_regime = 'ANEMIC';

  const volume_surge = ratio >= 1.5;

  return { volume_ratio: ratio, volume_surge, volume_regime };
}

export function detectLiquiditySweeps(
  high: number[], low: number[], close: number[], open: number[],
  bullish_fractals: {index: number, price: number}[],
  bearish_fractals: {index: number, price: number}[]
) {
  let liquidity_sweep_bullish = false;
  let liquidity_sweep_bearish = false;
  
  const n = close.length;
  if (n < 5) return { liquidity_sweep_bullish, liquidity_sweep_bearish };
  
  const currentLow = low[n-1];
  const currentHigh = high[n-1];
  const currentClose = close[n-1];
  const currentOpen = open[n-1];
  
  for (const frac of bullish_fractals.slice(-3)) {
    if (currentLow < frac.price && Math.max(currentClose, currentOpen) > frac.price) {
      liquidity_sweep_bullish = true;
    }
  }
  
  for (const frac of bearish_fractals.slice(-3)) {
    if (currentHigh > frac.price && Math.min(currentClose, currentOpen) < frac.price) {
      liquidity_sweep_bearish = true;
    }
  }
  return { liquidity_sweep_bullish, liquidity_sweep_bearish };
}

export function getMarketSession(utcDate: Date = new Date()): {
  session: 'ASIA' | 'LONDON_OPEN' | 'LONDON_SESSION' | 'NY_OPEN' | 'NY_AFTERNOON' | 'OFF_HOURS';
  killzone_active: boolean;
  name: string;
} {
  const hour = utcDate.getUTCHours();
  const minute = utcDate.getUTCMinutes();
  const timeNum = hour + minute / 60;

  if (timeNum >= 0 && timeNum < 6) {
    return { session: 'ASIA', killzone_active: false, name: 'Asian Accumulation Session' };
  } else if (timeNum >= 7 && timeNum <= 9.5) {
    return { session: 'LONDON_OPEN', killzone_active: true, name: 'London Open Killzone (Judas Sweep Window)' };
  } else if (timeNum > 9.5 && timeNum < 12.5) {
    return { session: 'LONDON_SESSION', killzone_active: false, name: 'London Morning Continuation' };
  } else if (timeNum >= 12.5 && timeNum <= 15.5) {
    return { session: 'NY_OPEN', killzone_active: true, name: 'New York Open Killzone (Institutional Volume)' };
  } else if (timeNum > 15.5 && timeNum <= 20) {
    return { session: 'NY_AFTERNOON', killzone_active: false, name: 'NY Afternoon / Trend Reversal Window' };
  } else {
    return { session: 'OFF_HOURS', killzone_active: false, name: 'Off-Hours Low Liquidity' };
  }
}

export function computeAsianRange(timestamps: string[], high: number[], low: number[], close: number[]): {
  asian_high: number | null;
  asian_low: number | null;
  asian_sweep: 'SWEPT_HIGH' | 'SWEPT_LOW' | 'NONE';
} {
  if (timestamps.length === 0 || high.length === 0) {
    return { asian_high: null, asian_low: null, asian_sweep: 'NONE' };
  }

  const now = new Date(timestamps[timestamps.length - 1]);
  const todayDateStr = now.toISOString().split('T')[0];

  let asianHigh = -Infinity;
  let asianLow = Infinity;
  let hasAsianBars = false;

  for (let i = 0; i < timestamps.length; i++) {
    const t = new Date(timestamps[i]);
    const dStr = t.toISOString().split('T')[0];
    const h = t.getUTCHours();
    if (dStr === todayDateStr && h >= 0 && h < 6) {
      hasAsianBars = true;
      if (high[i] > asianHigh) asianHigh = high[i];
      if (low[i] < asianLow) asianLow = low[i];
    }
  }

  if (!hasAsianBars || asianHigh === -Infinity || asianLow === Infinity) {
    return { asian_high: null, asian_low: null, asian_sweep: 'NONE' };
  }

  const currentPrice = close[close.length - 1];
  const lastBarHigh = high[high.length - 1];
  const lastBarLow = low[low.length - 1];

  let asian_sweep: 'SWEPT_HIGH' | 'SWEPT_LOW' | 'NONE' = 'NONE';
  if (lastBarHigh > asianHigh && currentPrice < asianHigh) {
    asian_sweep = 'SWEPT_HIGH';
  } else if (lastBarLow < asianLow && currentPrice > asianLow) {
    asian_sweep = 'SWEPT_LOW';
  }

  return {
    asian_high: Number(asianHigh.toFixed(5)),
    asian_low: Number(asianLow.toFixed(5)),
    asian_sweep
  };
}

export function computeNormalizedLevelDistance(currentPrice: number, targetLevel: number, atr: number | null, symbol?: string): {
  pctDistance: number;
  atrDistance: number | null;
  isSafeForTrade: boolean;
} {
  const diff = Math.abs(currentPrice - targetLevel);
  const pctDistance = (diff / currentPrice) * 100;
  const atrDistance = atr && atr > 0 ? diff / atr : null;

  // Indices & Crypto have wide swings, so 0.02% or 0.25x ATR is adequate room.
  const isIndexOrCrypto = symbol && ['US30', 'NAS100', 'GER30', 'SPX500', 'BTCUSD'].includes(symbol);
  const minThresholdPct = isIndexOrCrypto ? 0.02 : 0.08;
  const isSafeForTrade = pctDistance >= minThresholdPct || (atrDistance !== null && atrDistance >= 0.25);

  return {
    pctDistance: Number(pctDistance.toFixed(4)),
    atrDistance: atrDistance !== null ? Number(atrDistance.toFixed(2)) : null,
    isSafeForTrade
  };
}

export function getContextSnapshot(
  timestamps: string[],
  open: number[],
  high: number[],
  low: number[],
  close: number[],
  volumeOrSymbol?: number[] | string,
  symbolParam?: string
): LogicContext {
  let volume: number[] | undefined = undefined;
  let symbol: string | undefined = undefined;

  if (Array.isArray(volumeOrSymbol)) {
    volume = volumeOrSymbol;
    symbol = symbolParam;
  } else if (typeof volumeOrSymbol === 'string') {
    symbol = volumeOrSymbol;
  }

  // Edge case: Not enough data
  if (close.length === 0) {
    return {
      timestamp: new Date().toISOString(),
      current_price: 0,
      ema_50: null,
      ema_200: null,
      rsi_14: null,
      adx_14: null,
      atr_14: null,
      bb_upper: null,
      bb_lower: null,
      recent_swing_high: null,
      recent_swing_low: null,
      safe_long_stop_loss: null,
      safe_short_stop_loss: null,
      trend_alignment: 'CHOP',
      htf_support: [],
      htf_resistance: [],
      ltf_bos: 'NONE',
      candlestick_pattern: 'NONE',
      bullish_fvg_nearest: null,
      bearish_fvg_nearest: null,
      bullish_ob_nearest: null,
      bearish_ob_nearest: null,
      liquidity_sweep_bullish: false,
      liquidity_sweep_bearish: false,
      momentum_spike: 'NONE',
      macd_line: null,
      macd_signal: null,
      macd_histogram: null,
      vwap: null,
      vwap_upper_1: null,
      vwap_lower_1: null,
      vwap_upper_2: null,
      vwap_lower_2: null,
      vwap_relation: 'NONE',
      poc_price: null,
      vah_price: null,
      val_price: null,
      in_value_area: false,
      volume_ratio: 1.0,
      volume_surge: false,
      volume_regime: 'NORMAL',
      nearest_hvn: null,
    };
  }

  const current_price = close[close.length - 1];
  const timestamp = timestamps[timestamps.length - 1] || new Date().toISOString();

  // Calculate recent structural highs and lows using 5-bar fractals
  const { bullish_fractals, bearish_fractals } = calculateFractals(high, low);
  const ltf_bos = detectBOS(close, bullish_fractals, bearish_fractals);
  const recent_swing_high = bearish_fractals.length > 0 ? bearish_fractals[bearish_fractals.length - 1].price : null;
  const recent_swing_low = bullish_fractals.length > 0 ? bullish_fractals[bullish_fractals.length - 1].price : null;

  // SMC Calculations (with volume validation)
  const { bullish_fvg_nearest, bearish_fvg_nearest } = detectFVG(open, high, low, close);
  const { bullish_ob_nearest, bearish_ob_nearest } = detectOrderBlocks(open, high, low, close, volume);
  const { liquidity_sweep_bullish, liquidity_sweep_bearish } = detectLiquiditySweeps(high, low, close, open, bullish_fractals, bearish_fractals);

  // Smart Money Order Flow & Volume Calculations
  const vwapResult = calculateVWAP(timestamps, high, low, close, volume);
  const volProfile = calculateVolumeProfile(high, low, close, volume);
  const volSurge = detectVolumeSurge(volume);

  // Calculate indicators
  const ema50 = EMA.calculate({ period: 50, values: close });
  const ema200 = EMA.calculate({ period: 200, values: close });
  const rsi14 = RSI.calculate({ period: 14, values: close });
  const atr14 = ATR.calculate({ period: 14, high, low, close });
  const bb20 = BollingerBands.calculate({ period: 20, values: close, stdDev: 2 });
  
  let adx14: number[] = [];
  try {
    const adxResult = ADX.calculate({ period: 14, high, low, close });
    adx14 = adxResult.map(res => res.adx);
  } catch (e) {
    console.warn("ADX calculation failed:", e);
  }

  let macdResult: any[] = [];
  try {
    macdResult = MACD.calculate({ values: close, fastPeriod: 12, slowPeriod: 26, signalPeriod: 9, SimpleMAOscillator: false, SimpleMASignal: false });
  } catch (e) {
    console.warn("MACD calculation failed:", e);
  }

  const current_ema_50 = ema50.length > 0 ? ema50[ema50.length - 1] : null;
  const current_ema_200 = ema200.length > 0 ? ema200[ema200.length - 1] : null;
  const current_rsi_14 = rsi14.length > 0 ? rsi14[rsi14.length - 1] : null;
  const current_adx_14 = adx14.length > 0 ? adx14[adx14.length - 1] : null;
  const current_atr_14 = atr14.length > 0 ? atr14[atr14.length - 1] : null;
  
  const current_macd = macdResult.length > 0 ? macdResult[macdResult.length - 1] : null;
  
  const current_bb_upper = bb20.length > 0 ? bb20[bb20.length - 1].upper : null;
  const current_bb_lower = bb20.length > 0 ? bb20[bb20.length - 1].lower : null;

  // Momentum Spike Detection
  let momentum_spike: 'BULLISH' | 'BEARISH' | 'NONE' = 'NONE';
  if (current_adx_14 !== null && current_adx_14 > 25 && current_atr_14 !== null) {
    const last_body = close[close.length - 1] - open[open.length - 1];
    if (last_body > 1.5 * current_atr_14) momentum_spike = 'BULLISH';
    else if (last_body < -1.5 * current_atr_14) momentum_spike = 'BEARISH';
  }

  // Calculate safe structural stop loss boundaries
  const atrBuffer = current_atr_14 !== null ? current_atr_14 * 1.5 : 0;
  const safe_long_stop_loss = recent_swing_low !== null ? recent_swing_low - atrBuffer : null;
  const safe_short_stop_loss = recent_swing_high !== null ? recent_swing_high + atrBuffer : null;

  // Determine trend alignment
  let trend_alignment: 'BULLISH_TREND' | 'BULLISH_PULLBACK' | 'BEARISH_TREND' | 'BEARISH_PULLBACK' | 'CHOP' = 'CHOP';

  if (current_ema_50 !== null && current_ema_200 !== null && current_rsi_14 !== null) {
    if (current_ema_50 > current_ema_200) {
      // Macro Bullish
      if (current_price > current_ema_50 && current_rsi_14 >= 45) {
        trend_alignment = 'BULLISH_TREND';
      } else if (current_rsi_14 < 45) {
        trend_alignment = 'BULLISH_PULLBACK';
      }
    } else if (current_ema_50 < current_ema_200) {
      // Macro Bearish
      if (current_price < current_ema_50 && current_rsi_14 <= 55) {
        trend_alignment = 'BEARISH_TREND';
      } else if (current_rsi_14 > 55) {
        trend_alignment = 'BEARISH_PULLBACK';
      }
    }

    // Mathematical CHOP Overrides
    const emaSpread = Math.abs(current_ema_50 - current_ema_200) / current_ema_200;
    
    // 1. ADX Method: Trend strength is too weak
    let minAdxThreshold = 20;
    if (symbol && ['UKOIL', 'XAUUSD', 'XAGUSD'].includes(symbol)) {
      minAdxThreshold = 15;
    }
    if (current_adx_14 !== null && current_adx_14 < minAdxThreshold) {
      trend_alignment = 'CHOP';
    } 
    // 2. EMA Distance Method: MAs are tangling (less than 0.1% apart)
    else if (emaSpread < 0.001) {
      trend_alignment = 'CHOP';
    }
  }

  // Candlestick Pattern Evaluation
  let candlestick_pattern = 'NONE';
  if (close.length >= 3) {
    const n = close.length;
    const curr = { o: open[n-1], h: high[n-1], l: low[n-1], c: close[n-1] };
    const prev = { o: open[n-2], h: high[n-2], l: low[n-2], c: close[n-2] };
    const prev2 = { o: open[n-3], h: high[n-3], l: low[n-3], c: close[n-3] };
    
    if (isBullishEngulfing(prev, curr)) candlestick_pattern = 'BULLISH_ENGULFING';
    else if (isBearishEngulfing(prev, curr)) candlestick_pattern = 'BEARISH_ENGULFING';
    else if (isMorningStar(prev2, prev, curr)) candlestick_pattern = 'MORNING_STAR';
    else if (isEveningStar(prev2, prev, curr)) candlestick_pattern = 'EVENING_STAR';
    else if (isBullishRejection(prev, curr)) candlestick_pattern = 'BULLISH_REJECTION_PINBAR';
    else if (isBearishRejection(prev, curr)) candlestick_pattern = 'BEARISH_REJECTION_PINBAR';
  }

  // Session & Asian Range Calculations
  const marketSessionInfo = getMarketSession(new Date(timestamp));
  const asianRange = computeAsianRange(timestamps, high, low, close);
  const mean_reversion_target = volProfile.poc || (current_bb_upper !== null && current_bb_lower !== null ? Number(((current_bb_upper + current_bb_lower) / 2).toFixed(5)) : null);

  return {
    timestamp,
    current_price,
    ema_50: current_ema_50 ? Number(current_ema_50.toFixed(5)) : null,
    ema_200: current_ema_200 ? Number(current_ema_200.toFixed(5)) : null,
    rsi_14: current_rsi_14 ? Number(current_rsi_14.toFixed(2)) : null,
    adx_14: current_adx_14 ? Number(current_adx_14.toFixed(2)) : null,
    atr_14: current_atr_14 ? Number(current_atr_14.toFixed(5)) : null,
    bb_upper: current_bb_upper ? Number(current_bb_upper.toFixed(5)) : null,
    bb_lower: current_bb_lower ? Number(current_bb_lower.toFixed(5)) : null,
    recent_swing_high,
    recent_swing_low,
    safe_long_stop_loss: safe_long_stop_loss ? Number(safe_long_stop_loss.toFixed(5)) : null,
    safe_short_stop_loss: safe_short_stop_loss ? Number(safe_short_stop_loss.toFixed(5)) : null,
    trend_alignment,
    ltf_bos,
    candlestick_pattern,
    bullish_fvg_nearest,
    bearish_fvg_nearest,
    bullish_ob_nearest,
    bearish_ob_nearest,
    liquidity_sweep_bullish,
    liquidity_sweep_bearish,
    momentum_spike,
    macd_line: current_macd ? Number(current_macd.MACD?.toFixed(5)) : null,
    macd_signal: current_macd ? Number(current_macd.signal?.toFixed(5)) : null,
    macd_histogram: current_macd ? Number(current_macd.histogram?.toFixed(5)) : null,
    vwap: vwapResult.vwap,
    vwap_upper_1: vwapResult.upper1,
    vwap_lower_1: vwapResult.lower1,
    vwap_upper_2: vwapResult.upper2,
    vwap_lower_2: vwapResult.lower2,
    vwap_relation: vwapResult.relation,
    poc_price: volProfile.poc,
    vah_price: volProfile.vah,
    val_price: volProfile.val,
    in_value_area: volProfile.in_value_area,
    volume_ratio: volSurge.volume_ratio,
    volume_surge: volSurge.volume_surge,
    volume_regime: volSurge.volume_regime,
    nearest_hvn: volProfile.nearest_hvn,

    // Session & Killzone Engine
    market_session: marketSessionInfo.name,
    killzone_active: marketSessionInfo.killzone_active,
    asian_high: asianRange.asian_high,
    asian_low: asianRange.asian_low,
    asian_sweep: asianRange.asian_sweep,
    mean_reversion_target,
  };
}

export function isBullishEngulfing(prev: any, curr: any) {
  return (
    prev.c < prev.o &&
    curr.c > curr.o &&
    curr.o <= prev.c &&
    curr.c >= prev.o
  );
}

export function isBearishEngulfing(prev: any, curr: any) {
  return (
    prev.c > prev.o &&
    curr.c < curr.o &&
    curr.o >= prev.c &&
    curr.c <= prev.o
  );
}

export function isMorningStar(prev2: any, prev1: any, curr: any) {
  return (
    prev2.c < prev2.o &&
    Math.abs(prev1.c - prev1.o) < Math.abs(prev2.c - prev2.o) * 0.3 &&
    curr.c > curr.o &&
    curr.c > (prev2.c + prev2.o) / 2
  );
}

export function isEveningStar(prev2: any, prev1: any, curr: any) {
  return (
    prev2.c > prev2.o &&
    Math.abs(prev1.c - prev1.o) < Math.abs(prev2.c - prev2.o) * 0.3 &&
    curr.c < curr.o &&
    curr.c < (prev2.c + prev2.o) / 2
  );
}

export function isBullishRejection(prev: any, curr: any) {
  const body      = Math.abs(curr.c - curr.o);
  const lowerWick = Math.min(curr.o, curr.c) - curr.l;
  const isHammer  = lowerWick > body * 1.5 && curr.c > curr.o;
  return isHammer;
}

export function isBearishRejection(prev: any, curr: any) {
  const body      = Math.abs(curr.c - curr.o);
  const upperWick = curr.h - Math.max(curr.o, curr.c);
  const isStar    = upperWick > body * 1.5 && curr.c < curr.o;
  return isStar;
}

// ============================================================
// HTF FIBONACCI ALIGNMENT
// Checks whether the nearest daily Fib level and the nearest
// weekly Fib level converge within `tolerancePct` of each other.
// When aligned, the zone has dual-timeframe institutional weight
// and qualifies for a +5 confidence bonus in agent-swing.
// ============================================================
export interface FibAlignmentResult {
  aligned: boolean;
  dailyLevel: number | null;
  weeklyLevel: number | null;
  overlapPct: number | null;
}

export interface SimpleFibLevel {
  label: string;
  price: number;
  pct: number;
}

export function computeHtfFibAlignment(
  dailyFibLevels: SimpleFibLevel[],
  weeklyFibLevels: SimpleFibLevel[],
  currentPrice: number,
  tolerancePct = 0.003 // 0.3%
): FibAlignmentResult {
  if (!dailyFibLevels?.length || !weeklyFibLevels?.length) {
    return { aligned: false, dailyLevel: null, weeklyLevel: null, overlapPct: null };
  }

  // Find the nearest daily Fib level to current price
  const nearestDaily = dailyFibLevels
    .map((l) => ({ ...l, dist: Math.abs(l.price - currentPrice) }))
    .sort((a, b) => a.dist - b.dist)[0];

  // Find the nearest weekly Fib level to current price
  const nearestWeekly = weeklyFibLevels
    .map((l) => ({ ...l, dist: Math.abs(l.price - currentPrice) }))
    .sort((a, b) => a.dist - b.dist)[0];

  if (!nearestDaily || !nearestWeekly) {
    return { aligned: false, dailyLevel: null, weeklyLevel: null, overlapPct: null };
  }

  const overlapPct = Math.abs(nearestDaily.price - nearestWeekly.price) / nearestDaily.price;
  const aligned = overlapPct <= tolerancePct;

  if (aligned) {
    console.log(
      `[HtfFibAlign] Daily ${nearestDaily.label} @ ${nearestDaily.price} ≈ Weekly ${nearestWeekly.label} @ ${nearestWeekly.price} (overlap ${(overlapPct * 100).toFixed(3)}%) → +5 confidence`
    );
  }

  return {
    aligned,
    dailyLevel: nearestDaily.price,
    weeklyLevel: nearestWeekly.price,
    overlapPct,
  };
}

// ============================================================
// KELLY CRITERION — BAYESIAN PROBABILITY CALIBRATION
// Blends the AI's raw probability estimate with the symbol's
// historical win rate from trade_opportunities (WON / total).
// Alpha weight grows from 0 → 1 as the history reaches 20 trades,
// ensuring the prior only dominates once sufficient data exists.
//
// Formula: calibrated = α × historicalWinRate + (1−α) × rawProbability
// where    α = min(1, totalTrades / 20)
// ============================================================
export function calibrateProbability(
  rawProbability: number,   // AI-generated 1–99
  wonCount: number,
  lostCount: number
): number {
  const totalTrades = wonCount + lostCount;

  if (totalTrades === 0) {
    // No history — return AI estimate unchanged
    return rawProbability;
  }

  const historicalWinRate = (wonCount / totalTrades) * 100; // convert to 1-99 scale
  const alpha = Math.min(1, totalTrades / 20); // weight grows with sample size

  const calibrated = alpha * historicalWinRate + (1 - alpha) * rawProbability;
  const rounded = Math.round(calibrated * 10) / 10;

  console.log(
    `[KellyCalibration] Raw=${rawProbability.toFixed(1)}% | Historical=${historicalWinRate.toFixed(1)}% (n=${totalTrades}) | α=${alpha.toFixed(2)} | Calibrated=${rounded}%`
  );

  return rounded;
}

// ============================================================
// LIQUIDITY SWEEP SCORING
// Wraps detectLiquiditySweeps() boolean output into a named,
// human-readable pattern label with HTF trend alignment context.
// This gives the AI explicit, actionable narrative instead of
// raw boolean flags which it may underweight or ignore.
//
// BSL_SWEEP (Buy-Side Liquidity Sweep): Price wicked ABOVE a
//   bearish fractal (short squeeze trap), then closed back below.
//   → Cleared weak shorts. HIGH-CONVICTION LONG signal.
//
// SSL_SWEEP (Sell-Side Liquidity Sweep): Price wicked BELOW a
//   bullish fractal (long squeeze trap), then closed back above.
//   → Cleared weak longs. HIGH-CONVICTION SHORT signal.
// ============================================================
export type LiquiditySweepPattern = "BSL_SWEEP" | "SSL_SWEEP" | null;

export interface LiquiditySweepScore {
  pattern: LiquiditySweepPattern;
  htfAligned: boolean;
  directive: string;
}

export function computeLiquiditySweepScore(
  snapshot: LogicContext,
  htfTrend?: "BULLISH" | "BEARISH" | "NEUTRAL" | string | null
): LiquiditySweepScore {
  const { liquidity_sweep_bullish, liquidity_sweep_bearish } = snapshot;
  const trend = htfTrend?.toUpperCase() ?? "NEUTRAL";

  if (liquidity_sweep_bearish) {
    // Price wicked above bearish fractal resistance, then closed back below.
    // Bearish fractals = prior swing highs = pools of resting buy stops.
    // Clearing them indicates a short squeeze has been exhausted.
    const htfAligned = trend === "BULLISH";
    return {
      pattern: "BSL_SWEEP",
      htfAligned,
      directive:
        `[LIQUIDITY SWEEP DETECTED: BSL_SWEEP]\n` +
        `Price wicked above a prior swing high (bearish fractal resistance), triggering a short squeeze cascade, then closed back below the level.\n` +
        `Interpretation: Weak short positions have been cleared. Institutional buyers absorbing the liquidity.\n` +
        `Directive: ${htfAligned
          ? "HTF trend is BULLISH — this sweep CONFIRMS the macro direction. Treat any retest of the swept level as a HIGH-CONVICTION LONG entry."
          : "HTF trend is not bullish — proceed with caution. The sweep is valid but requires additional confluence before entering LONG."}`,
    };
  }

  if (liquidity_sweep_bullish) {
    // Price wicked below a bullish fractal (prior swing low = resting sell stops),
    // then closed back above. Weak longs have been stopped out.
    const htfAligned = trend === "BEARISH";
    return {
      pattern: "SSL_SWEEP",
      htfAligned,
      directive:
        `[LIQUIDITY SWEEP DETECTED: SSL_SWEEP]\n` +
        `Price wicked below a prior swing low (bullish fractal support), triggering a long squeeze, then closed back above the level.\n` +
        `Interpretation: Weak long positions have been stopped out. Institutions absorbing the sell-side liquidity.\n` +
        `Directive: ${htfAligned
          ? "HTF trend is BEARISH — this sweep CONFIRMS the macro direction. Treat any retest of the swept level as a HIGH-CONVICTION SHORT entry."
          : "HTF trend is not bearish — proceed with caution. The sweep is valid but requires additional confluence before entering SHORT."}`,
    };
  }

  return { pattern: null, htfAligned: false, directive: "" };
}

