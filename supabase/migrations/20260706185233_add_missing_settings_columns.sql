-- Add missing columns to user_risk_settings for UI compatibility
ALTER TABLE "public"."user_risk_settings" 
    ADD COLUMN IF NOT EXISTS "max_volume_per_trade" numeric DEFAULT 50,
    ADD COLUMN IF NOT EXISTS "alpaca_key" text,
    ADD COLUMN IF NOT EXISTS "alpaca_secret" text,
    ADD COLUMN IF NOT EXISTS "auto_trade_enabled" boolean DEFAULT false,
    ADD COLUMN IF NOT EXISTS "sync_trailing_stops" boolean DEFAULT false,
    ADD COLUMN IF NOT EXISTS "auto_trade_tiers" text[] DEFAULT '{}'::text[],
    ADD COLUMN IF NOT EXISTS "telegram_bot_token" text,
    ADD COLUMN IF NOT EXISTS "telegram_chat_id" text;
