-- Unschedule old market-scout cron
SELECT cron.unschedule('market-scout-poll');

-- Unschedule old macro-scout cron
SELECT cron.unschedule('macro-scout-poll');

-- Schedule agent-sniper-poll (formerly market-scout)
SELECT cron.schedule(
  'agent-sniper-poll',
  '*/5 22-23 * * 0-5',
  $$
  declare
    url text;
    api_key text;
    req_id bigint;
  begin
    url     := current_setting('app.supabase_url') || '/functions/v1/agent-sniper';
    api_key := current_setting('app.supabase_anon_key');
    
    select net.http_post(
      url := url,
      headers := jsonb_build_object('Authorization', 'Bearer ' || api_key)
    ) into req_id;
  end;
  $$
);

-- Schedule agent-news-poll (formerly macro-scout)
SELECT cron.schedule(
    'agent-news-poll',
    '*/1 * * * 1-5',
    $$
    declare
        url text;
        api_key text;
        req_id bigint;
    begin
        url := 'https://' || current_setting('custom.project_id', true) || '.supabase.co/functions/v1/agent-news';
        api_key := current_setting('custom.anon_key', true);
        
        select net.http_post(
            url := url,
            headers := jsonb_build_object('Authorization', 'Bearer ' || api_key)
        ) into req_id;
    end;
    $$
);

-- Update trigger_trade_execution webhook to point to agent-trade
CREATE OR REPLACE FUNCTION trigger_trade_execution()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
declare
  request_id bigint;
  payload jsonb;
  webhook_url text;
  secret_val text;
begin
  webhook_url := current_setting('app.supabase_url', true);
  secret_val := current_setting('app.webhook_secret', true);

  if webhook_url is null or secret_val is null then
    return NEW;
  end if;

  payload := jsonb_build_object(
    'type', TG_OP,
    'table', TG_TABLE_NAME,
    'schema', TG_TABLE_SCHEMA,
    'record', row_to_json(NEW),
    'old_record', row_to_json(OLD)
  );

  select net.http_post(
    url := webhook_url || '/functions/v1/agent-trade',
    body := payload,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-webhook-secret', secret_val)
  ) into request_id;

  return NEW;
end;
$$;
