-- ============================================================
-- Migration: Autonomous SRE Agent (agent-sre-poll)
-- ============================================================

-- 1. Unschedule legacy system-health-check-poll if active
DO $$
BEGIN
  PERFORM cron.unschedule('system-health-check-poll');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

-- 2. Unschedule existing agent-sre-poll if present
DO $$
BEGIN
  PERFORM cron.unschedule('agent-sre-poll');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

-- 3. Schedule agent-sre-poll to run hourly at minute 15 with vault x-cron-secret
SELECT cron.schedule(
  'agent-sre-poll',
  '15 * * * *',
  $$
    SELECT net.http_post(
      url := 'https://ktezlusdkqlfdwqrldtn.supabase.co/functions/v1/agent-sre',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-cron-secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'new_cron_secret' LIMIT 1)
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 150000
    );
  $$
);
