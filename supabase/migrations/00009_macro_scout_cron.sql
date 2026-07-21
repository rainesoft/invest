-- Schedule the agent-news to poll the Forex Factory feed for high-impact events
-- Runs every 5 minutes, Monday through Friday
SELECT cron.schedule(
    'agent-news-poll',
    '*/1 * * * 1-5', -- Every minute from Monday to Friday
    $$
    declare
        url text;
        api_key text;
        req_id bigint;
    begin
        -- Using current_setting to dynamically get project URL
        -- Ensure 'custom.project_id' and 'custom.anon_key' are set in your postgres settings
        url := 'https://' || current_setting('custom.project_id', true) || '.supabase.co/functions/v1/agent-news';
        api_key := current_setting('custom.anon_key', true);
        
        select net.http_post(
            url := url,
            headers := jsonb_build_object(
                'Authorization', 'Bearer ' || api_key
            )
        ) into req_id;
    end;
    $$
);
