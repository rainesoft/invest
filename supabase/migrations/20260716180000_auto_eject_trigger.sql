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

DROP TRIGGER IF EXISTS "on_signal_rejected_eject" ON "public"."trade_opportunities";

CREATE TRIGGER "on_signal_rejected_eject"
    AFTER UPDATE OF "status" ON "public"."trade_opportunities"
    FOR EACH ROW
    WHEN ((NEW.status = 'REJECTED'::text))
    EXECUTE FUNCTION "public"."trigger_auto_eject"();
