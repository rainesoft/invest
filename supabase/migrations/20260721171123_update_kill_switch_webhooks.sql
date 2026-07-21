-- Update the handle_rejected_signal webhook
CREATE OR REPLACE FUNCTION "public"."handle_rejected_signal"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
BEGIN
  IF NEW.status = 'REJECTED' AND OLD.status != 'REJECTED' THEN
    PERFORM net.http_post(
      url:='https://ktezlusdkqlfdwqrldtn.supabase.co/functions/v1/agent-kill-switch',
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

-- Update the generic trigger_auto_eject webhook
CREATE OR REPLACE FUNCTION "public"."trigger_auto_eject"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
declare
  webhook_url text;
  payload jsonb;
  request_id bigint;
  secret_val text;
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
    url := webhook_url || '/agent-kill-switch',
    body := payload,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-webhook-secret', current_setting('app.settings.webhook_secret', true))
  ) into request_id;

  return NEW;
end;
$$;
