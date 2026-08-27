---
name: run-trading-agents
description: Complete instructions and scripts to execute AI trading agents (agent-news, agent-day, agent-swing) on production, analyze Trading Central chartist patterns, Fibonacci & SMC confluence, inspect S/A-Tier signals via Supabase, and optimize agent tier generation.
---

# Running Trading Agents & Signal Analysis

This skill outlines the process for executing the full multi-agent trading pipeline (`agent-news`, `agent-day`, `agent-swing`) against the production environment and analyzing generated signals for S-Tier and A-Tier confluence.

> [!IMPORTANT]
> **Live Execution Expected**: Running these agents against the production database generates live S-Tier and A-Tier signals that are automatically routed, risk-sized, and executed on connected live MT5 broker accounts via the PAMM Execution Desk / VPS Engine.

---

## 1. Multi-Agent Pipeline Architecture (Trading Central Institutional Standard)

The trading framework operates as a coordinated Hive Mind:

1. **`agent-news` (Macro Scout & Sentiment)**:
   - Polls high-impact economic calendar events (Forex Factory) and live breaking news feeds (Tavily/RSS).
   - Writes macroeconomic calendar context into `system_settings` (`macro_oracle_context`).
   - Evaluates crypto/macro sentiment and publishes high-conviction events (`status: "PUBLISHED"`), waking up `agent-swing` for immediate event-driven confluence.

2. **`agent-day` (Intraday M30 Scalper / Momentum & Value Area Trader)**:
   - Evaluates 30-minute charts across 24 global assets (Forex, Indices, Metals, Oil, Crypto, Tech Equities).
   - Utilizes Session VWAP bands, Value Area (POC/VAH/VAL), Daily Pivot Regimes, RSI/MACD divergences, trend channels, and geometric patterns.
   - Enforces the **20-Bar Anticipation Horizon (10 hours for 30m candles)**.
   - Enforces **Target 2 R:R $\ge 1:1.70$** using the Adaptive Pullback Limit Solver.

3. **`agent-swing` (Macro Fibonacci, Chartist & SMC Swing Trader)**:
   - Analyzes 1D and 1W charts for dominant swing ranges, Fibonacci retracements (23.6%, 38.2%, 50%, 61.8%, 78.6%), extensions (127.2%, 141.4%, 161.8%, 200%), and 40-bar trend channels.
   - Algorithmically identifies classical geometric patterns (Triangles, Wedges, Double Tops/Bottoms, Head & Shoulders).
   - Consumes pending news sentiment from `agent-news` (injecting a **+20 confidence boost** when technicals align).
   - Checks Weekly/Daily Fib confluence (**+5 confidence bonus**).
   - Applies ICT/SMC institutional footprints (Order Blocks, FVGs, Liquidity Sweeps).
   - Enforces the **20-Bar Daily Horizon (20 trading days = 480 hours)**.
   - Governs invalidations on confirmed daily bar closes.

---

## 2. Prerequisites & Environment Setup

You will need the production `SUPABASE_SERVICE_ROLE_KEY` and `SUPABASE_URL` in your `.env` file to authenticate HTTP POST requests.

Ensure your root `.env` contains:
```env
SUPABASE_URL="https://ktezlusdkqlfdwqrldtn.supabase.co"
SUPABASE_SERVICE_ROLE_KEY="eyJh..."
```

---

## 3. Execution Script

Use the consolidated runner script (`scripts/call_agents.mjs`):

```bash
node scripts/call_agents.mjs
```

Or run the deep diagnostic audit script:
```bash
node scripts/deep_agent_audit.mjs
```

### Script Execution Structure:
```javascript
async function run() {
  // 1. Event-Driven Macro & Multi-Asset Sentiment Scout (BOJ, ECB, Fed, Crypto)
  await callAgent('agent-news');
  
  // 2. Intraday M30 Momentum & Pivot Scalper (24 Assets)
  await callAgent('agent-day', {
    symbols: [
      "BTCUSD", "ETHUSD", "XAUUSD", "US30", "NAS100", "SPX500", "EURUSD", 
      "GBPUSD", "AUDUSD", "USDCAD", "USDCHF", "UKOIL", "USOIL", "XAGUSD", 
      "USDJPY", "GBPJPY", "EURJPY", "GER30", "JP225", "NVDA", "AAPL", "MSFT", "TSLA"
    ]
  });
  
  // 3. Macro Swing Trader (Split into chunks to avoid 150s Edge Function timeouts)
  await callAgent('agent-swing', { 
    symbols: ["EURUSD", "GBPUSD", "USDJPY", "AUDUSD", "USDCAD", "USDCHF", "NZDUSD", "EURJPY", "GBPJPY"] 
  });
  await callAgent('agent-swing', { symbols: ["BTCUSD", "ETHUSD"] });
  await callAgent('agent-swing', { symbols: ["US30", "NAS100", "SPX500", "GER30", "JP225", "XAUUSD", "XAGUSD", "UKOIL", "USOIL"] });
  await callAgent('agent-swing', { symbols: ["NVDA", "AAPL", "MSFT", "GOOGL", "AMZN", "TSLA", "META"] });
}
```

---

## 4. Signal Tier Classification & Criteria (Trading Central Standards)

Signals are graded based on calibrated confidence scores:

| Tier | Confidence Score | Confluence Requirements | Target 2 R:R Benchmark | Execution Sizing |
| :--- | :--- | :--- | :--- | :--- |
| **S-Tier** | **90 – 99** | Multi-timeframe Fib overlap + SMC Order Block/FVG mitigation + Macro News Alignment (+20) + Trend Channel / Reversal Pattern. | **$\ge 1:1.75$** | **High / Aggressive Sizing** |
| **A-Tier** | **80 – 89** | Key Fib level (50% / 61.8% / 78.6%) + RSI/MACD divergence + Candlestick confirmation (Piercing Line, Harami, Pinbar) + Channel boundary. | **$\ge 1:1.70$** | **Standard Sizing** |
| **B-Tier** | **70 – 79** | Single-timeframe setup, mean-reversion boundary fade, or moderate momentum breakout with volume surge. | **$\ge 1:1.50$** | **Conservative Sizing** |
| **C-Tier / Rejection** | **< 70** | Mid-range chop, anemic breakout volume, conflicting divergence, or guardrail failure. | **N/A** | **Sideline / Rejected** |

---

## 5. Analyzing Generated Signals via Supabase

Query the `trade_opportunities` table to review the details of all recent signals:

```sql
SELECT 
    id, 
    symbol, 
    side, 
    status, 
    timeframe, 
    confidence, 
    entry_plan_json->>'order_type' AS order_type,
    entry_plan_json->>'price' AS entry_price, 
    entry_plan_json->>'max_holding_bars' AS max_holding_bars,
    stop_plan_json->>'stop' AS stop_loss, 
    take_profit_json->>'tp1' AS tp1,
    take_profit_json->>'tp2' AS tp2,
    take_profit_json->>'tp' AS primary_tp, 
    ai_summary, 
    ai_risks, 
    created_at 
FROM trade_opportunities 
WHERE created_at >= NOW() - INTERVAL '2 hours' 
ORDER BY created_at DESC;
```

### Inspecting Guardrail Rejections & Debugging:
- **`status = 'APPROVED'`**: Signal passed all confluences, verified for Target 2 R:R $\ge 1.70$, and sent to Execution Desk.
- **`status = 'REJECTED'`**: Review `ai_risks` and `ai_summary` to identify which filter triggered:
  - **`Pre-AI Guard`**: Asset isolation violation (another active trade exists on this symbol).
  - **`Layer 0`**: Macro Blackout Window (high-impact USD central bank announcement within ±30 minutes).
  - **`Adaptive Limit Solver`**: If market price gave R:R < 1.70, converted to a pullback Limit Order at the exact structural discount.
  - **`Bar-Close Invalidation`**: Confirmed candle close beyond the Pivot Point.
  - **`20-Bar Horizon Expired`**: Setup exceeded its 20-period life (10h intraday / 20 days swing) without fill.

---

## 6. How to Optimize the Agents for S-Tier Signal Generation

1. **Leverage News-Technical Confluence (`agent-news` -> `agent-swing`)**:
   - When high-impact catalysts fire in `agent-news`, ensure the news sentiment is written to `trade_opportunities` with `status: "PUBLISHED"`.
   - `agent-swing` detects this pending sentiment and applies an immediate **+20 confidence boost**, elevating 75-80 confidence setups into the 95+ S-Tier bracket.

2. **Refine Chartist & Divergence Confluences**:
   - Confluence between a Trend Channel boundary (Upper/Lower), RSI/MACD Regular Divergence, and a 61.8% Fibonacci zone delivers optimal S-Tier setups.
   - For overextended markets, use the **Adaptive Pullback Limit Solver** to ensure entry prices guarantee $\ge 1:1.75$ R:R to Target 2.

3. **Multi-Timeframe Weekly/Daily Fibonacci Convergence**:
   - Assets where the Daily Fib overlaps the Weekly Fib within 0.3% receive an automatic **+5 confidence boost**. Scanning broad cross-pairs (e.g. `EURJPY`, `GBPJPY`, `AUDUSD`, `NZDUSD`) increases the frequency of institutional confluence.
