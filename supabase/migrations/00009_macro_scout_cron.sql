-- Schedule the Macro-Scout to poll the Forex Factory feed for high-impact events
-- Runs every 5 minutes, Monday through Friday
SELECT cron.schedule(
    'macro-scout-poll',
    '*/5 * * * 1-5',
    $$
    SELECT net.http_post(
        url := 'https://' || current_setting('custom.project_id', true) || '.supabase.co/functions/v1/macro-scout',
        headers := jsonb_build_object(
            'Content-Type', 'application/json',
            'Authorization', 'Bearer ' || current_setting('custom.service_role_key', true)
        )
    );
    $$
);
