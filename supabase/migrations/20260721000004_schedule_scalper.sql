-- Schedule agent-scalper-poll every 30 minutes on weekdays
SELECT cron.schedule(
    'agent-scalper-poll',
    '*/30 * * * 1-5',
    $$
    declare
        url text;
        api_key text;
        req_id bigint;
    begin
        url := current_setting('app.supabase_url', true) || '/functions/v1/agent-scalper';
        api_key := current_setting('app.supabase_anon_key', true);
        
        select net.http_post(
            url := url,
            headers := jsonb_build_object('Authorization', 'Bearer ' || api_key)
        ) into req_id;
    end;
    $$
);
