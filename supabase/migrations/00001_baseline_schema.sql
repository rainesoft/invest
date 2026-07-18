

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






COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE EXTENSION IF NOT EXISTS "pg_net" WITH SCHEMA "public";






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


CREATE OR REPLACE FUNCTION "public"."allocate_virtual_pnl"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE
  v_user_wallet_id uuid;
  v_platform_wallet_id uuid;
  v_txn_id uuid;
  v_description text;
BEGIN
  -- We only allocate when the status changes to WON or LOST
  IF NEW.status IN ('WON', 'LOST') AND OLD.status NOT IN ('WON', 'LOST') THEN
    
    -- Assuming Rainebank trading pool operates in USD
    SELECT id INTO v_user_wallet_id FROM public.wallets 
    WHERE user_id = NEW.user_id AND currency = 'USD' AND is_platform = false;
    
    SELECT id INTO v_platform_wallet_id FROM public.wallets 
    WHERE currency = 'USD' AND is_platform = true;

    IF v_user_wallet_id IS NOT NULL AND v_platform_wallet_id IS NOT NULL AND COALESCE(NEW.profit_usd, 0) != 0 THEN
      
      -- Create Ledger Transaction
      IF NEW.profit_usd > 0 THEN
        v_description := 'Virtual Trading Profit: ' || NEW.symbol;
      ELSE
        v_description := 'Virtual Trading Loss: ' || NEW.symbol;
      END IF;

      INSERT INTO public.ledger_transactions (reference_code, description, type) 
      VALUES ('TRADE-' || NEW.id, v_description, 'TRADE_PNL')
      RETURNING id INTO v_txn_id;

      -- Double Entry Logging
      -- Debit/Credit Platform Escrow Wallet
      INSERT INTO public.ledger_entries (transaction_id, wallet_id, amount)
      VALUES (v_txn_id, v_platform_wallet_id, -NEW.profit_usd);

      UPDATE public.wallets 
      SET balance = GREATEST(0, balance - NEW.profit_usd)
      WHERE id = v_platform_wallet_id;

      -- Debit/Credit User Wallet
      INSERT INTO public.ledger_entries (transaction_id, wallet_id, amount)
      VALUES (v_txn_id, v_user_wallet_id, NEW.profit_usd);

      UPDATE public.wallets 
      SET balance = GREATEST(0, balance + NEW.profit_usd)
      WHERE id = v_user_wallet_id;
    END IF;
  END IF;
  
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."allocate_virtual_pnl"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_total_assets"("asset_type" "text") RETURNS numeric
    LANGUAGE "sql" SECURITY DEFINER
    AS $$
  SELECT COALESCE(sum(balance), 0) FROM public.treasury_accounts WHERE account_type = asset_type;
$$;


ALTER FUNCTION "public"."get_total_assets"("asset_type" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_total_customer_liability"() RETURNS numeric
    LANGUAGE "sql" SECURITY DEFINER
    AS $$
  SELECT COALESCE(sum(balance), 0) FROM public.wallets WHERE is_platform = false;
$$;


ALTER FUNCTION "public"."get_total_customer_liability"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."handle_admin_creation"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
BEGIN
  IF NEW.email = 'kobequagraine@yahoo.com' THEN
    -- Insert risk settings with admin = true
    INSERT INTO public.user_risk_settings (user_id, is_admin)
    VALUES (NEW.id, true)
    ON CONFLICT (user_id) DO UPDATE SET is_admin = true;
  END IF;
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."handle_admin_creation"() OWNER TO "postgres";


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


CREATE OR REPLACE FUNCTION "public"."handle_rejected_signal"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
BEGIN
  IF NEW.status = 'REJECTED' AND OLD.status != 'REJECTED' THEN
    PERFORM net.http_post(
      url:='https://ktezlusdkqlfdwqrldtn.supabase.co/functions/v1/auto-eject',
      headers:=jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key', true)
      ),
      body:=jsonb_build_object(
        'type', 'UPDATE',
        'table', 'trade_opportunities',
        'record', row_to_json(NEW),
        'old_record', row_to_json(OLD)
      )
    );
  END IF;
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."handle_rejected_signal"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."process_transfer"("sender_wallet_id" "uuid", "receiver_wallet_id" "uuid", "transfer_amount" numeric, "txn_reference" "text", "txn_description" "text", "txn_type" "text") RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE
  new_txn_id uuid;
BEGIN
  -- Create the transaction record
  INSERT INTO public.ledger_transactions (reference_code, description, type) 
  VALUES (txn_reference, txn_description, txn_type)
  RETURNING id INTO new_txn_id;

  -- Debit the sender
  INSERT INTO public.ledger_entries (transaction_id, wallet_id, amount)
  VALUES (new_txn_id, sender_wallet_id, -transfer_amount);

  UPDATE public.wallets 
  SET balance = balance - transfer_amount 
  WHERE id = sender_wallet_id;

  -- Credit the receiver
  INSERT INTO public.ledger_entries (transaction_id, wallet_id, amount)
  VALUES (new_txn_id, receiver_wallet_id, transfer_amount);

  UPDATE public.wallets 
  SET balance = balance + transfer_amount 
  WHERE id = receiver_wallet_id;

  -- If it's a deposit, increase the receiver's High-Water Mark
  IF txn_type = 'DEPOSIT' THEN
    UPDATE public.wallets
    SET watermark_principal = watermark_principal + transfer_amount
    WHERE id = receiver_wallet_id AND is_platform = false AND is_revenue = false;
  END IF;

  RETURN true;
END;
$$;


ALTER FUNCTION "public"."process_transfer"("sender_wallet_id" "uuid", "receiver_wallet_id" "uuid", "transfer_amount" numeric, "txn_reference" "text", "txn_description" "text", "txn_type" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."request_withdrawal"("p_user_id" "uuid", "p_wallet_id" "uuid", "p_amount" numeric, "p_currency" "text", "p_reference" "text", "p_destination" "jsonb") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE
  v_platform_wallet_id uuid;
  v_revenue_wallet_id uuid;
  v_user_wallet record;
  v_plan_tier text;
  v_withdrawal_id uuid;
  v_txn_id uuid;
  
  v_profit numeric;
  v_amount_profit numeric;
  v_amount_principal numeric;
  v_fee_amount numeric := 0;
  v_net_to_user numeric;
BEGIN
  -- 1. Find the platform clearing wallet and revenue wallet
  SELECT id INTO v_platform_wallet_id FROM public.wallets WHERE is_platform = true AND currency = p_currency;
  SELECT id INTO v_revenue_wallet_id FROM public.wallets WHERE is_revenue = true AND currency = p_currency;
  
  IF v_platform_wallet_id IS NULL THEN
    RAISE EXCEPTION 'Platform wallet for currency % not found', p_currency;
  END IF;
  
  IF v_revenue_wallet_id IS NULL THEN
    RAISE EXCEPTION 'Revenue wallet for currency % not found', p_currency;
  END IF;

  -- 2. Fetch User Wallet & Subscription
  SELECT * INTO v_user_wallet FROM public.wallets WHERE id = p_wallet_id AND user_id = p_user_id;
  IF v_user_wallet.id IS NULL THEN
    RAISE EXCEPTION 'User wallet not found';
  END IF;

  IF v_user_wallet.balance < p_amount THEN
    RAISE EXCEPTION 'Insufficient funds';
  END IF;

  SELECT plan_tier INTO v_plan_tier FROM public.user_subscriptions WHERE user_id = p_user_id;

  -- 3. High-Water Mark Profit Calculation
  v_profit := GREATEST(0, v_user_wallet.balance - v_user_wallet.watermark_principal);
  v_amount_profit := LEAST(p_amount, v_profit);
  v_amount_principal := p_amount - v_amount_profit;

  -- If the user is on the free tier, we take 30% of the withdrawn profit
  IF COALESCE(v_plan_tier, 'free') = 'free' THEN
    v_fee_amount := v_amount_profit * 0.30;
  END IF;

  v_net_to_user := p_amount - v_fee_amount;

  -- 4. Adjust the Watermark if principal is being withdrawn
  IF v_amount_principal > 0 THEN
    UPDATE public.wallets 
    SET watermark_principal = GREATEST(0, watermark_principal - v_amount_principal)
    WHERE id = p_wallet_id;
  END IF;

  -- 5. Execute Internal Transfers
  -- Debit user the full gross amount
  UPDATE public.wallets SET balance = balance - p_amount WHERE id = p_wallet_id;
  
  -- Credit platform escrow with the net amount
  UPDATE public.wallets SET balance = balance + v_net_to_user WHERE id = v_platform_wallet_id;
  
  -- Credit revenue wallet with the fee
  IF v_fee_amount > 0 THEN
    UPDATE public.wallets SET balance = balance + v_fee_amount WHERE id = v_revenue_wallet_id;
  END IF;

  -- 6. Record Ledger Entries
  INSERT INTO public.ledger_transactions (reference_code, description, type) 
  VALUES (p_reference, 'Withdrawal Escrow & Performance Fee', 'WITHDRAWAL')
  RETURNING id INTO v_txn_id;

  INSERT INTO public.ledger_entries (transaction_id, wallet_id, amount) VALUES (v_txn_id, p_wallet_id, -p_amount);
  INSERT INTO public.ledger_entries (transaction_id, wallet_id, amount) VALUES (v_txn_id, v_platform_wallet_id, v_net_to_user);
  
  IF v_fee_amount > 0 THEN
    INSERT INTO public.ledger_entries (transaction_id, wallet_id, amount) VALUES (v_txn_id, v_revenue_wallet_id, v_fee_amount);
  END IF;

  -- 7. Create Withdrawal Request (Net Amount is passed to Paystack)
  INSERT INTO public.withdrawal_requests (user_id, wallet_id, amount, performance_fee, principal_withdrawn, currency, reference_code, destination_details)
  VALUES (p_user_id, p_wallet_id, v_net_to_user, v_fee_amount, v_amount_principal, p_currency, p_reference, p_destination)
  RETURNING id INTO v_withdrawal_id;

  RETURN v_withdrawal_id;
END;
$$;


ALTER FUNCTION "public"."request_withdrawal"("p_user_id" "uuid", "p_wallet_id" "uuid", "p_amount" numeric, "p_currency" "text", "p_reference" "text", "p_destination" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."reverse_withdrawal"("p_reference" "text") RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE
  v_req record;
  v_platform_wallet_id uuid;
  v_revenue_wallet_id uuid;
  v_txn_id uuid;
BEGIN
  SELECT * INTO v_req FROM public.withdrawal_requests WHERE reference_code = p_reference;
  
  IF v_req.id IS NULL THEN
    RAISE EXCEPTION 'Withdrawal request not found';
  END IF;

  IF v_req.status != 'PENDING' AND v_req.status != 'PROCESSING' THEN
    RAISE EXCEPTION 'Withdrawal request is not pending';
  END IF;

  SELECT id INTO v_platform_wallet_id FROM public.wallets WHERE is_platform = true AND currency = v_req.currency;
  SELECT id INTO v_revenue_wallet_id FROM public.wallets WHERE is_revenue = true AND currency = v_req.currency;

  -- Debit platform (net amount)
  UPDATE public.wallets SET balance = balance - v_req.amount WHERE id = v_platform_wallet_id;
  
  -- Debit revenue (fee amount)
  IF COALESCE(v_req.performance_fee, 0) > 0 THEN
    UPDATE public.wallets SET balance = balance - v_req.performance_fee WHERE id = v_revenue_wallet_id;
  END IF;

  -- Credit user (gross amount)
  UPDATE public.wallets SET balance = balance + v_req.amount + COALESCE(v_req.performance_fee, 0) WHERE id = v_req.wallet_id;

  -- Restore the watermark if principal was withdrawn
  IF COALESCE(v_req.principal_withdrawn, 0) > 0 THEN
    UPDATE public.wallets SET watermark_principal = watermark_principal + v_req.principal_withdrawn WHERE id = v_req.wallet_id;
  END IF;

  INSERT INTO public.ledger_transactions (reference_code, description, type) 
  VALUES (p_reference || '-REV', 'Withdrawal Reversal', 'WITHDRAWAL_REFUND')
  RETURNING id INTO v_txn_id;

  INSERT INTO public.ledger_entries (transaction_id, wallet_id, amount) VALUES (v_txn_id, v_platform_wallet_id, -v_req.amount);
  
  IF COALESCE(v_req.performance_fee, 0) > 0 THEN
    INSERT INTO public.ledger_entries (transaction_id, wallet_id, amount) VALUES (v_txn_id, v_revenue_wallet_id, -v_req.performance_fee);
  END IF;
  
  INSERT INTO public.ledger_entries (transaction_id, wallet_id, amount) VALUES (v_txn_id, v_req.wallet_id, v_req.amount + COALESCE(v_req.performance_fee, 0));

  UPDATE public.withdrawal_requests SET status = 'FAILED' WHERE id = v_req.id;

  RETURN true;
END;
$$;


ALTER FUNCTION "public"."reverse_withdrawal"("p_reference" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."trigger_auto_eject"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
declare
  webhook_url text;
  payload jsonb;
  request_id bigint;
  secret_val text := 'r4in3_s3cur3_w3bh00k_k3y';
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
    'old_record', row_to_json(OLD)
  );

  select net.http_post(
    url := webhook_url || '/auto-eject',
    body := payload,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-webhook-secret', secret_val)
  ) into request_id;

  return NEW;
end;
$$;


ALTER FUNCTION "public"."trigger_auto_eject"() OWNER TO "postgres";


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


CREATE OR REPLACE FUNCTION "public"."trigger_telegram_broadcast"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
declare
  webhook_url text := 'https://ktezlusdkqlfdwqrldtn.supabase.co/functions/v1';
  payload jsonb;
  request_id bigint;
  secret_val text := 'r4in3_s3cur3_w3bh00k_k3y';
begin
  payload := jsonb_build_object(
    'type', TG_OP,
    'table', TG_TABLE_NAME,
    'schema', TG_TABLE_SCHEMA,
    'record', row_to_json(NEW),
    'old_record', row_to_json(OLD)
  );

  select net.http_post(
    url := webhook_url || '/telegram-broadcast',
    body := payload,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-webhook-secret', secret_val)
  ) into request_id;

  return NEW;
end;
$$;


ALTER FUNCTION "public"."trigger_telegram_broadcast"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."trigger_trade_executor"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
declare
  webhook_url text := 'https://ktezlusdkqlfdwqrldtn.supabase.co/functions/v1';
  payload jsonb;
  request_id bigint;
  secret_val text := 'r4in3_s3cur3_w3bh00k_k3y';
begin
  payload := jsonb_build_object(
    'type', TG_OP,
    'table', TG_TABLE_NAME,
    'schema', TG_TABLE_SCHEMA,
    'record', row_to_json(NEW),
    'old_record', row_to_json(OLD)
  );

  select net.http_post(
    url := webhook_url || '/trade-executor',
    body := payload,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-webhook-secret', secret_val)
  ) into request_id;

  return NEW;
end;
$$;


ALTER FUNCTION "public"."trigger_trade_executor"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_treasury_balance"("p_account_id" "uuid", "p_new_balance" numeric) RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
BEGIN
  UPDATE public.treasury_accounts
  SET balance = p_new_balance,
      last_synced_at = now()
  WHERE id = p_account_id;
  RETURN true;
END;
$$;


ALTER FUNCTION "public"."update_treasury_balance"("p_account_id" "uuid", "p_new_balance" numeric) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_wallet_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."update_wallet_updated_at"() OWNER TO "postgres";

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


CREATE TABLE IF NOT EXISTS "public"."executions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "order_id" "uuid",
    "price" numeric,
    "qty" numeric,
    "fee" numeric,
    "ts" timestamp with time zone DEFAULT "now"(),
    "raw_fill" "jsonb",
    "user_id" "uuid"
);


ALTER TABLE "public"."executions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."ledger_entries" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "transaction_id" "uuid" NOT NULL,
    "wallet_id" "uuid" NOT NULL,
    "amount" numeric NOT NULL,
    "created_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL
);


ALTER TABLE "public"."ledger_entries" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."ledger_transactions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "reference_code" "text" NOT NULL,
    "description" "text" NOT NULL,
    "type" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL
);


ALTER TABLE "public"."ledger_transactions" OWNER TO "postgres";


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
    CONSTRAINT "trade_opportunities_status_check" CHECK (("status" = ANY (ARRAY['PENDING_APPROVAL'::"text", 'PUBLISHED'::"text", 'ACTIVE'::"text", 'EXECUTED'::"text", 'APPROVED'::"text", 'REJECTED'::"text", 'WON'::"text", 'LOST'::"text", 'EXPIRED'::"text"])))
);


ALTER TABLE "public"."trade_opportunities" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."treasury_accounts" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "account_name" "text" NOT NULL,
    "account_type" "text" NOT NULL,
    "currency" "text" DEFAULT 'USD'::"text" NOT NULL,
    "balance" numeric DEFAULT 0.00 NOT NULL,
    "sync_method" "text" NOT NULL,
    "last_synced_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL,
    "created_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL
);


ALTER TABLE "public"."treasury_accounts" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."treasury_snapshots" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "snapshot_timestamp" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL,
    "total_customer_liability" numeric NOT NULL,
    "stanbic_bank_total" numeric NOT NULL,
    "exness_master_total" numeric NOT NULL,
    "total_assets" numeric NOT NULL,
    "solvency_ratio" numeric NOT NULL,
    "notes" "text"
);


ALTER TABLE "public"."treasury_snapshots" OWNER TO "postgres";


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
    "max_spread_points" numeric DEFAULT 50,
    "is_admin" boolean DEFAULT false,
    "active_broker" "text" DEFAULT 'ALPACA'::"text",
    "max_volume_per_trade" numeric DEFAULT 50,
    "alpaca_key" "text",
    "alpaca_secret" "text",
    "auto_trade_enabled" boolean DEFAULT false,
    "sync_trailing_stops" boolean DEFAULT false,
    "auto_trade_tiers" "text"[] DEFAULT '{}'::"text"[],
    "telegram_bot_token" "text",
    "telegram_chat_id" "text",
    "high_water_mark_equity" numeric DEFAULT 0,
    "max_drawdown_pct" numeric DEFAULT 0.05,
    "use_partial_profit_taking" boolean DEFAULT true,
    "is_master_account" boolean DEFAULT false NOT NULL,
    "vps_last_heartbeat" timestamp with time zone,
    "telegram_link_token" "text"
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
    "updated_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL,
    "paystack_auth_code" "text",
    "billing_amount_usd" numeric,
    "next_billing_date" timestamp with time zone,
    "cancel_at_period_end" boolean DEFAULT false NOT NULL
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
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "profit_usd" numeric,
    "close_price" numeric,
    "closed_at" timestamp with time zone,
    "trade_type" "text" DEFAULT 'STANDARD'::"text" NOT NULL
);


ALTER TABLE "public"."user_trades" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."wallets" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid",
    "is_platform" boolean DEFAULT false NOT NULL,
    "currency" "text" DEFAULT 'USD'::"text" NOT NULL,
    "balance" numeric DEFAULT 0.00 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL,
    "watermark_principal" numeric DEFAULT 0.00 NOT NULL,
    "is_revenue" boolean DEFAULT false NOT NULL,
    CONSTRAINT "balance_must_be_positive" CHECK (("balance" >= (0)::numeric))
);


ALTER TABLE "public"."wallets" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."withdrawal_requests" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "wallet_id" "uuid" NOT NULL,
    "amount" numeric NOT NULL,
    "currency" "text" NOT NULL,
    "status" "text" DEFAULT 'PENDING'::"text" NOT NULL,
    "reference_code" "text" NOT NULL,
    "payment_gateway" "text" DEFAULT 'paystack'::"text",
    "destination_details" "jsonb",
    "created_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL,
    "performance_fee" numeric DEFAULT 0.00 NOT NULL,
    "principal_withdrawn" numeric DEFAULT 0.00 NOT NULL
);


ALTER TABLE "public"."withdrawal_requests" OWNER TO "postgres";


ALTER TABLE ONLY "public"."audit_log"
    ADD CONSTRAINT "audit_log_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."executions"
    ADD CONSTRAINT "executions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."ledger_entries"
    ADD CONSTRAINT "ledger_entries_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."ledger_transactions"
    ADD CONSTRAINT "ledger_transactions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."ledger_transactions"
    ADD CONSTRAINT "ledger_transactions_reference_code_key" UNIQUE ("reference_code");



ALTER TABLE ONLY "public"."market_data_pti"
    ADD CONSTRAINT "market_data_pti_pkey" PRIMARY KEY ("symbol", "timeframe", "ts", "revision");



ALTER TABLE ONLY "public"."meta_api_retry_queue"
    ADD CONSTRAINT "meta_api_retry_queue_pkey" PRIMARY KEY ("id");



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



ALTER TABLE ONLY "public"."treasury_accounts"
    ADD CONSTRAINT "treasury_accounts_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."treasury_snapshots"
    ADD CONSTRAINT "treasury_snapshots_pkey" PRIMARY KEY ("id");



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



ALTER TABLE ONLY "public"."wallets"
    ADD CONSTRAINT "wallets_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."withdrawal_requests"
    ADD CONSTRAINT "withdrawal_requests_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."withdrawal_requests"
    ADD CONSTRAINT "withdrawal_requests_reference_code_key" UNIQUE ("reference_code");



CREATE INDEX "idx_meta_api_retry_queue_sweep" ON "public"."meta_api_retry_queue" USING "btree" ("status", "next_retry_at") WHERE ("status" = 'PENDING'::"public"."retry_status");



CREATE UNIQUE INDEX "unique_platform_currency_idx" ON "public"."wallets" USING "btree" ("currency") WHERE ("is_platform" = true);



CREATE UNIQUE INDEX "unique_revenue_currency_idx" ON "public"."wallets" USING "btree" ("currency") WHERE ("is_revenue" = true);



CREATE UNIQUE INDEX "unique_user_currency_idx" ON "public"."wallets" USING "btree" ("user_id", "currency") WHERE ("is_platform" = false);



CREATE OR REPLACE TRIGGER "on_signal_execute" AFTER INSERT OR UPDATE ON "public"."trade_opportunities" FOR EACH ROW EXECUTE FUNCTION "public"."trigger_trade_executor"();



CREATE OR REPLACE TRIGGER "on_signal_generated" AFTER INSERT ON "public"."trade_opportunities" FOR EACH ROW EXECUTE FUNCTION "public"."trigger_telegram_broadcast"();



CREATE OR REPLACE TRIGGER "on_signal_rejected" AFTER UPDATE ON "public"."trade_opportunities" FOR EACH ROW EXECUTE FUNCTION "public"."handle_rejected_signal"();



CREATE OR REPLACE TRIGGER "on_signal_rejected_eject" AFTER UPDATE OF "status" ON "public"."trade_opportunities" FOR EACH ROW WHEN (("new"."status" = 'REJECTED'::"text")) EXECUTE FUNCTION "public"."trigger_auto_eject"();



CREATE OR REPLACE TRIGGER "on_user_trade_inserted" AFTER INSERT ON "public"."user_trades" FOR EACH ROW EXECUTE FUNCTION "public"."trigger_telegram_broadcast"();



CREATE OR REPLACE TRIGGER "trg_allocate_virtual_pnl" AFTER UPDATE ON "public"."user_trades" FOR EACH ROW EXECUTE FUNCTION "public"."allocate_virtual_pnl"();



CREATE OR REPLACE TRIGGER "update_wallets_timestamp" BEFORE UPDATE ON "public"."wallets" FOR EACH ROW EXECUTE FUNCTION "public"."update_wallet_updated_at"();



CREATE OR REPLACE TRIGGER "update_withdrawal_requests_timestamp" BEFORE UPDATE ON "public"."withdrawal_requests" FOR EACH ROW EXECUTE FUNCTION "public"."update_wallet_updated_at"();



ALTER TABLE ONLY "public"."executions"
    ADD CONSTRAINT "executions_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id");



ALTER TABLE ONLY "public"."executions"
    ADD CONSTRAINT "executions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."ledger_entries"
    ADD CONSTRAINT "ledger_entries_transaction_id_fkey" FOREIGN KEY ("transaction_id") REFERENCES "public"."ledger_transactions"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."ledger_entries"
    ADD CONSTRAINT "ledger_entries_wallet_id_fkey" FOREIGN KEY ("wallet_id") REFERENCES "public"."wallets"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."meta_api_retry_queue"
    ADD CONSTRAINT "meta_api_retry_queue_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."user_risk_settings"("user_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."user_risk_settings"
    ADD CONSTRAINT "user_risk_settings_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."user_subscriptions"
    ADD CONSTRAINT "user_subscriptions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."user_trades"
    ADD CONSTRAINT "user_trades_opportunity_id_fkey" FOREIGN KEY ("opportunity_id") REFERENCES "public"."trade_opportunities"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."user_trades"
    ADD CONSTRAINT "user_trades_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."wallets"
    ADD CONSTRAINT "wallets_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."withdrawal_requests"
    ADD CONSTRAINT "withdrawal_requests_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."withdrawal_requests"
    ADD CONSTRAINT "withdrawal_requests_wallet_id_fkey" FOREIGN KEY ("wallet_id") REFERENCES "public"."wallets"("id") ON DELETE CASCADE;



CREATE POLICY "Admins can insert opportunities" ON "public"."trade_opportunities" FOR INSERT TO "authenticated" WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."user_risk_settings"
  WHERE (("user_risk_settings"."user_id" = "auth"."uid"()) AND ("user_risk_settings"."is_admin" = true)))));



CREATE POLICY "Admins can manage treasury accounts" ON "public"."treasury_accounts" TO "authenticated" USING ((("auth"."jwt"() ->> 'role'::"text") = 'admin'::"text"));



CREATE POLICY "Admins can update opportunities" ON "public"."trade_opportunities" FOR UPDATE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."user_risk_settings"
  WHERE (("user_risk_settings"."user_id" = "auth"."uid"()) AND ("user_risk_settings"."is_admin" = true))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."user_risk_settings"
  WHERE (("user_risk_settings"."user_id" = "auth"."uid"()) AND ("user_risk_settings"."is_admin" = true)))));



CREATE POLICY "Admins can view treasury snapshots" ON "public"."treasury_snapshots" FOR SELECT TO "authenticated" USING ((("auth"."jwt"() ->> 'role'::"text") = 'admin'::"text"));



CREATE POLICY "Users can create withdrawal requests" ON "public"."withdrawal_requests" FOR INSERT TO "authenticated" WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can manage their own risk settings" ON "public"."user_risk_settings" TO "authenticated" USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can view opportunities" ON "public"."trade_opportunities" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "Users can view their own executions" ON "public"."executions" FOR SELECT TO "authenticated" USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can view their own ledger entries" ON "public"."ledger_entries" FOR SELECT TO "authenticated" USING (("wallet_id" IN ( SELECT "wallets"."id"
   FROM "public"."wallets"
  WHERE ("wallets"."user_id" = "auth"."uid"()))));



CREATE POLICY "Users can view their own ledger transactions" ON "public"."ledger_transactions" FOR SELECT TO "authenticated" USING (("id" IN ( SELECT "ledger_entries"."transaction_id"
   FROM "public"."ledger_entries"
  WHERE ("ledger_entries"."wallet_id" IN ( SELECT "wallets"."id"
           FROM "public"."wallets"
          WHERE ("wallets"."user_id" = "auth"."uid"()))))));



CREATE POLICY "Users can view their own subscription status" ON "public"."user_subscriptions" FOR SELECT TO "authenticated" USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can view their own trades" ON "public"."user_trades" FOR SELECT TO "authenticated" USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can view their own wallets" ON "public"."wallets" FOR SELECT TO "authenticated" USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can view their own withdrawal requests" ON "public"."withdrawal_requests" FOR SELECT TO "authenticated" USING (("auth"."uid"() = "user_id"));



ALTER TABLE "public"."audit_log" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."executions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."ledger_entries" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."ledger_transactions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."market_data_pti" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."meta_api_retry_queue" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."orders" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."profit_take_requests" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."risk_limits" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."trade_opportunities" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."treasury_accounts" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."treasury_snapshots" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."user_risk_settings" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."user_subscriptions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."user_trades" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."wallets" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."withdrawal_requests" ENABLE ROW LEVEL SECURITY;




ALTER PUBLICATION "supabase_realtime" OWNER TO "postgres";









GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";
































































































































































































GRANT ALL ON FUNCTION "public"."allocate_virtual_pnl"() TO "anon";
GRANT ALL ON FUNCTION "public"."allocate_virtual_pnl"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."allocate_virtual_pnl"() TO "service_role";



GRANT ALL ON FUNCTION "public"."get_total_assets"("asset_type" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."get_total_assets"("asset_type" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_total_assets"("asset_type" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."get_total_customer_liability"() TO "anon";
GRANT ALL ON FUNCTION "public"."get_total_customer_liability"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_total_customer_liability"() TO "service_role";



GRANT ALL ON FUNCTION "public"."handle_admin_creation"() TO "anon";
GRANT ALL ON FUNCTION "public"."handle_admin_creation"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."handle_admin_creation"() TO "service_role";



GRANT ALL ON FUNCTION "public"."handle_new_user_subscription"() TO "anon";
GRANT ALL ON FUNCTION "public"."handle_new_user_subscription"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."handle_new_user_subscription"() TO "service_role";



GRANT ALL ON FUNCTION "public"."handle_rejected_signal"() TO "anon";
GRANT ALL ON FUNCTION "public"."handle_rejected_signal"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."handle_rejected_signal"() TO "service_role";



GRANT ALL ON FUNCTION "public"."process_transfer"("sender_wallet_id" "uuid", "receiver_wallet_id" "uuid", "transfer_amount" numeric, "txn_reference" "text", "txn_description" "text", "txn_type" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."process_transfer"("sender_wallet_id" "uuid", "receiver_wallet_id" "uuid", "transfer_amount" numeric, "txn_reference" "text", "txn_description" "text", "txn_type" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."process_transfer"("sender_wallet_id" "uuid", "receiver_wallet_id" "uuid", "transfer_amount" numeric, "txn_reference" "text", "txn_description" "text", "txn_type" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."request_withdrawal"("p_user_id" "uuid", "p_wallet_id" "uuid", "p_amount" numeric, "p_currency" "text", "p_reference" "text", "p_destination" "jsonb") TO "anon";
GRANT ALL ON FUNCTION "public"."request_withdrawal"("p_user_id" "uuid", "p_wallet_id" "uuid", "p_amount" numeric, "p_currency" "text", "p_reference" "text", "p_destination" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."request_withdrawal"("p_user_id" "uuid", "p_wallet_id" "uuid", "p_amount" numeric, "p_currency" "text", "p_reference" "text", "p_destination" "jsonb") TO "service_role";



GRANT ALL ON FUNCTION "public"."reverse_withdrawal"("p_reference" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."reverse_withdrawal"("p_reference" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."reverse_withdrawal"("p_reference" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."trigger_auto_eject"() TO "anon";
GRANT ALL ON FUNCTION "public"."trigger_auto_eject"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."trigger_auto_eject"() TO "service_role";



GRANT ALL ON FUNCTION "public"."trigger_email_onboarding"() TO "anon";
GRANT ALL ON FUNCTION "public"."trigger_email_onboarding"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."trigger_email_onboarding"() TO "service_role";



GRANT ALL ON FUNCTION "public"."trigger_telegram_broadcast"() TO "anon";
GRANT ALL ON FUNCTION "public"."trigger_telegram_broadcast"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."trigger_telegram_broadcast"() TO "service_role";



GRANT ALL ON FUNCTION "public"."trigger_trade_executor"() TO "anon";
GRANT ALL ON FUNCTION "public"."trigger_trade_executor"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."trigger_trade_executor"() TO "service_role";



GRANT ALL ON FUNCTION "public"."update_treasury_balance"("p_account_id" "uuid", "p_new_balance" numeric) TO "anon";
GRANT ALL ON FUNCTION "public"."update_treasury_balance"("p_account_id" "uuid", "p_new_balance" numeric) TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_treasury_balance"("p_account_id" "uuid", "p_new_balance" numeric) TO "service_role";



GRANT ALL ON FUNCTION "public"."update_wallet_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."update_wallet_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_wallet_updated_at"() TO "service_role";
























GRANT ALL ON TABLE "public"."audit_log" TO "anon";
GRANT ALL ON TABLE "public"."audit_log" TO "authenticated";
GRANT ALL ON TABLE "public"."audit_log" TO "service_role";



GRANT ALL ON TABLE "public"."executions" TO "anon";
GRANT ALL ON TABLE "public"."executions" TO "authenticated";
GRANT ALL ON TABLE "public"."executions" TO "service_role";



GRANT ALL ON TABLE "public"."ledger_entries" TO "anon";
GRANT ALL ON TABLE "public"."ledger_entries" TO "authenticated";
GRANT ALL ON TABLE "public"."ledger_entries" TO "service_role";



GRANT ALL ON TABLE "public"."ledger_transactions" TO "anon";
GRANT ALL ON TABLE "public"."ledger_transactions" TO "authenticated";
GRANT ALL ON TABLE "public"."ledger_transactions" TO "service_role";



GRANT ALL ON TABLE "public"."market_data_pti" TO "anon";
GRANT ALL ON TABLE "public"."market_data_pti" TO "authenticated";
GRANT ALL ON TABLE "public"."market_data_pti" TO "service_role";



GRANT ALL ON TABLE "public"."meta_api_retry_queue" TO "anon";
GRANT ALL ON TABLE "public"."meta_api_retry_queue" TO "authenticated";
GRANT ALL ON TABLE "public"."meta_api_retry_queue" TO "service_role";



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



GRANT ALL ON TABLE "public"."treasury_accounts" TO "anon";
GRANT ALL ON TABLE "public"."treasury_accounts" TO "authenticated";
GRANT ALL ON TABLE "public"."treasury_accounts" TO "service_role";



GRANT ALL ON TABLE "public"."treasury_snapshots" TO "anon";
GRANT ALL ON TABLE "public"."treasury_snapshots" TO "authenticated";
GRANT ALL ON TABLE "public"."treasury_snapshots" TO "service_role";



GRANT ALL ON TABLE "public"."user_risk_settings" TO "anon";
GRANT ALL ON TABLE "public"."user_risk_settings" TO "authenticated";
GRANT ALL ON TABLE "public"."user_risk_settings" TO "service_role";



GRANT ALL ON TABLE "public"."user_subscriptions" TO "anon";
GRANT ALL ON TABLE "public"."user_subscriptions" TO "authenticated";
GRANT ALL ON TABLE "public"."user_subscriptions" TO "service_role";



GRANT ALL ON TABLE "public"."user_trades" TO "anon";
GRANT ALL ON TABLE "public"."user_trades" TO "authenticated";
GRANT ALL ON TABLE "public"."user_trades" TO "service_role";



GRANT ALL ON TABLE "public"."wallets" TO "anon";
GRANT ALL ON TABLE "public"."wallets" TO "authenticated";
GRANT ALL ON TABLE "public"."wallets" TO "service_role";



GRANT ALL ON TABLE "public"."withdrawal_requests" TO "anon";
GRANT ALL ON TABLE "public"."withdrawal_requests" TO "authenticated";
GRANT ALL ON TABLE "public"."withdrawal_requests" TO "service_role";









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






























