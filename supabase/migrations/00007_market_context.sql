-- Migration: 00007_market_context.sql
-- Creates the shared intelligence table that allows trading agents
-- to publish and consume each other's key levels, Fibonacci zones,
-- and macro bias. This is the foundation of the multi-agent council.

CREATE TABLE IF NOT EXISTS "public"."market_context" (
  "id"                 UUID DEFAULT gen_random_uuid() NOT NULL,
  "symbol"             TEXT NOT NULL,
  "agent_persona"      TEXT NOT NULL,
  "timeframe"          TEXT NOT NULL,
  "created_at"         TIMESTAMPTZ DEFAULT NOW(),
  "expires_at"         TIMESTAMPTZ,
  "key_levels"         JSONB,
  "macro_bias"         TEXT CHECK ("macro_bias" IN ('BULLISH', 'BEARISH', 'NEUTRAL')),
  "invalidation_price" NUMERIC,
  "narrative"          TEXT,
  CONSTRAINT "market_context_pkey" PRIMARY KEY ("id")
);

-- Index for fast symbol+expiry lookups (the hot path every 30 minutes)
CREATE INDEX IF NOT EXISTS "market_context_symbol_expires_idx"
  ON "public"."market_context" ("symbol", "expires_at" DESC);

-- Index for persona-scoped queries (useful for auditing per agent)
CREATE INDEX IF NOT EXISTS "market_context_persona_idx"
  ON "public"."market_context" ("agent_persona", "symbol");

-- Row-Level Security: service role can do anything; authenticated users can read
ALTER TABLE "public"."market_context" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access"
  ON "public"."market_context"
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Authenticated users can read context"
  ON "public"."market_context"
  FOR SELECT
  TO authenticated
  USING (true);

-- Auto-cleanup: delete rows where expires_at is in the past (runs nightly via cron)
-- The application also filters by expires_at > NOW() on every read, so expired rows
-- are harmlessly ignored. The cleanup here is just housekeeping.
COMMENT ON TABLE "public"."market_context" IS
  'Shared intelligence layer for the multi-agent trading council. Agents write key levels, Fibonacci zones, and macro bias here so other agents can read them before generating signals.';
