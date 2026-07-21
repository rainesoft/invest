CREATE TABLE IF NOT EXISTS public.market_context (
  id            UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  symbol        TEXT NOT NULL,
  agent_persona TEXT NOT NULL,      -- 'SWING_TRADER', 'MACRO_SCOUT', etc.
  timeframe     TEXT NOT NULL,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  expires_at    TIMESTAMPTZ,        -- stale after this; Swing context = 7 days, Volatility = 2 hours
  key_levels    JSONB,              -- { support: [], resistance: [], fib: {} }
  macro_bias    TEXT,               -- 'BULLISH', 'BEARISH', 'NEUTRAL', 'VOLATILITY_LOCKOUT'
  invalidation_price NUMERIC,
  narrative     TEXT                -- plain English for other agents to read
);

-- Enable RLS (allow all for service role)
ALTER TABLE public.market_context ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Enable all for service role" ON public.market_context USING (true) WITH CHECK (true);
