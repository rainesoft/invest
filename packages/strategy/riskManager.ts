import { SupabaseClient } from "@supabase/supabase-js";
import { LogicContext } from "./indicators.ts";

export type RiskValidationResult = {
  valid: boolean;
  reason?: string;
};

const CORRELATION_GROUPS: Record<string, { group: string, weight: number }> = {
  'EURUSD': { group: 'USD', weight: -1 },
  'GBPUSD': { group: 'USD', weight: -1 },
  'XAUUSD': { group: 'USD', weight: -1 },
  'XAGUSD': { group: 'USD', weight: -1 },
  'BTCUSD': { group: 'USD', weight: -1 },
  'USDJPY': { group: 'USD', weight: 1 },
  'US30':   { group: 'EQUITY_INDICES', weight: 1 },
  'NAS100': { group: 'EQUITY_INDICES', weight: 1 },
};

// Validates if the central AI is allowed to generate a new signal for this asset
export async function validateGlobalSignal(
  supabase: SupabaseClient,
  symbol: string,
  currentSnapshot?: LogicContext
): Promise<RiskValidationResult> {
  // Fetch active and pending signals
  const { data: activeSignals, error: activeError } = await supabase
    .from("trade_opportunities")
    .select("id, symbol, side, entry_plan_json, stop_plan_json")
    .in("status", ["APPROVED", "PENDING_APPROVAL"])
    .eq("is_archived", false);

  if (activeError) {
    return { valid: false, reason: "Risk Check Failed: Could not query active signals" };
  }

  // Guardrail: Asset Isolation (Don't spam multiple signals for the same asset)
  // Smart Pyramiding Upgrade: Only block if we have an active trade that is NOT significantly in profit.
  if (activeSignals) {
    const activeForSymbol = activeSignals.filter(t => t.symbol === symbol);
    if (activeForSymbol.length > 0) {
      if (activeForSymbol.length >= 2) {
        return { valid: false, reason: `REJECTED: Maximum pyramiding capacity reached (2 trades active for ${symbol}).` };
      }

      if (currentSnapshot && currentSnapshot.current_price && currentSnapshot.atr_14) {
        const existingTrade = activeForSymbol[0];
        const entryPrice = existingTrade.entry_plan_json?.price;
        if (entryPrice) {
          const priceDiff = Math.abs(currentSnapshot.current_price - entryPrice);
          const atr = currentSnapshot.atr_14;
          // If the current price is at least 1 ATR away from the first entry, we consider it "in profit" and allow scaling in
          if (priceDiff > atr) {
            console.log(`[Risk Manager] Pyramiding approved for ${symbol}. Current price is > 1 ATR from original entry.`);
            // DO NOT return valid yet, we must check correlation limits below
          } else {
            return { valid: false, reason: `REJECTED: Asset isolation enforced. Active trade for ${symbol} is not far enough in profit (needs >1 ATR) to safely scale in.` };
          }
        }
      } else {
        return { valid: false, reason: `REJECTED: Asset isolation enforced. Signal already active for ${symbol}` };
      }
    }

    // Guardrail: Correlation Limits
    const symbolGroup = CORRELATION_GROUPS[symbol];
    if (symbolGroup && currentSnapshot) {
      let existingExposure = 0;
      
      for (const t of activeSignals) {
        // We only care about other assets in the same correlation group
        if (t.symbol !== symbol) {
          const activeGroup = CORRELATION_GROUPS[t.symbol];
          if (activeGroup && activeGroup.group === symbolGroup.group) {
            const activeWeight = (t.side === 'LONG' ? 1 : -1) * activeGroup.weight;
            existingExposure += activeWeight;
          }
        }
      }

      // Estimate the assumed direction of the new signal based on trend alignment
      let assumedSide = 'NONE';
      if (currentSnapshot.trend_alignment.startsWith('BULLISH')) assumedSide = 'LONG';
      else if (currentSnapshot.trend_alignment.startsWith('BEARISH')) assumedSide = 'SHORT';

      if (assumedSide !== 'NONE') {
        const assumedWeight = (assumedSide === 'LONG' ? 1 : -1) * symbolGroup.weight;
        const projectedExposure = existingExposure + assumedWeight;

        // If the absolute net exposure exceeds 1, we are stacking correlated trades. Reject.
        if (Math.abs(projectedExposure) > 1) {
          return { valid: false, reason: `REJECTED: Correlation limit exceeded. Cannot stack multiple correlated ${symbolGroup.group} trades.` };
        }
      }
    }
  }

  return { valid: true };
}

// Validates if a specific user can take a new trade based on their personal heat cap
export async function validateUserExposure(
  supabase: SupabaseClient,
  userId: string,
  newRiskAmount: number
): Promise<RiskValidationResult> {
  // Fetch user's active trades to calculate current heat
  const { data: userTrades, error: tradesError } = await supabase
    .from("user_trades")
    .select("risk_amount")
    .in("status", ["OPEN", "PENDING"]);

  if (tradesError) {
    return { valid: false, reason: "Failed to query user trades" };
  }

  // Fetch user's risk settings
  const { data: settings, error: settingsError } = await supabase
    .from("user_risk_settings")
    .select("portfolio_capital, max_portfolio_heat_pct")
    .eq("user_id", userId)
    .single();

  if (settingsError || !settings) {
    return { valid: false, reason: "User risk settings not found" };
  }

  let currentHeat = 0;
  if (userTrades) {
    currentHeat = userTrades.reduce((sum, trade) => sum + Number(trade.risk_amount), 0);
  }

  const maxHeat = Number(settings.portfolio_capital) * Number(settings.max_portfolio_heat_pct);

  if ((currentHeat + newRiskAmount) > maxHeat) {
    return { valid: false, reason: `REJECTED: Portfolio Heat limit (${Number(settings.max_portfolio_heat_pct) * 100}%) exceeded.` };
  }

  return { valid: true };
}

