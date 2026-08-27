-- ============================================================
-- Migration: Consolidate Email Hub into email-campaigns
-- ============================================================

CREATE OR REPLACE FUNCTION public.trigger_email_onboarding()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
declare
  webhook_url text := 'https://ktezlusdkqlfdwqrldtn.supabase.co/functions/v1';
  payload jsonb;
  request_id bigint;
begin
  payload := jsonb_build_object(
    'type', 'INSERT',
    'table', 'users',
    'schema', 'auth',
    'record', jsonb_build_object('id', NEW.id, 'email', NEW.email)
  );

  select net.http_post(
    url := webhook_url || '/email-campaigns',
    body := payload,
    headers := '{"Content-Type": "application/json"}'::jsonb,
    timeout_milliseconds := 10000
  ) into request_id;

  return NEW;
end;
$function$;
