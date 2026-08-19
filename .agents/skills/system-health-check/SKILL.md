---
name: system-health-check
description: Run comprehensive system diagnostics to verify the health of the autonomous trading agents and execution pipelines.
---

# System Health Check Skill

This skill allows the agent to autonomously verify the execution integrity, database background jobs, and risk guardrails of the Raine Bank autonomous trading system.

## Usage
Whenever the user requests a "system health check", you should:

1. Refer to the diagnostic protocols found in `docs/System Health Checklist.md`.
2. Run the `scripts/healthcheck.sql` file using `psql` or a custom DB query script to quickly dump the health of the system.
3. Verify the output to ensure:
   - `pg_cron` jobs are firing successfully.
   - Autonomous agents are generating signals and heartbeats.
   - Orphaned signals (stuck in `PUBLISHED` or `PENDING`) are not piling up.
   - `vps-poll` receives fresh MT5 heartbeats.
4. If the database cannot be queried directly due to environmental restrictions, try running `python3 temp/check_health_now.py` (if it exists) to fetch the latest diagnostics via the REST API.
5. Report any anomalies to the user and suggest fixes.

## Resources
- [Healthcheck SQL Script](../../../scripts/healthcheck.sql)
- [System Health Checklist](../../../docs/System Health Checklist.md)
