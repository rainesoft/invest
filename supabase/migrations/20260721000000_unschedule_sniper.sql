DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'agent-sniper-poll') THEN
    PERFORM cron.unschedule('agent-sniper-poll');
  END IF;
END $$;
