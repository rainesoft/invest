-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: 00008_market_scout_cron.sql
-- Schedules the market-scout edge function via pg_cron.
--
-- Schedule:  Every 5 minutes from 20:00–00:00 UTC, Sunday–Friday
--            (covers Asian open 22:00 SAST and London pre-open)
--
-- TO DELETE after setups close:
--   SELECT cron.unschedule('market-scout-poll');
-- ─────────────────────────────────────────────────────────────────────────────

-- Enable pg_cron (idempotent)
CREATE EXTENSION IF NOT EXISTS pg_cron;
GRANT USAGE ON SCHEMA cron TO postgres;

-- Remove any existing schedule with this name first (idempotent re-run)
SELECT cron.unschedule('market-scout-poll') 
WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'market-scout-poll'
);

-- Schedule: every 5 minutes during active trading window (20:00–23:59 UTC)
-- Runs Sunday (0) through Friday (5) — covers market open through US close
SELECT cron.schedule(
  'market-scout-poll',
  '*/5 20-23 * * 0-5',
  $$
  SELECT net.http_post(
    url     := current_setting('app.supabase_url') || '/functions/v1/market-scout',
    headers := jsonb_build_object(
      'Content-Type',      'application/json',
      'x-webhook-secret',  current_setting('app.webhook_secret')
    ),
    body    := '{}'::jsonb
  );
  $$
);

-- Confirm the schedule was created
SELECT jobid, jobname, schedule, command 
FROM cron.job 
WHERE jobname = 'market-scout-poll';
