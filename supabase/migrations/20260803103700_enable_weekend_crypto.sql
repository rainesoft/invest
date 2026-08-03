-- ============================================================
-- Migration: Enable 24/7 Weekend Execution (Crypto) & Fix pg_cron Auth Syntax
-- ============================================================

-- 1. Unschedule old restricted weekday jobs
DO $$
BEGIN
  PERFORM cron.unschedule('agent-swing-poll');
  PERFORM cron.unschedule('agent-news-poll');
  PERFORM cron.unschedule('agent-trade-poll');
  PERFORM cron.unschedule('position-manager-poll');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

-- 2. Reschedule agent-swing-poll every 4 hours, 7 days a week
SELECT cron.schedule(
    'agent-swing-poll',
    '0 */4 * * *',
    $$
    SELECT net.http_post(
        url := 'https://ktezlusdkqlfdwqrldtn.supabase.co/functions/v1/agent-swing',
        headers := jsonb_build_object(
            'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key', true),
            'Content-Type', 'application/json'
        ),
        body := '{}'::jsonb
    );
    $$
);

-- 3. Reschedule agent-news-poll every hour, 7 days a week
SELECT cron.schedule(
    'agent-news-poll',
    '0 * * * *',
    $$
    SELECT net.http_post(
        url := 'https://ktezlusdkqlfdwqrldtn.supabase.co/functions/v1/agent-news',
        headers := jsonb_build_object(
            'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key', true),
            'Content-Type', 'application/json'
        ),
        body := '{}'::jsonb
    );
    $$
);

-- 4. Reschedule agent-trade-poll every 5 minutes (offset 3m), 7 days a week
SELECT cron.schedule(
    'agent-trade-poll',
    '3-59/5 * * * *',
    $$
    SELECT net.http_post(
        url := 'https://ktezlusdkqlfdwqrldtn.supabase.co/functions/v1/agent-trade',
        headers := jsonb_build_object(
            'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key', true),
            'Content-Type', 'application/json'
        ),
        body := '{}'::jsonb
    );
    $$
);

-- 5. Reschedule position-manager-poll every 30 minutes, 7 days a week
SELECT cron.schedule(
  'position-manager-poll',
  '*/30 * * * *',
  $$
    SELECT net.http_post(
      url := 'https://ktezlusdkqlfdwqrldtn.supabase.co/functions/v1/agent-trade',
      headers := jsonb_build_object(
        'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key', true),
        'Content-Type', 'application/json'
      ),
      body := '{"action":"MANAGE_POSITIONS"}'::jsonb
    );
  $$
);
