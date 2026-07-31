# Multi-Agent AI Trading Architecture
## Raine Bank — Optimum Agent Council Design

---

## The Core Insight

Right now we have two isolated agents that never talk to each other:
- **Scalper** sees 100 bars of 1H data, knows nothing about the weekly Fibonacci structure
- **Swing Trader** generates macro setups but can't tell the Scalper *where* to enter inside them

The fix is a **shared intelligence layer** — a `market_context` table that agents write to and read from, so every agent benefits from every other agent's analysis.

---

## Part 1 — How the Scalper Uses Swing Levels Right Now (It Doesn't)

The Scalper currently receives:
```
✅ EMA-50, EMA-200 (1H)
✅ RSI, ATR, ADX (1H)
✅ Pivot points from yesterday's single candle
✅ Recent 5-bar fractal swing high/low
```

It does NOT receive:
```
❌ Fibonacci retracement levels from the 300-day swing
❌ Weekly EMA positions
❌ Swing Trader's identified entry/invalidation zones
❌ Whether current price is at a major structural level
```

**The fix**: The Swing Trader writes its key levels to a `market_context` table after every analysis. The Scalper reads that table before every prompt call. A scalper entry at the 61.8% Fib retracement on the 1H gets an automatic +8 confidence boost because it has multi-timeframe confluence — the most powerful signal in institutional trading.

---

## Part 2 — The Full Agent Council

### Tier 1: Signal Generation Agents
*Independent specialists. Each runs on its own schedule and timeframe.*

| Agent | Persona | Timeframe | Lookback | Cron | Specialty |
|-------|---------|-----------|----------|------|-----------|
| **Scalper** ✅ | Aggressive intraday trader | 1H | 100 bars | Every 30m | BOS entries, EMA momentum |
| **Swing Trader** ✅ | Institutional Fibonacci analyst | 1D | 300 bars | Daily 07:00 UTC | Fib levels, macro structure |
| **Position Trader** | Macro hedge fund manager | 1W | 200 weeks | Sunday 06:00 UTC | Central bank cycles, commodity supercycles |
| **Momentum Trader** | Trend-following quant | 4H | 200 bars | Every 4H | Breakout confirmation, volume, ADX > 40 |
| **Contrarian** | Reversal hunter | 1D | 100 bars | Daily 08:00 UTC | RSI divergence, exhaustion candles, sentiment extremes |
| **News Trader** | Event-driven macro analyst | Real-time | N/A | On-event trigger | Economic releases, geopolitical shocks, Fed speeches |
| **Pairs Trader** | Statistical arbitrageur | 4H | 300 bars | Every 4H | XAUUSD/XAGUSD ratio, Gold/Oil correlation, USD index |

---

### Tier 2: Validation Council
*These agents don't generate signals. They review and score Tier 1 outputs.*

| Agent | Role | Output |
|-------|------|--------|
| **Confluence Validator** | Checks how many Tier 1 agents agree on direction for a symbol | Confluence score −100 to +100 |
| **Devil's Advocate** | Actively argues AGAINST every approved signal | MAINTAIN / CHALLENGE / VETO |
| **Macro Alignment Officer** | Ensures every signal aligns with the dominant weekly regime | ALIGNED / NEUTRAL / MISALIGNED |

Signal is **upgraded** if ≥ 2 validators MAINTAIN.
Signal is **vetoed** if Devil's Advocate + 1 other both CHALLENGE.

---

### Tier 3: Chief Risk Officer (CRO)
*The final authority. No trade executes without passing through here.*

Inputs:
- Validated signal with Tier 2 verdicts
- Current portfolio exposure + correlation matrix
- FOMC and high-impact news lockout windows
- User-level risk limits from `risk_limits` table

Decisions: `EXECUTE (full)` · `EXECUTE (50% — correlation risk)` · `HOLD (pending entry)` · `REJECT`

---

### Tier 4: Post-Trade Auditor
*Learns from outcomes and feeds intelligence back into Tier 1 calibration.*

| Agent | Role |
|-------|------|
| **Performance Auditor** | After each trade closes, runs attribution: which agent's signal was correct? Writes to agent memory |
| **Calibration Engine** | Adjusts each agent's confidence weighting based on real win-rate per symbol. Prevents persistent overconfidence |

---

## Part 3 — The Shared Intelligence Layer

### New Database Tables

#### `market_context` — The Shared Brain
Agents publish their key levels here. All other agents read it before generating signals.

```sql
CREATE TABLE market_context (
  id            UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  symbol        TEXT NOT NULL,
  agent_persona TEXT NOT NULL,      -- 'SWING_TRADER' | 'POSITION_TRADER' | etc.
  timeframe     TEXT NOT NULL,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  expires_at    TIMESTAMPTZ,        -- stale after this; Swing context = 7 days
  key_levels    JSONB,              -- { support: [], resistance: [], fib: {} }
  macro_bias    TEXT,               -- 'BULLISH' | 'BEARISH' | 'NEUTRAL'
  invalidation_price NUMERIC,
  narrative     TEXT                -- plain English for other agents to read
);
```

#### `agent_signal_confluence` — Agreement Tracker
```sql
CREATE TABLE agent_signal_confluence (
  id                 UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  symbol             TEXT NOT NULL,
  evaluated_at       TIMESTAMPTZ DEFAULT NOW(),
  bull_agents        TEXT[],         -- agents currently bullish
  bear_agents        TEXT[],         -- agents currently bearish
  neutral_agents     TEXT[],
  confluence_score   NUMERIC,        -- −100 (unanimous bear) to +100 (unanimous bull)
  recommended_action TEXT,           -- 'STRONG_BUY' | 'BUY' | 'HOLD' | 'SELL' | 'STRONG_SELL'
  window_hours       INT DEFAULT 24
);
```

#### `agent_verdicts` — Validation Outputs
```sql
CREATE TABLE agent_verdicts (
  id                    UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  opportunity_id        UUID REFERENCES trade_opportunities(id),
  agent_name            TEXT NOT NULL,
  verdict               TEXT NOT NULL,    -- 'MAINTAIN' | 'CHALLENGE' | 'VETO'
  confidence_adjustment NUMERIC,          -- +/- applied to original confidence
  reasoning             TEXT,
  created_at            TIMESTAMPTZ DEFAULT NOW()
);
```

---

## Part 4 — Signal Lifecycle Flow

```
[Position Trader]  Sunday 06:00 UTC
      │  Writes weekly macro bias + key S/R to market_context (7-day TTL)
      ↓
[Swing Trader]     Daily 07:00 UTC
      │  Reads position context → computes Fib levels → writes to market_context (7-day TTL)
      │  Generates 1D swing signals (TP1/TP2/TP3)
      ↓
[Momentum Trader]  Every 4H
      │  Reads swing + position context → confirms breakouts with ADX + volume
      ↓
[Scalper]          Every 30 min
      │  Reads ALL market_context for symbol (Fib zones, macro bias, invalidation)
      │  Auto +8 confidence if entry is within 0.3% of a Fib level
      │  Generates 1H scalp entries WITHIN the swing trader's identified zones
      ↓
[News Trader]      Real-time (on economic event)
      │  Can cancel any PENDING signal if event contradicts thesis
      ↓
                   ─────────────── TIER 2 ───────────────
[Confluence Validator]  → Scores agreement across all active Tier 1 signals
[Devil's Advocate]      → Challenges every approved signal; must be defeated
[Macro Alignment]       → Checks weekly regime alignment
      ↓
[Chief Risk Officer]    → Final gate: portfolio exposure, correlation, sizing
      ↓
[trade-executor]        → Executes on MetaAPI broker
      ↓
[resolve-outcomes]      → Monitors live positions, auto-closes on SL/TP
      ↓
[Performance Auditor]   → Post-close attribution → writes to agent memory
[Calibration Engine]    → Adjusts agent confidence weights for next cycle
```

---

## Part 5 — Immediate Fix: Scalper Reads Swing Levels

**3 code changes required (all low complexity):**

### A. Swing Trader writes to `market_context` (swing-research-run/index.ts)
After computing Fibonacci levels, insert into `market_context`:
```typescript
await supabase.from('market_context').insert({
  symbol,
  agent_persona: 'SWING_TRADER',
  timeframe: '1D',
  expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
  key_levels: {
    fib_levels: fib.levels,      // all 7 retracement levels with prices
    fib_extensions: fib.extensions,
    swing_high: fib.swing_high,
    swing_low: fib.swing_low
  },
  macro_bias: evaluation.recommended_direction === 'LONG' ? 'BULLISH'
            : evaluation.recommended_direction === 'SHORT' ? 'BEARISH' : 'NEUTRAL',
  invalidation_price: evaluation.execution_parameters.suggested_stop_loss,
  narrative: evaluation.fibonacci_rationale
});
```

### B. Scalper reads `market_context` before AI call (research-run/index.ts)
```typescript
const { data: agentContext } = await supabase
  .from('market_context')
  .select('agent_persona, macro_bias, key_levels, invalidation_price, narrative')
  .eq('symbol', symbol)
  .gt('expires_at', new Date().toISOString())
  .order('created_at', { ascending: false })
  .limit(5);

snapshot.agent_context = agentContext ?? [];
```

### C. Add confluence rule to Scalper prompt
```
MULTI-TIMEFRAME CONFLUENCE (MANDATORY CHECK):
The snapshot may include agent_context from longer-timeframe agents.
1. If agent_context contains a SWING_TRADER entry with macro_bias matching 
   your intended direction → add +5 to your confidence_score.
2. If your suggested_entry_price is within 0.3% of any Fibonacci level in 
   agent_context[].key_levels.fib_levels → add +8 to your confidence_score.
3. If your entry would place you AGAINST the swing trader's macro_bias → 
   reduce confidence by 10 and require minimum A-Tier (80) confidence to proceed.
```

---

## Part 6 — Build Priority

| # | Agent / Feature | Impact | Complexity | When |
|---|-----------------|--------|------------|------|
| 1 | `market_context` table + Scalper reads Swing levels | 🔥 Immediate | Low | Now |
| 2 | **Momentum Trader** (4H breakouts) | High | Medium | Week 1 |
| 3 | **Devil's Advocate** Validator | High | Medium | Week 1 |
| 4 | **Confluence Validator** | High | Medium | Week 2 |
| 5 | **Contrarian Agent** (RSI divergence) | Medium | Medium | Week 2 |
| 6 | **Position Trader** (Weekly regime) | Very High | High | Week 3 |
| 7 | **News Trader** (Real-time events) | High | High | Week 3 |
| 8 | **Pairs Trader** (Gold/Silver ratio) | Medium | High | Week 4 |
| 9 | **CRO** (Portfolio-level final gate) | Critical | High | Week 4 |
| 10 | **Performance Auditor + Calibration** | Long-term | Very High | Month 2 |

---

## Part 7 — Why This Is How Winning Desks Are Run

The single biggest edge of institutional trading desks over retail traders is not their data or technology — it's their **structured disagreement process**. A junior analyst brings a trade idea. A risk manager actively tries to kill it. A macro strategist checks the regime. Only after surviving that council does the trade reach the execution desk.

Our current system has one voice. The architecture above gives it a council.

> ⚠️ *This is a design blueprint. All trading decisions involve risk. This system does not guarantee profits. Maintain human oversight of all automated trading systems.*
