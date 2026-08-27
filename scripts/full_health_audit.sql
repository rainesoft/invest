SELECT jsonb_pretty(jsonb_build_object(
  'timestamp', NOW(),
  
  'cron_jobs', (
    SELECT jsonb_agg(jsonb_build_object(
      'jobid', j.jobid,
      'jobname', j.jobname,
      'schedule', j.schedule,
      'active', j.active,
      'last_run', (SELECT MAX(start_time) FROM cron.job_run_details WHERE jobid = j.jobid),
      'last_status', (SELECT status FROM cron.job_run_details WHERE jobid = j.jobid ORDER BY start_time DESC LIMIT 1),
      'last_return_message', (SELECT return_message FROM cron.job_run_details WHERE jobid = j.jobid ORDER BY start_time DESC LIMIT 1)
    ))
    FROM cron.job j
  ),
  
  'cron_failures_last_48h', (
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'jobname', sub.jobname,
      'status', sub.status,
      'return_message', sub.return_message,
      'start_time', sub.start_time
    )), '[]'::jsonb)
    FROM (
      SELECT j.jobname, r.status, r.return_message, r.start_time
      FROM cron.job_run_details r
      JOIN cron.job j ON j.jobid = r.jobid
      WHERE r.status != 'succeeded' AND r.start_time > NOW() - INTERVAL '48 hours'
      ORDER BY r.start_time DESC
      LIMIT 20
    ) sub
  ),

  'cron_insecure_or_missing_timeout', (
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'jobname', jobname,
      'command', command
    )), '[]'::jsonb)
    FROM cron.job
    WHERE command LIKE '%net.http_post%' 
      AND (command NOT LIKE '%x-cron-secret%' OR command NOT LIKE '%timeout_milliseconds%')
  ),

  'cron_duplicates', (
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'duplicate_jobs', sub.duplicate_jobs,
      'schedule', sub.schedule,
      'count', sub.cnt
    )), '[]'::jsonb)
    FROM (
      SELECT array_agg(jobname) AS duplicate_jobs, schedule, count(*) AS cnt
      FROM cron.job
      GROUP BY command, schedule
      HAVING count(*) > 1
    ) sub
  ),

  'database_webhook_http_errors', (
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'id', sub.id,
      'status_code', sub.status_code,
      'error_msg', sub.error_msg,
      'created', sub.created
    )), '[]'::jsonb)
    FROM (
      SELECT id, status_code, error_msg, created
      FROM net._http_response
      WHERE error_msg IS NOT NULL OR status_code >= 400
      ORDER BY created DESC
      LIMIT 10
    ) sub
  ),

  'agent_crashes_and_errors', (
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'id', sub.id,
      'action', sub.action,
      'payload', sub.payload_json,
      'created_at', sub.created_at
    )), '[]'::jsonb)
    FROM (
      SELECT id, action, payload_json, created_at
      FROM audit_log
      WHERE (action = 'AGENT_CRASH' OR action ILIKE '%ERROR%' OR action ILIKE '%FAIL%')
        AND created_at > NOW() - INTERVAL '7 days'
      ORDER BY created_at DESC
      LIMIT 20
    ) sub
  ),

  'recent_research_runs_24h', (
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'agent', sub.agent,
      'symbol', sub.symbol,
      'tf', sub.timeframe,
      'count', sub.count,
      'last_run', sub.last_run
    )), '[]'::jsonb)
    FROM (
      SELECT payload_json->>'agent' as agent, payload_json->>'symbol' as symbol, payload_json->>'timeframe' as timeframe, count(*) as count, MAX(created_at) as last_run
      FROM audit_log
      WHERE action = 'RESEARCH_RUN' AND created_at > NOW() - INTERVAL '24 hours'
      GROUP BY payload_json->>'agent', payload_json->>'symbol', payload_json->>'timeframe'
      ORDER BY last_run DESC
    ) sub
  ),

  'orphaned_signals', (
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'issue_type', sub.issue_type,
      'id', sub.id,
      'symbol', sub.symbol,
      'side', sub.side,
      'status', sub.status,
      'created_at', sub.created_at
    )), '[]'::jsonb)
    FROM (
      SELECT 'Orphaned PUBLISHED (>5m)' as issue_type, id, symbol, side, status, created_at
      FROM trade_opportunities
      WHERE status = 'PUBLISHED' AND created_at < NOW() - INTERVAL '5 minutes'
      UNION ALL
      SELECT 'Aged APPROVED (>1h)' as issue_type, id, symbol, side, status, created_at
      FROM trade_opportunities
      WHERE status = 'APPROVED' AND created_at < NOW() - INTERVAL '1 hour'
      UNION ALL
      SELECT 'Stale ACTIVE (>24h, no open trades)' as issue_type, t.id, t.symbol, t.side, t.status, t.created_at
      FROM trade_opportunities t
      WHERE t.status = 'ACTIVE' AND t.created_at < NOW() - INTERVAL '24 hours'
        AND NOT EXISTS (SELECT 1 FROM user_trades u WHERE u.opportunity_id = t.id AND u.status IN ('OPEN', 'PENDING', 'VPS_PENDING', 'VPS_PROCESSING'))
      UNION ALL
      SELECT 'Unreconciled Completed Opps' as issue_type, t.id, t.symbol, t.side, t.status, t.created_at
      FROM trade_opportunities t
      WHERE t.status IN ('ACTIVE', 'APPROVED')
        AND EXISTS (SELECT 1 FROM user_trades u WHERE u.opportunity_id = t.id)
        AND NOT EXISTS (SELECT 1 FROM user_trades u WHERE u.opportunity_id = t.id AND u.status IN ('OPEN', 'PENDING', 'VPS_PENDING'))
      UNION ALL
      SELECT 'Desynced Closed Trades' as issue_type, u.id, u.symbol, u.side, u.status, u.created_at
      FROM user_trades u
      WHERE u.status = 'OPEN' AND u.profit_usd IS NOT NULL
      UNION ALL
      SELECT 'Stale Unfilled Orders (>48h)' as issue_type, u.id, u.symbol, u.side, u.status, u.created_at
      FROM user_trades u
      WHERE u.status IN ('OPEN', 'PENDING', 'VPS_PENDING') AND u.open_price IS NULL AND u.created_at < NOW() - INTERVAL '48 hours'
    ) sub
  ),

  'recent_trade_opportunities', (
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'id', sub.id,
      'symbol', sub.symbol,
      'side', sub.side,
      'tf', sub.timeframe,
      'status', sub.status,
      'confidence', sub.confidence,
      'source', sub.source,
      'created_at', sub.created_at,
      'ai_summary', sub.ai_summary,
      'ai_risks', sub.ai_risks
    )), '[]'::jsonb)
    FROM (
      SELECT * FROM trade_opportunities ORDER BY created_at DESC LIMIT 10
    ) sub
  ),

  'open_user_trades', (
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'id', sub.id,
      'opportunity_id', sub.opportunity_id,
      'symbol', sub.symbol,
      'side', sub.side,
      'volume', sub.volume,
      'status', sub.status,
      'trade_type', sub.trade_type,
      'open_price', sub.open_price,
      'profit_usd', sub.profit_usd,
      'meta_api_order_id', sub.meta_api_order_id,
      'created_at', sub.created_at
    )), '[]'::jsonb)
    FROM (
      SELECT * FROM user_trades
      WHERE status IN ('OPEN', 'PENDING', 'VPS_PENDING')
      ORDER BY created_at DESC
    ) sub
  ),

  'failed_user_trades_7d', (
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'id', sub.id,
      'opportunity_id', sub.opportunity_id,
      'symbol', sub.symbol,
      'side', sub.side,
      'volume', sub.volume,
      'status', sub.status,
      'error_message', sub.error_message,
      'created_at', sub.created_at
    )), '[]'::jsonb)
    FROM (
      SELECT * FROM user_trades
      WHERE status = 'FAILED' AND created_at > NOW() - INTERVAL '7 days'
      ORDER BY created_at DESC
    ) sub
  ),

  'vps_heartbeat_and_risk', (
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'user_id', user_id,
      'portfolio_capital', portfolio_capital,
      'is_live_execution_enabled', is_live_execution_enabled,
      'auto_trade_enabled', auto_trade_enabled,
      'is_master_account', is_master_account,
      'vps_last_heartbeat', vps_last_heartbeat,
      'mins_since_heartbeat', ROUND(EXTRACT(EPOCH FROM (NOW() - vps_last_heartbeat)) / 60, 1)
    )), '[]'::jsonb)
    FROM user_risk_settings
  ),

  'market_data_freshness', (
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'symbol', sub.symbol,
      'timeframe', sub.timeframe,
      'last_candle', sub.last_candle_pushed,
      'hours_stale', sub.hours_stale
    )), '[]'::jsonb)
    FROM (
      SELECT symbol, timeframe, MAX(ts) as last_candle_pushed,
             ROUND(EXTRACT(EPOCH FROM (NOW() - MAX(ts))) / 3600, 1) as hours_stale
      FROM market_data_pti
      GROUP BY symbol, timeframe
      ORDER BY hours_stale ASC
    ) sub
  ),

  'treasury_status', (
    SELECT value FROM system_settings WHERE key = 'treasury_status'
  ),

  'treasury_snapshots', (
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'id', sub.id,
      'timestamp', sub.snapshot_timestamp,
      'total_liabilities', sub.total_customer_liability,
      'total_assets', sub.total_assets,
      'solvency_ratio', sub.solvency_ratio,
      'notes', sub.notes
    )), '[]'::jsonb)
    FROM (
      SELECT * FROM treasury_snapshots ORDER BY snapshot_timestamp DESC LIMIT 5
    ) sub
  ),

  'global_settings', (
    SELECT COALESCE(jsonb_object_agg(key, value), '{}'::jsonb)
    FROM system_settings
  )
)) AS report;
