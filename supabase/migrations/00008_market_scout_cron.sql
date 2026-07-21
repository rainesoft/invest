-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: 00008_market_scout_cron.sql
-- Schedules the agent-sniper edge function via pg_cron.
--
-- This script creates a cron job that runs every 5 minutes during
-- specific active hours (22:00 - 23:00) on weekdays (Sunday-Friday).
--
-- Note: To completely remove this job later, you would run:
--   SELECT cron.unschedule('agent-sniper-poll');

-- 1. Ensure pg_net is available (required for http_post)
CREATE EXTENSION IF NOT EXISTS pg_net;

-- 2. Ensure pg_cron is available
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- 3. Safely unschedule if it exists so we can recreate it
SELECT cron.unschedule('agent-sniper-poll') 
WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'agent-sniper-poll'
);

-- 4. Schedule the cron job
SELECT cron.schedule(
  'agent-sniper-poll',
  '*/5 22-23 * * 0-5',
  $$
  declare
    url text;
    api_key text;
    req_id bigint;
  begin
    -- Retrieve configurations set via SQL parameters or use hardcoded URL
    url     := current_setting('app.supabase_url') || '/functions/v1/agent-sniper';
    api_key := current_setting('app.supabase_anon_key');
    
    select net.http_post(
      url := url,
      headers := jsonb_build_object('Authorization', 'Bearer ' || api_key)
    ) into req_id;
  end;
  $$
);

-- 5. (Optional) Check the scheduled job
-- SELECT * FROM cron.job WHERE jobname = 'agent-sniper-poll';
