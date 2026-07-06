ALTER TABLE "public"."user_risk_settings" 
ADD COLUMN IF NOT EXISTS "high_water_mark_equity" numeric DEFAULT 0,
ADD COLUMN IF NOT EXISTS "max_drawdown_pct" numeric DEFAULT 0.05;
