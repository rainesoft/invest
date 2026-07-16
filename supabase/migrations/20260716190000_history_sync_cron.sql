-- Migration to schedule the history-sync Edge Function via pg_cron

-- Ensure pg_net is available
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Create the cron job to poll MetaAPI history every 5 minutes
SELECT cron.schedule(
    'history-sync-cron',
    '*/5 * * * *',
    $$
    SELECT net.http_post(
        url:='https://ktezlusdkqlfdwqrldtn.supabase.co/functions/v1/history-sync',
        headers:='{"Content-Type": "application/json", "Authorization": "Bearer ' || current_setting('app.settings.service_role_key', true) || '"}'::jsonb
    ) as request_id;
    $$
);
