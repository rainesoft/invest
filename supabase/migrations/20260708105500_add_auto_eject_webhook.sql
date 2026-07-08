CREATE OR REPLACE FUNCTION public.handle_rejected_signal()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.status = 'REJECTED' AND OLD.status != 'REJECTED' THEN
    PERFORM net.http_post(
      url:='https://ktezlusdkqlfdwqrldtn.supabase.co/functions/v1/auto-eject',
      headers:=jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key', true)
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
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_signal_rejected ON public.trade_opportunities;
CREATE TRIGGER on_signal_rejected
AFTER UPDATE ON public.trade_opportunities
FOR EACH ROW EXECUTE FUNCTION public.handle_rejected_signal();
