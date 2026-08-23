-- Reschedule resolve-outcomes-poll every 10 minutes to grade trades
SELECT cron.schedule(
  'resolve-outcomes-poll',
  '*/10 * * * *',
  $$
    SELECT net.http_post(
      url := 'https://ktezlusdkqlfdwqrldtn.supabase.co/functions/v1/resolve-outcomes',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-cron-secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'new_cron_secret' LIMIT 1)
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 150000
    );
  $$
);
