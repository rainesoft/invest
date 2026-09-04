---
name: system-health-check
description: Run comprehensive system diagnostics to verify the health of the autonomous trading agents and execution pipelines.
---

# System Health Check Skill

This skill allows the agent to autonomously verify the execution integrity, database background jobs, and risk guardrails of the Raine Bank autonomous trading system.

## Usage
Whenever the user requests a "system health check", you should:

1. Refer to the diagnostic protocols found in `docs/System Health Checklist.md`.
2. Run the unified diagnostics query:
   ```bash
   npx supabase db query --linked --file scripts/full_health_audit.sql
   ```
   Or execute `python3 scripts/comprehensive_healthcheck.py` to fetch real-time diagnostics via the REST API.
3. Verify the output to ensure:
   - `pg_cron` jobs (all 15 active canonical jobs) are firing successfully with `status = 'succeeded'`, have zero duplicate/overlapping jobs (Section 1H), and have no missing `timeout_milliseconds` or `x-cron-secret` configurations (proactive sweep in Section 1B).
   - No silent agent crashes are occurring (query `audit_log` for `AGENT_CRASH`).
   - Autonomous agents (`agent-news`, `agent-day`, `agent-swing` split crons) are generating signals and heartbeats.
   - Database Webhook & Cron HTTP responses in `net._http_response` (queried via `public.check_http_response_errors()` RPC) have zero network failures (`Couldn't resolve host name`), no unhandled 500 server errors, no silent `System Error` / `ReferenceError` / `TypeError` strings in response bodies (Section 1N), and decommissioned functions do not flood logs with 401s from external legacy pings (Section 1L).
   - PostgREST queries avoid unconstrained embedded table joins (Section 1J), queries targeting `trade_opportunities` by agent name filter by `source` rather than `model_id` UUID (Section 2E), signal inserts strictly normalize `side` to `'LONG' | 'SHORT'` (handling `REQUIRE_LTF_DRILLDOWN` via `trade_watchlists` per Section 2F), Central Bank currency interventions trigger pre-AI vetoes without opposing sovereign flow (Section 2K), MetaAPI market data fallback maps candidate broker symbol aliases (e.g. `NAS100` -> `USTEC`, `GER30` -> `DE30`, `SPX500` -> `US500` per Section 2G), and cross-asset contract sizing ensures proper quote currency divisor conversions (e.g., JPY division for `JP225` per Section 2L).
   - Orphaned signals (stuck in `PUBLISHED`, `APPROVED` without `user_trades`, or `PENDING`) are zero, and Execution Desk volume skips explicitly mark `status = 'REJECTED'` (Section 3I) while index CFD micro-lots enforce `0.01` minimum volume (Section 3O).
   - Inter-agent HTTP calls construct sibling URLs using `SUPABASE_URL/functions/v1` and avoid referencing undefined `WEBHOOK_URL` (Section 4B), and Telegram broadcast webhooks properly escape all MarkdownV2 reserved characters (`\(`, `\)`, `\.`, `\-`) with zero parse entity errors and track broadcast failures via `TELEGRAM_BROADCAST_FAILURE` audit logs (Section 4A, 4C).
   - Closed trades with calculated `profit_usd` are not desynced in `status = 'OPEN'` (reconcile to `WON` or `LOST` via Section 3G, Step 1c).
   - Stale unfilled pending orders older than their 20-bar horizon (10h for 30m intraday, 20 days for 1D swing) are zero or garbage-collected to `status = 'CLOSED'` with parent opportunities marked `EXPIRED`.
   - Stop loss evaluations adhere to the Bar-Close Invalidation rule (governed on confirmed candle close, allowing intra-bar liquidity wicks to breathe unless the $2.0\times$ ATR catastrophic emergency stop is reached).
   - Database triggers (e.g. `allocate_virtual_pnl()`) are idempotent and skip duplicate reference codes without throwing `23505 duplicate key` errors.
   - Broker execution errors in `user_trades` (MT5 error codes 10013 Invalid Request / Symbol Alias, 10014 Invalid Volume, 10015 Invalid Price, 10016 Invalid Stops / Multi-Leg TP Direction, 10018 Market Closed, 10019 Margin, 10044 Close Only) are caught and parent opportunities updated to `REJECTED`, enforcing broker symbol alias resolution (`SPX500` -> `US500`, `NAS100` -> `USTEC`, `GER30` -> `DE30`, US stocks -> `NVDA_m`/`NVDAm`/`NVDA.pro` per Section 3K & Section 3P) and validating `SYMBOL_TRADE_MODE_FULL`.
   - All TP targets (`tp1`, `tp2`, `tp3`) enforce the 3-Layer Direction Validation against entry prices across `agent-swing`, `agent-trade`, and `vps-poll`, verifying Target 2 satisfies $\ge 1:1.70$ R:R.
   - Runner legs enforce the Chandelier ATR dynamic trail ($2.0\times\text{ ATR}$) and stepped profit floors ($+0.75\text{R}$ at $+1.5\text{R}$, $+1.25\text{R}$ at $+2.0\text{R}$, $+2.0\text{R}$ at $+3.0\text{R}$) per Section 3M.
   - Edge Functions strictly employ `.maybeSingle()` and avoid `.single()` on user/trade/opportunity lookups to eliminate unhandled `PGRST116 (0 rows)` crashes across background crons (Section 3N).
   - `vps-history` callback adheres to canonical schema (`profit_usd`, `error_message`, `status = WON | LOST`), dynamically updates user capital and high-water mark, and skips unmapped manual/external MT5 tickets with `status = 'EXTERNAL_SKIPPED'` rather than 404 (Section 3J).
   - `vps-callback` uses `.maybeSingle()` and returns HTTP 200 `OK` on unmapped/external callback tickets rather than throwing 500 errors (Section 3L).
   - Stale `ACTIVE` trade opportunities older than 24 hours without live `OPEN` positions are safely expired to `status = 'EXPIRED'` (complying with `trade_opportunities_status_check` constraint).
   - Completed trades (`WON`/`LOST`/`CLOSED`) have their parent `trade_opportunities` reconciled immediately (`WON` for positive net PnL, `LOST` for negative net PnL, `EXPIRED` for cancelled/missed entries) without lingering in `ACTIVE`.
   - `vps-poll` receives fresh MT5 heartbeats (within 60s) dynamically queried across master accounts, formats stock CFDs to 2 decimal places and `JP225` to 1 decimal place, and streams live 30m candles (`market_data_pti`).
   - Hourly autonomous SRE watchdog `agent-sre` executed via `agent-sre-poll` audits all 9 subsystem probes (including cron failures, HTTP errors via RPC, agent crashes & critical errors, pipeline self-healing, VPS heartbeats, market data freshness, treasury solvency, AI model timeout sweeps, and drawdown/circuit-breaker limits), auto-heals status desyncs, and records `SRE_HEARTBEAT`.
   - AI model evaluation timeouts (`API_TIMEOUT` in `audit_log`) are zero or transient, backed by exponential retry resiliency in `agent-day` and `agent-swing`.
   - Account drawdown limits (5% daily, 10% total max drawdown) are unbreached across all active user PAMM accounts.
4. If anomalies or status desyncs are detected, apply the reconciliation SQL from Section 3G, Section 3H, Section 3I, and Section 3P of `docs/System Health Checklist.md` and report findings to the user.

## Resources
- [Unified Health Audit SQL Script](../../../scripts/full_health_audit.sql)
- [Healthcheck SQL Script](../../../scripts/healthcheck.sql)
- [Comprehensive Healthcheck Python Script](../../../scripts/comprehensive_healthcheck.py)
- [System Health Checklist](../../../docs/System%20Health%20Checklist.md)

