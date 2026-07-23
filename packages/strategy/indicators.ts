import { EMA, RSI, ADX, ATR, BollingerBands } from 'technicalindicators';

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
  mtfa_ema_50?: number | null;
  mtfa_ema_200?: number | null;
  mtfa_trend?: 'BULLISH' | 'BEARISH' | 'CHOP';
  
  // SMC (Smart Money Concepts)
  bullish_fvg_nearest?: number | null;
  bearish_fvg_nearest?: number | null;
  bullish_ob_nearest?: number | null;
  bearish_ob_nearest?: number | null;
  liquidity_sweep_bullish?: boolean;
  liquidity_sweep_bearish?: boolean;
  momentum_spike?: 'BULLISH' | 'BEARISH' | 'NONE';
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

export function detectOrderBlocks(open: number[], high: number[], low: number[], close: number[]) {
  let bullish_ob_nearest: number | null = null;
  let bearish_ob_nearest: number | null = null;
  
  const n = close.length;
  const lookback = Math.min(30, n);
  
  for (let i = n - 2; i >= n - lookback; i--) {
    const body = Math.abs(close[i] - open[i]);
    const prevBody = Math.abs(close[i-1] - open[i-1]);
    
    // Bullish OB
    if (i >= 1 && close[i] > open[i] && body > prevBody * 1.5 && close[i-1] < open[i-1]) {
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
    if (i >= 1 && close[i] < open[i] && body > prevBody * 1.5 && close[i-1] > open[i-1]) {
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

export function getContextSnapshot(
  timestamps: string[],
  open: number[],
  high: number[],
  low: number[],
  close: number[]
): LogicContext {
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
    };
  }

  const current_price = close[close.length - 1];
  const timestamp = timestamps[timestamps.length - 1] || new Date().toISOString();

  // Calculate recent structural highs and lows using 5-bar fractals
  const { bullish_fractals, bearish_fractals } = calculateFractals(high, low);
  const ltf_bos = detectBOS(close, bullish_fractals, bearish_fractals);
  const recent_swing_high = bearish_fractals.length > 0 ? bearish_fractals[bearish_fractals.length - 1].price : null;
  const recent_swing_low = bullish_fractals.length > 0 ? bullish_fractals[bullish_fractals.length - 1].price : null;

  // SMC Calculations
  const { bullish_fvg_nearest, bearish_fvg_nearest } = detectFVG(open, high, low, close);
  const { bullish_ob_nearest, bearish_ob_nearest } = detectOrderBlocks(open, high, low, close);
  const { liquidity_sweep_bullish, liquidity_sweep_bearish } = detectLiquiditySweeps(high, low, close, open, bullish_fractals, bearish_fractals);

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
    // technicalindicators ADX might throw if arrays are not equal length or too short
    console.warn("ADX calculation failed:", e);
  }

  const current_ema_50 = ema50.length > 0 ? ema50[ema50.length - 1] : null;
  const current_ema_200 = ema200.length > 0 ? ema200[ema200.length - 1] : null;
  const current_rsi_14 = rsi14.length > 0 ? rsi14[rsi14.length - 1] : null;
  const current_adx_14 = adx14.length > 0 ? adx14[adx14.length - 1] : null;
  const current_atr_14 = atr14.length > 0 ? atr14[atr14.length - 1] : null;
  
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
    if (current_adx_14 !== null && current_adx_14 < 20) {
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

  return {
    timestamp,
    current_price,
    ema_50: current_ema_50 ? Number(current_ema_50.toFixed(2)) : null,
    ema_200: current_ema_200 ? Number(current_ema_200.toFixed(2)) : null,
    rsi_14: current_rsi_14 ? Number(current_rsi_14.toFixed(2)) : null,
    adx_14: current_adx_14 ? Number(current_adx_14.toFixed(2)) : null,
    atr_14: current_atr_14 ? Number(current_atr_14.toFixed(2)) : null,
    bb_upper: current_bb_upper ? Number(current_bb_upper.toFixed(2)) : null,
    bb_lower: current_bb_lower ? Number(current_bb_lower.toFixed(2)) : null,
    recent_swing_high,
    recent_swing_low,
    safe_long_stop_loss: safe_long_stop_loss ? Number(safe_long_stop_loss.toFixed(2)) : null,
    safe_short_stop_loss: safe_short_stop_loss ? Number(safe_short_stop_loss.toFixed(2)) : null,
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
