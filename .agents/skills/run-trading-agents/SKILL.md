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
node temp/deep_agent_audit.mjs
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
    - **BTCUSD Contract Mathematics (0.01 lot = 0.01 BTC = $0.01 / $1.00 move)**:
      * Point Value = $\$0.01\text{ per } \$1.00\text{ move}$.
      * Example S-Tier Swing Buy Market @ $\$79,543.35$, SL @ $\$76,711.34$ (Risk Distance = $\$2,832.01 \implies \$28.32\text{ risk USD}$), TP1 @ $\$83,366.56$ (Reward Distance = $\$3,823.21 \implies \$38.23\text{ reward}$), TP2 @ $\$86,198.57$ (Reward Distance = $\$6,655.22 \implies \$66.55\text{ reward}$), TP3 @ $\$90,413.70$ (Reward Distance = $\$10,870.35 \implies \$108.70\text{ reward}$), R:R = $1:2.35$ to TP2, $1:3.84$ to TP3.
      * At $75\%$ Win Probability (S-Tier standard):
        $$EV_{\text{TP2}} = (0.75 \times \$66.55) - (0.25 \times \$28.32) = \$49.91 - \$7.08 = +\$42.83\text{ per 0.01 lot}$$
        $$EV_{\text{TP3}} = (0.75 \times \$108.70) - (0.25 \times \$28.32) = \$81.53 - \$7.08 = +\$74.45\text{ per 0.01 lot}$$
      * Account Risk Efficiency: Excellent ($<\$30$ risk on $\$1,100$ equity, yielding $>+2.35R$).

    - **XAGUSD Contract Mathematics (0.01 lot = 50 oz = $50.00 / $1.00 move)**:
      * Point Value = $\$50.00\text{ per } \$1.00\text{ move}$.
      * Maximum Allowable Stop Distance to stay under $3.0\%$ capital cap ($\$33.00$):
        $$\text{Max Allowable SL Distance} = \frac{\$33.00}{\$50.00} = \$0.66$$
      * Example S-Tier Buy Limit @ $\$66.45$, SL @ $\$65.57$ (Risk Distance = $\$0.88 \implies \$44.00\text{ risk}$).
      * **Volume Allocation Intervention**: Because $\$44.00 > \$33.00$, the Execution Desk rejects the order with `Execution Skipped: No volume allocated (10% Account Blowout Protection hard cap reached)`.
      * **The Fix**: The Adaptive Pullback Limit Solver must compress entry closer to the support pivot: Buy Limit @ $\$66.23$, SL @ $\$65.57$ (Risk Distance = $\$0.66 \implies \$33.00\text{ risk}$), TP2 @ $\$67.92$ (Reward Distance = $\$1.69 \implies \$84.50\text{ reward}$, R:R $= 1:2.56$).
      * At $75\%$ Win Probability:
        $$EV_{\text{TP2}} = (0.75 \times \$84.50) - (0.25 \times \$33.00) = \$63.38 - \$8.25 = +\$55.13\text{ per 0.01 lot}$$

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
6. **Crypto Spread Guard Handling (`SPREAD_TOO_WIDE`)**:
   - During crypto volatility spikes or broker roll-over, MT5 spreads for `BTCUSD` can widen (e.g. 275 points). If an S-Tier signal encounters `Execution Failed: SPREAD_TOO_WIDE:275.0`, configure the VPS execution bridge to:
     * Convert the order to a passive Limit Order resting outside the current bid/ask spread.
     * Expand the broker maximum spread tolerance filter for crypto pairs from 150 points to 350 points in `agent-risk.ts`.
7. **Dual Momentum Divergence Exhaustion Handling (e.g. Oil Parabolic Breakouts)**:
   - When an asset explodes on geopolitical news (e.g. Brent Crude `UKOIL` surging to $100), `agent-day` may flag `Dual Momentum Divergence Conflict (RSI REGULAR_BEARISH & MACD REGULAR_BEARISH)`.
   - Chasing market orders into dual bearish divergence has a low expected value. Instead of rejecting the trade entirely, the pipeline should originate an **Adaptive Pullback Limit Order** anchored at the confirmed S/R flip level ($95.62 – $96.15) or FVG discount zone, capturing the secondary expansion wave with $\ge 1:2.0$ R:R.
8. **Intraday vs. Swing Timeframe Decoupling**:
   - In `scripts/call_agents.mjs`, timeframe flags are now decoupled: `agent-day` is locked to intraday M30 resolution (`30m`), while `agent-swing` processes macro swing charts (`1D`). Passing `--timeframe 1D` will correctly evaluate swing setups on daily bars while allowing `agent-day` to scan intraday liquidity without resolution corruption.
9. **Strict Local Telegram API Safety**:
   - Automated signal broadcasts to Telegram channels are executed strictly via server-side database triggers (`on_signal_generated`) invoking the deployed `telegram-broadcast` Edge Function in Supabase cloud.
   - Diagnostic scripts, backtests, and manual agent runs executed locally on developer workstations must **NEVER** call `https://api.telegram.org` directly to prevent duplicate or corrupted alerts.
10. **Scenario Tree Variable Scoping in `agent-day` (`finalTp1` / `finalTp2`)**:
    - When `agent-day` constructs its Trading Central bifurcated scenario tree for `market_context`, targets must be mapped to `[finalTp1, finalTp2]`. Referencing un-aliased `[tp1, tp2]` throws a runtime `ReferenceError` during the `market_context` upsert, aborting the pipeline after trade insertion.
11. **PAMM Portfolio Drawdown Circuit Breakers (`No volume allocated`)**:
    - When an S-Tier signal generates `Execution Skipped: No volume allocated (Circuit Breaker / Max Drawdown reached for all users)`, the opportunity was successfully approved and scored by AI agents (e.g. `UKOIL` S-Tier 95%), but the PAMM risk desk halts trade execution because account equity drawdown limits were reached. Check account balances, open drawdown, and reset watermarks in `user_accounts` and `system_settings`.
12. **Counter-Trend Falling Knife Protection (Deterministic Alignment Veto)**:
    - For assets trading at macro extremes (e.g. Gold `XAUUSD` above $4,400 with Daily Hidden Bearish Divergence), agents enforce a Deterministic Alignment Veto to reject counter-trend longs. To originate S-Tier setups, agents should pivot to pullback short limit orders at key resistance or wait for confirmed structural break of swing support.
13. **Inter-Asset Sentiment Fallback in `pendingNewsSide` Pre-Filter**:
    - In `agent-swing` (lines 947-963), `pendingNewsSide` fetches direct sentiment for `symbol`. When `agent-news` detects a catalyst for benchmark pairs (e.g. `USOIL` Bearish or `XAUUSD` Bearish from surging 30Y Treasury yields), ensure `pendingNewsSide` falls back to the correlated peer (`UKOIL` $\leftarrow$ `USOIL`, `XAGUSD` $\leftarrow$ `XAUUSD`). This guarantees that correlated commodities receive the deterministic **+20 Macro Scout Fundamental Confluence** boost, upgrading 85% A-Tier setups into 95% S-Tier opportunities.
14. **Origination Risk Governor Dynamic Offset Calibration for Metals (`XAGUSD`)**:
    - For `XAGUSD` (Contract Size = 5,000 oz $\implies \$50.00$ per $\$1.00$ move), the maximum stop distance allowed under the $\$45.00$ cap ($3.0\%$ of $\$1,500$ equity) is strictly:
      $$\text{Max Stop Distance} = \frac{\$45.00}{0.01 \times \$50.00} = \$0.90$$
    - When daily/intraday ATR is elevated, raw stop placement (e.g. $\$3.09$) creates $\$154.60$ risk. The Risk Governor attempts to pull back the entry, but if the required entry offset exceeds `dynamic ATR buffer` ($0.515$), the setup is rejected with `entry offset exceeds dynamic ATR buffer`.
    - **Remediation**: The Adaptive Pullback Limit Solver must anchor the Limit Order strictly within $\$0.90$ of the confirmed swing invalidation pivot, or configure the metal buffer threshold to `Math.max(atr_14 * 1.5, currentPrice * 0.05)`.
15. **Cross-Timeframe Transition Handling (Intraday Extension $\to$ Macro Swing Exhaustion)**:
    - As demonstrated in `UKOIL`, `agent-day` captured an S-Tier 95% Bullish Continuation setup on M30 (Entry @ $\$102.49$, hitting TP2 @ $\$105.28$, status: `WON`). Simultaneously, once price expanded into the apex of the Daily Rising Wedge with RSI at 73.3, `agent-swing` originated an A-Tier 85% Short (@ $\$104.75$, TP2 @ $\$94.49$).
    - Pipeline operators must ensure intraday trend positions are fully realized / scaled out at TP2 before taking macro exhaustion swing entries to avoid margin netting conflicts.
16. **Consolidation / CHOP Passive Limit Recovery Protocol (`XAUUSD` & `BTCUSD`)**:
    - When pareto assets enter macro range consolidation (e.g. `XAUUSD` at $4,352 or `BTCUSD` at $77,270), `agent-swing` rejects with `No valid swing setup identified: Consolidation / CHOP without clear edge`.
    - Instead of discarding the asset, the pipeline should anchor a passive Limit Order at the 50.0% / 61.8% Fibonacci Golden Pocket or nearest structural Order Block / FVG (e.g. BTCUSD Buy Limit at 61.8% Fib $70,006, Gold Sell Limit at $4,397 FVG). This compresses stop distance, expands R:R to $\ge 1:2.5$, and elevates the setup into S-Tier.
17. **`agent-day` Macro Scout Fundamental Alignment Bonus (+20)**:
    - While `agent-swing` grants +20 confidence for aligning with `pendingNewsSide`, `agent-day` currently lacks an explicit +20 Macro Scout bonus in `agent-day/index.ts` (only applying +10 for S/R flips and +5 for session opens).
    - Implementing this fundamental alignment check in `agent-day` elevates high-probability intraday setups (75-80 confidence) into the 95+ S-Tier bracket when technicals align with live macro news from `market_context`.
18. **Adaptive Limit Solver Order Type Decoupling in `agent-swing`**:
    - In `agent-swing/index.ts` (line 562), the Adaptive Limit Solver is conditionally locked to `entry_type === "Market"`. If the LLM proposes a Limit order where Target 2 R:R is $< 1:1.70$, the solver is bypassed, routing the trade to `REQUIRE_LTF_DRILLDOWN` or rejection.
    - Removing the `"Market"` string restriction allows the solver to automatically recalculate any sub-optimal Limit order to guarantee the institutional $\ge 1:1.75$ R:R threshold.
19. **Live S-Tier Intraday Benchmark Case Study (`XAGUSD` M30 Short)**:
    - **Execution Proof**: Ticket `602943419`, Status `ACTIVE`, Confidence `92` (S-Tier 🏆).
    - **Parameters**: Sell Limit @ $\$65.31208$, SL @ $\$65.9771$ ($1.25\times\text{ATR}$ Volatility Guard), TP1 @ $\$64.5741$, TP2 @ $\$64.1121$, TP3 @ $\$63.1221$.
    - **Capital Efficiency**: Stop distance of $\$0.665 \times \$50.00 = \$33.25$ risk (under 3% cap), yielding $EV_{\text{TP2}} = +\$36.69$ ($+1.10R$) and $EV_{\text{TP3}} = +\$73.82$ ($+2.22R$) per 0.01 lot.
20. **Revalidation Seasoning & Unfilled Limit Order Protection**:
    - **Problem**: When `agent-day` or `agent-swing` originates a Limit Order awaiting a pullback fill (e.g. `XAGUSD` Sell Limit @ $65.31 while spot is $64.19), Phase 1 signal revalidation must NOT evaluate it prematurely or confuse resting limit distance with an active position approaching TP.
    - **Resolution**:
      * **Minimum Seasoning Guard**: Signals created $<15$ minutes ago (`hoursElapsed < 0.25`) are strictly bypassed during revalidation passes.
      * **Programmatic Limit Guard (`isUnfilledLimit`)**: If a limit order has not yet been filled (`currentPrice > entryPrice` for LONG, or `currentPrice < entryPrice` for SHORT), any AI-generated `TAKE_PROFIT` or `TIGHTEN_STOP` is intercepted and overridden to `MAINTAIN`.
      * **Timeframe Scoping**: `agent-swing` strictly revalidates daily swing signals (`1d`), preventing cross-agent interference with intraday scalps.
      * **Profit Securing Status Mapping**: Legitimate early profit securing on filled active positions updates `status: "WON"`, never `"REJECTED"`, preserving transparency in dashboard metrics.
