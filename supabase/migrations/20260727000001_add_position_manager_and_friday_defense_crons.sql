-- ============================================================
-- Migration: Position Manager Cron + Friday Weekend Defense
-- ============================================================

-- 1. Position Manager: runs every 30 minutes Mon–Fri
--    Handles break-even, lock-in at 2R, and runner trailing stops.
SELECT cron.unschedule('position-manager-poll') WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'position-manager-poll'
);

SELECT cron.schedule(
  'position-manager-poll',
  '*/30 * * * 1-5',
  $$
  declare
    url text;
    api_key text;
    req_id bigint;
  begin
    url := current_setting('app.supabase_url', true) || '/functions/v1/agent-trade';
    api_key := current_setting('app.supabase_anon_key', true);
    select net.http_post(
      url := url,
      headers := jsonb_build_object(
        'Authorization', 'Bearer ' || api_key,
        'Content-Type', 'application/json'
      ),
      body := '{"action":"MANAGE_POSITIONS"}'::jsonb
    ) into req_id;
  end;
  $$
);

-- 2. Friday Weekend Defense: fires every Friday at 20:30 UTC
--    Closes losing trades at market, moves winning trades to break-even.
--    This protects capital from Sunday gap risk.
DO $$
BEGIN
  PERFORM cron.unschedule('weekend-defense-cron');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

SELECT cron.schedule(
  'weekend-defense-cron',
  '30 20 * * 5',
  $$
  declare
    url text;
    api_key text;
    req_id bigint;
  begin
    url := current_setting('app.supabase_url', true) || '/functions/v1/agent-kill-switch';
    api_key := current_setting('app.supabase_anon_key', true);
    select net.http_post(
      url := url,
      headers := jsonb_build_object(
        'Authorization', 'Bearer ' || api_key,
        'Content-Type', 'application/json'
      ),
      body := '{"action":"WEEKEND_DEFENSE"}'::jsonb
    ) into req_id;
  end;
  $$
);
