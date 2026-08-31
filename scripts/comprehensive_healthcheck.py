#!/usr/bin/env python3
"""
Raine Invest - Comprehensive System Health Check Diagnostic Script
Fetches real-time diagnostics via the Supabase REST API.
"""

import os
import sys
import json
import urllib.request
import urllib.error
from pathlib import Path
from datetime import datetime, timezone

# Resolve project root and load .env if present
SCRIPT_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = SCRIPT_DIR.parent
ENV_PATH = PROJECT_ROOT / ".env"

env_vars = {}
if ENV_PATH.exists():
    with open(ENV_PATH, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                key, val = line.split("=", 1)
                env_vars[key.strip()] = val.strip().strip('"').strip("'")

# Extract configuration
supabase_url = os.environ.get("SUPABASE_URL") or env_vars.get("SUPABASE_URL") or "https://ktezlusdkqlfdwqrldtn.supabase.co"
if not supabase_url.endswith("/rest/v1"):
    rest_url = f"{supabase_url.rstrip('/')}/rest/v1"
else:
    rest_url = supabase_url

service_role_key = (
    os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    or env_vars.get("SUPABASE_SERVICE_ROLE_KEY")
    or "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imt0ZXpsdXNka3FsZmR3cXJsZHRuIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc0NDYyNDQ2MiwiZXhwIjoyMDYwMjAwNDYyfQ.t1U0KpSeGL8SrsMDuLWVfpXI-SsV5UnJIdRIRNAi9ZM"
)

def query_table(table: str, params: str = "") -> list:
    """Query a Supabase table using PostgREST API with service role key."""
    url = f"{rest_url}/{table}"
    if params:
        url += f"?{params}"
    
    req = urllib.request.Request(url)
    req.add_header("apikey", service_role_key)
    req.add_header("Authorization", f"Bearer {service_role_key}")
    req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req) as response:
            return json.loads(response.read().decode())
    except urllib.error.HTTPError as e:
        print(f"Error querying {table}: {e.code} - {e.read().decode()}")
        return []
    except Exception as e:
        print(f"Network error querying {table}: {e}")
        return []

def parse_iso(dt_str: str):
    """Safely parse ISO timestamp across various formats and Python versions."""
    if not dt_str:
        return None
    s = dt_str.replace("Z", "+00:00")
    try:
        return datetime.fromisoformat(s)
    except Exception:
        pass
    # Fallback with regex/strptime
    try:
        import dateutil.parser
        return dateutil.parser.isoparse(dt_str)
    except Exception:
        pass
    return None

now_utc = datetime.now(timezone.utc)
print(f"================================================================================")
print(f"=== RAINE INVEST SYSTEM HEALTH CHECK — {now_utc.strftime('%Y-%m-%d %H:%M:%S UTC')} ===")
print(f"================================================================================")

# 1. Edge Function Agent Crashes
print("\n--- 1. AGENT CRASHES (audit_log) ---")
crashes = query_table("audit_log", "action=eq.AGENT_CRASH&order=created_at.desc&limit=10")
if crashes:
    for c in crashes:
        print(f"  [{c.get('created_at')}] {c.get('payload_json')}")
else:
    print("  Zero AGENT_CRASH entries found. Clean!")

# 1b. AI Evaluation Model Timeouts / API Outages
print("\n--- 1b. AI MODEL TIMEOUTS / OUTAGES (audit_log) ---")
timeouts = query_table("audit_log", "action=eq.API_TIMEOUT&order=created_at.desc&limit=5")
if timeouts:
    for to in timeouts:
        payload = to.get('payload_json') or {}
        print(f"  [{to.get('created_at')}] Symbol: {payload.get('symbol')} | Reason: {payload.get('reason')} | Err: {str(payload.get('error'))[:100]}")
else:
    print("  Zero recent API_TIMEOUT entries found. Clean!")

# 2. Recent Autonomous Agent Research Runs
print("\n--- 2. RECENT AGENT ACTIVITY (RESEARCH_RUN) ---")
for agent in ["agent-news", "agent-swing", "agent-day"]:
    runs = query_table("audit_log", f"action=eq.RESEARCH_RUN&payload_json->>agent=eq.{agent}&order=created_at.desc&limit=5")
    print(f"\n>> {agent} recent runs:")
    if runs:
        for r in runs:
            payload = r.get('payload_json') or {}
            print(f"  [{r.get('created_at')}] Symbol: {payload.get('symbol')} | TF: {payload.get('timeframe')} | Agent: {payload.get('agent')}")
    else:
        print("  No runs found.")

# 3. All Recent audit_log actions in last 6 hours
print("\n--- 3. RECENT AUDIT LOG ACTIONS (Last 6 Hours) ---")
recent_actions = query_table("audit_log", "order=created_at.desc&limit=20")
if recent_actions:
    for a in recent_actions:
        payload = a.get('payload_json') or {}
        print(f"  [{a.get('created_at')}] Action: {a.get('action')} | Actor: {a.get('actor_type')} | Payload: {json.dumps(payload)[:120]}")

# 4. Trade Opportunities Analysis
print("\n--- 4. TRADE OPPORTUNITIES (Last 15) ---")
opps = query_table("trade_opportunities", "order=created_at.desc&limit=15")
if opps:
    for o in opps:
        print(f"  [{o.get('created_at')}] ID: {o.get('id')} | {o.get('symbol')} {o.get('side')} | Status: {o.get('status')} | Source: {o.get('source')} | Confidence: {o.get('confidence')}")
        if o.get('ai_risks'):
            print(f"      Risks: {str(o.get('ai_risks'))[:120]}")
        if o.get('ai_summary'):
            print(f"      Summary: {str(o.get('ai_summary'))[:120]}")

# 5. Orphaned PUBLISHED Signals (> 5 mins)
print("\n--- 5. ORPHANED PUBLISHED SIGNALS (> 5 mins) ---")
orphaned_published = query_table("trade_opportunities", "status=eq.PUBLISHED&order=created_at.desc")
if orphaned_published:
    for op in orphaned_published:
        print(f"  ORPHANED PUBLISHED: {op.get('id')} | {op.get('symbol')} | {op.get('side')} | Created: {op.get('created_at')}")
else:
    print("  None found. All signals transitioned cleanly.")

# 6. Orphaned APPROVED Signals (> 5 mins without user_trades)
print("\n--- 6. ORPHANED APPROVED SIGNALS (Missing user_trades) ---")
approved_opps = query_table("trade_opportunities", "status=eq.APPROVED&order=created_at.desc&limit=15")
if approved_opps:
    for ao in approved_opps:
        ut = query_table("user_trades", f"opportunity_id=eq.{ao.get('id')}&limit=1")
        if not ut:
            print(f"  ORPHANED APPROVED: {ao.get('id')} | {ao.get('symbol')} | {ao.get('side')} | Created: {ao.get('created_at')}")
        else:
            trade = ut[0]
            print(f"  APPROVED Matched -> Trade: {trade.get('id')} | Status: {trade.get('status')} | Vol: {trade.get('volume')} | Ticket: {trade.get('meta_api_order_id')}")
else:
    print("  No orphaned APPROVED opportunities found.")

# 7. User Trades Health & Recent Execution
print("\n--- 7. USER TRADES HEALTH & RECENT EXECUTION ---")
trades = query_table("user_trades", "order=created_at.desc&limit=15")
if trades:
    for t in trades:
        print(f"  [{t.get('created_at')}] Trade: {t.get('id')} | {t.get('symbol')} {t.get('side')} | Status: {t.get('status')} | Vol: {t.get('volume')} | Type: {t.get('trade_type')} | Profit: {t.get('profit_usd')} | Err: {t.get('error_message')}")
else:
    print("  No user trades found.")

# 8. Stuck or Failed Trades
print("\n--- 8. FAILED / STUCK / DESYNCED TRADES (Last 7 Days) ---")
failed_trades = query_table("user_trades", "status=in.(FAILED,PENDING,VPS_PENDING)&order=created_at.desc&limit=10")
if failed_trades:
    for ft in failed_trades:
        print(f"  FAILED/STUCK: {ft.get('id')} | {ft.get('symbol')} | Status: {ft.get('status')} | Err: {ft.get('error_message')} | Created: {ft.get('created_at')}")
else:
    print("  None found. No trades stuck in PENDING, VPS_PENDING, or FAILED.")

desynced_trades = query_table("user_trades", "status=eq.OPEN&profit_usd=not.is.null&limit=10")
if desynced_trades:
    for dt in desynced_trades:
        print(f"  ⚠️ DESYNCED CLOSED TRADE (Status OPEN but has Profit): {dt.get('id')} | {dt.get('symbol')} | Profit: ${dt.get('profit_usd')} | ClosedAt: {dt.get('closed_at')}")
else:
    print("  Zero desynced trades found. (All OPEN trades have profit_usd = null). Clean!")

# 8b. Stale Unfilled Pending Orders (> 48h)
print("\n--- 8b. STALE UNFILLED PENDING ORDERS (> 48h) ---")
stale_unfilled = query_table("user_trades", "status=in.(OPEN,PENDING,VPS_PENDING)&open_price=is.null&order=created_at.desc")
if stale_unfilled:
    found_stale = False
    for su in stale_unfilled:
        c_at = parse_iso(su.get('created_at'))
        if c_at:
            if c_at.tzinfo is None:
                c_at = c_at.replace(tzinfo=timezone.utc)
            hours_old = (now_utc - c_at).total_seconds() / 3600.0
            if hours_old >= 48:
                found_stale = True
                print(f"  ⚠️ STALE UNFILLED ORDER: {su.get('id')} | {su.get('symbol')} {su.get('side')} | Created: {su.get('created_at')} ({hours_old:.1f}h old) | Ticket: {su.get('meta_api_order_id')}")
    if not found_stale:
        print("  Zero stale unfilled pending orders > 48h found. Clean!")
else:
    print("  Zero stale unfilled pending orders found.")

# 9. VPS Heartbeat Diagnostics
print("\n--- 9. VPS HEARTBEAT & RISK SETTINGS ---")
risk_settings = query_table("user_risk_settings", "")
if risk_settings:
    for rs in risk_settings:
        hb = rs.get('vps_last_heartbeat')
        minutes_ago = None
        if hb:
            hb_dt = parse_iso(hb)
            if hb_dt:
                if hb_dt.tzinfo is None:
                    hb_dt = hb_dt.replace(tzinfo=timezone.utc)
                minutes_ago = max(0.0, (now_utc - hb_dt).total_seconds() / 60.0)
        print(f"  User: {rs.get('user_id')} | Master: {rs.get('is_master_account')} | Capital: ${rs.get('portfolio_capital')} | Live: {rs.get('is_live_execution_enabled')} | Auto: {rs.get('auto_trade_enabled')} | VPS Ping: {hb} ({minutes_ago:.1f} mins ago)" if minutes_ago is not None else f"  User: {rs.get('user_id')} | No heartbeat")
else:
    print("  No risk settings found.")

# 10. VPS Market Data Streaming Freshness
print("\n--- 10. MARKET DATA STREAMING FRESHNESS (market_data_pti) ---")
pti = query_table("market_data_pti", "order=ts.desc&limit=30")
if pti:
    seen_symbols = {}
    for p in pti:
        sym = p.get('symbol')
        tf = p.get('timeframe')
        key = f"{sym}_{tf}"
        if key not in seen_symbols:
            seen_symbols[key] = p
    for key, p in seen_symbols.items():
        ts_str = p.get('ts')
        hours_ago = None
        if ts_str:
            ts_dt = parse_iso(ts_str)
            if ts_dt:
                if ts_dt.tzinfo is None:
                    ts_dt = ts_dt.replace(tzinfo=timezone.utc)
                hours_ago = (now_utc - ts_dt).total_seconds() / 3600.0
        print(f"  {p.get('symbol')} [{p.get('timeframe')}]: Last candle = {ts_str} ({hours_ago:.1f}h ago)" if hours_ago is not None else f"  {p.get('symbol')} [{p.get('timeframe')}]: {ts_str}")

# 11. Market Context & Volatility Lockout
print("\n--- 11. MARKET CONTEXT & VOLATILITY LOCKOUT ---")
ctx = query_table("market_context", "order=created_at.desc&limit=5")
if ctx:
    for c in ctx:
        print(f"  Context: {c.get('id')} | Bias: {c.get('macro_bias')} | Regimes: {c.get('regime')} | Expires: {c.get('expires_at')}")
else:
    print("  No market context rows found.")

# 12. Treasury & Solvency Status
print("\n--- 12. TREASURY STATUS & SNAPSHOTS ---")
sys_set = query_table("system_settings", "key=eq.treasury_status")
if sys_set:
    print(f"  system_settings.treasury_status: {json.dumps(sys_set[0].get('value'))}")
tsnaps = query_table("treasury_snapshots", "order=snapshot_timestamp.desc&limit=5")
if tsnaps:
    for ts in tsnaps:
        print(f"  [{ts.get('snapshot_timestamp')}] Solvency Ratio: {ts.get('solvency_ratio')} | Assets: ${ts.get('total_assets')} | Liab: ${ts.get('total_customer_liability')} | Notes: {ts.get('notes')}")
else:
    print("  No treasury snapshots found.")

# 13. System Settings (PHM, Global Flags)
print("\n--- 13. GLOBAL SETTINGS ---")
all_settings = query_table("system_settings", "")
if all_settings:
    for s in all_settings:
        val_str = json.dumps(s.get('value'))
        if len(val_str) > 120:
            val_str = val_str[:120] + "..."
        print(f"  Key: {s.get('key')} -> Value: {val_str}")

print("\n================================================================================")
print("=== HEALTH CHECK COMPLETE ===")
print("================================================================================")
