-- Schedule the pending orders monitor to run every minute
SELECT cron.schedule(
    'monitor-pending-orders',
    '* * * * *', -- Every minute
    $$
    SELECT net.http_post(
        url:='https://ktezlusdkqlfdwqrldtn.supabase.co/functions/v1/monitor-pending-orders',
        headers:='{"Content-Type": "application/json", "Authorization": "Bearer ' || current_setting('app.settings.service_role_key', true) || '"}'::jsonb
    ) as request_id;
    $$
);
