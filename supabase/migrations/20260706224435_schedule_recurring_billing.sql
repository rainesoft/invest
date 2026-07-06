-- Schedule custom tokenized recurring billing to process daily at 1:00 AM UTC
SELECT cron.schedule(
  'process-dynamic-recurring-billing-daily',
  '0 1 * * *',
  $$
    SELECT net.http_post(
      url:=(current_setting('app.settings.edge_function_url', true) || '/process-recurring-billing'),
      headers:=jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || (SELECT secret FROM vault.decrypted_secrets WHERE name = 'cron_secret' LIMIT 1)
      ),
      body:='{}'::jsonb
    )
  $$
);
