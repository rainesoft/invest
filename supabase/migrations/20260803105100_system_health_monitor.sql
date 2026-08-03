-- ============================================================
-- Migration: System Health Monitor (Cron Alerts)
-- ============================================================

-- 1. Create a secure RPC function to read cron failures
-- We use SECURITY DEFINER so it can access the 'cron' schema even if called via the API
CREATE OR REPLACE FUNCTION public.check_cron_failures()
RETURNS jsonb AS $$
DECLARE
  failures jsonb;
BEGIN
  SELECT jsonb_agg(
    jsonb_build_object(
      'jobname', j.jobname,
      'runid', r.runid,
      'start_time', r.start_time,
      'return_message', r.return_message
    )
  ) INTO failures
  FROM cron.job_run_details r
  JOIN cron.job j ON r.jobid = j.jobid
  WHERE r.status = 'failed' 
    AND r.start_time >= now() - interval '1 hour';
    
  RETURN COALESCE(failures, '[]'::jsonb);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 2. Schedule the health check to run every hour at minute 15
DO $$
BEGIN
  PERFORM cron.unschedule('system-health-check-poll');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

SELECT cron.schedule(
    'system-health-check-poll',
    '15 * * * *',
    $$
    SELECT net.http_post(
        url := 'https://ktezlusdkqlfdwqrldtn.supabase.co/functions/v1/agent-kill-switch',
        headers := jsonb_build_object(
            'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key', true),
            'Content-Type', 'application/json'
        ),
        body := '{"action":"SYSTEM_HEALTH_CHECK"}'::jsonb
    );
    $$
);
