import { SupabaseClient } from "npm:@supabase/supabase-js@2.108.2";
import { LogicContext } from "./indicators.ts";

export type RiskValidationResult = {
  valid: boolean;
  reason?: string;
};

const CORRELATION_GROUPS: Record<string, { group: string, weight: number }> = {
  // US Dollar Basket
  'EURUSD': { group: 'USD', weight: -1 },
  'GBPUSD': { group: 'USD', weight: -1 },
  'AUDUSD': { group: 'USD', weight: -1 },
  'NZDUSD': { group: 'USD', weight: -1 },
  'XAUUSD': { group: 'USD', weight: -1 },
  'XAGUSD': { group: 'USD', weight: -1 },
  'BTCUSD': { group: 'USD', weight: -1 },
  'USDJPY': { group: 'USD', weight: 1 },
  'USDCHF': { group: 'USD', weight: 1 },
  'USDCAD': { group: 'USD', weight: 1 },

  // Global Equity Indices Basket
  'US30':   { group: 'EQUITY_INDICES', weight: 1 },
  'NAS100': { group: 'EQUITY_INDICES', weight: 1 },
  'SPX500': { group: 'EQUITY_INDICES', weight: 1 },
  'GER30':  { group: 'EQUITY_INDICES', weight: 1 },

  // Energy Basket
  'UKOIL':  { group: 'ENERGY', weight: 1 },
  'USOIL':  { group: 'ENERGY', weight: 1 },

  // JPY Crosses Basket
  'GBPJPY': { group: 'JPY_CROSSES', weight: 1 },
  'EURJPY': { group: 'JPY_CROSSES', weight: 1 },
  'CADJPY': { group: 'JPY_CROSSES', weight: 1 },
};

// Validates if the central AI is allowed to generate a new signal for this asset
export async function validateGlobalSignal(
  supabase: SupabaseClient,
  symbol: string,
  currentSnapshot?: LogicContext,
  isManual: boolean = false
): Promise<RiskValidationResult> {
  if (isManual) {
    console.log(`[Risk Manager] Manual bypass engaged for ${symbol}. Skipping correlation and isolation guards.`);
    return { valid: true };
  }
  // Fetch active and pending signals
  const { data: activeSignals, error: activeError } = await supabase
    .from("trade_opportunities")
    .select("id, symbol, side, entry_plan_json, stop_plan_json")
    .in("status", ["APPROVED", "PENDING_APPROVAL"])
    .eq("is_archived", false);

  if (activeError) {
    return { valid: false, reason: "Risk Check Failed: Could not query active signals" };
  }

  // --- GUARD: Check for OPEN & PENDING trades in user_trades ---
  const { data: openTrades, error: openTradesError } = await supabase
    .from("user_trades")
    .select("id, symbol, side, status, open_price, created_at, meta_api_order_id, opportunity_id")
    .in("status", ["OPEN", "VPS_PENDING", "VPS_PROCESSING"]);
    
  if (openTradesError) {
    return { valid: false, reason: "Risk Check Failed: Could not query open trades" };
  }

  const liveTradesForSymbol = openTrades ? openTrades.filter(t => t.symbol === symbol) : [];
  if (liveTradesForSymbol.length > 0) {
    // Check if the trade is truly a filled active position
    const hasFilledPosition = liveTradesForSymbol.some(t => t.open_price !== null && t.open_price !== undefined);
    
    // Check age of pending trades
    const now = Date.now();
    const hasFreshPendingOrder = liveTradesForSymbol.some(t => {
      const createdAt = t.created_at ? new Date(t.created_at).getTime() : 0;
      const ageHours = (now - createdAt) / (1000 * 60 * 60);
      return ageHours < 2; // Under 2 hours is considered active pending
    });

    if (hasFilledPosition) {
      return { valid: false, reason: `REJECTED: Strict 1-trade-per-symbol isolation. A live filled position for ${symbol} is already OPEN.` };
    } else if (hasFreshPendingOrder) {
      return { valid: false, reason: `REJECTED: Strict 1-trade-per-symbol isolation. A fresh pending order for ${symbol} is awaiting fill (<2h old).` };
    } else {
      // Stale pending limit order (>2h unfilled). Auto-cancel/expire it and allow the new high-conviction signal!
      console.log(`[Risk Manager] Found stale unfilled pending order for ${symbol} (>2h old). Superseding with fresh signal.`);
      for (const staleTrade of liveTradesForSymbol) {
        await supabase.from("user_trades").update({ 
          status: "CLOSED", 
          error_message: "Superseded by fresh AI signal" 
        }).eq("id", staleTrade.id);
        if (staleTrade.opportunity_id) {
          await supabase.from("trade_opportunities").update({ 
            status: "EXPIRED", 
            closed_at: new Date().toISOString() 
          }).eq("id", staleTrade.opportunity_id).in("status", ["ACTIVE", "APPROVED", "QUEUED"]);
        }
      }
    }
  }

  // --- CONSECUTIVE STOP-LOSS COOLDOWN (Cascade & Knife-Catching Guard) ---
  const fourHoursAgo = new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString();
  const { data: recentLosses } = await supabase
    .from("user_trades")
    .select("id, symbol, side, closed_at, status")
    .eq("symbol", symbol)
    .eq("status", "LOST")
    .gte("closed_at", fourHoursAgo)
    .limit(1);

  if (recentLosses && recentLosses.length > 0) {
    const lastLoss = recentLosses[0];
    return {
      valid: false,
      reason: `REJECTED: Stop-loss cooldown active for ${symbol}. Trade stopped out within the last 4 hours (${lastLoss.closed_at}). Cooling down to prevent knife-catching.`,
    };
  }
  // --------------------------------------------------------

  // Guardrail: Asset Isolation (Don't spam multiple signals for the same asset)
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
          // If the current price is at least 0.50 ATR away from the first entry, allow scaling in
          if (priceDiff > atr * 0.50) {
            console.log(`[Risk Manager] Pyramiding approved for ${symbol}. Current price is > 0.50 ATR from original entry.`);
          } else {
            return { valid: false, reason: `REJECTED: Asset isolation enforced. Active trade for ${symbol} is not far enough in profit (needs >0.50 ATR) to safely scale in.` };
          }
        }
      } else {
        return { valid: false, reason: `REJECTED: Asset isolation enforced. Signal already active for ${symbol}` };
      }
    }
  }

  // Guardrail: Comprehensive Portfolio Correlation Basket Limits
  const symbolGroup = CORRELATION_GROUPS[symbol];
  if (symbolGroup && currentSnapshot) {
    let existingExposure = 0;
    
    // Check signals in trade_opportunities
    if (activeSignals) {
      for (const t of activeSignals) {
        if (t.symbol !== symbol) {
          const activeGroup = CORRELATION_GROUPS[t.symbol];
          if (activeGroup && activeGroup.group === symbolGroup.group) {
            const activeWeight = (t.side === 'LONG' ? 1 : -1) * activeGroup.weight;
            existingExposure += activeWeight;
          }
        }
      }
    }

    // Check live open positions in user_trades
    if (openTrades) {
      for (const ut of openTrades) {
        if (ut.symbol !== symbol) {
          const activeGroup = CORRELATION_GROUPS[ut.symbol];
          if (activeGroup && activeGroup.group === symbolGroup.group) {
            const activeWeight = (ut.side === 'LONG' || ut.side === 'BUY' ? 1 : -1) * activeGroup.weight;
            existingExposure += activeWeight;
          }
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

      // If the absolute net exposure exceeds 1, reject to prevent stacked correlation
      if (Math.abs(projectedExposure) > 1) {
        return { valid: false, reason: `REJECTED: Portfolio correlation limit exceeded. Cannot stack multiple correlated ${symbolGroup.group} trades (Current Net Exposure: ${existingExposure}, Projected: ${projectedExposure}).` };
      }
    }
  }

  // --- ORDER FLOW & VOLUME SURGE GUARD ---
  if (currentSnapshot && currentSnapshot.volume_regime === 'ANEMIC' && currentSnapshot.volume_ratio && currentSnapshot.volume_ratio < 0.6) {
    console.warn(`[Risk Manager] Low Liquidity Warning: ${symbol} volume is ANEMIC (Ratio: ${currentSnapshot.volume_ratio}x).`);
  }

  return { valid: true };
}

// Validates whether a momentum breakout strategy has sufficient institutional volume backing
export function validateOrderFlowBreakout(
  strategyApplied: string,
  snapshot?: LogicContext
): RiskValidationResult {
  if (!snapshot) return { valid: true };

  const isBreakout = strategyApplied === 'MOMENTUM_BREAKOUT' || 
                     strategyApplied === 'MACRO_MOMENTUM_BREAKOUT' || 
                     strategyApplied === 'BREAKOUT';

  if (isBreakout) {
    const volRatio = snapshot.volume_ratio ?? 1.0;
    // Breakout requires at least normal volume (>= 0.85x) and preferably a surge
    if (snapshot.volume_regime === 'ANEMIC' || volRatio < 0.80) {
      return {
        valid: false,
        reason: `REJECTED (Order Flow Guard): Breakout rejected due to anemic volume (${volRatio.toFixed(2)}x < 0.80x baseline). False breakout trap detected.`
      };
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

// ============================================================================
// AI Risk Guardrail (formerly Devil's Advocate)
// ============================================================================

export interface AIRiskContext {
  symbol: string;
  side: "BUY" | "SELL" | "LONG" | "SHORT";
  price: number;
  setup_label: string;
  macro_bias: string;
  fib_narrative?: string;
  technical_reasons: string;
}

export interface AIRiskValidationResult {
  approved: boolean;
  reason: string;
}

/**
 * Validates a signal qualitatively using an LLM (Responses API) to check for 
 * fundamental or structural contradictions before execution.
 */
export async function validateSignalWithAI(
  supabase: SupabaseClient,
  context: AIRiskContext,
  traceId: string
): Promise<AIRiskValidationResult> {
  console.log(`[Risk Manager] [Trace: ${traceId}] AI Risk Check for ${context.side} on ${context.symbol}...`);
  
  // Try to use Deno.env (for Edge Functions) or process.env (for local tests)
  let openaiKey = "";
  try {
    openaiKey = Deno.env.get("OPENAI_API_KEY") || "";
  } catch {
    // @ts-ignore
    openaiKey = process?.env?.OPENAI_API_KEY || "";
  }

  if (!openaiKey) {
    console.warn(`[Risk Manager] [Trace: ${traceId}] No AI keys found. Bypassing AI check.`);
    return { approved: true, reason: "Bypassed: No AI configuration" };
  }

  const headers = {
    "Authorization": `Bearer ${openaiKey}`,
    "Content-Type": "application/json"
  };

  const userContent = `
PROPOSED TRADE:
Symbol: ${context.symbol}
Action: ${context.side}
Current Price: $${context.price}
Setup: ${context.setup_label}
Technical Basis: ${context.technical_reasons}

MARKET CONTEXT:
Macro Bias: ${context.macro_bias}
Fibonacci / Structure Narrative: ${context.fib_narrative || "None available"}

Analyze this trade and return your verdict.
  `;

  try {
    console.log(`[Responses API] [Risk Manager] Submitting ${context.symbol} AI analysis...`);
    
    const body = {
      model: "gpt-4o",
      input: userContent,
      tools: [
        {
          type: "function",
          name: "approve_trade",
          description: "Submit this action when the trade seems reasonable and doesn't contradict macro bias.",
          parameters: {
            type: "object",
            properties: {
              reason: { type: "string" }
            },
            required: ["reason"]
          }
        },
        {
          type: "function",
          name: "reject_trade",
          description: "Submit this action when the trade contradicts macro bias or is technically weak.",
          parameters: {
            type: "object",
            properties: {
              reason: { type: "string" }
            },
            required: ["reason"]
          }
        }
      ]
    };

    const responseRes = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers,
      body: JSON.stringify(body)
    });

    const responseData = await responseRes.json();
    
    if (responseData.error) {
      throw new Error(`Responses API Error: ${responseData.error.message}`);
    }

    const output = responseData.output;
    if (!output || output.length === 0) {
      throw new Error("No output returned from Responses API");
    }

    // Look for a function_call in the output array
    const toolCall = output.find((item: any) => item.type === "function_call");

    if (!toolCall) {
      throw new Error(`No tool call returned from AI. Full output: ${JSON.stringify(output)}`);
    }

    console.log(`[Responses API] [Risk Manager] Tool called: ${toolCall.name}`);
    const args = JSON.parse(toolCall.arguments);
    
    const result = {
      approved: toolCall.name === "approve_trade",
      reason: args.reason || "No reason provided."
    };
    
    // Log verdict to DB
    await supabase.from("agent_verdicts").insert({
      trace_id: traceId,
      agent_persona: "RISK_MANAGER_AI",
      symbol: context.symbol,
      action: context.side,
      verdict_approved: result.approved,
      verdict_reason: result.reason,
      context_json: context
    });

    console.log(`[Risk Manager] [Trace: ${traceId}] Verdict for ${context.symbol}: ${result.approved ? 'APPROVED' : 'REJECTED'} - ${result.reason}`);
    return result;
  } catch (error: any) {
    console.error(`[Risk Manager] [Trace: ${traceId}] Error during AI analysis:`, error.message);
    // Fail-open strategy to not block trades if AI fails
    return { approved: true, reason: `Bypassed: AI Error - ${error.message}` };
  }
}
