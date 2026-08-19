-- Unschedule the monolithic swing job
SELECT cron.unschedule('agent-swing-poll');

-- Schedule agent-swing-forex every 4 hours on weekdays at minute 0
SELECT cron.schedule(
    'agent-swing-forex',
    '0 */4 * * 1-5',
    $$
    declare
        url text;
        api_key text;
        req_id bigint;
    begin
        url := current_setting('app.supabase_url', true) || '/functions/v1/agent-swing';
        api_key := current_setting('app.supabase_anon_key', true);
        
        select net.http_post(
            url := url,
            headers := jsonb_build_object('Authorization', 'Bearer ' || api_key, 'Content-Type', 'application/json'),
            body := '{"symbols": ["EURUSD", "GBPUSD", "USDJPY", "AUDUSD", "NZDUSD", "EURJPY", "GBPJPY"]}'::jsonb
        ) into req_id;
    end;
    $$
);

-- Schedule agent-swing-crypto every 4 hours every day at minute 2
SELECT cron.schedule(
    'agent-swing-crypto',
    '2 */4 * * *',
    $$
    declare
        url text;
        api_key text;
        req_id bigint;
    begin
        url := current_setting('app.supabase_url', true) || '/functions/v1/agent-swing';
        api_key := current_setting('app.supabase_anon_key', true);
        
        select net.http_post(
            url := url,
            headers := jsonb_build_object('Authorization', 'Bearer ' || api_key, 'Content-Type', 'application/json'),
            body := '{"symbols": ["BTCUSD"]}'::jsonb
        ) into req_id;
    end;
    $$
);

-- Schedule agent-swing-indices every 4 hours on weekdays at minute 4
SELECT cron.schedule(
    'agent-swing-indices',
    '4 */4 * * 1-5',
    $$
    declare
        url text;
        api_key text;
        req_id bigint;
    begin
        url := current_setting('app.supabase_url', true) || '/functions/v1/agent-swing';
        api_key := current_setting('app.supabase_anon_key', true);
        
        select net.http_post(
            url := url,
            headers := jsonb_build_object('Authorization', 'Bearer ' || api_key, 'Content-Type', 'application/json'),
            body := '{"symbols": ["US30", "NAS100", "XAUUSD", "XAGUSD", "UKOIL"]}'::jsonb
        ) into req_id;
    end;
    $$
);
