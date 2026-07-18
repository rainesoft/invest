-- Migration: Centralized Telegram Bot Architecture
-- Adds the telegram_link_token to allow users to securely link their telegram accounts via Deep Linking
-- We preserve telegram_bot_token temporarily to avoid breaking changes if any old edge functions are still using it, but it will be deprecated.

ALTER TABLE "public"."user_risk_settings" 
    ADD COLUMN IF NOT EXISTS "telegram_link_token" text;
