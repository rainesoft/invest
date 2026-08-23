-- 1. pg_cron Diagnostic
SELECT '\n--- pg_cron Diagnostic ---' AS section;
SELECT
  j.jobname,
  j.schedule,
  j.active,
  r.status,
  r.return_message,
  r.start_time
FROM cron.job j
JOIN cron.job_run_details r ON j.jobid = r.jobid
ORDER BY r.start_time DESC
LIMIT 30;

-- 1A. Check for authorization header usage in cron
SELECT '\n--- pg_cron Authorization Headers ---' AS section;
SELECT jobname, command
FROM cron.job
WHERE command LIKE '%net.http_post%';

-- 1B. Check for insecure auth or missing timeout in cron (Proactive Bug Catching)
SELECT '\n--- pg_cron Missing x-cron-secret or Timeout ---' AS section;
SELECT jobname, command
FROM cron.job
WHERE command LIKE '%net.http_post%' 
  AND (command NOT LIKE '%x-cron-secret%' OR command NOT LIKE '%timeout_milliseconds%');

-- 2. Autonomous Agent Activity
SELECT '\n--- Recent RESEARCH_RUN (agent-news & agent-swing) ---' AS section;
SELECT action, payload_json->>'symbol' AS symbol, created_at
FROM audit_log
WHERE action = 'RESEARCH_RUN' AND (payload_json->>'agent' = 'agent-news' OR payload_json->>'agent' = 'agent-swing')
ORDER BY created_at DESC
LIMIT 10;

-- 2B. Autonomous Agent Activity (agent-day)
SELECT '\n--- Recent RESEARCH_RUN (agent-day) ---' AS section;
SELECT action, payload_json->>'symbol' AS symbol, created_at
FROM audit_log
WHERE action = 'RESEARCH_RUN' AND payload_json->>'agent' = 'agent-day'
ORDER BY created_at DESC
LIMIT 10;

-- 3. Signal Generation
SELECT '\n--- Trade Opportunities ---' AS section;
SELECT symbol, side, status, confidence, created_at, ai_summary
FROM trade_opportunities
ORDER BY created_at DESC
LIMIT 10;

-- 4. Orphaned PUBLISHED Signals
SELECT '\n--- Orphaned PUBLISHED Signals ---' AS section;
SELECT id, symbol, side, status, created_at
FROM trade_opportunities
WHERE status = 'PUBLISHED'
  AND created_at < NOW() - INTERVAL '5 minutes';

-- 5. Rejected by Risk Pre-AI
SELECT '\n--- Rejections Pre-AI ---' AS section;
SELECT payload_json->>'symbol' AS symbol, payload_json->>'reason' AS reason, created_at
FROM audit_log
WHERE action = 'REJECTED_BY_RISK_PRE_AI'
  AND created_at > NOW() - INTERVAL '4 hours'
ORDER BY created_at DESC
LIMIT 10;

-- 6. Orphaned PENDING Trades
SELECT '\n--- Orphaned PENDING Trades ---' AS section;
SELECT id, symbol, status, created_at 
FROM user_trades 
WHERE status = 'PENDING' 
  AND created_at < NOW() - INTERVAL '1 hour';

-- 7. FAILED Trades (Execution blocks)
SELECT '\n--- FAILED Trades ---' AS section;
SELECT id, symbol, volume, error_message, created_at 
FROM user_trades 
WHERE status = 'FAILED' 
ORDER BY created_at DESC
LIMIT 10;

-- 8. VPS Heartbeat
SELECT '\n--- VPS Heartbeat ---' AS section;
SELECT user_id, vps_last_heartbeat, 
       ROUND(EXTRACT(EPOCH FROM (NOW() - vps_last_heartbeat)) / 60, 1) as minutes_since_last_ping
FROM user_risk_settings
WHERE vps_last_heartbeat IS NOT NULL;

-- 9. VPS Data Streaming
SELECT '\n--- VPS Data Streaming ---' AS section;
SELECT symbol, timeframe, MAX(ts) as last_candle_pushed
FROM market_data_pti
GROUP BY symbol, timeframe
ORDER BY last_candle_pushed DESC
LIMIT 10;

-- 10. Stuck VPS_PENDING Trades
SELECT '\n--- Stuck VPS_PENDING Trades ---' AS section;
SELECT id, symbol, status, created_at,
       ROUND(EXTRACT(EPOCH FROM (NOW() - created_at)) / 60, 1) as minutes_stuck
FROM user_trades
WHERE status = 'VPS_PENDING'
ORDER BY created_at ASC;

-- 11. Stale Data Execution Bypass
SELECT '\n--- Stale Data Execution Bypass ---' AS section;
SELECT 
  (SELECT vps_last_heartbeat FROM user_risk_settings LIMIT 1) as heartbeat,
  symbol,
  MAX(ts) as last_candle_pushed,
  ROUND(EXTRACT(EPOCH FROM (NOW() - MAX(ts))) / 3600, 1) as hours_stale
FROM market_data_pti
GROUP BY symbol
ORDER BY hours_stale DESC
LIMIT 10;

-- 12. Approved signals missing from user_trades
SELECT '\n--- Approved Signals Missing Execution ---' AS section;
SELECT t.id, t.symbol, t.side, t.status, t.created_at
FROM trade_opportunities t
LEFT JOIN user_trades u ON u.opportunity_id = t.id
WHERE t.status = 'APPROVED'
  AND u.id IS NULL
ORDER BY t.created_at DESC;

-- 13. WIN RATE (30D) 0% Anomaly Check
SELECT '\n--- Aged APPROVED Signals (0% Win Rate Anomaly Check) ---' AS section;
SELECT symbol, side, status, created_at
FROM trade_opportunities
WHERE status = 'APPROVED'
  AND created_at < NOW() - INTERVAL '1 hour';

-- 14. Edge Function Agent Crashes
SELECT '\n--- Edge Function Agent Crashes ---' AS section;
SELECT payload_json->>'agent' AS agent, payload_json->>'error' AS error_message, created_at
FROM audit_log
WHERE action = 'AGENT_CRASH'
ORDER BY created_at DESC
LIMIT 10;
