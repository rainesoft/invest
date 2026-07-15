-- Migration: schedule_exness_history_sync
-- Description: Adds a pg_cron schedule to run exness-history-sync every 15 minutes

SELECT cron.schedule(
    'exness_history_sync',
    '*/15 * * * *',
    $$
    select net.http_post(
        url:='https://ktezlusdkqlfdwqrldtn.supabase.co/functions/v1/exness-history-sync',
        headers:=jsonb_build_object('x-cron-secret', replace((SELECT secret FROM vault.decrypted_secrets WHERE name = 'cron_secret' LIMIT 1), chr(10), ''))
    );
    $$
);
