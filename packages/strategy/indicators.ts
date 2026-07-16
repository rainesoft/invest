import { EMA, RSI, ADX, ATR, BollingerBands } from 'technicalindicators';

export type LogicContext = {
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

export function getContextSnapshot(
  timestamps: string[],
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
    };
  }

  const current_price = close[close.length - 1];
  const timestamp = timestamps[timestamps.length - 1] || new Date().toISOString();

  // Calculate recent structural highs and lows using 5-bar fractals
  const { bullish_fractals, bearish_fractals } = calculateFractals(high, low);
  const ltf_bos = detectBOS(close, bullish_fractals, bearish_fractals);
  const recent_swing_high = bearish_fractals.length > 0 ? bearish_fractals[bearish_fractals.length - 1].price : null;
  const recent_swing_low = bullish_fractals.length > 0 ? bullish_fractals[bullish_fractals.length - 1].price : null;

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
    if (current_adx_14 !== null && current_adx_14 < 25) {
      trend_alignment = 'CHOP';
    } 
    // 2. EMA Distance Method: MAs are tangling (less than 0.5% apart)
    else if (emaSpread < 0.005) {
      trend_alignment = 'CHOP';
    }
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
  };
}
