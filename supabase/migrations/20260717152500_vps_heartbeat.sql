-- Add VPS heartbeat tracking to user_risk_settings
ALTER TABLE "public"."user_risk_settings" ADD COLUMN "vps_last_heartbeat" timestamp with time zone;
