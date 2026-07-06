-- Add active_broker to user_risk_settings
ALTER TABLE "public"."user_risk_settings" ADD COLUMN "active_broker" text DEFAULT 'ALPACA';
