-- 1. Unschedule old market-scout / agent-sniper if it still exists
SELECT cron.unschedule('agent-sniper-poll');
SELECT cron.unschedule('market-scout-poll');

-- 2. Schedule agent-swing-poll every 4 hours on weekdays
SELECT cron.schedule(
    'agent-swing-poll',
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
            headers := jsonb_build_object('Authorization', 'Bearer ' || api_key)
        ) into req_id;
    end;
    $$
);

-- 3. Restore the app.webhook_secret and url settings that were cleared
ALTER DATABASE postgres SET "app.webhook_secret" TO 'FALLBACK_SECRET_123';
ALTER DATABASE postgres SET "app.supabase_url" TO 'https://ktezlusdkqlfdwqrldtn.supabase.co';

-- 4. Reload configuration (optional but good practice)
-- Not strictly required in some environments but helps
