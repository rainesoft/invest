-- Add trade_type column to user_trades to support Partial Profit Taking.
-- STANDARD  = original single-leg trade (default for all existing rows)
-- QUICK_EXIT = the 50% leg targeting 1:1 R:R — exits early to bank guaranteed profit
-- RUNNER     = the 50% leg targeting the full AI take profit — protected by breakeven stop

ALTER TABLE "public"."user_trades"
  ADD COLUMN IF NOT EXISTS "trade_type" TEXT NOT NULL DEFAULT 'STANDARD';
