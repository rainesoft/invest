-- ============================================================
-- Migration: Enable 24/7 Weekend Execution (Crypto)
-- ============================================================

-- 1. Unschedule old restricted weekday jobs
DO $$
BEGIN
  PERFORM cron.unschedule('agent-swing-poll');
  PERFORM cron.unschedule('agent-news-poll');
  PERFORM cron.unschedule('agent-trade-poll');
  PERFORM cron.unschedule('position-manager-poll');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

-- 2. Reschedule agent-swing-poll every 4 hours, 7 days a week
SELECT cron.schedule(
    'agent-swing-poll',
    '0 */4 * * *',
    $$
    declare
        url text;
        api_key text;
        req_id bigint;
    begin
        url := current_setting('app.supabase_url', true) || '/functions/v1/agent-swing';
        api_key := current_setting('app.settings.service_role_key', true);
        
        select net.http_post(
            url := url,
            headers := jsonb_build_object('Authorization', 'Bearer ' || api_key)
        ) into req_id;
    end;
    $$
);

-- 3. Reschedule agent-news-poll every hour, 7 days a week
SELECT cron.schedule(
    'agent-news-poll',
    '0 * * * *',
    $$
    declare
        url text;
        api_key text;
        req_id bigint;
    begin
        url := current_setting('app.supabase_url', true) || '/functions/v1/agent-news';
        api_key := current_setting('app.settings.service_role_key', true);
        
        select net.http_post(
            url := url,
            headers := jsonb_build_object('Authorization', 'Bearer ' || api_key)
        ) into req_id;
    end;
    $$
);

-- 4. Reschedule agent-trade-poll every 5 minutes (offset 3m), 7 days a week
SELECT cron.schedule(
    'agent-trade-poll',
    '3-59/5 * * * *',
    $$
    declare
        url text;
        api_key text;
        req_id bigint;
    begin
        url := current_setting('app.supabase_url', true) || '/functions/v1/agent-trade';
        api_key := current_setting('app.settings.service_role_key', true);
        
        select net.http_post(
            url := url,
            headers := jsonb_build_object('Authorization', 'Bearer ' || api_key)
        ) into req_id;
    end;
    $$
);

-- 5. Reschedule position-manager-poll every 30 minutes, 7 days a week
SELECT cron.schedule(
  'position-manager-poll',
  '*/30 * * * *',
  $$
  declare
    url text;
    api_key text;
    req_id bigint;
  begin
    url := current_setting('app.supabase_url', true) || '/functions/v1/agent-trade';
    api_key := current_setting('app.settings.service_role_key', true);
    select net.http_post(
      url := url,
      headers := jsonb_build_object(
        'Authorization', 'Bearer ' || api_key,
        'Content-Type', 'application/json'
      ),
      body := '{"action":"MANAGE_POSITIONS"}'::jsonb
    ) into req_id;
  end;
  $$
);
