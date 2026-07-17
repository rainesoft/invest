-- Fix: Hardcode the production Supabase Edge Functions base URL directly into the
-- trigger functions, removing the dependency on the database-level config setting
-- that the migration user does not have permission to set via ALTER DATABASE.

CREATE OR REPLACE FUNCTION "public"."trigger_exness_executor"() RETURNS "trigger"
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
    url := webhook_url || '/exness-executor',
    body := payload,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-webhook-secret', secret_val)
  ) into request_id;

  return NEW;
end;
$$;

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
