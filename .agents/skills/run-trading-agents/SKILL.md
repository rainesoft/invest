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
   - Evaluates crypto/macro sentiment via LLM and Tavily deep-search verification.
   - Saves macro sentiment context into `market_context` (4-hour TTL) with `macro_bias` (`BULLISH` / `BEARISH`).
   - Wakes up `agent-swing` via HTTP trigger for immediate event-driven technical confluence.

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
   - Consumes pending news sentiment from `agent-news` (injecting a **+20 confidence boost** when technicals align, or a **-30 penalty** when technicals contradict macro).
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

### 3.2 Targeted Symbol Execution (e.g. USDJPY, XAUUSD, USOIL)
Runs `agent-news`, `agent-day`, and `agent-swing` specifically for target symbol(s) in manual/evaluation mode:
```bash
node scripts/call_agents.mjs --symbol USDJPY,XAUUSD,USOIL --timeframe 1D --hours 24
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
| **S-Tier** | **90 – 100** | Multi-timeframe Fib overlap + S/R flip or SMC Order Block/FVG mitigation + Macro News Alignment (+20) + Trend Channel / Reversal Pattern. | **$\ge 1:1.75$** | **High / 3.0x Multiplier** |
| **A-Tier** | **80 – 89** | Key Fib level (50% / 61.8% / 78.6%) + RSI/MACD divergence + Candlestick confirmation (Piercing Line, Harami, Pinbar) + Channel boundary. | **$\ge 1:1.70$** | **Standard 1.0x Sizing** |
| **B-Tier** | **70 – 79** | Single-timeframe setup, mean-reversion boundary fade, or moderate momentum breakout with volume surge. | **$\ge 1:1.50$** | **0.5x Conservative Sizing** |
| **C-Tier / Rejection** | **< 70** | Mid-range chop, anemic breakout volume, conflicting divergence, or guardrail failure. | **N/A** | **Sideline / Rejected** |

---

## 6. Origination Risk Governor & Contract Sizing Matrix

To safeguard capital from outsized dollar drawdowns on volatile instruments, the engine enforces the **3.0% Max Capital Risk Cap ($45.00 on $1,500 base equity)** at minimum 0.01 lot size:

$$\text{Max Allowable Stop Distance} = \frac{\$45.00}{0.01 \times \text{Point Value USD}}$$

### Contract Sizing Table:
- **`USOIL` / `UKOIL`**: Contract Size = $1,000\text{ bbl}$ $\implies 0.01\text{ lot} = 10\text{ bbl} \implies \$10.00\text{ per } \$1.00\text{ move}$. Max stop distance $= \$4.50$.
- **`XAUUSD`**: Contract Size = $100\text{ oz}$ $\implies 0.01\text{ lot} = 1\text{ oz} \implies \$1.00\text{ per } \$1.00\text{ move}$. Max stop distance $= \$45.00$.
- **`BTCUSD`**: Contract Size = $1\text{ BTC}$ $\implies 0.01\text{ lot} = 0.01\text{ BTC} \implies \$0.01\text{ per } \$1.00\text{ move}$. Max stop distance $= \$4,500$.
- **`Forex (USD Pairs)`**: Contract Size = $100,000$ $\implies 0.01\text{ lot} = \$0.10\text{ per pip}$. Max stop distance $= 450\text{ pips}$.

When raw ATR stop distance exceeds the cap, the **Adaptive Limit Anchoring** engine recalculates the entry to a pullback limit price within a $0.25\times\text{ATR}$ buffer.

---

## 7. Analyzing Generated Signals via Supabase

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
- **`status = 'APPROVED'` / `'ACTIVE'`**: Signal passed all confluences, verified for Target 2 R:R $\ge 1.70$, and sent to Execution Desk / MT5 VPS Engine.
- **`status = 'REJECTED'`**: Review `ai_risks` and `ai_summary` to identify which filter triggered:
  - **`Pre-AI Guard`**: Asset isolation violation (another active trade exists on this symbol or net USD exposure limit reached).
  - **`Layer 0`**: Macro Blackout Window (high-impact USD central bank announcement within ±30 minutes).
  - **`Risk Governor`**: Minimum 0.01 lot dollar risk exceeded $45.00 cap and required limit entry offset $> 0.25\times\text{ATR}$.
  - **`Adaptive Limit Solver`**: If market price gave R:R < 1.70, converted to a pullback Limit Order at the exact structural discount.
  - **`Bar-Close Invalidation`**: Confirmed candle close beyond the Pivot Point.
  - **`20-Bar Horizon Expired`**: Setup exceeded its 20-period life (10h intraday / 20 days swing) without fill.

---

## 8. How to Optimize the Agents for S-Tier Signal Generation

1. **Leverage News-Technical Confluence (`agent-news` -> `agent-swing`)**:
   - When high-impact catalysts fire in `agent-news`, ensure the news sentiment is written to `market_context` or `system_settings`.
   - `agent-swing` detects this pending sentiment and applies an immediate **+20 confidence boost**, elevating 75-80 confidence setups into the 95+ S-Tier bracket.

2. **S/R Flip & Golden Pocket Alignment**:
   - Confluence between a prior Resistance turned Support zone (S/R flip), RSI Oversold divergence, and the 50.0% / 61.8% Fibonacci zone delivers optimal institutional S-Tier setups.
   - For overextended markets, use the **Adaptive Pullback Limit Solver** to ensure entry prices guarantee $\ge 1:1.75$ R:R to Target 2.

3. **Multi-Timeframe Weekly/Daily Fibonacci Convergence**:
   - Assets where the Daily Fib overlaps the Weekly Fib within 0.3% receive an automatic **+5 confidence boost**. Scanning broad cross-pairs (e.g. `USDJPY`, `XAUUSD`, `USOIL`, `EURJPY`, `GBPJPY`, `AUDUSD`) increases the frequency of institutional confluence.

4. **ATR-Calibrated Breathing Room for Metals & Volatile Assets**:
   - For Gold (`XAUUSD`) and Crude Oil (`USOIL`/`UKOIL`), ensure stop losses are placed with at least a $1.0\times\text{ATR}$ to $1.25\times\text{ATR}$ buffer below the structural pivot to prevent premature wick stop-outs before impulsive expansion towards Target 2 / Target 3.

---

## 9. S-Tier Signal Recovery & Mathematical Profitability Playbook

When an asset fails to achieve S-Tier confidence (e.g. confidence < 75 due to mid-range chop or overhead resistance), apply the following institutional recovery protocols:

1. **Adaptive Limit Pullback Anchoring (Discount Entry)**:
   - Instead of rejecting mid-range chop, anchor a Limit Order at the nearest structural support / 61.8% Golden Pocket Fib. This compresses stop-loss distance and expands R:R to $> 1:3.0$, elevating the setup into S-Tier.
2. **Breakout Buy Stop Anchor (Momentum Expansion)**:
   - Place a Buy Stop 0.25x ATR above the contested resistance ceiling with volume surge verification to capture impulsive expansion towards Target 2 / Target 3.
3. **Calculating Institutional Trade Profitability ($EV$)**:
   - Calculate Expected Value: $EV = (P_{\text{win}} \times \text{TP2 Reward}) - (P_{\text{loss}} \times \text{Risk Distance})$.
   - Compare gross pip/point yields and R:R ratios across the portfolio to prioritize capital allocation to highest-EV setups (e.g. `USDJPY` R:R 1:3.24 and `USOIL` R:R 1:2.82).
