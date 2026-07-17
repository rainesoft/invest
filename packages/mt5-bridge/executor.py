import MetaTrader5 as mt5
import logging

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")

def init_mt5(account, password, server):
    if not mt5.initialize():
        logging.error(f"initialize() failed, error code = {mt5.last_error()}")
        return False
    
    authorized = mt5.login(int(account), password=password, server=server)
    if not authorized:
        logging.error(f"failed to connect at account #{account}, error code: {mt5.last_error()}")
        return False
    
    logging.info(f"Connected to MT5 account #{account}")
    return True

def execute_market_order(symbol, side, volume, sl=None, tp=None, magic=123456):
    """
    Executes a Market Order in MT5.
    side: 'LONG' or 'SHORT'
    """
    order_type = mt5.ORDER_TYPE_BUY if side == "LONG" else mt5.ORDER_TYPE_SELL
    
    # Ensure symbol is visible in Market Watch
    if not mt5.symbol_select(symbol, True):
        logging.error(f"Failed to select {symbol}")
        return {"success": False, "error": f"Symbol {symbol} not found"}
        
    symbol_info = mt5.symbol_info(symbol)
    if symbol_info is None:
        return {"success": False, "error": f"{symbol} not found, can not call order_check()"}
        
    price = mt5.symbol_info_tick(symbol).ask if side == "LONG" else mt5.symbol_info_tick(symbol).bid
    
    request = {
        "action": mt5.TRADE_ACTION_DEAL,
        "symbol": symbol,
        "volume": float(volume),
        "type": order_type,
        "price": price,
        "sl": float(sl) if sl else 0.0,
        "tp": float(tp) if tp else 0.0,
        "deviation": 20,
        "magic": magic,
        "comment": "RaineBank AI",
        "type_time": mt5.ORDER_TIME_GTC,
        "type_filling": mt5.ORDER_FILLING_IOC,
    }
    
    result = mt5.order_send(request)
    
    if result.retcode != mt5.TRADE_RETCODE_DONE:
        logging.error(f"Order failed: {result.retcode} - {result.comment}")
        return {"success": False, "error": f"Code {result.retcode}: {result.comment}"}
        
    logging.info(f"Order success: ticket {result.order}")
    return {"success": True, "ticket": result.order, "price": result.price}
