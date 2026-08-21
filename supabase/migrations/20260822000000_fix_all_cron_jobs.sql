-- ============================================================
-- Migration: Fix all pg_cron jobs according to System Health Checklist
-- ============================================================
-- Resolves:
-- 1. Removes PL/pgSQL anonymous blocks (`declare...begin`) which fail silently in pg_cron.
-- 2. Removes `current_setting('app.supabase_url')` which resolves to null and causes constraint errors.
-- 3. Replaces `app.settings.service_role_key` and `app.supabase_anon_key` with secure `x-cron-secret`.
-- 4. Adds explicit `timeout_milliseconds := 150000` to prevent 5000ms silent aborts.

-- 1. Unschedule all existing misconfigured jobs
DO $$
BEGIN
  PERFORM cron.unschedule('agent-swing-poll');
  PERFORM cron.unschedule('agent-swing-forex');
  PERFORM cron.unschedule('agent-swing-crypto');
  PERFORM cron.unschedule('agent-swing-indices');
  PERFORM cron.unschedule('agent-news-poll');
  PERFORM cron.unschedule('agent-day-poll');
  PERFORM cron.unschedule('agent-trade-poll');
  PERFORM cron.unschedule('position-manager-poll');
  PERFORM cron.unschedule('weekend-defense-cron');
  PERFORM cron.unschedule('exness-history-sync-poll');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

-- 2. Reschedule agent-swing-forex every 4 hours on weekdays at minute 0
SELECT cron.schedule(
  'agent-swing-forex',
  '0 */4 * * 1-5',
  $$
    SELECT net.http_post(
      url := 'https://ktezlusdkqlfdwqrldtn.supabase.co/functions/v1/agent-swing',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-cron-secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'new_cron_secret' LIMIT 1)
      ),
      body := '{"symbols": ["EURUSD", "GBPUSD", "USDJPY", "AUDUSD", "NZDUSD", "EURJPY", "GBPJPY"]}'::jsonb,
      timeout_milliseconds := 150000
    );
  $$
);

-- 3. Reschedule agent-swing-crypto every 4 hours every day at minute 2
SELECT cron.schedule(
  'agent-swing-crypto',
  '2 */4 * * *',
  $$
    SELECT net.http_post(
      url := 'https://ktezlusdkqlfdwqrldtn.supabase.co/functions/v1/agent-swing',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-cron-secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'new_cron_secret' LIMIT 1)
      ),
      body := '{"symbols": ["BTCUSD"]}'::jsonb,
      timeout_milliseconds := 150000
    );
  $$
);

-- 4. Reschedule agent-swing-indices every 4 hours on weekdays at minute 4
SELECT cron.schedule(
  'agent-swing-indices',
  '4 */4 * * 1-5',
  $$
    SELECT net.http_post(
      url := 'https://ktezlusdkqlfdwqrldtn.supabase.co/functions/v1/agent-swing',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-cron-secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'new_cron_secret' LIMIT 1)
      ),
      body := '{"symbols": ["US30", "NAS100", "XAUUSD", "XAGUSD", "UKOIL"]}'::jsonb,
      timeout_milliseconds := 150000
    );
  $$
);

-- 5. Reschedule agent-news-poll every hour, 7 days a week
SELECT cron.schedule(
  'agent-news-poll',
  '0 * * * *',
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

-- 5b. Reschedule agent-day-poll every 30 minutes
SELECT cron.schedule(
  'agent-day-poll',
  '*/30 * * * *',
  $$
    SELECT net.http_post(
      url := 'https://ktezlusdkqlfdwqrldtn.supabase.co/functions/v1/agent-day',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-cron-secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'new_cron_secret' LIMIT 1)
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 150000
    );
  $$
);

-- 6. Reschedule agent-trade-poll every 5 minutes (offset 3m), 7 days a week
SELECT cron.schedule(
  'agent-trade-poll',
  '3-59/5 * * * *',
  $$
    SELECT net.http_post(
      url := 'https://ktezlusdkqlfdwqrldtn.supabase.co/functions/v1/agent-trade',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-cron-secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'new_cron_secret' LIMIT 1)
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 150000
    );
  $$
);

-- 7. Reschedule position-manager-poll every 30 minutes, 7 days a week
SELECT cron.schedule(
  'position-manager-poll',
  '*/30 * * * *',
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

-- 8. Reschedule weekend-defense-cron every Friday at 20:30 UTC
SELECT cron.schedule(
  'weekend-defense-cron',
  '30 20 * * 5',
  $$
    SELECT net.http_post(
      url := 'https://ktezlusdkqlfdwqrldtn.supabase.co/functions/v1/agent-kill-switch',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-cron-secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'new_cron_secret' LIMIT 1)
      ),
      body := '{"action":"WEEKEND_DEFENSE"}'::jsonb,
      timeout_milliseconds := 150000
    );
  $$
);

-- 9. Reschedule exness-history-sync-poll every 15 minutes
SELECT cron.schedule(
  'exness-history-sync-poll',
  '*/15 * * * *',
  $$
    SELECT net.http_post(
      url := 'https://ktezlusdkqlfdwqrldtn.supabase.co/functions/v1/exness-history-sync',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-cron-secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'new_cron_secret' LIMIT 1)
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 150000
    );
  $$
);
