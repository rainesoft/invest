-- Migration: 20260906000000_fix_weekend_position_manager_and_eth_caps.sql
-- Description: Ensures position-manager-poll and agent-news-poll run 7 days a week to support 24/7 weekend crypto trailing stops.

SELECT cron.alter_job(
  job_id := (SELECT jobid FROM cron.job WHERE jobname = 'position-manager-poll'),
  schedule := '*/5 * * * *'
);

SELECT cron.alter_job(
  job_id := (SELECT jobid FROM cron.job WHERE jobname = 'agent-news-poll'),
  schedule := '0 * * * *'
);
