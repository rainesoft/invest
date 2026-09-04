-- ============================================================
-- Migration: Add News Shield Settings & Accelerate Cron Schedules
-- ============================================================

-- 1. Add news defense columns to user_risk_settings
ALTER TABLE user_risk_settings
  ADD COLUMN IF NOT EXISTS news_shield_enabled BOOLEAN DEFAULT true,
  ADD COLUMN IF NOT EXISTS news_auto_flatten_enabled BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS news_cancel_pending_orders BOOLEAN DEFAULT true,
  ADD COLUMN IF NOT EXISTS news_alert_minutes_before INTEGER DEFAULT 15;

-- 2. Update pg_cron schedules for high-frequency news defense & 15m polling
DO $$
BEGIN
  PERFORM cron.unschedule('agent-news-poll');
  PERFORM cron.unschedule('position-manager-poll');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

-- Reschedule agent-news-poll: every 15 minutes on weekdays (to capture 8:30 AM / :30 macro events)
SELECT cron.schedule(
  'agent-news-poll',
  '*/15 * * * 1-5',
  $$
    SELECT net.http_post(
      url := 'https://ktezlusdkqlfdwqrldtn.supabase.co/functions/v1/agent-news',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-cron-secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'new_cron_secret' LIMIT 1)
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 150000
    );
  $$
);

-- Reschedule position-manager-poll: every 5 minutes on weekdays (to execute 15m warnings and 5m protective actions)
SELECT cron.schedule(
  'position-manager-poll',
  '*/5 * * * 1-5',
  $$
    SELECT net.http_post(
      url := 'https://ktezlusdkqlfdwqrldtn.supabase.co/functions/v1/agent-trade',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-cron-secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'new_cron_secret' LIMIT 1)
      ),
      body := '{"action":"MANAGE_POSITIONS"}'::jsonb,
      timeout_milliseconds := 150000
    );
  $$
);
