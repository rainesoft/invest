---
name: run-trading-agents
description: Complete instructions and scripts to execute AI trading agents (agent-news, agent-day, agent-swing) on production, analyze Fibonacci & SMC confluence, inspect S/A-Tier signals via Supabase, and optimize agent tier generation.
---

# Running Trading Agents & Signal Analysis

This skill outlines the process for executing the full multi-agent trading pipeline (`agent-news`, `agent-day`, `agent-swing`) against the production environment and analyzing generated signals for S-Tier and A-Tier confluence.

> [!IMPORTANT]
> **Live Execution Expected**: Running these agents against the production database generates live S-Tier and A-Tier signals that are automatically routed, risk-sized, and executed on connected live MT5 broker accounts via the PAMM Execution Desk / VPS Engine.

---

## 1. Multi-Agent Pipeline Architecture

The trading framework operates as a coordinated Hive Mind:

1. **`agent-news` (Macro Scout & Sentiment)**:
   - Polls high-impact economic calendar events (Forex Factory) and live breaking news feeds (Tavily/RSS).
   - Writes macroeconomic calendar context into `system_settings` (`macro_oracle_context`).
   - Evaluates crypto/macro sentiment and publishes high-conviction events (`status: "PUBLISHED"`), waking up `agent-swing` for immediate event-driven confluence.

2. **`agent-day` (Intraday M30 Scalper / Momentum)**:
   - Evaluates 30-minute charts using Daily Pivot Regimes, VWAP bands, Value Area (POC/VAH/VAL), MACD, and Order Blocks.
   - Requires alignment between Intraday Pivot regimes and momentum before originating Limit/Market orders.

3. **`agent-swing` (Macro Fibonacci & SMC Swing Trader)**:
   - Analyzes 1D and 1W charts for dominant swing ranges, Fibonacci retracements (23.6%, 38.2%, 50%, 61.8%, 78.6%), and extensions (127.2%, 141.4%, 161.8%, 200%).
   - Consumes pending news sentiment from `agent-news` (injecting a **+20 confidence boost** when technicals align).
   - Checks Weekly/Daily Fib confluence (**+5 confidence bonus**).
   - Applies ICT/SMC institutional footprints (Order Blocks, FVGs, Liquidity Sweeps).

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
  
  // 2. Intraday M30 Momentum & Pivot Scalper
  await callAgent('agent-day', {
    symbols: ["BTCUSD", "EURUSD", "GBPUSD", "USDJPY", "EURJPY", "GBPJPY", "AUDUSD", "NZDUSD", "AUDJPY", "CADJPY", "EURGBP", "XAUUSD", "XAGUSD", "UKOIL", "US30", "NAS100"]
  });
  
  // 3. Macro Swing Trader (Split into chunks to avoid 150s Edge Function timeouts)
  await callAgent('agent-swing', { symbols: ["EURUSD", "GBPUSD", "USDJPY", "AUDUSD", "NZDUSD", "EURJPY", "GBPJPY", "AUDJPY", "CADJPY", "EURGBP"] });
  await callAgent('agent-swing', { symbols: ["BTCUSD"] });
  await callAgent('agent-swing', { symbols: ["US30", "NAS100", "XAUUSD", "XAGUSD", "UKOIL"] });
}
```

---

## 4. Signal Tier Classification & Criteria

Signals are graded based on calibrated confidence scores:

| Tier | Confidence Score | Confluence Requirements | Execution Allocation |
| :--- | :--- | :--- | :--- |
| **S-Tier** | **90 – 99** | Multi-timeframe Fib overlap + SMC Order Block/FVG mitigation + Macro News Alignment (+20) + Safe R:R (>= 1:1.5). | **High / Aggressive Sizing** |
| **A-Tier** | **80 – 89** | Key Fib level (e.g. 61.8% / 78.6%) + Structural exhaustion pinbar / MTFA trend alignment + R:R >= 1:1.2. | **Standard Sizing** |
| **B-Tier** | **70 – 79** | Single-timeframe setup or moderate momentum setup. | **Conservative Sizing** |
| **C-Tier / Rejection** | **< 70** | Mid-range price action, lack of volume surge, or guardrail failure. | **Sideline / Rejected** |

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
    entry_plan_json->>'price' AS entry_price, 
    stop_plan_json->>'stop' AS stop_loss, 
    take_profit_json->>'tp' AS take_profit, 
    ai_summary, 
    ai_risks, 
    created_at 
FROM trade_opportunities 
WHERE created_at >= NOW() - INTERVAL '2 hours' 
ORDER BY created_at DESC;
```

### Inspecting Guardrail Rejections & Debugging:
- **`status = 'ACTIVE'`**: Signal passed all checks, sized by risk engine, and sent to MT5 broker.
- **`status = 'REJECTED'`**: Review `ai_risks` and `ai_summary` to understand the exact layer that blocked the trade:
  - **`Pre-AI Guard`**: Asset isolation violation (another position on this symbol is already OPEN).
  - **`Layer 0`**: Macro Blackout Window (high-impact USD news within ±30 minutes).
  - **`S-Tier OB/FVG Guard`**: Downgraded from S-Tier to A-Tier because no LTF Order Block or FVG anchor was present.
  - **`Proximity Guard`**: Distance to support/resistance is too tight (< 0.1% forex, < 0.015% indices).
  - **`R:R Ratio Guard`**: R:R to TP2 is below the minimum required ratio for the tier.

---

## 6. How to Optimize the Agents for S-Tier Signal Generation

1. **Leverage News-Technical Confluence (`agent-news` -> `agent-swing`)**:
   - When high-impact catalysts fire in `agent-news`, ensure the news sentiment is written to `trade_opportunities` with `status: "PUBLISHED"`.
   - `agent-swing` detects this pending sentiment and applies an immediate **+20 confidence boost**, elevating 75-80 confidence setups into the 95+ S-Tier bracket.

2. **Refine LTF SMC Footprint Detection**:
   - S-Tier setups require an LTF Order Block or Fair Value Gap to compress the stop loss and expand R:R.
   - When price is near major daily Fibonacci levels (61.8% or 78.6%), originate limit orders anchored to the 15m/30m Order Block instead of wider daily structural stops.

3. **Multi-Timeframe Weekly/Daily Fibonacci Convergence**:
   - Assets where the Daily Fib overlaps the Weekly Fib within 0.3% receive an automatic **+5 confidence boost**. Scanning broader cross-pairs (e.g. EURJPY, GBPJPY, AUDUSD, NZDUSD) increases the probability of catching perfect HTF confluence.
