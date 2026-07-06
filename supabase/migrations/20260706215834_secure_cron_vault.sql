-- Enable the Supabase Vault extension if it isn't already enabled
CREATE EXTENSION IF NOT EXISTS "supabase_vault" WITH SCHEMA "vault";

-- Unschedule all existing jobs first to prevent duplicates
SELECT cron.unschedule('auto_expire_signals');
SELECT cron.unschedule('monitor_open_trades');
SELECT cron.unschedule('research_run_1h');
SELECT cron.unschedule('research_run_4h');
SELECT cron.unschedule('research_run_1d');
SELECT cron.unschedule('daily_drip_campaign');

-- Schedule Auto Expire Signals RPC (Runs every 15 minutes)
SELECT cron.schedule('auto_expire_signals', '*/15 * * * *', $$ select rpc_expire_stale_opportunities(); $$);

-- Monitor Open Trades via Edge Function (Runs every minute)
SELECT cron.schedule(
    'monitor_open_trades',
    '* * * * *',
    $$
    select net.http_post(
        url:='https://ktezlusdkqlfdwqrldtn.supabase.co/functions/v1/monitor-open-trades',
        headers:=('{"Authorization": "Bearer ' || (SELECT secret FROM vault.decrypted_secrets WHERE name = 'cron_secret' LIMIT 1) || '"}')::jsonb
    );
    $$
);

-- Research Run (1H) via Edge Function (Runs every hour)
SELECT cron.schedule(
    'research_run_1h',
    '0 * * * *',
    $$
    select net.http_post(
        url:='https://ktezlusdkqlfdwqrldtn.supabase.co/functions/v1/research-run',
        headers:=('{"Authorization": "Bearer ' || (SELECT secret FROM vault.decrypted_secrets WHERE name = 'cron_secret' LIMIT 1) || '", "Content-Type": "application/json"}')::jsonb,
        body:='{"timeframe": "1h"}'::jsonb,
        timeout_milliseconds:=300000
    );
    $$
);

-- Research Run (4H) via Edge Function (Runs every 4 hours)
SELECT cron.schedule(
    'research_run_4h',
    '0 */4 * * *',
    $$
    select net.http_post(
        url:='https://ktezlusdkqlfdwqrldtn.supabase.co/functions/v1/research-run',
        headers:=('{"Authorization": "Bearer ' || (SELECT secret FROM vault.decrypted_secrets WHERE name = 'cron_secret' LIMIT 1) || '", "Content-Type": "application/json"}')::jsonb,
        body:='{"timeframe": "4h"}'::jsonb,
        timeout_milliseconds:=300000
    );
    $$
);

-- Research Run (1D) via Edge Function (Runs daily at midnight)
SELECT cron.schedule(
    'research_run_1d',
    '0 0 * * *',
    $$
    select net.http_post(
        url:='https://ktezlusdkqlfdwqrldtn.supabase.co/functions/v1/research-run',
        headers:=('{"Authorization": "Bearer ' || (SELECT secret FROM vault.decrypted_secrets WHERE name = 'cron_secret' LIMIT 1) || '", "Content-Type": "application/json"}')::jsonb,
        body:='{"timeframe": "1d"}'::jsonb,
        timeout_milliseconds:=300000
    );
    $$
);

-- Daily Drip Campaign via Edge Function (Runs M-F at 13:00)
SELECT cron.schedule(
    'daily_drip_campaign',
    '0 13 * * 1-5',
    $$
    select net.http_post(
        url:='https://ktezlusdkqlfdwqrldtn.supabase.co/functions/v1/daily-drip-campaign',
        headers:=('{"Authorization": "Bearer ' || (SELECT secret FROM vault.decrypted_secrets WHERE name = 'cron_secret' LIMIT 1) || '"}')::jsonb,
        timeout_milliseconds:=300000
    );
    $$
);
