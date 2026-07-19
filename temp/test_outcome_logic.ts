export function simulateOutcomeLogic(
  side: 'BULLISH' | 'BEARISH' | 'LONG' | 'SHORT',
  takeProfit: number,
  stopLoss: number,
  candles: { ts: string, h: number, l: number }[]
) {
  let outcome: 'WON' | 'LOST' | null = null;
  let rMultiple = 0;
  let closedAt = null;

  for (const candle of candles) {
    if (side === 'BULLISH' || side === 'LONG') {
      if (candle.l <= stopLoss) {
        outcome = 'LOST';
        rMultiple = -1.0;
        closedAt = candle.ts;
        break;
      } else if (candle.h >= takeProfit) {
        outcome = 'WON';
        rMultiple = 2.0;
        closedAt = candle.ts;
        break;
      }
    } else if (side === 'BEARISH' || side === 'SHORT') {
      if (candle.h >= stopLoss) {
        outcome = 'LOST';
        rMultiple = -1.0;
        closedAt = candle.ts;
        break;
      } else if (candle.l <= takeProfit) {
        outcome = 'WON';
        rMultiple = 2.0;
        closedAt = candle.ts;
        break;
      }
    }
  }

  return { outcome, rMultiple, closedAt };
}

// Mock Test
const mockCandles = [
  { ts: "2026-06-16T10:00:00Z", h: 66000, l: 65000 }, // Safe
  { ts: "2026-06-16T10:30:00Z", h: 67000, l: 65100 }, // Hits TP!
  { ts: "2026-06-16T11:00:00Z", h: 68000, l: 63000 }  // Would hit SL, but already won
];

const testResult = simulateOutcomeLogic('BULLISH', 66500, 64000, mockCandles);
console.log("Mock Test Result (BULLISH, TP=66500, SL=64000):", testResult);
// Expected: WON, R=2.0, closedAt=10:30:00Z
