-- Drop deprecated trades table
DROP TABLE IF EXISTS "public"."trades" CASCADE;

-- Rename webhook trigger for trade-executor
DROP TRIGGER IF EXISTS "on_signal_execute" ON "public"."trade_opportunities";
DROP FUNCTION IF EXISTS "public"."trigger_exness_executor"();

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
GRANT ALL ON FUNCTION "public"."trigger_trade_executor"() TO "anon";
GRANT ALL ON FUNCTION "public"."trigger_trade_executor"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."trigger_trade_executor"() TO "service_role";

CREATE TRIGGER "on_signal_execute" AFTER INSERT OR UPDATE ON "public"."trade_opportunities" FOR EACH ROW EXECUTE FUNCTION "public"."trigger_trade_executor"();
