---
name: system-health-check
description: Run comprehensive system diagnostics to verify the health of the autonomous trading agents and execution pipelines.
---

# System Health Check Skill

This skill allows the agent to autonomously verify the execution integrity, database background jobs, and risk guardrails of the Raine Bank autonomous trading system.

## Usage
Whenever the user requests a "system health check", you should:

1. Refer to the diagnostic protocols found in `docs/System Health Checklist.md`.
2. Run the `scripts/healthcheck.sql` file using `npx supabase db query --linked --file scripts/healthcheck.sql` or a custom DB query script to dump the health of the system.
3. Verify the output to ensure:
   - `pg_cron` jobs (all 13 active jobs) are firing successfully and have no missing `timeout_milliseconds` or `x-cron-secret` configurations (the proactive sweep in Section 1B will flag this).
   - No silent agent crashes are occurring (query `audit_log` for `AGENT_CRASH`).
   - Autonomous agents (`agent-news`, `agent-day`, `agent-swing` split crons) are generating signals and heartbeats.
   - Database Webhook Trigger responses (`net._http_response`) have zero DNS/network failures (`Couldn't resolve host name`).
   - Orphaned signals (stuck in `PUBLISHED`, `APPROVED` without `user_trades`, or `PENDING`) are not piling up.
   - Stale `ACTIVE` trade opportunities older than 24 hours in `trade_opportunities` are flagged/expired (Section 13B in `healthcheck.sql` and Section 3G in `System Health Checklist.md`).
   - `vps-poll` receives fresh MT5 heartbeats (within 60s) and streams live 30m candles (`market_data_pti`).
   - Treasury snapshots and solvency ratio remain >= 1.0.
4. If the database cannot be queried directly due to environmental restrictions, try running `python3 temp/comprehensive_healthcheck.py` or `python3 temp/check_health_now.py` to fetch the latest diagnostics via the REST API.
5. Report any anomalies to the user and suggest fixes.

## Resources
- [Healthcheck SQL Script](../../../scripts/healthcheck.sql)
- [System Health Checklist](../../../docs/System Health Checklist.md)
