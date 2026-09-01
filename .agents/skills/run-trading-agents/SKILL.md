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
   - Detects **Support/Resistance (S/R) Flips** (prior resistance broken and holding as support for LONG, or prior support broken down and acting as resistance for SHORT) with an automatic **+10 confidence bonus**.
   - Enforces the **20-Bar Anticipation Horizon (10 hours for 30m candles)**.
   - Enforces **Target 2 R:R $\ge 1:1.70$** using the Adaptive Pullback Limit Solver.

3. **`agent-swing` (Macro Fibonacci, Chartist & SMC Swing Trader)**:
   - Analyzes 1D and 1W charts for dominant swing ranges, Fibonacci retracements (23.6%, 38.2%, 50%, 61.8%, 78.6%), extensions (127.2%, 141.4%, 161.8%, 200%), and 40-bar trend channels.
   - Algorithmically identifies classical geometric patterns (Triangles, Wedges, Double Tops/Bottoms, Head & Shoulders).
   - Incorporates **S/R Flip Confluence (+10 bonus)** and passes the S-Tier Structural Guard when S/R Flip is confirmed.
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

## 3. Execution Commands & Scripts

### 3.1 Full Multi-Asset Pipeline Run
Executes the entire 24-asset roster across news, intraday, and swing tiers:
```bash
node scripts/call_agents.mjs
```

### 3.2 Targeted Symbol Execution (e.g. XAUUSD)
Runs `agent-news`, `agent-day`, and `agent-swing` specifically for target symbol(s) in manual/evaluation mode:
```bash
node scripts/call_agents.mjs --symbol XAUUSD --timeframe 1D --hours 48
```

### 3.3 Deep Diagnostic Audit
Performs a deep diagnostic scan across database health, MT5 connections, and recent trade logs:
```bash
node scripts/deep_agent_audit.mjs
```

---

## 4. Market Hours & Rollover Behavior

- **Forex / Metals / Indices Rollover Gap (22:00 – 23:00 UTC)**:
  - Financial markets experience daily broker settlement rollover between 22:00 and 23:00 UTC.
  - `packages/core/market.ts` flags non-crypto assets as closed during this window to protect execution from extreme spread widening.
  - To inspect or backtest signals during rollover, pass `--symbol <SYM>` or `{ "is_manual": true }` to evaluate structural levels.

---

## 5. Signal Tier Classification & Institutional Confluence Standards

Signals are graded based on calibrated confidence scores:

| Tier | Confidence Score | Confluence Requirements | Target 2 R:R Benchmark | Execution Sizing |
| :--- | :--- | :--- | :--- | :--- |
| **S-Tier** | **90 – 99** | Multi-timeframe Fib overlap + S/R flip or SMC Order Block/FVG mitigation + Macro News Alignment (+20) + Trend Channel / Reversal Pattern. | **$\ge 1:1.75$** | **High / 3.0x Multiplier** |
| **A-Tier** | **80 – 89** | Key Fib level (50% / 61.8% / 78.6%) + RSI/MACD divergence + Candlestick confirmation (Piercing Line, Harami, Pinbar) + Channel boundary. | **$\ge 1:1.70$** | **Standard 1.0x Sizing** |
| **B-Tier** | **70 – 79** | Single-timeframe setup, mean-reversion boundary fade, or moderate momentum breakout with volume surge. | **$\ge 1:1.50$** | **0.5x Conservative Sizing** |
| **C-Tier / Rejection** | **< 70** | Mid-range chop, anemic breakout volume, conflicting divergence, or guardrail failure. | **N/A** | **Sideline / Rejected** |

---

## 6. Analyzing Generated Signals via Supabase

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
WHERE created_at >= NOW() - INTERVAL '24 hours' 
ORDER BY confidence DESC;
```

### Inspecting Guardrail Rejections & Debugging:
- **`status = 'APPROVED'`**: Signal passed all confluences, verified for Target 2 R:R $\ge 1.70$, and sent to Execution Desk.
- **`status = 'REJECTED'`**: Review `ai_risks` and `ai_summary` to identify which filter triggered:
  - **`Pre-AI Guard`**: Asset isolation violation (another active trade exists on this symbol or net USD exposure limit reached).
  - **`Layer 0`**: Macro Blackout Window (high-impact USD central bank announcement within ±30 minutes).
  - **`Adaptive Limit Solver`**: If market price gave R:R < 1.70, converted to a pullback Limit Order at the exact structural discount.
  - **`Bar-Close Invalidation`**: Confirmed candle close beyond the Pivot Point.
  - **`20-Bar Horizon Expired`**: Setup exceeded its 20-period life (10h intraday / 20 days swing) without fill.

---

## 7. How to Optimize the Agents for S-Tier Signal Generation

1. **Leverage News-Technical Confluence (`agent-news` -> `agent-swing`)**:
   - When high-impact catalysts fire in `agent-news`, ensure the news sentiment is written to `market_context` or `system_settings`.
   - `agent-swing` detects this pending sentiment and applies an immediate **+20 confidence boost**, elevating 75-80 confidence setups into the 95+ S-Tier bracket.

2. **S/R Flip & Golden Pocket Alignment**:
   - Confluence between a prior Resistance turned Support zone (S/R flip), RSI Oversold divergence, and the 50.0% / 61.8% Fibonacci zone delivers optimal institutional S-Tier setups.
   - For overextended markets, use the **Adaptive Pullback Limit Solver** to ensure entry prices guarantee $\ge 1:1.75$ R:R to Target 2.

3. **Multi-Timeframe Weekly/Daily Fibonacci Convergence**:
   - Assets where the Daily Fib overlaps the Weekly Fib within 0.3% receive an automatic **+5 confidence boost**. Scanning broad cross-pairs (e.g. `XAUUSD`, `USOIL`, `EURJPY`, `GBPJPY`, `AUDUSD`) increases the frequency of institutional confluence.

4. **ATR-Calibrated Breathing Room for Metals & Volatile Assets**:
   - For Gold (`XAUUSD`) and Crude Oil (`USOIL`/`UKOIL`), ensure stop losses are placed with at least a $1.0\times\text{ATR}$ to $1.25\times\text{ATR}$ buffer below the structural pivot to prevent premature wick stop-outs before impulsive expansion towards Target 2 / Target 3.

