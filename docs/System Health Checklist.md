# RaineInvest: Daily System Health Checklist

A rapid, structured checklist to verify that all autonomous subsystems (VPS ingestion, Edge Function agents, PAMM execution, database health, risk controls) are fully operational.

> [!IMPORTANT]
> **Primary Architecture:** RaineInvest prioritizes the zero-latency **MT5 VPS Execution Architecture** as the primary source of truth for market data and trade execution. MetaAPI is strictly maintained as an autonomous failover layer. If the VPS stream fails, it must be investigated and restarted immediately to avoid long-term reliance on MetaAPI polling.

## 1. Edge Infrastructure & Core DB Health
Verify that the underlying Supabase infrastructure is responsive and background scheduling is active.

- [ ] **Database Connectivity:** Verify the Supabase dashboard is accessible and the database is accepting queries.
- [ ] **Cron Scheduler Activity:** Navigate to `pg_cron` (or the internal cron dashboard) and ensure `agent-news`, `agent-swing`, and `agent-day` are firing on their expected schedules without `failed` statuses.
- [ ] **Edge Function Error Rates:** Review the Supabase Edge Functions dashboard. Verify there are no massive spikes in `5xx` errors for:
  - `agent-day`
  - `agent-trade`
  - `agent-sre`
  - `telegram-broadcast`
  - `vps-poll`
  - `vps-market-feed` (Look specifically for `HTTP 500 DB Bulk Insert Error: duplicate key value` which indicates a live-candle UPSERT failure from the EA).

---

## ⚠️ 1B. pg_cron Diagnostic — Critical Failure Check

> [!CAUTION]
> **Incident (2026-07-30):** `agent-scalper-poll`, `agent-news-poll`, and `agent-trade-manage-positions` silently failed for 1.5+ hours due to a PL/pgSQL syntax error in the cron job SQL commands. Because pg_cron fires asynchronously, **no alerts were raised** — signals simply stopped being generated. Run this check at the start of every trading day.

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

The `created_at` timestamps should fall within the last 4 hours for `agent-swing`, within the last 30 minutes for `agent-day`, and within the last hour for `agent-news`.

### Expected Cron Schedule Reference (12 Canonical Jobs)

| Job Name | Schedule | Expected Behaviour |
|---|---|---|
| `agent-day-poll` | `*/30 * * * *` | Fires every 30 minutes to evaluate intraday pivot setups |
| `agent-news-poll` | `0 * * * *` | Fires at the top of every hour, 7 days a week |
| `agent-swing-forex` | `0 */4 * * 1-5` | Fires every 4 hours on weekdays for Forex pairs |
| `agent-swing-crypto` | `2 */4 * * *` | Fires every 4 hours daily for BTCUSD |
| `agent-swing-indices` | `4 */4 * * 1-5` | Fires every 4 hours on weekdays for Indices & Commodities |
| `agent-trade-poll` | `3-59/5 * * * *` | Fires every 5 min (offset 3m), 7 days a week |
| `position-manager-poll` | `*/30 * * * *` | Fires every 30 min, 7 days a week to trail stops, manage invalidations, and cancel stale pending orders |
| `exness-history-sync-poll` | `*/15 * * * *` | Fires every 15 min to reconcile closed trades and update portfolio capital |
| `resolve-outcomes-poll` | `*/10 * * * *` | Fires every 10 min to reconcile MT5 deals and grade trade opportunities |
| `agent-sre-poll` | `15 * * * *` | Fires hourly to run 8-point telemetry audit, execute auto-healing reconciliations, and dispatch alerts |
| `invoke_reset_daily_drawdown` | `0 22 * * *` | Fires at 22:00 UTC daily |
| `weekend-defense-cron` | `30 20 * * 5` | Fires Friday 20:30 UTC to trigger `agent-trade` roll-over sweep (closes losers, moves winners to BE) |


---

## ⚠️ 1C. pg_cron Diagnostic — Authentication Failure Check (401 Unauthorized)

> [!CAUTION]
> **Incident (2026-08-04 & 2026-08-10):** `agent-swing-poll` silently failed to execute because `current_setting('app.settings.service_role_key', true)` resolves to `null` inside the background `pg_cron` worker. Additionally, if the `CRON_SECRET` environment variable is missing from the Edge Function deployment, the function will reject the cron job's `x-cron-secret` header with a silent `401 Unauthorized`. Edge functions strictly enforce the **Security First Principle** and reject invalid tokens.

### Step 1 — Check for 401 Errors in Edge Function Logs

If cron jobs are showing `status = 'succeeded'` in `cron.job_run_details` but the agents are not producing any `trade_opportunities` or `audit_log` entries, the cron is successfully firing the HTTP request but the Edge Function is rejecting it.

1. Open the Supabase Dashboard -> Edge Functions -> Logs.
2. Filter for the failing function (e.g., `agent-swing`).
3. Look for HTTP 401 statuses.

### Step 1b — Verify Edge Function Secrets

Run the following command via the Supabase CLI to ensure that the Edge Functions have the `CRON_SECRET` loaded in their environment:
```bash
npx supabase secrets list
```
If `CRON_SECRET` is missing, set it immediately (using the `new_cron_secret` value from the database vault):
```bash
npx supabase secrets set CRON_SECRET=YourSecureCronSecretHere
```

### Step 2 — Verify the Cron Job Authorization Header

Run the following query to inspect the payload being sent by the cron jobs:

```sql
SELECT jobname, command
FROM cron.job
WHERE command LIKE '%net.http_post%';
```

Check how the authentication is being passed.

- ❌ **BROKEN:** Hardcoded token string or relying on `current_setting(...)` for the Authorization header.
```sql
headers := jsonb_build_object('Authorization', 'Bearer ' || current_setting('app.settings.service_role_key', true))
```

- ✅ **CORRECT:** Securely injected `x-cron-secret` fetched from the internal vault using `new_cron_secret` (which contains no libcurl-breaking newlines).
```sql
headers := jsonb_build_object(
  'Content-Type', 'application/json',
  'x-cron-secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'new_cron_secret' LIMIT 1)
)
```

### Step 3 — Apply the Fix

If any job is using an outdated or insecure key resolution method, update it immediately using `cron.alter_job()`:

```sql
SELECT cron.alter_job(
  job_id := (SELECT jobid FROM cron.job WHERE jobname = 'agent-swing-poll'),
  command := $$
    SELECT net.http_post(
      url := 'https://ktezlusdkqlfdwqrldtn.supabase.co/functions/v1/agent-swing',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-cron-secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'new_cron_secret' LIMIT 1)
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 150000
    );
  $$
);
```

### Step 4 — Check Database Triggers for Agent Handoffs

Edge Functions also receive webhook handoffs directly from database triggers (e.g., `trigger_trade_executor` calling `agent-trade`). Ensure these triggers dynamically fetch the `webhook_secret` from the vault, avoiding hardcoded legacy keys (`r4in3_...`).

- ✅ **CORRECT:**
```sql
SELECT decrypted_secret INTO secret_val FROM vault.decrypted_secrets WHERE name = 'webhook_secret' LIMIT 1;
... headers := jsonb_build_object('Content-Type', 'application/json', 'x-webhook-secret', secret_val)
```

---

## ⚠️ 1D. pg_cron Diagnostic — Null URL Constraint Error (net.http_request_queue)

> [!WARNING]
> **Incident (2026-07-31):** The `agent-trade-manage-positions` job repeatedly failed with a `violates not-null constraint` error on the `url` column in `net.http_request_queue`.

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

## ⚠️ 1E. pg_cron Diagnostic — Execution Timeout (Silent Aborts)

> [!CAUTION]
> **Incident (2026-08-04 / 2026-08-06):** Edge Functions like `agent-swing-poll`, `agent-trade-manage-positions`, and `agent-news-poll` silently aborted after exactly 5 seconds. `pg_net` defaults to a 5000ms timeout for HTTP POSTs. Because these functions take longer than 5 seconds to run (e.g., managing positions via MetaAPI or scraping news), the client closed the connection and Deno silently killed the execution without throwing an error log. This caused a week-long agent flatline and failed to trail live Stop Losses.

### Step 1 — Check for Missing Timeouts

Verify that all long-running cron jobs explicitly declare a `timeout_milliseconds` parameter in their `pg_net` payload.

> [!TIP]
> This check, along with the `x-cron-secret` authorization check, is now automatically swept by the `scripts/healthcheck.sql` diagnostic. It will proactively flag any misconfigured `cron.job` entries before they fail.

```sql
SELECT jobname, command
FROM cron.job
WHERE command LIKE '%net.http_post%';
```

- ❌ **BROKEN:** No timeout parameter, meaning it defaults to 5 seconds.
- ✅ **CORRECT:** `timeout_milliseconds := 150000` is explicitly set (matching the Edge Function maximum limit of 150 seconds).

### Step 2 — Apply the Fix

Alter the job to inject the timeout parameter:

```sql
SELECT cron.alter_job(
  job_id := (SELECT jobid FROM cron.job WHERE jobname = 'agent-swing-poll'),
  command := $$
    SELECT net.http_post(
      url := 'https://ktezlusdkqlfdwqrldtn.supabase.co/functions/v1/agent-swing',
      headers := jsonb_build_object(
        'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key', true),
        'Content-Type', 'application/json'
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 150000
    );
  $$
);
```

---

## ⚠️ 1F. pg_cron Diagnostic — Silent Agent Crashes (AGENT_CRASH)

> [!CAUTION]
> **Incident (2026-08-23):** `agent-day` stalled and stopped evaluating trades because it silently crashed during the pipeline execution. Because it returned an HTTP 200 containing `{"error": "..."}`, `pg_cron` recorded the run as `succeeded`, hiding the crash from standard cron monitoring.

### Step 1 — Check Audit Logs for AGENT_CRASH
The agents have been patched to emit an `AGENT_CRASH` event to the `audit_log` whenever an unhandled exception causes the pipeline to fail. 
Run the following query:

```sql
SELECT payload_json->>'agent' AS agent, payload_json->>'error' AS error_message, created_at
FROM audit_log
WHERE action = 'AGENT_CRASH'
ORDER BY created_at DESC
LIMIT 10;
```

- ❌ **FAILED:** If rows are returned, the Edge Function is failing internally. Review the stack trace and the Edge Function logs to resolve the code-level exception.

---

## ⚠️ 1G. Database Webhook Trigger Diagnostic — Broken URLs & Kong Fallbacks

> [!CAUTION]
> **Incident (2026-08-24):** Database triggers (e.g. `on_signal_rejected_eject` and `trigger_email_onboarding`) repeatedly threw `"Couldn't resolve host name"` errors in `net._http_response`. These triggers relied on `current_setting('app.settings.edge_functions_base_url', true)`, which is not set in cloud Supabase, causing them to fall back to `http://kong:8000/functions/v1` (a local Docker-only domain).

### Step 1 — Check for Webhook & Cron HTTP Errors
Run this query to inspect failed `pg_net` requests and Edge Function responses:

```sql
SELECT id, status_code, error_msg, created, content
FROM net._http_response
WHERE error_msg IS NOT NULL OR status_code >= 400
ORDER BY created DESC
LIMIT 10;
```

- ❌ **DNS/URL Errors:** If rows show `error_msg = 'Couldn't resolve host name'`, inspect `pg_proc` for functions with hardcoded `http://kong:8000` or unset GUC settings. Ensure all triggers call production Edge Function URLs (`https://<project-ref>.supabase.co/functions/v1/...`).
- ❌ **HTTP 500 Responses (e.g. `Failed to fetch Master history`):** If rows show `status_code = 500` with `content = 'Failed to fetch Master history'`, `exness-history-sync` experienced a transient MetaAPI timeout or rate limit while pulling `/history-deals`. Re-invoke the function manually or verify MetaAPI token status.

---

## ⚠️ 1H. pg_cron Diagnostic — Duplicate or Conflicting Cron Jobs

> [!WARNING]
> **Incident (2026-08-26):** Redundant duplicate cron jobs (`agent-trade-manage-positions` and `position-manager-poll`) were both configured at `*/30 * * * *` invoking `agent-trade` with `{"action":"MANAGE_POSITIONS"}` concurrently, doubling server load and causing race conditions on position evaluation.

### Step 1 — Check for Duplicate Commands in pg_cron

Run the following query to detect duplicate commands or identical schedules:

```sql
SELECT command, schedule, count(*), array_agg(jobname) as duplicate_jobs
FROM cron.job
GROUP BY command, schedule
HAVING count(*) > 1;
```

- [ ] Query returns zero rows (no duplicates).

### Step 2 — Apply the Fix (Unschedule Redundant Job)

If duplicates are detected, unschedule the redundant entry and retain the canonical job:

```sql
SELECT cron.unschedule('agent-trade-manage-positions');
```

---

## ⚠️ 1I. SQL Diagnostics — Nested Aggregate Syntax Error (PostgreSQL 42803)

> [!WARNING]
> **Incident (2026-08-27):** Running the unified health audit script `scripts/full_health_audit.sql` threw `ERROR: 42803: aggregate function calls cannot be nested` because `array_agg(jobname)` was nested inside `jsonb_agg(...)` within the same `GROUP BY` SELECT clause.

### Step 1 — Verify Diagnostic Query Pattern

When aggregating grouped rows into a JSON array in Postgres, always use a derived subquery rather than nesting aggregates:

- ❌ **BROKEN (PostgreSQL Error 42803):**
```sql
SELECT COALESCE(jsonb_agg(jsonb_build_object(
  'duplicate_jobs', array_agg(jobname),
  'schedule', schedule,
  'count', count(*)
)), '[]'::jsonb)
FROM cron.job
GROUP BY command, schedule
HAVING count(*) > 1;
```

- ✅ **CORRECT (Derived Subquery Table):**
```sql
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
) sub;
```

---

## 2. Autonomous Agent Activity
Verify that the AI agents are actively evaluating the market and producing expected heartbeat logs.

**Health Checklist (Schedule Verification):**
Scan through the system and ensure everything is working as expected below:
- [ ] Agent News wakes up every hour, scans the news and attempts to generate S- and A- Tier trades based on news and fundamental analysis.
- [ ] Agent Swing wakes up every 4 hours, scans the market and attempts to generate S- and A- Tier swing trades.
- [ ] Agent Day wakes up every 30 minutes, evaluates the market based on Pivot Regimes and MACD, and generates S- and A- Tier intraday trades.
- [ ] VPS Bridge (`vps-poll`) is actively receiving heartbeat pings from the MT5 EA every 15 seconds without throwing 401 Unauthorized or 1003 timeouts.

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

- [ ] **Event-Driven Signal Chain (Orphaned PUBLISHED):** Since `agent-news` instantly webhooks `agent-swing`, signals should transition from `PUBLISHED` to `APPROVED` or `REJECTED` within seconds. Check for signals stuck in `PUBLISHED` for more than 5 minutes. If found, it indicates one of three things: (1) the `pingAgentSwing` webhook from `agent-news` failed, (2) `agent-swing` crashed during execution, or (3) `agent-swing` encountered a logic gap where it evaluated the trade as `NONE` but failed to correctly update the original `PUBLISHED` row to `REJECTED`.

```sql
SELECT id, symbol, side, status, created_at
FROM trade_opportunities
WHERE status = 'PUBLISHED'
  AND created_at < NOW() - INTERVAL '5 minutes';
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

- [ ] **Global Abort & Isolation Locks:** Verify that emergency circuit breakers (`KILL_SWITCH_TRIGGERED`) haven't triggered an unintended global system pause. Query `system_settings` (`auto_trading_enabled`) and `audit_log` to ensure no permanent isolation locks have been placed on key assets like `XAUUSD` or `BTCUSD` unless macro events dictate so.

### 🧠 Agent Cognitive Engine & Structural Guardrails
- [ ] **News-Augmented Signal Confidence:** Verify the handoff pipeline between `agent-news` and `agent-swing`. Check `trade_opportunities` generated by `agent-swing` for fundamental catalyst boosts; look for `pendingNewsId` or news sentiment references in the `ai_summary`.
- [ ] **Multi-Timeframe Confluence Filter:** Confirm that `agent-swing` is actively pulling and analyzing 4H and Weekly macro trends to validate 30m entries before approving any S-Tier signals.
- [ ] **Structural Guardrails (OB/FVG/Sweeps):** Review recent S-Tier `trade_opportunities` to ensure that Fibonacci executions are explicitly paired with Order Blocks, Fair Value Gaps, or Liquidity Sweeps.
- [ ] **Adaptive ATR Compression:** Monitor `market_context` to verify that ATR expansion and contraction bounds are actively adjusting based on whether the market is assessed as being in `CHOP` or `TRENDING` conditions.

---

## ⚠️ 3A. Trade Execution — Status Mismatch (Orphaned PENDING)

> [!WARNING]
> **Incident (2026-08-04):** Trades were successfully inserted by `agent-trade` but never picked up by the MT5 VPS EA because they were inserted with `status = 'PENDING'`, but the EA was explicitly polling for `status = 'VPS_PENDING'`.

Check for orphaned signals that are stuck in the database and being ignored by the Execution EA:

```sql
SELECT id, symbol, status, created_at 
FROM user_trades 
WHERE status = 'PENDING' 
  AND created_at < NOW() - INTERVAL '1 hour';
```

If this query returns rows, investigate a routing failure or a hardcoded status mismatch between the edge function inserts and the `vps-poll` fetch logic.

---

## ⚠️ 3B. Trade Execution — MT5 Execution Errors (10014, 10015, 10016, 10019)

> [!WARNING]
> **Incident (2026-08-04, 2026-08-10, 2026-08-24, 2026-08-25):** 
> - The strategy logic split the minimum lot size (0.01) into two legs (0.005 lots each) and also incorrectly sent `0.01` lots for indices like `US30` which actually require a minimum of `0.1` lots on some brokers. MetaTrader 5 strictly enforces minimum lot sizes and increments, and instantly rejected the trades with `TRADE_RETCODE_INVALID_VOLUME` (Code 10014).
> - On 2026-08-24, an S-Tier `BUY STOP` order on `BTCUSD` was rejected with `TRADE_RETCODE_INVALID_PRICE` (Code 10015) because live market price had already moved past the breakout entry level before order placement.
> - On 2026-08-25, an A-Tier EURUSD LONG trade's companion RUNNER leg was rejected with `TRADE_RETCODE_INVALID_STOPS` (Code 10016) because `tp3` was set to `1.13` (below the entry price of `1.16` on a BUY order). The primary SWING leg succeeded using `tp2 = 1.17`, but the RUNNER leg failed.

Monitor for execution blocks on the broker side:

```sql
SELECT id, symbol, volume, error_message, created_at 
FROM user_trades 
WHERE status = 'FAILED' 
ORDER BY created_at DESC;
```

If this query returns rows, investigate the error code:
- **Code 10014 (Invalid Volume):** Ensure that the volume algorithms in `agent-trade` and `agent-news` enforce a strict mathematical floor against a dynamic `volumeStep` mapping (e.g. `US30 = 0.1`, `BTCUSD = 0.01`), rather than hardcoding `0.01` universally.
- **Code 10015 (Invalid Price / Stale Breakout Entry):** A pending stop/limit order (e.g., `BUY STOP` or `SELL STOP`) had an entry price that was invalid relative to current market Ask/Bid (e.g., placing a BUY STOP below or at the current Ask price because price already broke out before the order was submitted). **Diagnostic Action:** When this occurs, ensure the parent `trade_opportunities` status is updated to `REJECTED` rather than remaining stuck in `APPROVED`, and check that `agent-trade` validates live price against order type prior to placing pending orders.
- **Code 10016 (Invalid Stops / Wrong TP Direction on Multi-Leg Trades):** The Stop Loss or Take Profit was placed too close to the entry price or on the wrong side (e.g., placing a TP below the entry on a LONG trade, or an inverted `tp3` on a RUNNER leg). **Diagnostic Action:**
  1. Verify the **3-Layer TP Direction Validation**: Ensure `agent-swing`, `agent-trade` (Execution Guard 1), and `vps-poll` validate that for LONG trades, all TP targets (`tp`, `tp1`, `tp2`, `tp3`) satisfy `tp > entry`, and for SHORT trades `tp < entry`. If inverted, fallback to standard R-multiples ($1\text{R}, 2\text{R}, 3\text{R}$).
  2. If this error occurs for a specific symbol (e.g., `NZDUSD`), check `agent-trade`'s `minDistances` configuration. If the symbol is missing from the dictionary, the AI's ultra-tight stops bypass the widening guard and are instantly rejected by the broker.
- **Code 10019 (No Money):** The user's account had insufficient free margin to open the required volume. This is working as intended to protect against margin calls if the account is overleveraged.

---

## ⚠️ 3C. Trade Execution — MT5 EA & VPS Health Diagnostics

> [!WARNING]
> The MT5 Expert Advisor (EA) running on the local Windows VPS is strictly responsible for opening new positions with zero-latency. If the EA dies, trades will queue up indefinitely.

Check these three metrics to ensure the VPS is actively connected and executing:

### Step 1 — Check VPS Heartbeat
The EA pings `vps-poll` every 15 seconds. Ensure the heartbeat is fresh:
```sql
SELECT user_id, vps_last_heartbeat, 
       ROUND(EXTRACT(EPOCH FROM (NOW() - vps_last_heartbeat)) / 60, 1) as minutes_since_last_ping
FROM user_risk_settings
WHERE vps_last_heartbeat IS NOT NULL;
```
- ❌ **FAILED:** If `minutes_since_last_ping` > 1.0, the EA has crashed or the VPS lost internet.

### Step 2 — Check VPS Data Streaming
The EA streams closed 30m candles to `vps-market-feed` to update the AI context:
```sql
SELECT symbol, timeframe, MAX(ts) as last_candle_pushed
FROM market_data_pti
GROUP BY symbol, timeframe
ORDER BY last_candle_pushed DESC
LIMIT 10;
```
- ❌ **FAILED:** If `last_candle_pushed` is older than ~35 minutes for **actively traded symbols** (like `XAUUSD`, `BTCUSD`, `US30`, `UKOIL`), the EA chart is frozen or the data stream is broken.
- *Note: You may see older timestamps for symbols like `EURUSD` or `SPY`. This is completely normal if the agent responsible for trading them (e.g., `agent-scalper`) has been archived or deprecated.*

### Step 3 — Check Execution Queue Bottleneck
When `agent-trade` generates a signal, it creates a `VPS_PENDING` trade. The EA should instantly pick this up.
```sql
SELECT id, symbol, status, created_at,
       ROUND(EXTRACT(EPOCH FROM (NOW() - created_at)) / 60, 1) as minutes_stuck
FROM user_trades
WHERE status = 'VPS_PENDING'
ORDER BY created_at ASC;
```
- ❌ **FAILED:** If any trade has `minutes_stuck` > 1.0, the EA is failing to execute trades (e.g. MetaTrader disconnected from broker or Auto-Trading is turned off).

---

---

## ⚠️ 3D. Trade Execution — Stale Data Execution Bypass (The 26-Hour Freeze)

> [!CAUTION]
> **Incident (2026-08-19):** The MT5 VPS EA froze but continued sending heartbeat pings. The central database recorded a `vps_last_heartbeat` within 60 seconds, but `market_data_pti` was stuck on a 26-hour-old candle. Because `fetchPaperBars` had a relaxed 7-day weekend cache validity, the AI swallowed the 26-hour-old data as "live", failed to find any valid structural setups, and silently aborted trading operations.

If the system has gone unusually quiet, verify that the AI is not being poisoned by a stale VPS data feed:

### Step 1 — Verify Cache Freshness vs Heartbeat
Run this query to ensure the data stream matches the heartbeat:

```sql
SELECT 
  (SELECT vps_last_heartbeat FROM user_risk_settings LIMIT 1) as heartbeat,
  symbol,
  MAX(ts) as last_candle_pushed,
  ROUND(EXTRACT(EPOCH FROM (NOW() - MAX(ts))) / 3600, 1) as hours_stale
FROM market_data_pti
GROUP BY symbol
ORDER BY hours_stale DESC
LIMIT 10;
```

- ❌ **FAILED:** If the heartbeat is fresh (within minutes) but `hours_stale` is > 4.0 during weekdays, the EA is frozen (or the broker connection is lost) but still pinging. The Edge Function `fetchPaperBars` will automatically reject this and fall back to MetaAPI, but you **must immediately restart the MT5 EA on the VPS** to restore primary zero-latency execution.

### Step 2 — Verify vps-market-feed Upsert Integrity
If you have just restarted the EA and see a barrage of `HTTP 500` errors in the MT5 Journal ("Failed to push data... duplicate key value violates unique constraint"), this indicates the backend is incorrectly using `.insert()` instead of `.upsert()` for live tick fluctuations on the same timestamp. Ensure `vps-market-feed` is enforcing `ON CONFLICT (symbol, timeframe, ts)` to safely overwrite live unclosed candles.

---

## 3. Trade Execution & PAMM Routing
Verify that approved signals are actually materializing into user trades and correctly interfacing with brokers.

- [ ] **PAMM Execution Router (`agent-trade`):** Match the latest `APPROVED` signals in `trade_opportunities` with records in `user_trades`. Ensure `volume` and `risk_amount` are non-zero.

> [!NOTE]
> **Execution Guardrails Standard:** Any logic within `agent-trade` that returns early to block a trade (such as the Asian Session Kill Zone, Tier Filters, or Drawdown Breakers) **must** actively execute a `supabase.from('trade_opportunities').update({ status: 'REJECTED' })`. Signals should never be left hanging in the `APPROVED` state.

- [ ] **Database Trigger Chain (Orphaned APPROVED):** The `on_signal_execute` PostgreSQL trigger instantly webhooks `agent-trade` the millisecond a signal is marked `APPROVED`. If signals are stuck in `APPROVED` for more than 5 minutes without a corresponding `user_trade`, the database trigger has failed, or the `agent-trade` Edge Function crashed.

```sql
-- Approved signals that have no corresponding user_trade (potential execution gap)
SELECT t.id, t.symbol, t.side, t.status, t.created_at
FROM trade_opportunities t
LEFT JOIN user_trades u ON u.opportunity_id = t.id
WHERE t.status = 'APPROVED'
  AND u.id IS NULL
ORDER BY t.created_at DESC;
```

- [ ] **Signal 20-Period Anticipation Horizon (TTL Monitor):**
  - **30m Intraday Signals (`agent-day`):** Expire after **10 hours (20 bars)** if unexecuted.
  - **1D Swing Signals (`agent-swing`):** Expire after **20 trading days (480 hours)** if unexecuted.
  - Check for signals approaching expiry that have not executed:

```sql
SELECT symbol, side, timeframe, entry_plan_json->>'order_type' AS order_type, created_at,
       ROUND(EXTRACT(EPOCH FROM (NOW() - created_at)) / 3600, 1) AS hours_open,
       CASE 
         WHEN timeframe = '30m' AND EXTRACT(EPOCH FROM (NOW() - created_at)) > 36000 THEN 'EXPIRED_10H_HORIZON'
         WHEN timeframe = '1d' AND EXTRACT(EPOCH FROM (NOW() - created_at)) > 1728000 THEN 'EXPIRED_20D_HORIZON'
         ELSE 'ACTIVE'
       END AS horizon_status
FROM trade_opportunities
WHERE status IN ('APPROVED', 'ACTIVE')
ORDER BY created_at ASC;
```

Any 30m signal with `hours_open > 10` is automatically expired by the 20-period anticipation horizon engine.

- [ ] **Bar-Close Stop Loss & Invalidation Rule:**
  - Invalidation is governed strictly at the confirmed **CLOSE of a candle** (30m for intraday, 1D for swing).
  - Intra-bar wicks are permitted to breathe unless the Catastrophic Emergency Stop ($2.0\times$ ATR behind the Pivot) is breached.
  - Verify that `agent-day` and `agent-swing` revalidation routines evaluate `currentClose <= stopLoss` for Longs and `currentClose >= stopLoss` for Shorts on completed candles.

- [ ] **Master Broker Gateway (MetaAPI):** Check `meta_api_order_id` in `user_trades`. Confirm that orders are correctly syncing with MetaTrader and not returning structural errors (e.g., `SYMBOL_NOT_FOUND` or `INSUFFICIENT_MARGIN`).
- [ ] **Drawdown Breaker & House Money (PHM):** 
  - Check `user_risk_settings`. Ensure no critical master/PAMM accounts have their `high_water_mark_equity` threshold breached by more than their `max_drawdown_pct`.
  - Check `system_settings` for `phm_settings`. Confirm if the master account is currently playing with **House Money**. If active, verify that the escalated risk (e.g. 15%) is correctly overriding standard risk, and that the Drawdown Breaker correctly locks to the PHM Floor to ensure a safe soft-landing if a loss streak occurs.
- [ ] **10% Account Blowout Protection & Contract Multipliers:** Verify if trades are being rejected due to the 10% hard risk cap ($150 on $1,500 base capital). For high-multiplier assets like `XAGUSD` (5000) and `UKOIL` (1000), `agent-day` and `agent-swing` dynamically anchor limit entries to structural discounts so 0.01 lot dollar risk stays strictly below $150.
- [ ] **Trailing Stop Ladder & 20-Bar Stagnation Decay:** Verify `position-manager-poll` (`agent-trade` with `action: "MANAGE_POSITIONS"`) is executing every 30 minutes. Profitable trades should log `BREAK_EVEN` (+0.5R), `LOCK_IN_HALF_R` (+1.0R), `LOCK_IN_1R` (+2.0R), `LOCK_IN_2R` (+3.0R), or `TRAIL_RUNNER`. Positions active for $> 20$ bars in profit with $< +0.5\text{R}$ progress are automatically moved to Breakeven via `20_BAR_THESIS_DECAY_BE`.
- [ ] **Pending Order Garbage Collection:** Verify `position-manager-poll` cancels stale pending limit/stop orders older than their 20-bar horizon (10h intraday / 20 days swing) and purges orphaned broker orders.

---

## ⚠️ 3G. Stale ACTIVE Signals & Broker Pending Order Reconciliations

> [!CAUTION]
> **Incident (2026-08-24):** 12 stale broker limit/stop orders from previous trading sessions (Aug 19–21) remained open on MetaTrader because their corresponding database records were closed or not tracked in the active `user_trades` set. Concurrently, older trade opportunities in `trade_opportunities` remained in `ACTIVE` state without being expired or reconciled with completed trades.

### Step 1 — Check for Stale ACTIVE Signals (> 24h) Without Open Positions
Signals that were generated more than 24 hours ago and never resolved or expired must be marked `EXPIRED` **only if there are no active OPEN trades running on the broker**:

```sql
SELECT t.id, t.symbol, t.side, t.timeframe, t.status, t.created_at,
       ROUND(EXTRACT(EPOCH FROM (NOW() - t.created_at)) / 3600, 1) as hours_active
FROM trade_opportunities t
WHERE t.status = 'ACTIVE'
  AND t.created_at < NOW() - INTERVAL '24 hours'
  AND NOT EXISTS (
    SELECT 1 FROM user_trades u
    WHERE u.opportunity_id = t.id AND u.status = 'OPEN'
  )
ORDER BY t.created_at ASC;
```

If rows are returned (and confirmed to have no open positions), run:
```sql
UPDATE trade_opportunities t
SET status = 'EXPIRED'
WHERE t.status = 'ACTIVE'
  AND t.created_at < NOW() - INTERVAL '24 hours'
  AND NOT EXISTS (
    SELECT 1 FROM user_trades u
    WHERE u.opportunity_id = t.id AND u.status = 'OPEN'
  );
```

### Step 1b — Reconcile Opportunities whose Trades Have Completed
If all `user_trades` for an opportunity have closed (e.g. `WON`, `LOST`, `CLOSED`), the parent `trade_opportunities` row must be reconciled to reflect `WON`, `LOST`, or `EXPIRED` (per the `trade_opportunities_status_check` constraint):

```sql
-- Reconcile WON opportunities (positive net profit)
UPDATE trade_opportunities t
SET status = 'WON',
    r_multiple = 2.0,
    closed_at = NOW()
WHERE t.status IN ('ACTIVE', 'APPROVED')
  AND EXISTS (
    SELECT 1 FROM user_trades u
    WHERE u.opportunity_id = t.id AND u.status = 'WON'
  )
  AND NOT EXISTS (
    SELECT 1 FROM user_trades u
    WHERE u.opportunity_id = t.id AND u.status IN ('OPEN', 'PENDING', 'VPS_PENDING', 'VPS_PROCESSING')
  );

-- Reconcile LOST opportunities (negative net profit)
UPDATE trade_opportunities t
SET status = 'LOST',
    r_multiple = -1.0,
    closed_at = NOW()
WHERE t.status IN ('ACTIVE', 'APPROVED')
  AND EXISTS (
    SELECT 1 FROM user_trades u
    WHERE u.opportunity_id = t.id AND u.status = 'LOST'
  )
  AND NOT EXISTS (
    SELECT 1 FROM user_trades u
    WHERE u.opportunity_id = t.id AND u.status IN ('OPEN', 'PENDING', 'VPS_PENDING', 'VPS_PROCESSING')
  );

-- Reconcile Cancelled / Missed Entry opportunities (no filled trades)
UPDATE trade_opportunities t
SET status = 'EXPIRED',
    r_multiple = 0,
    closed_at = NOW()
WHERE t.status IN ('ACTIVE', 'APPROVED')
  AND EXISTS (
    SELECT 1 FROM user_trades u
    WHERE u.opportunity_id = t.id AND u.status = 'CLOSED'
  )
  AND NOT EXISTS (
    SELECT 1 FROM user_trades u
    WHERE u.opportunity_id = t.id AND u.status IN ('OPEN', 'PENDING', 'VPS_PENDING', 'VPS_PROCESSING', 'WON', 'LOST')
  );
```

### Step 1c — Reconcile Desynced Closed Trades (status = 'OPEN' with Profit)
If a trade was closed and had `profit_usd` calculated by Position Manager or Exness history sync, but its `status` is desynced as `'OPEN'`, run the following reconciliation:

```sql
-- 1. Identify desynced closed trades
SELECT id, symbol, side, status, profit_usd, close_price, closed_at
FROM user_trades
WHERE status = 'OPEN' AND profit_usd IS NOT NULL;

-- 2. Update status to reflect real outcome (WON / LOST)
UPDATE user_trades
SET status = CASE WHEN profit_usd > 0 THEN 'WON' ELSE 'LOST' END
WHERE status = 'OPEN' AND profit_usd IS NOT NULL;
```

> [!NOTE]
> **Ledger Idempotency Guard:** The `allocate_virtual_pnl()` database trigger verifies whether a ledger transaction with `reference_code = 'TRADE-' || NEW.id` already exists in `ledger_transactions`. If already posted, it skips re-allocation to prevent duplicate wallet balance adjustments and avoid `23505 duplicate key value` constraint violations.

### Step 2 — Reconcile Broker Pending Orders vs user_trades
Cross-reference live pending orders from the broker against open trades in `user_trades`:
- Any broker pending order older than 24 hours whose limit price was never reached must be cancelled via `ORDER_CANCEL`.
- Any broker pending order whose `user_trades` status is already `CLOSED` must be cancelled immediately.
- The `agent-trade` Position Manager (`position-manager-poll`) performs this cleanup autonomously every 30 minutes. Verify the function is deployed and running.

---

- [ ] **AI-Driven Invalidation (Trend Reversals):** Verify that the Position Manager is actively closing positions or cancelling pending orders if an opposing S/A-Tier setup or a C-Tier momentum shift is detected. Check `user_trades` for `error_message` containing `Closed by Position Manager: AI Trend Reversal`.
- [ ] **EOD Scalp Liquidation:** Ensure that all active `30m` timeframe Scalp trades are forcefully liquidated by the Position Manager at exactly 16:00 (4 PM NY time). Check for `error_message` containing `EOD Liquidation`.
- [ ] **Dynamic Correlation Limits:** Review the `ai_risks` field in `trade_opportunities` for `Rejected due to correlation contradiction` or `0.5x Risk Modifier Applied: Heavy Correlation Detected`. Ensure the PAMM router is actively blocking trades that oppose highly correlated existing open positions.
- [ ] **Dynamic ATR Stop Loss Floor:** Check the edge function logs for `agent-trade` for `Widen Stop Loss: Risk... Adjusted to...` to confirm ultra-tight AI-generated stops are being safely widened to at least `1.0x ATR`.
- [ ] **Take Profit Direction Validation:** Check the edge function logs for `agent-trade` for `TP direction mismatch... Corrected to`. Ensure this circuit breaker catches TPs placed on the wrong side of the entry price.
- [ ] **Database & Broker Reconciliation (Ghost Trades & Syncing):** Ensure that `exness-history-sync-poll` is successfully running every 15 minutes. Query `user_trades` for `status = 'OPEN'` and cross-reference with MetaAPI. If a trade is closed on the broker but stuck as `OPEN` in the database, the sync engine is failing, preventing `portfolio_capital` from updating with the realized profit/loss.

---

## ⚠️ 3E. Trade Execution — Premature Approval Race Condition (Missing user_trades)

> [!CAUTION]
> **Incident (2026-08-24):** An S-Tier `BTCUSD` signal generated via fundamental news confluence was marked `APPROVED` in `trade_opportunities`, but no corresponding `user_trades` were ever created. `agent-swing` had prematurely executed `update({ status: 'APPROVED' })` upon finding sentiment alignment, prior to calculating entry/SL/TP levels. When the full setup was saved later, `agent-trade`'s duplicate protection filter (`old_record.status === 'APPROVED'`) silently discarded the final trade plan.

### Step 1 — Check for Orphaned Approved Signals
Run this query to detect approved opportunities missing execution:

```sql
SELECT t.id, t.symbol, t.side, t.status, t.confidence, t.created_at
FROM trade_opportunities t
LEFT JOIN user_trades u ON u.opportunity_id = t.id
WHERE t.status = 'APPROVED'
  AND u.id IS NULL
ORDER BY t.created_at DESC;
```

- ❌ **FAILED:** If any opportunity has been in `APPROVED` for > 5 minutes without a matching `user_trades` entry, investigate a premature `APPROVED` status transition in the generating agent. Agents must maintain `status = 'PUBLISHED'` during evaluation and execute a single atomic transition to `APPROVED` only when the complete trade plan is constructed.

---

## ⚠️ 3H. Stale Unfilled Pending Orders (> 48h) & VPS History Reconciliation

> [!CAUTION]
> **Incident (2026-08-27):** A pending limit/stop order (`db36b400-2c85-4ad4-997b-e27f3962241c` on `XAUUSD`) was submitted but never filled. Because `open_price` remained `NULL` and `isVpsAlive` was true, the Position Manager's reverse-sync bypassed MetaAPI position 404 checks and created mock positions, keeping the unfilled trade lingering in `status = 'OPEN'` for > 74 hours. Additionally, `vps-history` referenced deprecated schema column names (`realized_pnl`, `close_reason`) instead of the canonical `profit_usd` and `error_message`.

### Step 1 — Check for Stale Unfilled Pending Orders (> 48h)

Run this query to find any unfilled orders that never triggered:

```sql
SELECT u.id, u.opportunity_id, u.symbol, u.side, u.status, u.open_price, u.meta_api_order_id, u.created_at,
       ROUND(EXTRACT(EPOCH FROM (NOW() - u.created_at)) / 3600, 1) AS hours_old
FROM user_trades u
WHERE u.status IN ('OPEN', 'PENDING', 'VPS_PENDING')
  AND u.open_price IS NULL
  AND u.created_at < NOW() - INTERVAL '48 hours'
ORDER BY u.created_at ASC;
```

### Step 2 — Reconcile Stale Unfilled Orders & Expire Parent Opportunities

```sql
-- 1. Close the stale unfilled trade
UPDATE user_trades
SET status = 'CLOSED',
    error_message = 'Order cancelled (Stale unfilled pending order > 48h)',
    closed_at = NOW()
WHERE status IN ('OPEN', 'PENDING', 'VPS_PENDING')
  AND open_price IS NULL
  AND created_at < NOW() - INTERVAL '48 hours';

-- 2. Expire parent trade opportunities that have no remaining open trades
UPDATE trade_opportunities t
SET status = 'EXPIRED',
    r_multiple = 0,
    closed_at = NOW()
WHERE t.status IN ('ACTIVE', 'APPROVED')
  AND NOT EXISTS (
    SELECT 1 FROM user_trades u
    WHERE u.opportunity_id = t.id AND u.status IN ('OPEN', 'PENDING', 'VPS_PENDING', 'VPS_PROCESSING')
  );
```

### Step 3 — VPS History Callback Schema Standard

The `/functions/v1/vps-history` Edge Function endpoint receives deal closure notifications directly from `RaineInvestEA.mq5`. Ensure payloads update:
- `user_trades.profit_usd` (numeric profit in USD, calculated from volume ratio)
- `user_trades.close_price` and `user_trades.closed_at`
- `user_trades.status = 'WON'` (if profit > 0) or `'LOST'`
- `user_risk_settings.portfolio_capital` (incremented by profit/loss) and `high_water_mark_equity`
- `trade_opportunities` parent status reconciliation (WON / LOST / CLOSED)

---

## 4. External Integrations
Verify that external data pipelines and notification systems are alive.

- [ ] **News API Data Feed:** Ensure `agent-news` is successfully fetching and parsing Tavily news articles. (Check Edge Function logs for `agent-news` to ensure no `401 Unauthorized` or timeout errors).
- [ ] **Market Data Feed:** Confirm `agent-swing` is successfully retrieving real-time candle data for evaluation.

### 4A. Telegram Webhook Diagnostics
The `telegram-broadcast` edge function is triggered automatically via a Postgres Trigger (`on_signal_generated`) whenever a new `trade_opportunities` row is inserted. It also triggers on `user_trades` updates for rejected executions.

- [ ] **Verify Edge Function Logs:** In the Supabase Dashboard -> Edge Functions, select `telegram-broadcast` and verify there are no `500 Internal Server Error` or `401 Unauthorized` logs.
- [ ] **Verify Webhook Secret Sync:** If the `telegram-broadcast` logs show a fast `401 Unauthorized` error when the database attempts to trigger it, the `WEBHOOK_SECRET` environment variable in the Edge Functions is out of sync with the database vault. Run `supabase secrets set WEBHOOK_SECRET=<decrypted_secret> --project-ref ktezlusdkqlfdwqrldtn` (fetching the secret from `vault.decrypted_secrets WHERE name = 'webhook_secret'`) to restore the pipeline.
- [ ] **Verify Bot Token:** Ensure `TELEGRAM_BOT_TOKEN` is correctly set in the Edge Function secrets. A missing or invalid token will result in HTTP 401 errors from the Telegram API within the edge function logs.
- [ ] **Test Delivery:** To safely verify delivery without broadcasting a fake signal to all users, you can manually invoke the edge function via the Supabase CLI or HTTP POST using a mock payload that mimics a `REJECTED` user trade for a specific test user's `user_id`.


## 5. API Quotas & External Dependency Balances
Sudden failures across agents or broker executions are almost always tied to hard limits on third-party API accounts running out of prepaid credits. Do not wait for `429 Too Many Requests` errors; proactively check these balances daily.

- [ ] **OpenAI Balance (`agent-swing`, `agent-news`):** 
  - Log into the [OpenAI Billing Dashboard](https://platform.openai.com/account/billing).
  - Verify that the prepaid credit balance is > $50.
  - Verify that auto-recharge is active and the attached credit card has not expired.
- [ ] **MetaAPI Quota & Billing (`agent-trade`, `position-manager`):** 
  - Log into the [MetaAPI Portal](https://app.metaapi.cloud/billing).
  - Check the active subscription tier and ensure you have not exceeded your monthly MT5 execution quota or request concurrency limits.
  - **Rate Limit Check:** Ensure historical data concurrency does not exceed 5 requests. If you see `429 TooManyRequestsError` in `agent-swing`, verify that the symbol loop is executing sequentially.
  - Ensure the billing method is up to date to prevent sudden API suspension.
- [ ] **Tavily Search Credits (`agent-news`):** 
  - Log into the [Tavily Developer Dashboard](https://app.tavily.com/home).
  - Check the remaining API calls for the current billing cycle. Ensure there is enough headroom to survive a high-volatility news day where `agent-news` may poll more frequently.
- [ ] **VPS & MT5 Health (`vps-poll`):** 
  - The `vps-poll` Edge Function should log a 200 OK ping every 15 seconds. If `vps-poll` logs suddenly stop or show `5xx` errors, the Windows VPS hosting the MetaTrader 5 EA has either lost internet connectivity, restarted, or the EA was detached from the chart. Log into the VPS remotely via RDP to ensure MT5 is running with Auto Trading enabled.

## 6. Trade Resolution & AI Post-Mortems (`resolve-outcomes`)
The system features an autonomous trade simulator that monitors active trades against live price action. When a trade hits its Stop Loss, it triggers an AI Post-Mortem.
- [ ] **Outcome Grading:** Query `trade_opportunities` to ensure signals are correctly transitioning from `APPROVED` to `WON` or `LOST`.
- [ ] **AI Post-Mortems:** Verify the `resolve-outcomes` edge function is firing correctly (no 5xx errors) and generating Post-Mortem text inside `ai_summary` for lost trades.

---

## ⚠️ 6A. Trade Resolution Diagnostic — 0% Win Rate (Take Profit Omission)

> [!CAUTION]
> **Incident (2026-08-18):** `agent-swing` and `agent-day` generated a mathematical 0% Win Rate because the live active sweep loops were strictly checking if the live price hit the Stop Loss, but completely omitted the logic to check if the Take Profit was hit. Winners sat in `APPROVED` purgatory until they either expired or retraced to hit Stop Loss. 

### Step 1 — Check for 0% Win Rate Anomaly
If the `WIN RATE (30D)` on the Vault Dashboard falls to exactly 0% with a deep negative Net R-multiple, run this query to check if there are aged trades stuck in `APPROVED` that should have been marked `WON`:

```sql
SELECT symbol, side, status, created_at
FROM trade_opportunities
WHERE status = 'APPROVED'
  AND created_at < NOW() - INTERVAL '1 hour';
```

### Step 2 — Verify Active Sweep Take Profit Logic
Check the edge function logs for `agent-swing` and `agent-day` and look for the keyword `[Validation] WON`. 
If you only see `[Validation] LOST` and never `WON`, the Take Profit sweep logic may have been reverted or omitted. Ensure the live loop always contains the validation checks for both `stopLoss` and `takeProfit`.

## 7. Treasury Management & Solvency (`agent-treasury`)
The system calculates the aggregate Solvency Ratio (Assets / Liability) and syncs master account balances with Exness.

- [ ] **Treasury Accounts & Balance Verification:** Ensure `treasury_accounts` contains active broker (`account_type = 'BROKER'`) and bank (`account_type = 'BANK'`) balances so `get_total_assets` calculates assets correctly.
- [ ] **Snapshot Generation:** Verify the `treasury_snapshots` table is generating rows correctly:
```sql
SELECT id, snapshot_timestamp, total_customer_liability, total_assets, solvency_ratio, notes
FROM treasury_snapshots
ORDER BY snapshot_timestamp DESC
LIMIT 5;
```
- [ ] **Solvency Safety & Execution Flag:** Ensure the `solvency_ratio` in `treasury_snapshots` and `system_settings` (`treasury_status`) remains ≥ 1.0. A ratio below 1.0 triggers an autonomous `Treasury Insolvency Lockout` inside `agent-trade`.
```sql
SELECT key, value
FROM system_settings
WHERE key = 'treasury_status';
```
- [ ] **Autonomous De-Leveraging (Emergency Trimming):** If Treasury Solvency falls below 1.0, verify the Position Manager is actively intervening to protect capital. Check the edge function logs for `agent-trade` for `DE-LEVERAGING: Moving SL to Breakeven` or `DE-LEVERAGING: Partially closing 50%`.
- [ ] **Exness Balance & Solvency Sync:** Check the edge function logs for `agent-treasury` to ensure it is authenticating properly, updating broker balances (`action = 'SYNC_BALANCE'`), and calculating solvency snapshots (`action = 'SNAPSHOT'`).

## 8. Subscription Billing & Email Communications Desk (`paystack-webhook`, `email-campaigns`)
The backend manages recurring billing and automated lifecycle campaigns.
- [ ] **Billing Webhooks & Recurring Charges:** Check Edge Function logs for `paystack-webhook` and `process-recurring-billing`. Ensure there are no authentication or timeout errors preventing active subscriptions.
- [ ] **Email Delivery & Lifecycle Campaigns:** Verify `email-campaigns` is executing Day 0 onboarding webhooks on `auth.users` insert and Day 3/Day 7 drip campaigns via Resend without errors.

## 9. Autonomous SRE Agent (`agent-sre`) & Self-Healing Watchdog

The `agent-sre` edge function runs automatically every hour at `:15` via `agent-sre-poll`. It serves as the primary autonomous guardian of system reliability.

### 8-Point Diagnostic Probes
1. **`pg_cron` Health**: Executes `check_cron_failures()` RPC to detect any failed background jobs.
2. **Network & HTTP Integrity**: Scans `net._http_response` for 4xx/5xx responses or DNS errors in the last hour.
3. **Agent Crash Detection**: Queries `audit_log` for `action = 'AGENT_CRASH'` entries.
4. **Signal & Trade Pipeline Integrity**: Scans for orphaned `PUBLISHED`, orphaned `APPROVED`, and desynced trades.
5. **Broker Execution Errors**: Scans `user_trades` for recent `status = 'FAILED'` records (MT5 error codes 10014, 10015, 10016, 10019) in the last hour.
6. **MT5 VPS Bridge Connectivity**: Verifies `user_risk_settings.vps_last_heartbeat` latency (< 3 mins).
7. **Market Data Freshness**: Validates `market_data_pti` candle flow for active symbols (< 2.0h latency during open sessions).
8. **Treasury Solvency**: Verifies `system_settings.treasury_status` solvency ratio ≥ 1.0.

### Autonomous Self-Healing Actions
When non-critical desyncs are detected, `agent-sre` auto-remediates without human intervention:
- **Desynced Closed Trades**: If a trade is marked `OPEN` but has a computed `profit_usd`, transitions to `WON` or `LOST`.
- **Stale Unfilled Pending Orders**: If an order has `open_price IS NULL` and is > 48h old, cancels it to `CLOSED` and marks the parent opportunity `EXPIRED`.
- **Completed Opportunities**: If a parent opportunity remains `ACTIVE`/`APPROVED` but has 0 remaining open trades, reconciles it to `WON` (if total net PnL > 0), `LOST` (if total net PnL < 0), or `EXPIRED` (if 0 trades / 0 profit).
- **Audit Logging & Incident Alerts**: Inserts `SRE_AUTO_REMEDIATION` and `SRE_HEARTBEAT` / `SRE_HEALTH_ALERT` into `audit_log`, and sends an HTML Telegram alert to administrators only when anomalies or active remediations occur.

---

> [!CAUTION]
> If any critical execution pipelines (such as missing `user_trades` for `APPROVED` signals) or external broker integrations are failing, escalate to the Engineering Team immediately and consider temporarily disabling `isAutoTradingEnabled` in global settings to prevent orphaned signals.

> [!TIP]
> Use the internal logging tables (`audit_log`) and Edge Function execution logs to rapidly pinpoint which layer of the system (Pre-AI, Cognitive AI, or Execution Desk) is responsible for abnormal rejections.

> [!NOTE]
> **Post-Event Consolidation (Normal Behaviour):** After a major central bank event (e.g., FOMC, ECB rate decision), it is normal for all signals on Gold, Silver, Oil, and Crypto to show `INFLECTION_POINT_WAIT` rejections for 2–6 hours while the market finds direction. This is the system working correctly. Do not override unless a clear breakout or sweep pattern has formed on the 1H or 4H chart.


