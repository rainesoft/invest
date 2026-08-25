-- Add source column to trade_opportunities for direct agent attribution
ALTER TABLE "public"."trade_opportunities" ADD COLUMN IF NOT EXISTS "source" "text";

-- Index the source column for efficient queries
CREATE INDEX IF NOT EXISTS "idx_trade_opportunities_source" ON "public"."trade_opportunities" ("source");

-- Backfill existing records based on ai_summary, timeframe, or model_version
UPDATE "public"."trade_opportunities"
SET "source" = 'agent-swing'
WHERE "source" IS NULL AND (
  "ai_summary" ILIKE '[SWING]%' OR
  "timeframe" IN ('1d', '1D', '4h', '4H', '1w', '1W')
);

UPDATE "public"."trade_opportunities"
SET "source" = 'agent-news'
WHERE "source" IS NULL AND (
  "ai_summary" ILIKE '%agent-news%' OR
  "risk_summary" ILIKE '%sentiment%'
);

UPDATE "public"."trade_opportunities"
SET "source" = 'agent-day'
WHERE "source" IS NULL AND (
  "timeframe" IN ('30m', '30M', '15m', '15M', '1h', '1H', '5m', '5M')
);
