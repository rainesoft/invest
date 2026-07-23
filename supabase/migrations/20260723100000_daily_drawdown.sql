ALTER TABLE "public"."user_risk_settings" 
ADD COLUMN IF NOT EXISTS "daily_starting_equity" numeric,
ADD COLUMN IF NOT EXISTS "max_daily_drawdown_pct" numeric DEFAULT 0.05;

-- Initialize daily_starting_equity to current portfolio_capital for existing rows
UPDATE "public"."user_risk_settings" 
SET "daily_starting_equity" = "portfolio_capital" 
WHERE "daily_starting_equity" IS NULL;
