-- ============================================================
-- Migration: Trading Central Institutional Best Practices & Asset Coverage
-- ============================================================
-- 1. Updates Forex coverage to include USDCAD, USDCHF, NZDUSD, EURJPY, GBPJPY
-- 2. Updates Crypto coverage to include BTCUSD, ETHUSD
-- 3. Updates Commodities coverage to include Gold (XAUUSD), Silver (XAGUSD), Brent (UKOIL), WTI Crude (USOIL)
-- 4. Updates Indices coverage to include Dow (US30), Nasdaq (NAS100), S&P 500 (SPX500), DAX 40 (GER30), Nikkei 225 (JP225)
-- 5. Adds dedicated Stocks coverage for Big Tech (AAPL, MSFT, NVDA, GOOGL, AMZN, TSLA, META)

DO $$
BEGIN
  PERFORM cron.unschedule('agent-swing-forex');
  PERFORM cron.unschedule('agent-swing-crypto');
  PERFORM cron.unschedule('agent-swing-commodities');
  PERFORM cron.unschedule('agent-swing-indices');
  PERFORM cron.unschedule('agent-swing-stocks');
  PERFORM cron.unschedule('agent-swing-stocks-daily');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

-- 1. Forex: Major currency pairs covered with up to 6 swing updates per day + 30m intraday
SELECT cron.schedule(
  'agent-swing-forex',
  '0 */4 * * 1-5',
  $$
    SELECT net.http_post(
      url := 'https://ktezlusdkqlfdwqrldtn.supabase.co/functions/v1/agent-swing',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-cron-secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'new_cron_secret' LIMIT 1)
      ),
      body := '{"symbols": ["EURUSD", "GBPUSD", "USDJPY", "AUDUSD", "USDCAD", "USDCHF", "NZDUSD", "EURJPY", "GBPJPY"]}'::jsonb,
      timeout_milliseconds := 150000
    );
  $$
);

-- 2. Crypto: 24/7 coverage with updates every 4 hours (6x/day) + 30m intraday
SELECT cron.schedule(
  'agent-swing-crypto',
  '2 */4 * * *',
  $$
    SELECT net.http_post(
      url := 'https://ktezlusdkqlfdwqrldtn.supabase.co/functions/v1/agent-swing',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-cron-secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'new_cron_secret' LIMIT 1)
      ),
      body := '{"symbols": ["BTCUSD", "ETHUSD"]}'::jsonb,
      timeout_milliseconds := 150000
    );
  $$
);

-- 3. Commodities: Gold, Silver, Brent, WTI Crude covered every 4 hours on weekdays
SELECT cron.schedule(
  'agent-swing-commodities',
  '4 */4 * * 1-5',
  $$
    SELECT net.http_post(
      url := 'https://ktezlusdkqlfdwqrldtn.supabase.co/functions/v1/agent-swing',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-cron-secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'new_cron_secret' LIMIT 1)
      ),
      body := '{"symbols": ["XAUUSD", "XAGUSD", "UKOIL", "USOIL"]}'::jsonb,
      timeout_milliseconds := 150000
    );
  $$
);

-- 4. Indices: Major global index futures (US30, NAS100, SPX500, GER30, JP225) every 4 hours on weekdays
SELECT cron.schedule(
  'agent-swing-indices',
  '6 */4 * * 1-5',
  $$
    SELECT net.http_post(
      url := 'https://ktezlusdkqlfdwqrldtn.supabase.co/functions/v1/agent-swing',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-cron-secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'new_cron_secret' LIMIT 1)
      ),
      body := '{"symbols": ["US30", "NAS100", "SPX500", "GER30", "JP225"]}'::jsonb,
      timeout_milliseconds := 150000
    );
  $$
);

-- 5a. Big US Tech Stocks: Daily intraday coverage at US Market Open (13:30 UTC / 9:30 AM EST)
SELECT cron.schedule(
  'agent-swing-stocks-daily',
  '30 13 * * 1-5',
  $$
    SELECT net.http_post(
      url := 'https://ktezlusdkqlfdwqrldtn.supabase.co/functions/v1/agent-swing',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-cron-secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'new_cron_secret' LIMIT 1)
      ),
      body := '{"symbols": ["AAPL", "MSFT", "NVDA", "GOOGL", "AMZN", "TSLA", "META"]}'::jsonb,
      timeout_milliseconds := 150000
    );
  $$
);

-- 5b. Equities / Stocks: Weekly swing analysis at Sunday 22:00 UTC
SELECT cron.schedule(
  'agent-swing-stocks',
  '0 22 * * 0',
  $$
    SELECT net.http_post(
      url := 'https://ktezlusdkqlfdwqrldtn.supabase.co/functions/v1/agent-swing',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-cron-secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'new_cron_secret' LIMIT 1)
      ),
      body := '{"symbols": ["AAPL", "MSFT", "NVDA", "GOOGL", "AMZN", "TSLA", "META"]}'::jsonb,
      timeout_milliseconds := 150000
    );
  $$
);
