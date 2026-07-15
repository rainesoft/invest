-- Schedule the resolve-outcomes function to sweep the execution logs every 15 minutes
SELECT cron.schedule(
    'resolve_outcomes',
    '*/15 * * * *',
    $$
    select net.http_post(
        url:='https://ktezlusdkqlfdwqrldtn.supabase.co/functions/v1/resolve-outcomes',
        headers:=('{"Authorization": "Bearer ' || (SELECT secret FROM vault.decrypted_secrets WHERE name = 'cron_secret' LIMIT 1) || '"}')::jsonb,
        timeout_milliseconds:=300000
    );
    $$
);
