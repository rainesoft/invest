ALTER TABLE "public"."user_subscriptions"
ADD COLUMN IF NOT EXISTS "paystack_auth_code" text,
ADD COLUMN IF NOT EXISTS "billing_amount_usd" numeric,
ADD COLUMN IF NOT EXISTS "next_billing_date" timestamp with time zone;
