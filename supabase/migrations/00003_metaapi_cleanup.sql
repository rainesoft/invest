-- Drop the obsolete MetaAPI tokens from user_risk_settings
ALTER TABLE "public"."user_risk_settings" DROP COLUMN IF EXISTS "meta_api_token";
ALTER TABLE "public"."user_risk_settings" DROP COLUMN IF EXISTS "meta_api_account_id";

-- Drop the obsolete MetaAPI retry queue
DROP TABLE IF EXISTS "public"."meta_api_retry_queue" CASCADE;
