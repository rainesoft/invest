ALTER TABLE "public"."user_subscriptions"
ADD COLUMN IF NOT EXISTS "cancel_at_period_end" boolean DEFAULT false NOT NULL;
