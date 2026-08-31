import { EMA, RSI, ADX, ATR, BollingerBands, MACD } from "npm:technicalindicators@3.1.0";

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
  bullish_fvg_50pct?: number | null;
  bearish_fvg_nearest?: number | null;
  bearish_fvg_50pct?: number | null;
  bullish_ob_nearest?: number | null;
  bullish_ob_50pct?: number | null;
  bearish_ob_nearest?: number | null;
  bearish_ob_50pct?: number | null;
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

  // Trading Central Institutional Elements
  rsi_divergence?: 'REGULAR_BULLISH' | 'REGULAR_BEARISH' | 'HIDDEN_BULLISH' | 'HIDDEN_BEARISH' | 'NONE';
  rsi_divergence_narrative?: string;
  macd_divergence?: 'REGULAR_BULLISH' | 'REGULAR_BEARISH' | 'HIDDEN_BULLISH' | 'HIDDEN_BEARISH' | 'NONE';
  macd_divergence_narrative?: string;
  trend_channel?: {
    type: 'ASCENDING_CHANNEL' | 'DESCENDING_CHANNEL' | 'HORIZONTAL_CHANNEL' | 'NONE';
    upper_line: number;
    lower_line: number;
    midline: number;
    slope: number;
    channel_position: 'UPPER_BOUNDARY' | 'LOWER_BOUNDARY' | 'MID_CHANNEL' | 'OUTSIDE';
    channel_description: string;
  } | null;
  chart_pattern?: 'ASCENDING_TRIANGLE' | 'DESCENDING_TRIANGLE' | 'SYMMETRICAL_TRIANGLE' | 'RISING_WEDGE' | 'FALLING_WEDGE' | 'DOUBLE_TOP' | 'DOUBLE_BOTTOM' | 'HEAD_AND_SHOULDERS' | 'INVERSE_HEAD_AND_SHOULDERS' | 'RECTANGLE_RANGE' | 'NONE';
  chart_pattern_narrative?: string;
  has_unfilled_gap?: boolean;
  unfilled_gap_type?: 'BULLISH_GAP' | 'BEARISH_GAP' | 'NONE';
  unfilled_gap_target?: number | null;
  anticipation_horizon_bars?: number;
  anticipation_horizon_hours?: number;
  fibonacci_projections?: FibonacciProjectionsResult | null;
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
  let bullish_fvg_50pct: number | null = null;
  let bearish_fvg_nearest: number | null = null;
  let bearish_fvg_50pct: number | null = null;
  
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
        bullish_fvg_50pct = Number(((gapTop + gapBottom) / 2).toFixed(5));
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
        bearish_fvg_50pct = Number(((gapTop + gapBottom) / 2).toFixed(5));
      }
    }
  }
  return { bullish_fvg_nearest, bullish_fvg_50pct, bearish_fvg_nearest, bearish_fvg_50pct };
}

export function detectOrderBlocks(open: number[], high: number[], low: number[], close: number[], volume?: number[]) {
  let bullish_ob_nearest: number | null = null;
  let bullish_ob_50pct: number | null = null;
  let bearish_ob_nearest: number | null = null;
  let bearish_ob_50pct: number | null = null;
  
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
      const obLow = low[i-1];
      let mitigated = false;
      for (let j = i + 1; j < n; j++) {
        if (low[j] <= obHigh) mitigated = true;
      }
      if (!mitigated && !bullish_ob_nearest) {
        bullish_ob_nearest = obHigh;
        bullish_ob_50pct = Number(((obHigh + obLow) / 2).toFixed(5));
      }
    }
    
    // Bearish OB
    if (i >= 1 && close[i] < open[i] && body > prevBody * 1.5 && close[i-1] > open[i-1] && volumeConfirmed) {
      const obHigh = high[i-1];
      const obLow = low[i-1];
      let mitigated = false;
      for (let j = i + 1; j < n; j++) {
        if (high[j] >= obLow) mitigated = true;
      }
      if (!mitigated && !bearish_ob_nearest) {
        bearish_ob_nearest = obLow;
        bearish_ob_50pct = Number(((obHigh + obLow) / 2).toFixed(5));
      }
    }
  }
  return { bullish_ob_nearest, bullish_ob_50pct, bearish_ob_nearest, bearish_ob_50pct };
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
      bullish_fvg_50pct: null,
      bearish_fvg_nearest: null,
      bearish_fvg_50pct: null,
      bullish_ob_nearest: null,
      bullish_ob_50pct: null,
      bearish_ob_nearest: null,
      bearish_ob_50pct: null,
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
      rsi_divergence: 'NONE',
      rsi_divergence_narrative: undefined,
      macd_divergence: 'NONE',
      macd_divergence_narrative: undefined,
      trend_channel: null,
      chart_pattern: 'NONE',
      chart_pattern_narrative: undefined,
      has_unfilled_gap: false,
      unfilled_gap_type: 'NONE',
      unfilled_gap_target: null,
      anticipation_horizon_bars: 20,
      anticipation_horizon_hours: 10,
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
  const { bullish_fvg_nearest, bullish_fvg_50pct, bearish_fvg_nearest, bearish_fvg_50pct } = detectFVG(open, high, low, close);
  const { bullish_ob_nearest, bullish_ob_50pct, bearish_ob_nearest, bearish_ob_50pct } = detectOrderBlocks(open, high, low, close, volume);
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
    else if (isPiercingLine(prev, curr)) candlestick_pattern = 'PIERCING_LINE';
    else if (isDarkCloudCover(prev, curr)) candlestick_pattern = 'DARK_CLOUD_COVER';
    else if (isBullishHarami(prev, curr)) candlestick_pattern = 'BULLISH_HARAMI';
    else if (isBearishHarami(prev, curr)) candlestick_pattern = 'BEARISH_HARAMI';
    else if (isDoji(curr)) candlestick_pattern = 'DOJI_INDECISION';
  }

  // Session & Asian Range Calculations
  const marketSessionInfo = getMarketSession(new Date(timestamp));
  const asianRange = computeAsianRange(timestamps, high, low, close);
  const mean_reversion_target = volProfile.poc || (current_bb_upper !== null && current_bb_lower !== null ? Number(((current_bb_upper + current_bb_lower) / 2).toFixed(5)) : null);

  // Trading Central Chartist, Divergence & Gap Detection
  const divResult = detectDivergence(high, low, close, rsi14);
  const macdDivResult = detectMacdDivergence(high, low, close, macdResult.map((m: any) => m.histogram));
  const gapResult = detectPriceGaps(open, close, high, low);
  const channelResult = detectTrendChannels(high, low, close);
  const patternResult = detectGeometricPatterns(high, low, close);
  const fibProjResult = calculateFibonacciProjections(high, low, close);

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
    bullish_fvg_50pct,
    bearish_fvg_nearest,
    bearish_fvg_50pct,
    bullish_ob_nearest,
    bullish_ob_50pct,
    bearish_ob_nearest,
    bearish_ob_50pct,
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

    // Trading Central Institutional Elements
    rsi_divergence: divResult.divergence,
    rsi_divergence_narrative: divResult.description,
    macd_divergence: macdDivResult.divergence,
    macd_divergence_narrative: macdDivResult.description,
    trend_channel: channelResult.type !== 'NONE' ? channelResult : null,
    chart_pattern: patternResult.pattern,
    chart_pattern_narrative: patternResult.narrative || undefined,
    has_unfilled_gap: gapResult.has_unfilled_gap,
    unfilled_gap_type: gapResult.gap_type,
    unfilled_gap_target: gapResult.gap_close_price,
    anticipation_horizon_bars: 20,
    anticipation_horizon_hours: 10,
    fibonacci_projections: fibProjResult.has_valid_abc ? fibProjResult : null,
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

export function isDoji(curr: any) {
  const body = Math.abs(curr.c - curr.o);
  const range = curr.h - curr.l;
  return range > 0 && body <= range * 0.10;
}

export function isBullishHarami(prev: any, curr: any) {
  return (
    prev.c < prev.o &&
    curr.c > curr.o &&
    curr.o > prev.c &&
    curr.c < prev.o
  );
}

export function isBearishHarami(prev: any, curr: any) {
  return (
    prev.c > prev.o &&
    curr.c < curr.o &&
    curr.o < prev.c &&
    curr.c > prev.o
  );
}

export function isPiercingLine(prev: any, curr: any) {
  const prevMidpoint = (prev.o + prev.c) / 2;
  return (
    prev.c < prev.o &&
    curr.c > curr.o &&
    curr.o < prev.l &&
    curr.c > prevMidpoint &&
    curr.c < prev.o
  );
}

export function isDarkCloudCover(prev: any, curr: any) {
  const prevMidpoint = (prev.o + prev.c) / 2;
  return (
    prev.c > prev.o &&
    curr.c < curr.o &&
    curr.o > prev.h &&
    curr.c < prevMidpoint &&
    curr.c > prev.o
  );
}

// ============================================================
// CHARTIST TREND CHANNELS & TRENDLINES (Trading Central Methodology)
// Uses swing fractals and linear regression to identify parallel
// support and resistance trendlines forming ascending/descending channels.
// ============================================================
export interface TrendChannelResult {
  type: 'ASCENDING_CHANNEL' | 'DESCENDING_CHANNEL' | 'HORIZONTAL_CHANNEL' | 'NONE';
  upper_line: number;
  lower_line: number;
  midline: number;
  slope: number;
  channel_position: 'UPPER_BOUNDARY' | 'LOWER_BOUNDARY' | 'MID_CHANNEL' | 'OUTSIDE';
  channel_description: string;
}

export function detectTrendChannels(
  high: number[],
  low: number[],
  close: number[],
  lookback = 40
): TrendChannelResult {
  const defaultResult: TrendChannelResult = {
    type: 'NONE',
    upper_line: 0,
    lower_line: 0,
    midline: 0,
    slope: 0,
    channel_position: 'OUTSIDE',
    channel_description: 'No coherent channel established'
  };

  const n = close.length;
  if (n < 15) return defaultResult;

  const start = Math.max(0, n - lookback);
  const sliceH = high.slice(start);
  const sliceL = low.slice(start);
  const sliceC = close.slice(start);
  const m = sliceC.length;

  let { bullish_fractals, bearish_fractals } = calculateFractals(sliceH, sliceL);
  
  // Fallback to 3-bar swing pivots if 5-bar fractals are sparse
  if (bearish_fractals.length < 2) {
    const swingHighs: { index: number; price: number }[] = [];
    for (let i = 1; i < sliceH.length - 1; i++) {
      if (sliceH[i] >= sliceH[i-1] && sliceH[i] >= sliceH[i+1]) {
        swingHighs.push({ index: i, price: sliceH[i] });
      }
    }
    if (swingHighs.length >= 2) bearish_fractals = swingHighs;
  }

  if (bullish_fractals.length < 2) {
    const swingLows: { index: number; price: number }[] = [];
    for (let i = 1; i < sliceL.length - 1; i++) {
      if (sliceL[i] <= sliceL[i-1] && sliceL[i] <= sliceL[i+1]) {
        swingLows.push({ index: i, price: sliceL[i] });
      }
    }
    if (swingLows.length >= 2) bullish_fractals = swingLows;
  }

  if (bearish_fractals.length < 2 || bullish_fractals.length < 2) return defaultResult;

  // Linear regression on swing highs (resistance line)
  const xH = bearish_fractals.map(f => f.index);
  const yH = bearish_fractals.map(f => f.price);
  const nH = xH.length;
  const sumXH = xH.reduce((a, b) => a + b, 0);
  const sumYH = yH.reduce((a, b) => a + b, 0);
  const sumX2H = xH.reduce((a, b) => a + b * b, 0);
  const sumXYH = xH.reduce((acc, x, i) => acc + x * yH[i], 0);
  const denomH = (nH * sumX2H - sumXH * sumXH) || 1;
  const slopeH = (nH * sumXYH - sumXH * sumYH) / denomH;
  const interceptH = (sumYH - slopeH * sumXH) / nH;

  // Linear regression on swing lows (support line)
  const xL = bullish_fractals.map(f => f.index);
  const yL = bullish_fractals.map(f => f.price);
  const nL = xL.length;
  const sumXL = xL.reduce((a, b) => a + b, 0);
  const sumYL = yL.reduce((a, b) => a + b, 0);
  const sumX2L = xL.reduce((a, b) => a + b * b, 0);
  const sumXYL = xL.reduce((acc, x, i) => acc + x * yL[i], 0);
  const denomL = (nL * sumX2L - sumXL * sumXL) || 1;
  const slopeL = (nL * sumXYL - sumXL * sumYL) / denomL;
  const interceptL = (sumYL - slopeL * sumXL) / nL;

  const currentIdx = m - 1;
  const currentPrice = sliceC[currentIdx];
  const upperLine = Number((slopeH * currentIdx + interceptH).toFixed(5));
  const lowerLine = Number((slopeL * currentIdx + interceptL).toFixed(5));

  if (upperLine <= lowerLine) return defaultResult;

  const midline = Number(((upperLine + lowerLine) / 2).toFixed(5));
  const channelHeight = upperLine - lowerLine;
  const avgSlope = (slopeH + slopeL) / 2;
  const normSlope = avgSlope / currentPrice;

  let type: TrendChannelResult['type'] = 'NONE';
  if (normSlope > 0.0003 && slopeH > 0 && slopeL > 0) {
    type = 'ASCENDING_CHANNEL';
  } else if (normSlope < -0.0003 && slopeH < 0 && slopeL < 0) {
    type = 'DESCENDING_CHANNEL';
  } else if (Math.abs(normSlope) <= 0.0003) {
    type = 'HORIZONTAL_CHANNEL';
  } else {
    type = 'NONE';
  }

  let channel_position: TrendChannelResult['channel_position'] = 'MID_CHANNEL';
  if (currentPrice >= upperLine - channelHeight * 0.15 && currentPrice <= upperLine + channelHeight * 0.15) {
    channel_position = 'UPPER_BOUNDARY';
  } else if (currentPrice <= lowerLine + channelHeight * 0.15 && currentPrice >= lowerLine - channelHeight * 0.15) {
    channel_position = 'LOWER_BOUNDARY';
  } else if (currentPrice > upperLine + channelHeight * 0.15 || currentPrice < lowerLine - channelHeight * 0.15) {
    channel_position = 'OUTSIDE';
  } else {
    channel_position = 'MID_CHANNEL';
  }

  const desc = type !== 'NONE' 
    ? `${type.replace('_', ' ')} detected (Upper $${upperLine}, Lower $${lowerLine}, Mid $${midline}). Price is currently at ${channel_position.replace('_', ' ')}.`
    : 'No coherent channel established';

  return {
    type,
    upper_line: upperLine,
    lower_line: lowerLine,
    midline,
    slope: Number(avgSlope.toFixed(5)),
    channel_position,
    channel_description: desc
  };
}

// ============================================================
// GEOMETRIC REVERSAL & CONSOLIDATION PATTERNS (Trading Central)
// Triangles, Wedges, Double Tops/Bottoms, Head & Shoulders, Rectangles
// ============================================================
export type GeometricChartPattern = 
  | 'ASCENDING_TRIANGLE'
  | 'DESCENDING_TRIANGLE'
  | 'SYMMETRICAL_TRIANGLE'
  | 'RISING_WEDGE'
  | 'FALLING_WEDGE'
  | 'DOUBLE_TOP'
  | 'DOUBLE_BOTTOM'
  | 'HEAD_AND_SHOULDERS'
  | 'INVERSE_HEAD_AND_SHOULDERS'
  | 'RECTANGLE_RANGE'
  | 'NONE';

export interface GeometricPatternResult {
  pattern: GeometricChartPattern;
  narrative: string;
  key_level_1: number | null;
  key_level_2: number | null;
  breakout_target: number | null;
}

export function detectGeometricPatterns(
  high: number[],
  low: number[],
  close: number[],
  lookback = 45
): GeometricPatternResult {
  const defaultRes: GeometricPatternResult = {
    pattern: 'NONE',
    narrative: '',
    key_level_1: null,
    key_level_2: null,
    breakout_target: null
  };

  const n = close.length;
  if (n < 20) return defaultRes;

  const start = Math.max(0, n - lookback);
  const sliceH = high.slice(start);
  const sliceL = low.slice(start);
  const sliceC = close.slice(start);

  const { bullish_fractals, bearish_fractals } = calculateFractals(sliceH, sliceL);
  const currentPrice = sliceC[sliceC.length - 1];

  // 1. Check Double Top / Double Bottom
  if (bearish_fractals.length >= 2) {
    const p1 = bearish_fractals[bearish_fractals.length - 2];
    const p2 = bearish_fractals[bearish_fractals.length - 1];
    const diffPct = Math.abs(p1.price - p2.price) / p1.price;
    if (diffPct <= 0.0035 && p2.index - p1.index >= 4) {
      const interveningLows = sliceL.slice(p1.index, p2.index + 1);
      const neckline = Math.min(...interveningLows);
      const height = p1.price - neckline;
      if (height / currentPrice >= 0.005) {
        return {
          pattern: 'DOUBLE_TOP',
          narrative: `Double Top Reversal: Peaks at $${p1.price} and $${p2.price} with neckline support at $${neckline}. Bearish target $${Number((neckline - height).toFixed(5))}.`,
          key_level_1: Number(p1.price.toFixed(5)),
          key_level_2: Number(neckline.toFixed(5)),
          breakout_target: Number((neckline - height).toFixed(5))
        };
      }
    }
  }

  if (bullish_fractals.length >= 2) {
    const p1 = bullish_fractals[bullish_fractals.length - 2];
    const p2 = bullish_fractals[bullish_fractals.length - 1];
    const diffPct = Math.abs(p1.price - p2.price) / p1.price;
    if (diffPct <= 0.0035 && p2.index - p1.index >= 4) {
      const interveningHighs = sliceH.slice(p1.index, p2.index + 1);
      const neckline = Math.max(...interveningHighs);
      const height = neckline - p1.price;
      if (height / currentPrice >= 0.005) {
        return {
          pattern: 'DOUBLE_BOTTOM',
          narrative: `Double Bottom Reversal: Troughs at $${p1.price} and $${p2.price} with neckline resistance at $${neckline}. Bullish target $${Number((neckline + height).toFixed(5))}.`,
          key_level_1: Number(p1.price.toFixed(5)),
          key_level_2: Number(neckline.toFixed(5)),
          breakout_target: Number((neckline + height).toFixed(5))
        };
      }
    }
  }

  // 2. Check Head and Shoulders / Inverse Head and Shoulders
  if (bearish_fractals.length >= 3) {
    const left = bearish_fractals[bearish_fractals.length - 3];
    const head = bearish_fractals[bearish_fractals.length - 2];
    const right = bearish_fractals[bearish_fractals.length - 1];
    if (head.price > left.price && head.price > right.price && Math.abs(left.price - right.price) / left.price <= 0.008) {
      const interveningLows = sliceL.slice(left.index, right.index + 1);
      const neckline = Math.min(...interveningLows);
      const height = head.price - neckline;
      return {
        pattern: 'HEAD_AND_SHOULDERS',
        narrative: `Head & Shoulders Top: Left Shoulder $${left.price}, Head $${head.price}, Right Shoulder $${right.price}. Neckline at $${neckline}. Target $${Number((neckline - height).toFixed(5))}.`,
        key_level_1: Number(head.price.toFixed(5)),
        key_level_2: Number(neckline.toFixed(5)),
        breakout_target: Number((neckline - height).toFixed(5))
      };
    }
  }

  if (bullish_fractals.length >= 3) {
    const left = bullish_fractals[bullish_fractals.length - 3];
    const head = bullish_fractals[bullish_fractals.length - 2];
    const right = bullish_fractals[bullish_fractals.length - 1];
    if (head.price < left.price && head.price < right.price && Math.abs(left.price - right.price) / left.price <= 0.008) {
      const interveningHighs = sliceH.slice(left.index, right.index + 1);
      const neckline = Math.max(...interveningHighs);
      const height = neckline - head.price;
      return {
        pattern: 'INVERSE_HEAD_AND_SHOULDERS',
        narrative: `Inverse Head & Shoulders Bottom: Left Shoulder $${left.price}, Head $${head.price}, Right Shoulder $${right.price}. Neckline at $${neckline}. Target $${Number((neckline + height).toFixed(5))}.`,
        key_level_1: Number(head.price.toFixed(5)),
        key_level_2: Number(neckline.toFixed(5)),
        breakout_target: Number((neckline + height).toFixed(5))
      };
    }
  }

  // 3. Check Triangles & Wedges via multi-pivot slopes
  if (bearish_fractals.length >= 2 && bullish_fractals.length >= 2) {
    const h1 = bearish_fractals[bearish_fractals.length - 2];
    const h2 = bearish_fractals[bearish_fractals.length - 1];
    const l1 = bullish_fractals[bullish_fractals.length - 2];
    const l2 = bullish_fractals[bullish_fractals.length - 1];

    const hDiffPct = (h2.price - h1.price) / h1.price;
    const lDiffPct = (l2.price - l1.price) / l1.price;

    const flatThreshold = 0.0025;

    // Ascending Triangle: Flat Highs + Higher Lows
    if (Math.abs(hDiffPct) <= flatThreshold && lDiffPct > flatThreshold) {
      const height = h1.price - l1.price;
      return {
        pattern: 'ASCENDING_TRIANGLE',
        narrative: `Ascending Triangle: Flat Resistance at $${h1.price} with rising Higher Lows ($${l1.price} -> $${l2.price}). Bullish breakout continuation pattern with target $${Number((h1.price + height).toFixed(5))}.`,
        key_level_1: Number(h1.price.toFixed(5)),
        key_level_2: Number(l2.price.toFixed(5)),
        breakout_target: Number((h1.price + height).toFixed(5))
      };
    }

    // Descending Triangle: Flat Lows + Lower Highs
    if (Math.abs(lDiffPct) <= flatThreshold && hDiffPct < -flatThreshold) {
      const height = h1.price - l1.price;
      return {
        pattern: 'DESCENDING_TRIANGLE',
        narrative: `Descending Triangle: Flat Support at $${l1.price} with falling Lower Highs ($${h1.price} -> $${h2.price}). Bearish breakdown continuation pattern with target $${Number((l1.price - height).toFixed(5))}.`,
        key_level_1: Number(l1.price.toFixed(5)),
        key_level_2: Number(h2.price.toFixed(5)),
        breakout_target: Number((l1.price - height).toFixed(5))
      };
    }

    // Symmetrical Triangle: Lower Highs + Higher Lows
    if (hDiffPct < -flatThreshold && lDiffPct > flatThreshold) {
      const height = h1.price - l1.price;
      return {
        pattern: 'SYMMETRICAL_TRIANGLE',
        narrative: `Symmetrical Triangle: Converging Lower Highs ($${h1.price} -> $${h2.price}) and Higher Lows ($${l1.price} -> $${l2.price}). Volatility compression preceding breakout.`,
        key_level_1: Number(h2.price.toFixed(5)),
        key_level_2: Number(l2.price.toFixed(5)),
        breakout_target: Number((currentPrice + height * 0.8).toFixed(5))
      };
    }

    // Rising Wedge: Both sloping up, but lows rising faster than highs (bearish reversal)
    if (hDiffPct > flatThreshold && lDiffPct > flatThreshold && lDiffPct > hDiffPct * 1.3) {
      return {
        pattern: 'RISING_WEDGE',
        narrative: `Rising Wedge (Bearish Exhaustion): Price making higher highs with narrowing upward compression. Classic reversal pattern.`,
        key_level_1: Number(h2.price.toFixed(5)),
        key_level_2: Number(l2.price.toFixed(5)),
        breakout_target: Number(l1.price.toFixed(5))
      };
    }

    // Falling Wedge: Both sloping down, but highs falling faster than lows (bullish reversal)
    if (hDiffPct < -flatThreshold && lDiffPct < -flatThreshold && Math.abs(hDiffPct) > Math.abs(lDiffPct) * 1.3) {
      return {
        pattern: 'FALLING_WEDGE',
        narrative: `Falling Wedge (Bullish Exhaustion): Price making lower lows with narrowing downward compression. Classic reversal pattern.`,
        key_level_1: Number(h2.price.toFixed(5)),
        key_level_2: Number(l2.price.toFixed(5)),
        breakout_target: Number(h1.price.toFixed(5))
      };
    }

    // Rectangle Range: Both Highs and Lows flat
    if (Math.abs(hDiffPct) <= flatThreshold && Math.abs(lDiffPct) <= flatThreshold) {
      return {
        pattern: 'RECTANGLE_RANGE',
        narrative: `Rectangle Consolidation: Bound between Resistance $${h1.price} and Support $${l1.price}.`,
        key_level_1: Number(h1.price.toFixed(5)),
        key_level_2: Number(l1.price.toFixed(5)),
        breakout_target: null
      };
    }
  }

  return defaultRes;
}

// ============================================================
// MACD INDICATOR DIVERGENCE ENGINE (Trading Central Methodology)
// Identifies Regular & Hidden divergences between Price & MACD Histogram
// ============================================================
export interface MacdDivergenceResult {
  divergence: 'REGULAR_BULLISH' | 'REGULAR_BEARISH' | 'HIDDEN_BULLISH' | 'HIDDEN_BEARISH' | 'NONE';
  description: string;
}

export function detectMacdDivergence(
  high: number[],
  low: number[],
  close: number[],
  macdHistogram: (number | undefined)[],
  lookback = 35
): MacdDivergenceResult {
  const defaultRes: MacdDivergenceResult = { divergence: 'NONE', description: '' };
  if (!close || !macdHistogram || close.length < 15 || macdHistogram.length < 15) return defaultRes;

  const validHisto: number[] = macdHistogram.map(h => (typeof h === 'number' && !isNaN(h) ? h : 0));
  const sliceLow = low.slice(-lookback);
  const sliceHigh = high.slice(-lookback);
  const sliceHisto = validHisto.slice(-lookback);

  const swingLows: { idx: number; price: number; hist: number }[] = [];
  for (let i = 2; i < sliceLow.length - 2; i++) {
    if (
      sliceLow[i] <= sliceLow[i-1] && sliceLow[i] <= sliceLow[i-2] &&
      sliceLow[i] <= sliceLow[i+1] && sliceLow[i] <= sliceLow[i+2]
    ) {
      swingLows.push({ idx: i, price: sliceLow[i], hist: sliceHisto[i] });
    }
  }

  const swingHighs: { idx: number; price: number; hist: number }[] = [];
  for (let i = 2; i < sliceHigh.length - 2; i++) {
    if (
      sliceHigh[i] >= sliceHigh[i-1] && sliceHigh[i] >= sliceHigh[i-2] &&
      sliceHigh[i] >= sliceHigh[i+1] && sliceHigh[i] >= sliceHigh[i+2]
    ) {
      swingHighs.push({ idx: i, price: sliceHigh[i], hist: sliceHisto[i] });
    }
  }

  if (swingLows.length >= 2) {
    const p1 = swingLows[swingLows.length - 2];
    const p2 = swingLows[swingLows.length - 1];
    if (p2.price < p1.price && p2.hist > p1.hist + 0.0001) {
      return {
        divergence: 'REGULAR_BULLISH',
        description: `Regular Bullish MACD Divergence: Price printed Lower Low ($${p1.price} -> $${p2.price}) while MACD Histogram rose (${p1.hist.toFixed(4)} -> ${p2.hist.toFixed(4)}). Signals exhaustion of selling momentum.`
      };
    }
    if (p2.price > p1.price && p2.hist < p1.hist - 0.0001) {
      return {
        divergence: 'HIDDEN_BULLISH',
        description: `Hidden Bullish MACD Divergence: Price printed Higher Low ($${p1.price} -> $${p2.price}) while MACD Histogram fell (${p1.hist.toFixed(4)} -> ${p2.hist.toFixed(4)}). Signals bullish trend continuation.`
      };
    }
  }

  if (swingHighs.length >= 2) {
    const p1 = swingHighs[swingHighs.length - 2];
    const p2 = swingHighs[swingHighs.length - 1];
    if (p2.price > p1.price && p2.hist < p1.hist - 0.0001) {
      return {
        divergence: 'REGULAR_BEARISH',
        description: `Regular Bearish MACD Divergence: Price printed Higher High ($${p1.price} -> $${p2.price}) while MACD Histogram fell (${p1.hist.toFixed(4)} -> ${p2.hist.toFixed(4)}). Signals exhaustion of buying momentum.`
      };
    }
    if (p2.price < p1.price && p2.hist > p1.hist + 0.0001) {
      return {
        divergence: 'HIDDEN_BEARISH',
        description: `Hidden Bearish MACD Divergence: Price printed Lower High ($${p1.price} -> $${p2.price}) while MACD Histogram rose (${p1.hist.toFixed(4)} -> ${p2.hist.toFixed(4)}). Signals bearish trend continuation.`
      };
    }
  }

  return defaultRes;
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

// ============================================================
// RSI INDICATOR DIVERGENCE ENGINE (Trading Central Methodology)
// Identifies Regular and Hidden divergences across recent swing pivots:
// - Regular Bullish: Price Lower Low (LL) vs RSI Higher Low (HL) -> Reversal Long
// - Regular Bearish: Price Higher High (HH) vs RSI Lower High (LH) -> Reversal Short
// - Hidden Bullish:  Price Higher Low (HL) vs RSI Lower Low (LL) -> Continuation Long
// - Hidden Bearish: Price Lower High (LH) vs RSI Higher High (HH) -> Continuation Short
// ============================================================
export type RsiDivergenceType = 
  | "REGULAR_BULLISH" 
  | "REGULAR_BEARISH" 
  | "HIDDEN_BULLISH" 
  | "HIDDEN_BEARISH" 
  | "NONE";

export interface DivergenceResult {
  divergence: RsiDivergenceType;
  description: string;
  price_pivots: { p1: number; p2: number };
  rsi_pivots: { r1: number; r2: number };
}

export function detectDivergence(
  high: number[],
  low: number[],
  close: number[],
  rsi: number[],
  lookback = 35
): DivergenceResult {
  const defaultRes: DivergenceResult = {
    divergence: "NONE",
    description: "",
    price_pivots: { p1: 0, p2: 0 },
    rsi_pivots: { r1: 0, r2: 0 },
  };

  if (!close || !rsi || close.length < 15 || rsi.length < 15) return defaultRes;

  const sliceLow = low.slice(-lookback);
  const sliceHigh = high.slice(-lookback);
  const sliceRsi = rsi.slice(-lookback);

  // Find local swing lows (for bullish divergences)
  const swingLows: { idx: number; price: number; rsi: number }[] = [];
  for (let i = 2; i < sliceLow.length - 2; i++) {
    if (
      sliceLow[i] <= sliceLow[i - 1] &&
      sliceLow[i] <= sliceLow[i - 2] &&
      sliceLow[i] <= sliceLow[i + 1] &&
      sliceLow[i] <= sliceLow[i + 2]
    ) {
      swingLows.push({ idx: i, price: sliceLow[i], rsi: sliceRsi[i] });
    }
  }

  // Find local swing highs (for bearish divergences)
  const swingHighs: { idx: number; price: number; rsi: number }[] = [];
  for (let i = 2; i < sliceHigh.length - 2; i++) {
    if (
      sliceHigh[i] >= sliceHigh[i - 1] &&
      sliceHigh[i] >= sliceHigh[i - 2] &&
      sliceHigh[i] >= sliceHigh[i + 1] &&
      sliceHigh[i] >= sliceHigh[i + 2]
    ) {
      swingHighs.push({ idx: i, price: sliceHigh[i], rsi: sliceRsi[i] });
    }
  }

  // Check Bullish Divergences (last 2 swing lows)
  if (swingLows.length >= 2) {
    const p1 = swingLows[swingLows.length - 2];
    const p2 = swingLows[swingLows.length - 1];

    // Regular Bullish: Price Lower Low, RSI Higher Low
    if (p2.price < p1.price && p2.rsi > p1.rsi + 1.5) {
      return {
        divergence: "REGULAR_BULLISH",
        description: `Regular Bullish Divergence: Price printed Lower Low ($${p1.price} -> $${p2.price}) while RSI printed Higher Low (${p1.rsi.toFixed(1)} -> ${p2.rsi.toFixed(1)}). Signals institutional exhaustion of selling pressure.`,
        price_pivots: { p1: p1.price, p2: p2.price },
        rsi_pivots: { r1: p1.rsi, r2: p2.rsi },
      };
    }

    // Hidden Bullish: Price Higher Low, RSI Lower Low
    if (p2.price > p1.price && p2.rsi < p1.rsi - 1.5) {
      return {
        divergence: "HIDDEN_BULLISH",
        description: `Hidden Bullish Divergence: Price printed Higher Low ($${p1.price} -> $${p2.price}) while RSI printed Lower Low (${p1.rsi.toFixed(1)} -> ${p2.rsi.toFixed(1)}). Signals bullish trend continuation.`,
        price_pivots: { p1: p1.price, p2: p2.price },
        rsi_pivots: { r1: p1.rsi, r2: p2.rsi },
      };
    }
  }

  // Check Bearish Divergences (last 2 swing highs)
  if (swingHighs.length >= 2) {
    const p1 = swingHighs[swingHighs.length - 2];
    const p2 = swingHighs[swingHighs.length - 1];

    // Regular Bearish: Price Higher High, RSI Lower High
    if (p2.price > p1.price && p2.rsi < p1.rsi - 1.5) {
      return {
        divergence: "REGULAR_BEARISH",
        description: `Regular Bearish Divergence: Price printed Higher High ($${p1.price} -> $${p2.price}) while RSI printed Lower High (${p1.rsi.toFixed(1)} -> ${p2.rsi.toFixed(1)}). Signals institutional exhaustion of buying momentum.`,
        price_pivots: { p1: p1.price, p2: p2.price },
        rsi_pivots: { r1: p1.rsi, r2: p2.rsi },
      };
    }

    // Hidden Bearish: Price Lower High, RSI Higher High
    if (p2.price < p1.price && p2.rsi > p1.rsi + 1.5) {
      return {
        divergence: "HIDDEN_BEARISH",
        description: `Hidden Bearish Divergence: Price printed Lower High ($${p1.price} -> $${p2.price}) while RSI printed Higher High (${p1.rsi.toFixed(1)} -> ${p2.rsi.toFixed(1)}). Signals bearish trend continuation.`,
        price_pivots: { p1: p1.price, p2: p2.price },
        rsi_pivots: { r1: p1.rsi, r2: p2.rsi },
      };
    }
  }

  return defaultRes;
}

// ============================================================
// PRICE GAP DETECTION ENGINE (Trading Central Methodology)
// Identifies Weekend & Session Opening Gaps that act as institutional liquidity targets.
// ============================================================
export interface PriceGapInfo {
  has_unfilled_gap: boolean;
  gap_type: "BULLISH_GAP" | "BEARISH_GAP" | "NONE";
  gap_open_price: number | null;
  gap_close_price: number | null;
  gap_distance: number;
}

export function detectPriceGaps(
  open: number[],
  close: number[],
  high: number[],
  low: number[],
  lookback = 12
): PriceGapInfo {
  const defaultGap: PriceGapInfo = {
    has_unfilled_gap: false,
    gap_type: "NONE",
    gap_open_price: null,
    gap_close_price: null,
    gap_distance: 0,
  };

  if (!open || !close || open.length < 5 || close.length < 5) return defaultGap;

  const startIdx = Math.max(1, open.length - lookback);

  for (let i = open.length - 1; i >= startIdx; i--) {
    const prevClose = close[i - 1];
    const currOpen = open[i];
    const gapSize = currOpen - prevClose;
    const gapPct = Math.abs(gapSize) / prevClose;

    // Minimum gap threshold 0.15% to filter out normal spread noise
    if (gapPct >= 0.0015) {
      if (gapSize > 0) {
        // Bullish Gap Up: prevClose < currOpen. Unfilled if low of all subsequent candles > prevClose
        const subsequentLows = low.slice(i);
        const minSubsequentLow = Math.min(...subsequentLows);
        const isUnfilled = minSubsequentLow > prevClose;

        if (isUnfilled) {
          return {
            has_unfilled_gap: true,
            gap_type: "BULLISH_GAP",
            gap_open_price: currOpen,
            gap_close_price: prevClose,
            gap_distance: Number(gapSize.toFixed(5)),
          };
        }
      } else {
        // Bearish Gap Down: currOpen < prevClose. Unfilled if high of all subsequent candles < prevClose
        const subsequentHighs = high.slice(i);
        const maxSubsequentHigh = Math.max(...subsequentHighs);
        const isUnfilled = maxSubsequentHigh < prevClose;

        if (isUnfilled) {
          return {
            has_unfilled_gap: true,
            gap_type: "BEARISH_GAP",
            gap_open_price: currOpen,
            gap_close_price: prevClose,
            gap_distance: Number(Math.abs(gapSize).toFixed(5)),
          };
        }
      }
    }
  }

  return defaultGap;
}

// ============================================================
// TRADING CENTRAL RISK/REWARD & SCENARIO ENGINE
// Enforces minimum 1:1.70 R:R against Target 2 (TP2).
// Solves for the optimal pullback entry zone if market R:R < 1.70.
// Generates the bifurcated alternative scenario beyond the Pivot.
// ============================================================
export interface TradingCentralLevels {
  pivot_point: number;
  direction: "LONG" | "SHORT";
  tp1: number;
  tp2: number;
  current_rr_tp2: number;
  min_rr_satisfied: boolean;
  suggested_entry_price: number;
  order_type: "BUY MARKET" | "SELL MARKET" | "BUY LIMIT" | "SELL LIMIT";
  alternative_scenario: {
    direction: "SHORT" | "LONG";
    trigger_condition: string;
    target_1: number;
    target_2: number;
  };
}

export function calculateInstitutionalTradingCentralLevels(
  currentPrice: number,
  pivotSl: number,
  tp1: number,
  tp2: number,
  direction: "LONG" | "SHORT",
  minRr = 1.70
): TradingCentralLevels {
  const isLong = direction === "LONG";
  const riskDist = Math.abs(currentPrice - pivotSl);
  const rewardTp2 = Math.abs(tp2 - currentPrice);
  const currentRr = riskDist > 0 ? Number((rewardTp2 / riskDist).toFixed(2)) : 0;
  const minRrSatisfied = currentRr >= minRr;

  let suggestedEntry = currentPrice;
  let orderType: "BUY MARKET" | "SELL MARKET" | "BUY LIMIT" | "SELL LIMIT" = isLong ? "BUY MARKET" : "SELL MARKET";

  if (!minRrSatisfied && Math.abs(tp2 - pivotSl) > 0) {
    // Solve for Entry where (TP2 - Entry) / (Entry - Pivot) = 1.75
    // => Entry = Pivot + (TP2 - Pivot) / (1 + 1.75)
    const totalSpan = Math.abs(tp2 - pivotSl);
    const requiredRiskDist = totalSpan / (1 + minRr + 0.05); // 1.75 factor
    suggestedEntry = isLong
      ? Number((pivotSl + requiredRiskDist).toFixed(5))
      : Number((pivotSl - requiredRiskDist).toFixed(5));
    orderType = isLong ? "BUY LIMIT" : "SELL LIMIT";
  }

  // Alternative Scenario (Beyond Pivot)
  const altDirection = isLong ? "SHORT" : "LONG";
  const altSpan = Math.abs(currentPrice - pivotSl);
  const altTp1 = isLong ? Number((pivotSl - altSpan).toFixed(5)) : Number((pivotSl + altSpan).toFixed(5));
  const altTp2 = isLong ? Number((pivotSl - (altSpan * 1.8)).toFixed(5)) : Number((pivotSl + (altSpan * 1.8)).toFixed(5));

  return {
    pivot_point: pivotSl,
    direction,
    tp1,
    tp2,
    current_rr_tp2: currentRr,
    min_rr_satisfied: minRrSatisfied,
    suggested_entry_price: suggestedEntry,
    order_type: orderType,
    alternative_scenario: {
      direction: altDirection,
      trigger_condition: `A confirmed bar close ${isLong ? "below" : "above"} the Pivot Point ($${pivotSl}) invalidates the ${direction} thesis.`,
      target_1: altTp1,
      target_2: altTp2,
    },
  };
}

// ============================================================
// 3-POINT FIBONACCI PROJECTIONS / EXPANSIONS (Trading Central Methodology)
// Measures Swing A -> B and projects from Pullback Point C:
// Target = C + Ratio * (B - A) for Bullish Expansion
// Target = C - Ratio * (A - B) for Bearish Expansion
// Standard Institutional Ratios: 61.8%, 100.0% (Equality), 127.2%, 161.8%, 200.0%, 261.8%
// ============================================================
export interface FibonacciProjection {
  label: string;
  ratio: number;
  price: number;
}

export interface FibonacciProjectionsResult {
  has_valid_abc: boolean;
  direction: 'BULLISH_EXPANSION' | 'BEARISH_EXPANSION' | 'NONE';
  point_a: number | null;
  point_b: number | null;
  point_c: number | null;
  projections: FibonacciProjection[];
  narrative: string;
}

export function calculateFibonacciProjections(
  high: number[],
  low: number[],
  close: number[],
  lookback = 60
): FibonacciProjectionsResult {
  const defaultResult: FibonacciProjectionsResult = {
    has_valid_abc: false,
    direction: 'NONE',
    point_a: null,
    point_b: null,
    point_c: null,
    projections: [],
    narrative: 'No completed 3-point ABC swing formation established'
  };

  const n = close.length;
  if (n < 15) return defaultResult;

  const start = Math.max(0, n - lookback);
  const sliceH = high.slice(start);
  const sliceL = low.slice(start);
  const sliceC = close.slice(start);

  const { bullish_fractals, bearish_fractals } = calculateFractals(sliceH, sliceL);

  // Check for most recent Bullish ABC (Swing Low A -> Swing High B -> Pullback Low C)
  if (bullish_fractals.length >= 2 && bearish_fractals.length >= 1) {
    const lastBullish = bullish_fractals[bullish_fractals.length - 1]; // Candidate C
    const priorBullish = bullish_fractals[bullish_fractals.length - 2]; // Candidate A

    // Find intermediate swing high B between A and C
    const intermediateBearish = bearish_fractals.filter(
      b => b.index > priorBullish.index && b.index < lastBullish.index
    );

    if (intermediateBearish.length > 0) {
      const bHigh = intermediateBearish.sort((a, b) => b.price - a.price)[0];
      const aLow = priorBullish;
      const cLow = lastBullish;

      if (bHigh.price > aLow.price && cLow.price > aLow.price && cLow.price < bHigh.price) {
        const waveAB = bHigh.price - aLow.price;
        const ratios = [0.618, 1.0, 1.272, 1.618, 2.0, 2.618];
        const projections: FibonacciProjection[] = ratios.map(r => ({
          label: `${(r * 100).toFixed(1)}% Proj`,
          ratio: r,
          price: Number((cLow.price + waveAB * r).toFixed(5))
        }));

        return {
          has_valid_abc: true,
          direction: 'BULLISH_EXPANSION',
          point_a: Number(aLow.price.toFixed(5)),
          point_b: Number(bHigh.price.toFixed(5)),
          point_c: Number(cLow.price.toFixed(5)),
          projections,
          narrative: `Bullish 3-Point Fib Expansion: Swing A ($${aLow.price}) -> Swing B ($${bHigh.price}) projected from Pullback C ($${cLow.price}). 100% Measured Target: $${(cLow.price + waveAB).toFixed(5)}, 161.8% Target: $${(cLow.price + waveAB * 1.618).toFixed(5)}.`
        };
      }
    }
  }

  // Check for most recent Bearish ABC (Swing High A -> Swing Low B -> Pullback High C)
  if (bearish_fractals.length >= 2 && bullish_fractals.length >= 1) {
    const lastBearish = bearish_fractals[bearish_fractals.length - 1]; // Candidate C
    const priorBearish = bearish_fractals[bearish_fractals.length - 2]; // Candidate A

    // Find intermediate swing low B between A and C
    const intermediateBullish = bullish_fractals.filter(
      b => b.index > priorBearish.index && b.index < lastBearish.index
    );

    if (intermediateBullish.length > 0) {
      const bLow = intermediateBullish.sort((a, b) => a.price - b.price)[0];
      const aHigh = priorBearish;
      const cHigh = lastBearish;

      if (bLow.price < aHigh.price && cHigh.price < aHigh.price && cHigh.price > bLow.price) {
        const waveAB = aHigh.price - bLow.price;
        const ratios = [0.618, 1.0, 1.272, 1.618, 2.0, 2.618];
        const projections: FibonacciProjection[] = ratios.map(r => ({
          label: `${(r * 100).toFixed(1)}% Proj`,
          ratio: r,
          price: Number((cHigh.price - waveAB * r).toFixed(5))
        }));

        return {
          has_valid_abc: true,
          direction: 'BEARISH_EXPANSION',
          point_a: Number(aHigh.price.toFixed(5)),
          point_b: Number(bLow.price.toFixed(5)),
          point_c: Number(cHigh.price.toFixed(5)),
          projections,
          narrative: `Bearish 3-Point Fib Expansion: Swing A ($${aHigh.price}) -> Swing B ($${bLow.price}) projected from Pullback C ($${cHigh.price}). 100% Measured Target: $${(cHigh.price - waveAB).toFixed(5)}, 161.8% Target: $${(cHigh.price - waveAB * 1.618).toFixed(5)}.`
        };
      }
    }
  }

  return defaultResult;
}



