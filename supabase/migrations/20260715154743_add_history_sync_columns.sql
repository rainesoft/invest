-- Migration: add_history_sync_columns
-- Description: Adds profit_usd, close_price, and closed_at to user_trades for historical P&L sync

ALTER TABLE "public"."user_trades"
ADD COLUMN "profit_usd" numeric,
ADD COLUMN "close_price" numeric,
ADD COLUMN "closed_at" timestamp with time zone;
