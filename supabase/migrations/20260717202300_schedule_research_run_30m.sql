

-- Research Run (30M) via Edge Function (Runs every 30 minutes)
SELECT cron.schedule(
    'research_run_30m',
    '*/30 * * * *',
    $$
    select net.http_post(
        url:='https://ktezlusdkqlfdwqrldtn.supabase.co/functions/v1/research-run',
        headers:=('{"Authorization": "Bearer ' || (SELECT secret FROM vault.decrypted_secrets WHERE name = 'cron_secret' LIMIT 1) || '", "Content-Type": "application/json"}')::jsonb,
        body:='{"timeframe": "30m"}'::jsonb,
        timeout_milliseconds:=300000
    );
    $$
);
