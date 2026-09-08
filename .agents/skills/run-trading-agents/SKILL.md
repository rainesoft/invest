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
   - Inherits **Inter-Asset Energy News Correlation** (`UKOIL` $\leftrightarrow$ `USOIL` Brent/WTI $>95\%$ correlation) and **Precious Metals Correlation** (`XAGUSD` $\leftrightarrow$ `XAUUSD`).
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

### 3.2 Targeted Symbol Execution (with Automatic Alias Mapping)
Runs `agent-news`, `agent-day`, and `agent-swing` specifically for target symbol(s). Common aliases like `UKOI` $\to$ `UKOIL`, `GOLD` $\to$ `XAUUSD`, `SILVER` $\to$ `XAGUSD`, `BTC` $\to$ `BTCUSD` are automatically resolved:
```bash
node scripts/call_agents.mjs --symbol XAUUSD,XAGUSD,BTCUSD,UKOIL --timeframe 1D --hours 24 --is_manual
```

### 3.3 Deep Diagnostic Audit
Performs a deep diagnostic scan across database health, MT5 connections, and recent trade logs:
```bash
node scripts/deep_agent_audit.mjs
```

---

## 4. Market Hours & Rollover Behavior

- **Forex / Metals / Commodities Rollover & Weekend Gates**:
  - Financial markets experience daily broker settlement rollover between 22:00 and 23:00 UTC, and weekend closure from Friday 22:00 UTC to Sunday 22:00 UTC.
  - `packages/core/market.ts` flags non-crypto assets as closed during these windows to protect execution from extreme spread widening.
  - **Manual Structural Analysis Override**: When inspecting or backtesting setups on demand (including weekends), pass `--manual` / `--is_manual` or `{ "is_manual": true }` in the request body. Both `agent-day` and `agent-swing` will bypass the market closed filter to evaluate structural Fibonacci and chartist levels.
  - **Data Cache Depth Protection**: `fetchPaperBars` enforces a minimum 50-bar depth requirement on database caches (`market_data_pti` and resampled candles). If cached data has $< 50$ bars, it automatically falls back to MetaAPI to ensure full 100+ bar lookbacks for accurate Fibonacci swing calculations.

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

To safeguard capital from outsized dollar drawdowns on volatile instruments, the engine enforces the **3.0% Max Capital Risk Cap ($33.00 on $1,100 base equity)** at minimum 0.01 lot size:

$$\text{Max Allowable Stop Distance} = \frac{\$33.00}{0.01 \times \text{Point Value USD}}$$

### Contract Sizing Table ($1,100 Base Capital):
- **`USOIL` / `UKOIL`**: Contract Size = $1,000\text{ bbl}$ $\implies 0.01\text{ lot} = 10\text{ bbl} \implies \$10.00\text{ per } \$1.00\text{ move}$. Max stop distance $= \$3.30$.
- **`XAUUSD`**: Contract Size = $100\text{ oz}$ $\implies 0.01\text{ lot} = 1\text{ oz} \implies \$1.00\text{ per } \$1.00\text{ move}$. Max stop distance $= \$33.00$.
- **`BTCUSD`**: Contract Size = $1\text{ BTC}$ $\implies 0.01\text{ lot} = 0.01\text{ BTC} \implies \$0.01\text{ per } \$1.00\text{ move}$. Max stop distance $= \$3,300.00$.
- **`XAGUSD`**: Contract Size = $5,000\text{ oz}$ $\implies 0.01\text{ lot} = 50\text{ oz} \implies \$50.00\text{ per } \$1.00\text{ move}$. Max stop distance $= \$0.66$.
- **`Forex (USD Pairs)`**: Contract Size = $100,000$ $\implies 0.01\text{ lot} = \$0.10\text{ per pip}$. Max stop distance $= 330\text{ pips}$.

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
    take_profit_json->>'tp3' AS tp3,
    take_profit_json->>'tp' AS primary_tp, 
    ai_summary, 
    ai_risks, 
    created_at 
FROM trade_opportunities 
WHERE created_at >= NOW() - INTERVAL '24 hours' 
ORDER BY confidence DESC;
```

---

## 8. How to Optimize the Agents for S-Tier Signal Generation

1. **Leverage News-Technical Confluence (`agent-news` -> `agent-swing`)**:
   - When high-impact catalysts fire in `agent-news` (e.g. Geopolitical Middle East escalations, OPEC+ supply cuts, `$3.8B Bitcoin ETF inflows`, Fed dovish/hawkish shifts), ensure the news sentiment is written to `market_context` with `confidence >= 85`.
   - `agent-swing` and `agent-day` detect this pending sentiment (or correlated peer context like `USOIL` $\leftrightarrow$ `UKOIL`, `XAUUSD` $\leftrightarrow$ `XAGUSD`) and apply an immediate **+20 confidence boost**, elevating 75-84 confidence technical setups into the 95-100 S-Tier bracket.

2. **S/R Flip & Golden Pocket Alignment**:
   - Confluence between a prior Resistance turned Support zone (S/R flip), RSI Oversold/Bullish divergence, and the 50.0% / 61.8% Fibonacci zone delivers optimal institutional S-Tier setups.
   - For overextended markets, use the **Adaptive Pullback Limit Solver** to ensure entry prices guarantee $\ge 1:1.75$ R:R to Target 2.

3. **Multi-Timeframe Weekly/Daily Fibonacci Convergence**:
   - Assets where the Daily Fib overlaps the Weekly Fib within 0.3% receive an automatic **+5 confidence boost**. Scanning broad cross-pairs (`UKOIL`, `BTCUSD`, `USDJPY`, `XAUUSD`, `EURJPY`, `GBPJPY`, `AUDUSD`) maximizes institutional confluence frequency.

4. **Crypto-Specific Weekend & ETF Flow Directives**:
   - During weekend trading (Saturday/Sunday), crypto volume is naturally 40-60% lower than weekday FX/TradFi benchmarks. The agents apply dynamic volatility scaling rather than rejecting setups due to low volume or low ADX.
   - Institutional ETF accumulation establishes a structural valuation floor, prioritizing pullback limit orders at Order Blocks/FVGs.

5. **ATR-Calibrated Breathing Room for Metals & Commodities**:
   - For Crude Oil (`UKOIL`/`USOIL`), Gold (`XAUUSD`), and Crypto (`BTCUSD`), ensure stop losses are placed with at least a $1.0\times\text{ATR}$ to $1.25\times\text{ATR}$ buffer below the structural pivot to prevent premature wick stop-outs before impulsive expansion towards Target 2 / Target 3.

---

## 9. S-Tier Signal Recovery & Mathematical Profitability Playbook

When an asset fails to achieve S-Tier confidence (e.g. confidence < 75 due to mid-range chop or overhead resistance), apply the following institutional recovery protocols:

1. **Adaptive Limit Pullback Anchoring (Discount Entry)**:
   - Instead of rejecting mid-range chop, anchor a Limit Order at the nearest structural support / 61.8% Golden Pocket Fib or LTF Fair Value Gap (FVG). This compresses stop-loss distance and expands R:R to $> 1:3.0$, elevating the setup into S-Tier.
2. **Breakout Buy Stop Anchor (Momentum Expansion)**:
   - Place a Buy Stop 0.25x ATR above the contested resistance ceiling with volume surge verification to capture impulsive expansion towards Target 2 / Target 3.
3. **Calculating Institutional Trade Profitability ($EV$)**:
   - Calculate Expected Value: 
     $$EV = (P_{\text{win}} \times \text{TP2/TP3 Reward USD}) - (P_{\text{loss}} \times \text{Risk USD})$$
   - **UKOIL Contract Mathematics (0.01 lot = 10 barrels = $10.00 / $1.00 move)**:
     * Point Value = $\$10.00\text{ per } \$1.00\text{ move}$.
     * Example Buy Limit @ $\$93.96$, SL @ $\$89.37$ (Risk Distance = $\$4.60 \implies \$46.00\text{ risk}$), TP2 @ $\$102.01$ (Reward Distance = $\$8.05 \implies \$80.50\text{ reward}$), TP3 @ $\$112.34$ (Reward Distance = $\$18.38 \implies \$183.80\text{ reward}$).
     * At $75\%$ Win Probability (S-Tier standard):
       $$EV_{\text{TP2}} = (0.75 \times \$80.50) - (0.25 \times \$46.00) = \$60.38 - \$11.50 = +\$48.88\text{ per trade}$$
       $$EV_{\text{TP3}} = (0.75 \times \$183.80) - (0.25 \times \$46.00) = \$137.85 - \$11.50 = +\$126.35\text{ per trade}$$
    - **XAUUSD Contract Mathematics (0.01 lot = 1 oz = $1.00 / $1.00 move)**:
      * Point Value = $\$1.00\text{ per } \$1.00\text{ move}$.
      * Example S-Tier Buy Limit @ $\$4,425.00$, SL @ $\$4,384.00$ (Risk Distance = $\$41.00 \implies \$41.00\text{ risk}$), TP1 @ $\$4,546.87$ (Reward Distance = $\$121.87$), TP2 @ $\$4,728.30$ (Reward Distance = $\$303.30 \implies \$303.30\text{ reward}$), TP3 @ $\$4,900.00$ (Reward Distance = $\$475.00 \implies \$475.00\text{ reward}$), R:R = $1:7.40\text{ to }1:8.28$.
      * At $75\%$ Win Probability (S-Tier Fib floor + macro alignment):
        $$EV_{\text{TP2}} = (0.75 \times \$303.30) - (0.25 \times \$41.00) = \$227.48 - \$10.25 = +\$217.23\text{ per trade}$$
        $$EV_{\text{TP3}} = (0.75 \times \$475.00) - (0.25 \times \$41.00) = \$356.25 - \$10.25 = +\$346.00\text{ per trade}$$
    - Prioritize capital allocation to setups with $EV > 1.0R$ and asymmetric upside multipliers.

---

## 10. Operational Best Practices & Pipeline Optimization

1. **Edge Function Batching (150s Timeout Guard)**:
   - Always run `agent-day` and `agent-swing` in chunked symbol batches (e.g. 5-8 symbols per HTTP POST) when querying the full 24-asset roster to prevent exceeding the Supabase Edge Function 150-second execution limit.
2. **Multi-Provider LLM Resilience & Token Bounds**:
   - Ensure the LLM gateway supports seamless fallback across OpenAI, Azure OpenAI, Anthropic, or DeepSeek so automated agent runs are immune to single-provider 429 quota exhaustion.
   - For Responses API and structured tool calls, ensure `max_output_tokens >= 800` to prevent JSON response truncation (`Unterminated string in JSON`) on verbose multi-target mathematical proofs.
3. **Session Filter Overrides for Manual Audits**:
   - Pass `--is_manual` or `{ "is_manual": true }` to evaluate structural Fibonacci, chartist patterns, and S/R flips during Asian session or weekend rollover without being blocked by execution session filters or portfolio heat caps.
4. **Origination Risk Governor Dynamic ATR Calibration**:
   - For high-volatility commodities and metals (`XAUUSD`, `XAGUSD`, `UKOIL`, `USOIL`), calibrate the maximum permissible entry offset buffer to `Math.max(dailyAtr * 0.50, currentPrice * 0.005)`. When raw stop loss exceeds the 3% capital cap, this allows the adaptive limit solver to safely compress the stop without prematurely rejecting valid institutional swing setups.
5. **Multi-Agent Inter-Asset Context Routing**:
   - `agent-news` writes high-impact catalysts into `market_context` with a 4-hour TTL. `agent-swing` and `agent-day` automatically consume this context and inherit correlated peer sentiment (`UKOIL` $\leftrightarrow$ `USOIL`, `XAGUSD` $\leftrightarrow$ `XAUUSD`, `EURUSD` $\leftrightarrow$ `USDCHF` inverse) to grant +20 confidence boosts.

