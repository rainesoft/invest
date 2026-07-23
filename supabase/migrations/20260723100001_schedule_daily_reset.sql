-- Function to reset the daily starting equity
CREATE OR REPLACE FUNCTION reset_daily_drawdown()
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
    UPDATE public.user_risk_settings
    SET daily_starting_equity = portfolio_capital;
END;
$$;

-- Schedule it to run at 22:00 UTC (5 PM EST)
SELECT cron.schedule(
  'invoke_reset_daily_drawdown',
  '0 22 * * *',
  $$
    SELECT reset_daily_drawdown();
  $$
);
