

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


CREATE EXTENSION IF NOT EXISTS "pg_cron" WITH SCHEMA "pg_catalog";






CREATE EXTENSION IF NOT EXISTS "pg_net" WITH SCHEMA "extensions";






COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE EXTENSION IF NOT EXISTS "pg_graphql" WITH SCHEMA "graphql";






CREATE EXTENSION IF NOT EXISTS "pg_stat_statements" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "pgcrypto" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "pgjwt" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "supabase_vault" WITH SCHEMA "vault";






CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA "extensions";






CREATE TYPE "public"."retry_request_type" AS ENUM (
    'ORDER_CREATE',
    'POSITION_MODIFY',
    'POSITION_CLOSE'
);


ALTER TYPE "public"."retry_request_type" OWNER TO "postgres";


CREATE TYPE "public"."retry_status" AS ENUM (
    'PENDING',
    'SUCCESS',
    'DEAD_LETTER'
);


ALTER TYPE "public"."retry_status" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."handle_new_user_subscription"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
begin
  insert into public.user_subscriptions (user_id)
  values (new.id);
  return new;
end;
$$;


ALTER FUNCTION "public"."handle_new_user_subscription"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."trigger_email_onboarding"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
declare
  webhook_url text;
  payload jsonb;
  request_id bigint;
begin
  webhook_url := current_setting('app.settings.edge_functions_base_url', true);
  
  if webhook_url is null then
    webhook_url := 'http://kong:8000/functions/v1';
  end if;

  payload := jsonb_build_object(
    'type', 'INSERT',
    'table', 'users',
    'schema', 'auth',
    'record', jsonb_build_object('id', NEW.id, 'email', NEW.email)
  );

  select net.http_post(
    url := webhook_url || '/email-onboarding',
    body := payload,
    headers := '{"Content-Type": "application/json"}'::jsonb
  ) into request_id;

  return NEW;
end;
$$;


ALTER FUNCTION "public"."trigger_email_onboarding"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."trigger_exness_executor"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
declare
  webhook_url text;
  payload jsonb;
  request_id bigint;
begin
  webhook_url := current_setting('app.settings.edge_functions_base_url', true);
  
  if webhook_url is null then
    webhook_url := 'http://kong:8000/functions/v1';
  end if;

  payload := jsonb_build_object(
    'type', TG_OP,
    'table', TG_TABLE_NAME,
    'schema', TG_TABLE_SCHEMA,
    'record', row_to_json(NEW),
    'old_record', case when TG_OP = 'UPDATE' then row_to_json(OLD) else null end
  );

  -- Execute asynchronous HTTP POST via pg_net to the execution API
  select net.http_post(
    url := webhook_url || '/exness-executor',
    body := payload,
    headers := '{"Content-Type": "application/json"}'::jsonb
  ) into request_id;

  return NEW;
end;
$$;


ALTER FUNCTION "public"."trigger_exness_executor"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."trigger_telegram_broadcast"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
declare
  webhook_url text;
  payload jsonb;
  request_id bigint;
begin
  -- Retrieve the base URL from postgres settings, fallback to local kong gateway
  webhook_url := current_setting('app.settings.edge_functions_base_url', true);
  
  if webhook_url is null then
    webhook_url := 'http://kong:8000/functions/v1';
  end if;

  -- Construct standard Supabase Webhook payload
  payload := jsonb_build_object(
    'type', 'INSERT',
    'table', TG_TABLE_NAME,
    'schema', TG_TABLE_SCHEMA,
    'record', row_to_json(NEW),
    'old_record', null
  );

  -- Execute asynchronous HTTP POST via pg_net
  select net.http_post(
    url := webhook_url || '/telegram-broadcast',
    body := payload,
    headers := '{"Content-Type": "application/json"}'::jsonb
  ) into request_id;

  return NEW;
end;
$$;


ALTER FUNCTION "public"."trigger_telegram_broadcast"() OWNER TO "postgres";

SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."audit_log" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "actor_type" "text",
    "actor_id" "uuid",
    "action" "text",
    "entity_type" "text",
    "entity_id" "uuid",
    "payload_json" "jsonb",
    "hash" "text",
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."audit_log" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."calendars" (
    "symbol" "text",
    "venue" "text",
    "session_open" time without time zone,
    "session_close" time without time zone,
    "holiday" "date",
    "half_day" boolean DEFAULT false,
    "tz" "text"
);


ALTER TABLE "public"."calendars" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."executions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "order_id" "uuid",
    "price" numeric,
    "qty" numeric,
    "fee" numeric,
    "ts" timestamp with time zone DEFAULT "now"(),
    "raw_fill" "jsonb"
);


ALTER TABLE "public"."executions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."idempotency_keys" (
    "key" "text" NOT NULL,
    "entity_type" "text",
    "entity_id" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."idempotency_keys" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."market_data_pti" (
    "symbol" "text" NOT NULL,
    "timeframe" "text" NOT NULL,
    "ts" timestamp with time zone NOT NULL,
    "o" numeric,
    "h" numeric,
    "l" numeric,
    "c" numeric,
    "v" numeric,
    "revision" integer DEFAULT 0 NOT NULL,
    "hash" "text"
);


ALTER TABLE "public"."market_data_pti" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."meta_api_retry_queue" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid",
    "meta_api_account_id" "text" NOT NULL,
    "request_type" "public"."retry_request_type" NOT NULL,
    "api_payload" "jsonb" NOT NULL,
    "retry_count" integer DEFAULT 0,
    "next_retry_at" timestamp with time zone DEFAULT "now"(),
    "status" "public"."retry_status" DEFAULT 'PENDING'::"public"."retry_status",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "last_error" "text"
);


ALTER TABLE "public"."meta_api_retry_queue" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."models" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "version" "text" NOT NULL,
    "params_json" "jsonb",
    "trained_until" "date",
    "regime_signature" "text",
    "sha_hash" "text",
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."models" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."orders" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "trade_id" "uuid",
    "broker" "text",
    "client_order_id" "text",
    "type" "text",
    "side" "text",
    "qty" numeric,
    "price" numeric,
    "status" "text",
    "raw_request" "jsonb",
    "raw_response" "jsonb",
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."orders" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."profit_take_requests" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "trade_id" "uuid",
    "price" numeric,
    "status" "text" DEFAULT 'PENDING'::"text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "expires_at" timestamp with time zone,
    "decision_at" timestamp with time zone,
    CONSTRAINT "profit_take_requests_status_check" CHECK (("status" = ANY (ARRAY['PENDING'::"text", 'APPROVED'::"text", 'DENIED'::"text", 'EXPIRED'::"text"])))
);


ALTER TABLE "public"."profit_take_requests" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."risk_limits" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "scope" "text",
    "cap_type" "text",
    "value" numeric,
    "active" boolean DEFAULT true
);


ALTER TABLE "public"."risk_limits" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."trade_opportunities" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "report_id" "uuid",
    "strategy_id" "uuid",
    "model_id" "uuid",
    "model_version" "text",
    "symbol" "text" NOT NULL,
    "side" "text" NOT NULL,
    "timeframe" "text" NOT NULL,
    "entry_plan_json" "jsonb",
    "stop_plan_json" "jsonb",
    "take_profit_json" "jsonb",
    "risk_summary" "text",
    "expected_return" numeric,
    "confidence" numeric,
    "ai_summary" "text",
    "ai_risks" "text",
    "status" "text" DEFAULT 'PENDING_APPROVAL'::"text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "r_multiple" numeric,
    "closed_at" timestamp with time zone,
    "is_archived" boolean DEFAULT false,
    CONSTRAINT "trade_opportunities_side_check" CHECK (("side" = ANY (ARRAY['LONG'::"text", 'SHORT'::"text"]))),
    CONSTRAINT "trade_opportunities_status_check" CHECK (("status" = ANY (ARRAY['PENDING_APPROVAL'::"text", 'APPROVED'::"text", 'REJECTED'::"text", 'EXPIRED'::"text", 'WON'::"text", 'LOST'::"text"])))
);


ALTER TABLE "public"."trade_opportunities" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."trades" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "opportunity_id" "uuid",
    "symbol" "text" NOT NULL,
    "side" "text" NOT NULL,
    "qty" numeric NOT NULL,
    "entry_price" numeric,
    "stop_type" "text",
    "stop_params_json" "jsonb",
    "status" "text" DEFAULT 'OPEN'::"text",
    "opened_at" timestamp with time zone DEFAULT "now"(),
    "closed_at" timestamp with time zone,
    "close_reason" "text",
    "correlation_group" "text",
    CONSTRAINT "trades_side_check" CHECK (("side" = ANY (ARRAY['LONG'::"text", 'SHORT'::"text"]))),
    CONSTRAINT "trades_status_check" CHECK (("status" = ANY (ARRAY['OPEN'::"text", 'CLOSING'::"text", 'CLOSED'::"text"])))
);


ALTER TABLE "public"."trades" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."user_risk_settings" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "portfolio_capital" numeric DEFAULT 10000 NOT NULL,
    "risk_per_trade_pct" numeric DEFAULT 0.01 NOT NULL,
    "max_portfolio_heat_pct" numeric DEFAULT 0.10 NOT NULL,
    "meta_api_token" "text",
    "meta_api_account_id" "text",
    "is_live_execution_enabled" boolean DEFAULT false,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "max_spread_points" numeric DEFAULT 50
);


ALTER TABLE "public"."user_risk_settings" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."user_subscriptions" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "paystack_customer_code" "text",
    "paystack_subscription_code" "text",
    "plan_tier" "text" DEFAULT 'free'::"text" NOT NULL,
    "status" "text" DEFAULT 'active'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL
);


ALTER TABLE "public"."user_subscriptions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."user_trades" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "opportunity_id" "uuid" NOT NULL,
    "symbol" "text" NOT NULL,
    "side" "text" NOT NULL,
    "volume" numeric NOT NULL,
    "risk_amount" numeric NOT NULL,
    "status" "text" DEFAULT 'PENDING'::"text" NOT NULL,
    "meta_api_order_id" "text",
    "error_message" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."user_trades" OWNER TO "postgres";


ALTER TABLE ONLY "public"."audit_log"
    ADD CONSTRAINT "audit_log_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."executions"
    ADD CONSTRAINT "executions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."idempotency_keys"
    ADD CONSTRAINT "idempotency_keys_pkey" PRIMARY KEY ("key");



ALTER TABLE ONLY "public"."market_data_pti"
    ADD CONSTRAINT "market_data_pti_pkey" PRIMARY KEY ("symbol", "timeframe", "ts", "revision");



ALTER TABLE ONLY "public"."meta_api_retry_queue"
    ADD CONSTRAINT "meta_api_retry_queue_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."models"
    ADD CONSTRAINT "models_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."orders"
    ADD CONSTRAINT "orders_client_order_id_key" UNIQUE ("client_order_id");



ALTER TABLE ONLY "public"."orders"
    ADD CONSTRAINT "orders_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."profit_take_requests"
    ADD CONSTRAINT "profit_take_requests_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."risk_limits"
    ADD CONSTRAINT "risk_limits_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."trade_opportunities"
    ADD CONSTRAINT "trade_opportunities_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."trades"
    ADD CONSTRAINT "trades_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."user_risk_settings"
    ADD CONSTRAINT "user_risk_settings_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."user_risk_settings"
    ADD CONSTRAINT "user_risk_settings_user_id_key" UNIQUE ("user_id");



ALTER TABLE ONLY "public"."user_subscriptions"
    ADD CONSTRAINT "user_subscriptions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."user_subscriptions"
    ADD CONSTRAINT "user_subscriptions_user_id_key" UNIQUE ("user_id");



ALTER TABLE ONLY "public"."user_trades"
    ADD CONSTRAINT "user_trades_pkey" PRIMARY KEY ("id");



CREATE INDEX "idx_meta_api_retry_queue_sweep" ON "public"."meta_api_retry_queue" USING "btree" ("status", "next_retry_at") WHERE ("status" = 'PENDING'::"public"."retry_status");



CREATE OR REPLACE TRIGGER "on_signal_execute" AFTER INSERT OR UPDATE ON "public"."trade_opportunities" FOR EACH ROW EXECUTE FUNCTION "public"."trigger_exness_executor"();



CREATE OR REPLACE TRIGGER "on_signal_generated" AFTER INSERT ON "public"."trade_opportunities" FOR EACH ROW EXECUTE FUNCTION "public"."trigger_telegram_broadcast"();



ALTER TABLE ONLY "public"."executions"
    ADD CONSTRAINT "executions_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id");



ALTER TABLE ONLY "public"."meta_api_retry_queue"
    ADD CONSTRAINT "meta_api_retry_queue_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."user_risk_settings"("user_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."orders"
    ADD CONSTRAINT "orders_trade_id_fkey" FOREIGN KEY ("trade_id") REFERENCES "public"."trades"("id");



ALTER TABLE ONLY "public"."profit_take_requests"
    ADD CONSTRAINT "profit_take_requests_trade_id_fkey" FOREIGN KEY ("trade_id") REFERENCES "public"."trades"("id");



ALTER TABLE ONLY "public"."trades"
    ADD CONSTRAINT "trades_opportunity_id_fkey" FOREIGN KEY ("opportunity_id") REFERENCES "public"."trade_opportunities"("id");



ALTER TABLE ONLY "public"."user_risk_settings"
    ADD CONSTRAINT "user_risk_settings_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."user_subscriptions"
    ADD CONSTRAINT "user_subscriptions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."user_trades"
    ADD CONSTRAINT "user_trades_opportunity_id_fkey" FOREIGN KEY ("opportunity_id") REFERENCES "public"."trade_opportunities"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."user_trades"
    ADD CONSTRAINT "user_trades_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



CREATE POLICY "Users can manage their own risk settings" ON "public"."user_risk_settings" TO "authenticated" USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can view their own subscription status" ON "public"."user_subscriptions" FOR SELECT TO "authenticated" USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can view their own trades" ON "public"."user_trades" FOR SELECT TO "authenticated" USING (("auth"."uid"() = "user_id"));



ALTER TABLE "public"."user_risk_settings" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."user_subscriptions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."user_trades" ENABLE ROW LEVEL SECURITY;




ALTER PUBLICATION "supabase_realtime" OWNER TO "postgres";












GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";






































































































































































































GRANT ALL ON FUNCTION "public"."handle_new_user_subscription"() TO "anon";
GRANT ALL ON FUNCTION "public"."handle_new_user_subscription"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."handle_new_user_subscription"() TO "service_role";



GRANT ALL ON FUNCTION "public"."trigger_email_onboarding"() TO "anon";
GRANT ALL ON FUNCTION "public"."trigger_email_onboarding"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."trigger_email_onboarding"() TO "service_role";



GRANT ALL ON FUNCTION "public"."trigger_exness_executor"() TO "anon";
GRANT ALL ON FUNCTION "public"."trigger_exness_executor"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."trigger_exness_executor"() TO "service_role";



GRANT ALL ON FUNCTION "public"."trigger_telegram_broadcast"() TO "anon";
GRANT ALL ON FUNCTION "public"."trigger_telegram_broadcast"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."trigger_telegram_broadcast"() TO "service_role";
























GRANT ALL ON TABLE "public"."audit_log" TO "anon";
GRANT ALL ON TABLE "public"."audit_log" TO "authenticated";
GRANT ALL ON TABLE "public"."audit_log" TO "service_role";



GRANT ALL ON TABLE "public"."calendars" TO "anon";
GRANT ALL ON TABLE "public"."calendars" TO "authenticated";
GRANT ALL ON TABLE "public"."calendars" TO "service_role";



GRANT ALL ON TABLE "public"."executions" TO "anon";
GRANT ALL ON TABLE "public"."executions" TO "authenticated";
GRANT ALL ON TABLE "public"."executions" TO "service_role";



GRANT ALL ON TABLE "public"."idempotency_keys" TO "anon";
GRANT ALL ON TABLE "public"."idempotency_keys" TO "authenticated";
GRANT ALL ON TABLE "public"."idempotency_keys" TO "service_role";



GRANT ALL ON TABLE "public"."market_data_pti" TO "anon";
GRANT ALL ON TABLE "public"."market_data_pti" TO "authenticated";
GRANT ALL ON TABLE "public"."market_data_pti" TO "service_role";



GRANT ALL ON TABLE "public"."meta_api_retry_queue" TO "anon";
GRANT ALL ON TABLE "public"."meta_api_retry_queue" TO "authenticated";
GRANT ALL ON TABLE "public"."meta_api_retry_queue" TO "service_role";



GRANT ALL ON TABLE "public"."models" TO "anon";
GRANT ALL ON TABLE "public"."models" TO "authenticated";
GRANT ALL ON TABLE "public"."models" TO "service_role";



GRANT ALL ON TABLE "public"."orders" TO "anon";
GRANT ALL ON TABLE "public"."orders" TO "authenticated";
GRANT ALL ON TABLE "public"."orders" TO "service_role";



GRANT ALL ON TABLE "public"."profit_take_requests" TO "anon";
GRANT ALL ON TABLE "public"."profit_take_requests" TO "authenticated";
GRANT ALL ON TABLE "public"."profit_take_requests" TO "service_role";



GRANT ALL ON TABLE "public"."risk_limits" TO "anon";
GRANT ALL ON TABLE "public"."risk_limits" TO "authenticated";
GRANT ALL ON TABLE "public"."risk_limits" TO "service_role";



GRANT ALL ON TABLE "public"."trade_opportunities" TO "anon";
GRANT ALL ON TABLE "public"."trade_opportunities" TO "authenticated";
GRANT ALL ON TABLE "public"."trade_opportunities" TO "service_role";



GRANT ALL ON TABLE "public"."trades" TO "anon";
GRANT ALL ON TABLE "public"."trades" TO "authenticated";
GRANT ALL ON TABLE "public"."trades" TO "service_role";



GRANT ALL ON TABLE "public"."user_risk_settings" TO "anon";
GRANT ALL ON TABLE "public"."user_risk_settings" TO "authenticated";
GRANT ALL ON TABLE "public"."user_risk_settings" TO "service_role";



GRANT ALL ON TABLE "public"."user_subscriptions" TO "anon";
GRANT ALL ON TABLE "public"."user_subscriptions" TO "authenticated";
GRANT ALL ON TABLE "public"."user_subscriptions" TO "service_role";



GRANT ALL ON TABLE "public"."user_trades" TO "anon";
GRANT ALL ON TABLE "public"."user_trades" TO "authenticated";
GRANT ALL ON TABLE "public"."user_trades" TO "service_role";









ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES  TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES  TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES  TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES  TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS  TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS  TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS  TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS  TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES  TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES  TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES  TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES  TO "service_role";






























RESET ALL;
