-- Unschedule old agent-news-poll if it exists
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'agent-news-poll') THEN
    PERFORM cron.unschedule('agent-news-poll');
  END IF;
END $$;

-- Schedule agent-news-poll to run every hour on weekdays
SELECT cron.schedule(
    'agent-news-poll',
    '0 * * * 1-5',
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
