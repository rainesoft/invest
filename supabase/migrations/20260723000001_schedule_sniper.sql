SELECT cron.schedule(
  'invoke_agent_sniper_1m',
  '* * * * *',
  $$
  SELECT net.http_post(
    url := 'https://ktezlusdkqlfdwqrldtn.supabase.co/functions/v1/agent-sniper',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key', true)
    ),
    body := '{}'::jsonb
  ) as request_id;
  $$
);
