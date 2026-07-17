import os
import time
import asyncio
import logging
from dotenv import load_dotenv
from supabase import create_client, Client
from executor import init_mt5, execute_market_order

load_dotenv()

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_SERVICE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
MT5_LOGIN = os.getenv("MT5_LOGIN")
MT5_PASSWORD = os.getenv("MT5_PASSWORD")
MT5_SERVER = os.getenv("MT5_SERVER")

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")

supabase: Client = create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY)

async def heartbeat_loop():
    """Pings Supabase every 30 seconds to update vps_last_heartbeat for this broker."""
    while True:
        try:
            # We assume there is a master user or we update a specific risk setting record.
            # For this bridge, we update the user_risk_settings for the user who owns this VPS.
            USER_ID = os.getenv("USER_ID")
            if USER_ID:
                supabase.table("user_risk_settings").update({
                    "vps_last_heartbeat": "now()"
                }).eq("user_id", USER_ID).execute()
        except Exception as e:
            logging.error(f"Heartbeat failed: {e}")
        await asyncio.sleep(30)

async def poll_pending_trades():
    """Polls user_trades for 'VPS_PENDING' status every second."""
    USER_ID = os.getenv("USER_ID")
    while True:
        try:
            query = supabase.table("user_trades").select("*, trade_opportunities(*)").eq("status", "VPS_PENDING")
            if USER_ID:
                query = query.eq("user_id", USER_ID)
                
            response = query.execute()
            trades = response.data
            
            for trade in trades:
                logging.info(f"Received VPS_PENDING trade: {trade['id']}")
                
                # Lock the trade immediately to prevent double execution
                supabase.table("user_trades").update({"status": "VPS_PROCESSING"}).eq("id", trade["id"]).execute()
                
                opp = trade.get("trade_opportunities", {})
                stop_loss = opp.get("stop_plan_json", {}).get("stop") if opp else None
                take_profit = opp.get("take_profit_json", {}).get("tp") if opp else None
                
                # We assume trade_type logic (QUICK_EXIT vs RUNNER) TP calculations are either pre-calculated 
                # or handled here. For simplicity, we use the opportunity TP.
                
                res = execute_market_order(
                    symbol=trade["symbol"],
                    side=trade["side"],
                    volume=trade["volume"],
                    sl=stop_loss,
                    tp=take_profit
                )
                
                if res["success"]:
                    supabase.table("user_trades").update({
                        "status": "OPEN",
                        "meta_api_order_id": str(res["ticket"])
                    }).eq("id", trade["id"]).execute()
                    logging.info(f"Successfully executed trade {trade['id']}")
                else:
                    supabase.table("user_trades").update({
                        "status": "FAILED",
                        "error_message": res["error"]
                    }).eq("id", trade["id"]).execute()
                    logging.error(f"Failed to execute trade {trade['id']}: {res['error']}")
                    
        except Exception as e:
            logging.error(f"Polling loop error: {e}")
            
        await asyncio.sleep(1)

async def main():
    logging.info("Starting MT5 Python Bridge...")
    if not init_mt5(MT5_LOGIN, MT5_PASSWORD, MT5_SERVER):
        return
    
    # Run loops concurrently
    await asyncio.gather(
        heartbeat_loop(),
        poll_pending_trades()
    )

if __name__ == "__main__":
    asyncio.run(main())
