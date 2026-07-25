-- Fix agent-scalper cron to explicitly pass all symbols for multi-asset scanning.
-- Previously the cron sent no body, relying on RESEARCH_SYMBOLS env var which was only set to BTCUSD.
-- Now explicitly passes the full asset list in the POST body.

-- Remove old cron job
SELECT cron.unschedule('agent-scalper-poll');

-- Re-create with explicit symbol list (all instruments Raine trades)
SELECT cron.schedule(
    'agent-scalper-poll',
    '*/30 * * * 1-5',
    $$
    declare
        url text;
        api_key text;
        req_id bigint;
    begin
        url := current_setting('app.supabase_url', true) || '/functions/v1/agent-scalper';
        api_key := current_setting('app.supabase_anon_key', true);
        
        select net.http_post(
            url := url,
            headers := jsonb_build_object(
                'Authorization', 'Bearer ' || api_key,
                'Content-Type', 'application/json'
            ),
            body := '{"symbols":["XAUUSD","XAGUSD","BTCUSD","UKOIL","EURUSD","GBPUSD","USDJPY","US30","NAS100"],"timeframe":"30m"}'::jsonb
        ) into req_id;
    end;
    $$
);
