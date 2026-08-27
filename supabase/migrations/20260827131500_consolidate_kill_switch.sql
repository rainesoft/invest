-- ============================================================
-- Migration: Consolidate Kill Switch into agent-trade & agent-sre
-- ============================================================

-- 1. Route handle_rejected_signal() trigger to agent-trade
CREATE OR REPLACE FUNCTION public.handle_rejected_signal()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
declare
  secret_val text;
BEGIN
  IF NEW.status = 'REJECTED' AND OLD.status != 'REJECTED' THEN
    SELECT decrypted_secret INTO secret_val FROM vault.decrypted_secrets WHERE name = 'webhook_secret' LIMIT 1;
    PERFORM net.http_post(
      url:='https://ktezlusdkqlfdwqrldtn.supabase.co/functions/v1/agent-trade',
      headers:=jsonb_build_object(
        'Content-Type', 'application/json',
        'x-webhook-secret', secret_val
      ),
      body:=jsonb_build_object(
        'type', 'UPDATE',
        'table', 'trade_opportunities',
        'record', row_to_json(NEW),
        'old_record', row_to_json(OLD)
      )
    );
  END IF;
  RETURN NEW;
END;
$function$;

-- 2. Reschedule weekend-defense-cron to route to agent-trade
DO $$
BEGIN
  PERFORM cron.unschedule('weekend-defense-cron');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

SELECT cron.schedule(
  'weekend-defense-cron',
  '30 20 * * 5',
  $$
    SELECT net.http_post(
      url := 'https://ktezlusdkqlfdwqrldtn.supabase.co/functions/v1/agent-trade',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-cron-secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'new_cron_secret' LIMIT 1)
      ),
      body := jsonb_build_object('action', 'WEEKEND_DEFENSE'),
      timeout_milliseconds := 150000
    );
  $$
);
