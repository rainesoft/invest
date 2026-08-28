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
   - Database Webhook & Cron HTTP responses in `net._http_response` have zero network failures (`Couldn't resolve host name`) and no unhandled 500 server errors (e.g. MetaAPI transient failures in `exness-history-sync` are caught gracefully).
   - Orphaned signals (stuck in `PUBLISHED`, `APPROVED` without `user_trades`, or `PENDING`) are zero.
   - Closed trades with calculated `profit_usd` are not desynced in `status = 'OPEN'` (reconcile to `WON` or `LOST` via Section 3G, Step 1c).
   - Stale unfilled pending orders older than their 20-bar horizon (10h for 30m intraday, 20 days for 1D swing) are zero or garbage-collected to `status = 'CLOSED'` with parent opportunities marked `EXPIRED`.
   - Stop loss evaluations adhere to the Bar-Close Invalidation rule (governed on confirmed candle close, allowing intra-bar liquidity wicks to breathe unless the $2.0\times$ ATR catastrophic emergency stop is reached).
   - Database triggers (e.g. `allocate_virtual_pnl()`) are idempotent and skip duplicate reference codes without throwing `23505 duplicate key` errors.
   - Broker execution errors in `user_trades` (MT5 error codes 10014 Invalid Volume, 10015 Invalid Price, 10016 Invalid Stops / Multi-Leg TP Direction, 10019 Margin) are caught and parent opportunities updated to `REJECTED`.
   - All TP targets (`tp1`, `tp2`, `tp3`) enforce the 3-Layer Direction Validation against entry prices across `agent-swing`, `agent-trade`, and `vps-poll`, verifying Target 2 satisfies $\ge 1:1.70$ R:R.
   - `vps-history` callback adheres to canonical schema (`profit_usd`, `error_message`, `status = WON | LOST`) and dynamically updates user capital and high-water mark.
   - Stale `ACTIVE` trade opportunities older than 24 hours without live `OPEN` positions are safely expired to `status = 'EXPIRED'` (complying with `trade_opportunities_status_check` constraint).
   - Completed trades (`WON`/`LOST`/`CLOSED`) have their parent `trade_opportunities` reconciled (`WON` for positive net PnL, `LOST` for negative net PnL, `EXPIRED` for cancelled/missed entries) rather than lingering in `ACTIVE`.
   - `vps-poll` receives fresh MT5 heartbeats (within 60s) and streams live 30m candles (`market_data_pti`).
   - Hourly autonomous SRE watchdog `agent-sre` executed via `agent-sre-poll` audits all 8 subsystem probes (including broker error catching & net PnL opportunity grading), auto-heals status desyncs, and records `SRE_HEARTBEAT`.
4. If anomalies or status desyncs are detected, apply the reconciliation SQL from Section 3G and Section 3H of `docs/System Health Checklist.md` and report findings to the user.

## Resources
- [Unified Health Audit SQL Script](../../../scripts/full_health_audit.sql)
- [Healthcheck SQL Script](../../../scripts/healthcheck.sql)
- [Comprehensive Healthcheck Python Script](../../../scripts/comprehensive_healthcheck.py)
- [System Health Checklist](../../../docs/System%20Health%20Checklist.md)

