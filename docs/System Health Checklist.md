# Raine Bank: Daily System Health Checklist

This checklist is designed for App Support Engineers to verify the overall health, execution integrity, and safety limits of the autonomous agentic trading system at the start of each trading day.

## 1. Edge Infrastructure & Core DB Health
Verify that the underlying Supabase infrastructure is responsive and background scheduling is active.

- [ ] **Database Connectivity:** Verify the Supabase dashboard is accessible and the database is accepting queries.
- [ ] **Cron Scheduler Activity:** Navigate to `pg_cron` (or the internal cron dashboard) and ensure `agent-news` and `agent-swing` are firing on their expected schedules without `failed` statuses.
- [ ] **Edge Function Error Rates:** Review the Supabase Edge Functions dashboard. Verify there are no massive spikes in `5xx` errors for:
  - `agent-trade`
  - `telegram-broadcast`
  - `agent-kill-switch`
  - `vps-poll`

---

## ⚠️ 1B. pg_cron Diagnostic — Critical Failure Check

> [!CAUTION]
> **Incident (2026-07-30):** `agent-scalper-poll`, `agent-news-poll`, and `position-manager-poll` silently failed for 1.5+ hours due to a PL/pgSQL syntax error in the cron job SQL commands. Because pg_cron fires asynchronously, **no alerts were raised** — signals simply stopped being generated. Run this check at the start of every trading day.

### Step 1 — Query the last run status for every cron job

Run the following SQL in the Supabase SQL editor or via the MCP tool:

```sql
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
```

- [ ] All jobs show `status = 'succeeded'`
- [ ] No job shows `status = 'failed'`

### Step 2 — If any job shows `failed`, check for this known error pattern

A `return_message` containing any of the following indicates a **PL/pgSQL anonymous block was incorrectly used** in the cron command:

```
ERROR: syntax error at or near "text"
ERROR: syntax error at or near "bigint"
ERROR: syntax error at or near "declare"
```

**Root Cause:** pg_cron does **not** support anonymous PL/pgSQL blocks (`DECLARE...BEGIN...END`). It only accepts plain SQL statements. A cron command structured like this will always fail:

```sql
-- ❌ BROKEN — do not use DECLARE blocks in pg_cron
declare
    url text;
    req_id bigint;
begin
    select net.http_post(...) into req_id;
end;
```

### Step 3 — Apply the fix

Rewrite the failing job using a plain `SELECT` statement:

```sql
-- ✅ CORRECT pattern for pg_cron
SELECT cron.alter_job(
  job_id := (SELECT jobid FROM cron.job WHERE jobname = 'agent-scalper-poll'),
  command := $$
    SELECT net.http_post(
      url := current_setting('app.supabase_url', true) || '/functions/v1/agent-scalper',
      headers := jsonb_build_object(
        'Authorization', 'Bearer ' || current_setting('app.supabase_anon_key', true),
        'Content-Type', 'application/json'
      ),
      body := '{"symbols":["XAUUSD","XAGUSD","BTCUSD","UKOIL","EURUSD","GBPUSD","USDJPY","US30","NAS100"],"timeframe":"30m"}'::jsonb
    );
  $$
);
```

Repeat `cron.alter_job()` for each failing job, substituting the correct URL path and body. Verify the next scheduled run shows `status = 'succeeded'`.

### Step 4 — Confirm signals resumed

After fixing the cron jobs, run this query to confirm the agents are evaluating markets again:

```sql
SELECT action, payload_json->>'symbol' AS symbol, created_at
FROM audit_log
WHERE action = 'RESEARCH_RUN'
ORDER BY created_at DESC
LIMIT 10;
```

The `created_at` timestamps should fall within the last 30 minutes for `agent-scalper` and within the last hour for `agent-news`.

### Expected Cron Schedule Reference

| Job Name | Schedule | Expected Behaviour |
|---|---|---|
| `agent-news-poll` | `0 * * * 1-5` | Fires at the top of every hour, Mon–Fri |
| `agent-swing-poll` | `0 */4 * * 1-5` | Fires every 4 hours, Mon–Fri |
| `agent-trade-poll` | `3-59/5 * * * 1-5` | Fires every 5 min (offset 3m), Mon–Fri |
| `invoke_agent_sniper_1m` | `* * * * *` | Fires every 1 minute |
| `position-manager-poll` | `*/30 * * * 1-5` | Fires every 30 min, Mon–Fri |
| `invoke_reset_daily_drawdown` | `0 22 * * *` | Fires at 22:00 UTC daily |
| `weekend-defense-cron` | `30 20 * * 5` | Fires Friday 20:30 UTC |

---

## ⚠️ 1C. pg_cron Diagnostic — Authentication Failure Check (401 Unauthorized)

> [!CAUTION]
> **Incident (2026-07-31):** `agent-swing-poll` and `agent-news-poll` silently failed to execute for an entire day because the `pg_cron` HTTP POST request was hardcoded with the `SUPABASE_ANON_KEY`. The Edge Functions require the `SUPABASE_SERVICE_ROLE_KEY` to authenticate background cron triggers. This resulted in silent `401 Unauthorized` errors inside the edge function logs, and no signals were generated.

### Step 1 — Check for 401 Errors in Edge Function Logs

If cron jobs are showing `status = 'succeeded'` in `cron.job_run_details` but the agents are not producing any `trade_opportunities` or `audit_log` entries, the cron is successfully firing the HTTP request but the Edge Function is rejecting it.

1. Open the Supabase Dashboard -> Edge Functions -> Logs.
2. Filter for the failing function (e.g., `agent-swing`).
3. Look for HTTP 401 statuses.

### Step 2 — Verify the Cron Job Authorization Header

Run the following query to inspect the payload being sent by the cron jobs:

```sql
SELECT jobname, command
FROM cron.job
WHERE command LIKE '%net.http_post%';
```

Check the `Authorization` header inside the JSON payload. 

- ❌ **BROKEN:** Hardcoded token string (usually the Anon key).
```sql
headers := jsonb_build_object('Authorization', 'Bearer eyJhbGciOiJ...')
```

- ✅ **CORRECT:** Securely injected Service Role Key using `current_setting()`.
```sql
headers := jsonb_build_object('Authorization', 'Bearer ' || current_setting('app.settings.service_role_key', true))
```

### Step 3 — Apply the Fix

If any job is using a hardcoded or incorrect key, update it immediately using `cron.alter_job()` or by dropping and recreating it:

```sql
SELECT cron.alter_job(
  job_id := (SELECT jobid FROM cron.job WHERE jobname = 'agent-swing-poll'),
  command := $$
    SELECT net.http_post(
      url := 'https://ktezlusdkqlfdwqrldtn.supabase.co/functions/v1/agent-swing',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key', true)
      ),
      body := '{}'::jsonb
    );
  $$
);
```

---

## ⚠️ 1D. pg_cron Diagnostic — Null URL Constraint Error (net.http_request_queue)

> [!WARNING]
> **Incident (2026-07-31):** The `position-manager-poll` job repeatedly failed with a `violates not-null constraint` error on the `url` column in `net.http_request_queue`.

### Step 1 — Check for NULL URL errors

If `cron.job_run_details` shows `status = 'failed'` and the `return_message` contains:

```
ERROR:  null value in column "url" of relation "http_request_queue" violates not-null constraint
```

This indicates the cron job is trying to dynamically construct the URL using `current_setting('app.supabase_url', true)`, which is resolving to `NULL` in the Postgres configuration. 

### Step 2 — Apply the Fix

Do not rely on `app.supabase_url`. Rewrite the cron job to use the hardcoded base Supabase Edge Function URL instead:

```sql
-- ❌ BROKEN:
url := current_setting('app.supabase_url', true) || '/functions/v1/agent-trade'

-- ✅ CORRECT:
url := 'https://ktezlusdkqlfdwqrldtn.supabase.co/functions/v1/agent-trade'
```

Use `cron.alter_job()` to update the command.

---

## 2. Autonomous Agent Activity
Verify that the AI agents are actively evaluating the market and producing expected heartbeat logs.

**Health Checklist (Schedule Verification):**
Scan through the system and ensure everything is working as expected below:
- [ ] Agent News wakes up every hour, scans the news and attempts to generate S- and A- Tier trades based on news and fundamental analysis.
- [ ] Agent Swing wakes up every 4 hours, scans the market and attempts to generate S- and A- Tier swing trades.
- [ ] VPS Bridge (`vps-poll`) is actively receiving heartbeat pings from the MT5 EA every 1 second without throwing 401 Unauthorized or 1003 timeouts.

**Last-Run Timestamp Check:**
Run this query to confirm agents have fired recently. If `agent-swing` has no `RESEARCH_RUN` entry in the last 4.5 hours during market hours, treat it as an outage:

```sql
SELECT
  payload_json->>'symbol' AS symbol,
  action,
  created_at
FROM audit_log
WHERE action = 'RESEARCH_RUN'
  AND created_at > NOW() - INTERVAL '2 hours'
ORDER BY created_at DESC
LIMIT 20;
```

- [ ] **Signal Generation (Trade Opportunities):** Query `trade_opportunities` to confirm recent evaluations have occurred within the last few hours.

```sql
SELECT symbol, side, status, confidence, created_at, ai_summary
FROM trade_opportunities
ORDER BY created_at DESC
LIMIT 10;
```

- [ ] **Pre-AI Guard Approvals:** Review `audit_log` for action `REJECTED_BY_RISK_PRE_AI`. While rejections are normal, an overwhelming 100% rejection rate may indicate a bugged technical indicator or misconfigured spread limit.

```sql
SELECT payload_json->>'symbol' AS symbol, payload_json->>'reason' AS reason, created_at
FROM audit_log
WHERE action = 'REJECTED_BY_RISK_PRE_AI'
  AND created_at > NOW() - INTERVAL '4 hours'
ORDER BY created_at DESC;
```

- [ ] **INFLECTION_POINT_WAIT Saturation Check:** If every signal for a given symbol is being rejected with `INFLECTION_POINT_WAIT`, this is **not always a bug** — it often means the market is in a tight post-event consolidation (e.g., post-FOMC). However, if it persists for more than 4 hours across all symbols, check:
  1. Is there an active `VOLATILITY_LOCKOUT` in `market_context`?
  2. Is the ATR unusually low (market halted or thin)?
  3. Did a major central bank event just occur? If yes, the 0.5% threshold may need a temporary override.

```sql
-- Check for active volatility lockout
SELECT * FROM market_context
WHERE macro_bias = 'VOLATILITY_LOCKOUT'
  AND expires_at > NOW();
```

- [ ] **Kill Switch & Isolation Locks:** Verify that `agent-kill-switch` hasn't triggered an unintended global system pause. Query `shadow_ledger` and `audit_log` to ensure no permanent isolation locks have been placed on key assets like `XAUUSD` or `BTCUSD` unless macro events dictate so.

## 3. Trade Execution & PAMM Routing
Verify that approved signals are actually materializing into user trades and correctly interfacing with brokers.

- [ ] **PAMM Execution Router (`agent-trade`):** Match the latest `APPROVED` signals in `trade_opportunities` with records in `user_trades`. Ensure `volume` and `risk_amount` are non-zero.

```sql
-- Approved signals that have no corresponding user_trade (potential execution gap)
SELECT t.id, t.symbol, t.side, t.created_at
FROM trade_opportunities t
LEFT JOIN user_trades u ON u.opportunity_id = t.id
WHERE t.status = 'APPROVED'
  AND u.id IS NULL
ORDER BY t.created_at DESC;
```

- [ ] **Signal TTL Monitor:** APPROVED signals expire after 12 hours. Check for signals approaching expiry that have not executed, especially pending limit orders that may never have been triggered:

```sql
SELECT symbol, side, entry_plan_json->>'order_type' AS order_type, created_at,
       ROUND(EXTRACT(EPOCH FROM (NOW() - created_at)) / 3600, 1) AS hours_open
FROM trade_opportunities
WHERE status = 'APPROVED'
ORDER BY created_at ASC;
```

Any signal with `hours_open > 10` should be reviewed manually. If the limit order price was never reached, consider whether the setup is still valid or should be manually expired.

- [ ] **Master Broker Gateway (MetaAPI):** Check `meta_api_order_id` in `user_trades`. Confirm that orders are correctly syncing with MetaTrader and not returning structural errors (e.g., `SYMBOL_NOT_FOUND` or `INSUFFICIENT_MARGIN`).
- [ ] **Drawdown Breaker & House Money (PHM):** 
  - Check `user_risk_settings`. Ensure no critical master/PAMM accounts have their `high_water_mark_equity` threshold breached by more than their `max_drawdown_pct`.
  - Check `system_settings` for `phm_settings`. Confirm if the master account is currently playing with **House Money**. If active, verify that the escalated risk (e.g. 15%) is correctly overriding standard risk, and that the Drawdown Breaker correctly locks to the PHM Floor to ensure a safe soft-landing if a loss streak occurs.
- [ ] **Pending Order Garbage Collection:** Verify `position-manager-poll` is successfully executing every 30 minutes. Check the edge function logs for `agent-trade` to confirm it is scanning MetaAPI and autonomously cancelling stale pending limit orders (older than 24 hours) to prevent ghost executions.
- [ ] **Database & Broker Reconciliation (Ghost Trades):** Ensure that `agent-trade` is successfully syncing closed broker positions back to the database. Query `user_trades` for `status = 'OPEN'` and cross-reference with MetaAPI. If a trade is closed on the broker but stuck as `OPEN` in the database, the Execution Desk may incorrectly block new signals due to synthetic hedge correlation limits.

## 4. External Integrations
Verify that external data pipelines and notification systems are alive.

- [ ] **News API Data Feed:** Ensure `agent-news` is successfully fetching and parsing Tavily news articles. (Check Edge Function logs for `agent-news` to ensure no `401 Unauthorized` or timeout errors).
- [ ] **Market Data Feed:** Confirm `agent-swing` is successfully retrieving real-time candle data for evaluation.

### 4A. Telegram Webhook Diagnostics
The `telegram-broadcast` edge function is triggered automatically via a Postgres Trigger (`on_signal_generated`) whenever a new `trade_opportunities` row is inserted. It also triggers on `user_trades` updates for rejected executions.

- [ ] **Verify Edge Function Logs:** In the Supabase Dashboard -> Edge Functions, select `telegram-broadcast` and verify there are no `500 Internal Server Error` or `401 Unauthorized` logs.
- [ ] **Verify Bot Token:** Ensure `TELEGRAM_BOT_TOKEN` is correctly set in the Edge Function secrets. A missing or invalid token will result in HTTP 401 errors from the Telegram API within the edge function logs.
- [ ] **Test Delivery:** To safely verify delivery without broadcasting a fake signal to all users, you can manually invoke the edge function via the Supabase CLI or HTTP POST using a mock payload that mimics a `REJECTED` user trade for a specific test user's `user_id`.


## 5. API Quotas & Infrastructure Billing
Sudden failures across agents or broker executions are often tied to hard limits on third-party API accounts running out of prepaid credits.

- [ ] **OpenAI Credits (`agent-swing`, `agent-news`):** If the agents are suddenly failing to generate `trade_opportunities` and the Edge Function logs show `429 Too Many Requests` or `insufficient_quota`, log into the OpenAI billing dashboard to ensure auto-recharge hasn't failed and credits remain active.
- [ ] **MetaAPI Limits (`agent-trade`, `position-manager`):** MetaAPI operates on strict request concurrency and monthly execution quotas. If `agent-trade` logs show `QuotaExceededError` or 429 errors when attempting to sync or place trades, log into the MetaAPI portal to upgrade the tier or purchase extra volume.
- [ ] **Tavily Credits (`agent-news`):** If `agent-news` is failing to return macro insights and Edge Function logs show API rejection for Tavily, verify the Tavily developer dashboard to confirm the search query quota for the month hasn't been exhausted.
- [ ] **VPS & MT5 Health (`vps-poll`):** The `vps-poll` Edge Function should log a 200 OK ping every second. If `vps-poll` logs suddenly stop or show `5xx` errors, the Windows VPS hosting the MetaTrader 5 EA has either lost internet connectivity, restarted, or the EA was detached from the chart. Log into the VPS remotely via RDP to ensure MT5 is running with Auto Trading enabled.

> [!CAUTION]
> If any critical execution pipelines (such as missing `user_trades` for `APPROVED` signals) or external broker integrations are failing, escalate to the Engineering Team immediately and consider temporarily disabling `isAutoTradingEnabled` in global settings to prevent orphaned signals.

> [!TIP]
> Use the internal logging tables (`audit_log`) and Edge Function execution logs to rapidly pinpoint which layer of the system (Pre-AI, Cognitive AI, or Execution Desk) is responsible for abnormal rejections.

> [!NOTE]
> **Post-Event Consolidation (Normal Behaviour):** After a major central bank event (e.g., FOMC, ECB rate decision), it is normal for all signals on Gold, Silver, Oil, and Crypto to show `INFLECTION_POINT_WAIT` rejections for 2–6 hours while the market finds direction. This is the system working correctly. Do not override unless a clear breakout or sweep pattern has formed on the 1H or 4H chart.
