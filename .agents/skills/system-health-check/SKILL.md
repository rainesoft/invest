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
   - `pg_cron` jobs (all 12 active canonical jobs) are firing successfully with `status = 'succeeded'`, have zero duplicate/overlapping jobs (Section 1H), and have no missing `timeout_milliseconds` or `x-cron-secret` configurations (proactive sweep in Section 1B).
   - No silent agent crashes are occurring (query `audit_log` for `AGENT_CRASH`).
   - Autonomous agents (`agent-news`, `agent-day`, `agent-swing` split crons) are generating signals and heartbeats.
   - Database Webhook & Cron HTTP responses in `net._http_response` have zero network failures (`Couldn't resolve host name`) and no unhandled 500 server errors (e.g. MetaAPI transient failures in `exness-history-sync` are caught gracefully).
   - Orphaned signals (stuck in `PUBLISHED`, `APPROVED` without `user_trades`, or `PENDING`) are zero.
   - Closed trades with calculated `profit_usd` are not desynced in `status = 'OPEN'` (reconcile to `WON` or `LOST` via Section 3G, Step 1c).
   - Database triggers (e.g. `allocate_virtual_pnl()`) are idempotent and skip duplicate reference codes without throwing `23505 duplicate key` errors.
   - Broker execution errors in `user_trades` (MT5 error codes 10014 Invalid Volume, 10015 Invalid Price, 10016 Invalid Stops / Multi-Leg TP Direction, 10019 Margin) are caught and parent opportunities updated to `REJECTED`.
   - All TP targets (`tp1`, `tp2`, `tp3`) enforce the 3-Layer Direction Validation against entry prices.
   - Stale `ACTIVE` trade opportunities older than 24 hours without live `OPEN` positions are safely expired to `status = 'EXPIRED'` (complying with `trade_opportunities_status_check` constraint).
   - Completed trades (`WON`/`LOST`/`CLOSED`) have their parent `trade_opportunities` reconciled (`WON` for positive net PnL, `LOST` for negative net PnL, `EXPIRED` for cancelled/missed entries) rather than lingering in `ACTIVE`.
   - `vps-poll` receives fresh MT5 heartbeats (within 60s) and streams live 30m candles (`market_data_pti`).
   - Treasury accounts in `treasury_accounts` are populated, snapshots generated, and solvency ratio remains >= 1.0.
   - Hourly automated watchdog `check_cron_failures()` RPC executed via `system-health-check-poll` returns zero failures.
4. If anomalies or status desyncs are detected, apply the reconciliation SQL from Section 3G of `docs/System Health Checklist.md` and report findings to the user.

## Resources
- [Unified Health Audit SQL Script](../../../scripts/full_health_audit.sql)
- [Healthcheck SQL Script](../../../scripts/healthcheck.sql)
- [Comprehensive Healthcheck Python Script](../../../scripts/comprehensive_healthcheck.py)
- [System Health Checklist](../../../docs/System Health Checklist.md)

