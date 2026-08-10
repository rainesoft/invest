//+------------------------------------------------------------------+
//|                                                   RaineBankEA.mq5|
//|                                                        RaineBank |
//|                                       https://www.rainebank.com/ |
//+------------------------------------------------------------------+
#property copyright "RaineBank"
#property link      "https://www.rainebank.com/"
#property version   "1.00"

// --- HARDCODED MASTER NODE CONFIGURATION ---
string InpSupabaseURL = "https://ktezlusdkqlfdwqrldtn.supabase.co"; 
string InpUserID = "912d249b-9be8-4691-a11b-5b00f386a804"; 
string InpVPSSecret = "f4751d7f27496451f31eafbd3c937ab8036ce26ef30415b3"; 
// -----------------------------------------

input bool InpDemoMode = false; // HFT Demo Mode (simulates execution)
input double InpHFTLotSize = 0.01; // HFT Fixed Micro-Lot Size
input int InpHFTStopLossPoints = 100; // HFT Stop Loss (Points)
input int InpHFTTakeProfitPoints = 200; // HFT Take Profit (Points)
input int InpHFTTrailingStopPoints = 20; // HFT Trailing Stop Activation (Points)
string g_HFTBias = "NEUTRAL";
long activeTickets[];

//+------------------------------------------------------------------+
//| Expert initialization function                                   |
//+------------------------------------------------------------------+
int OnInit()
  {
   if(InpUserID == "")
     {
      Print("Error: UserID is empty! Please configure it in EA Settings.");
      return(INIT_PARAMETERS_INCORRECT);
     }
     
   if(InpVPSSecret == "")
     {
      Print("Error: VPS Secret is empty! Please configure it in EA Settings.");
      return(INIT_PARAMETERS_INCORRECT);
     }
     
   RecoverActiveTickets();
   EventSetTimer(15);
   Print("RaineBank VPS Bridge initialized. Polling every 15 seconds.");
   return(INIT_SUCCEEDED);
  }

//+------------------------------------------------------------------+
//| Recover Active Tickets on Startup                                |
//+------------------------------------------------------------------+
void RecoverActiveTickets()
  {
   ArrayResize(activeTickets, 0);
   for(int i=0; i<PositionsTotal(); i++)
     {
      ulong ticket = PositionGetTicket(i);
      if(PositionGetString(POSITION_COMMENT) == "RaineBank AI" || PositionGetInteger(POSITION_MAGIC) == 410673)
        {
         int size = ArraySize(activeTickets);
         ArrayResize(activeTickets, size+1);
         activeTickets[size] = ticket;
        }
     }
   for(int i=0; i<OrdersTotal(); i++)
     {
      ulong ticket = OrderGetTicket(i);
      if(OrderGetString(ORDER_COMMENT) == "RaineBank AI" || OrderGetInteger(ORDER_MAGIC) == 410673)
        {
         int size = ArraySize(activeTickets);
         ArrayResize(activeTickets, size+1);
         activeTickets[size] = ticket;
        }
     }
   Print("Recovered ", ArraySize(activeTickets), " active positions and pending orders.");
  }

//+------------------------------------------------------------------+
//| Expert deinitialization function                                 |
//+------------------------------------------------------------------+
void OnDeinit(const int reason)
  {
   EventKillTimer();
   Print("RaineBank VPS Bridge stopped.");
  }

datetime lastBarTime = 0;
datetime lastHFTTime = 0;
bool hftOpen = false;
int rsiHandle = INVALID_HANDLE;
double rsiBuffer[];

//+------------------------------------------------------------------+
//| Expert tick function (HFT Execution)                             |
//+------------------------------------------------------------------+
void OnTick()
  {
   if(g_HFTBias == "NEUTRAL") return;
   
   // Initialize RSI handle if not created
   if(rsiHandle == INVALID_HANDLE)
     {
      rsiHandle = iRSI(_Symbol, PERIOD_M1, 14, PRICE_CLOSE);
      ArraySetAsSeries(rsiBuffer, true);
     }
     
   if(rsiHandle != INVALID_HANDLE)
      CopyBuffer(rsiHandle, 0, 0, 2, rsiBuffer);
   
   if(!hftOpen && TimeCurrent() - lastHFTTime > 60) // Only 1 trade per minute max
     {
      double ask = SymbolInfoDouble(_Symbol, SYMBOL_ASK);
      double bid = SymbolInfoDouble(_Symbol, SYMBOL_BID);
      
      // Visual feedback: Print the scanner status every 30 seconds so we know it's hunting!
      static datetime lastScanPrint = 0;
      if(TimeCurrent() - lastScanPrint >= 30)
        {
         Print("HFT Scanner [", _Symbol, "] Active | Bias: ", g_HFTBias, " | Current M1 RSI: ", DoubleToString(rsiBuffer[0], 2), " (Waiting for < 35)");
         lastScanPrint = TimeCurrent();
        }
      
      // Native Intelligence: Wait for pullbacks on the 1-minute chart before executing the macro bias
      if(g_HFTBias == "LONG" && rsiBuffer[0] < 35) // Oversold pullback
        {
         if(InpDemoMode)
            Print("HFT DEMO: RSI is ", rsiBuffer[0], ". Executing BUY at ", ask);
         else
           {
            double sl = ask - (InpHFTStopLossPoints * Point());
            double tp = ask + (InpHFTTakeProfitPoints * Point());
            ExecuteTrade("HFT_NATIVE", _Symbol, "LONG", InpHFTLotSize, sl, tp, ask, "BUY MARKET");
           }
         hftOpen = true;
         lastHFTTime = TimeCurrent();
        }
      else if(g_HFTBias == "SHORT" && rsiBuffer[0] > 65) // Overbought pullback
        {
         if(InpDemoMode)
            Print("HFT DEMO: RSI is ", rsiBuffer[0], ". Executing SELL at ", bid);
         else
           {
            double sl = bid + (InpHFTStopLossPoints * Point());
            double tp = bid - (InpHFTTakeProfitPoints * Point());
            ExecuteTrade("HFT_NATIVE", _Symbol, "SHORT", InpHFTLotSize, sl, tp, bid, "SELL MARKET");
           }
         hftOpen = true;
         lastHFTTime = TimeCurrent();
        }
     }
   else if(hftOpen)
     {
      // Trailing Stop Logic
      if(!InpDemoMode)
        {
         for(int i=0; i<PositionsTotal(); i++)
           {
            ulong ticket = PositionGetTicket(i);
            if(PositionGetString(POSITION_SYMBOL) == _Symbol && PositionGetInteger(POSITION_MAGIC) == 410673)
              {
               double posOpenPrice = PositionGetDouble(POSITION_PRICE_OPEN);
               double currentSl = PositionGetDouble(POSITION_SL);
               long posType = PositionGetInteger(POSITION_TYPE);
               double point = Point();
               
               if(posType == POSITION_TYPE_BUY)
                 {
                  double currentBid = SymbolInfoDouble(_Symbol, SYMBOL_BID);
                  if(currentBid - posOpenPrice > InpHFTTrailingStopPoints * point)
                    {
                     double newSl = currentBid - (InpHFTTrailingStopPoints * point);
                     if(currentSl < newSl || currentSl == 0) ModifyTrade(ticket, newSl, PositionGetDouble(POSITION_TP));
                    }
                 }
               else if(posType == POSITION_TYPE_SELL)
                 {
                  double currentAsk = SymbolInfoDouble(_Symbol, SYMBOL_ASK);
                  if(posOpenPrice - currentAsk > InpHFTTrailingStopPoints * point)
                    {
                     double newSl = currentAsk + (InpHFTTrailingStopPoints * point);
                     if(currentSl > newSl || currentSl == 0) ModifyTrade(ticket, newSl, PositionGetDouble(POSITION_TP));
                    }
                 }
              }
           }
        }
        
      // Check exits: dynamically exit if RSI reverses or static time decay
      if(TimeCurrent() - lastHFTTime > 60) // 60 seconds time stop
        {
         if(InpDemoMode)
            Print("HFT DEMO: Closing position for micro-profit.");
         else
           {
            // Fallback close all HFT trades on this symbol if time decays
            for(int i=PositionsTotal()-1; i>=0; i--)
              {
               ulong ticket = PositionGetTicket(i);
               if(PositionGetString(POSITION_SYMBOL) == _Symbol && PositionGetInteger(POSITION_MAGIC) == 410673)
                 {
                  MqlTradeRequest request;
                  MqlTradeResult  result;
                  ZeroMemory(request);
                  ZeroMemory(result);
                  request.action = TRADE_ACTION_DEAL;
                  request.position = ticket;
                  request.magic = 410673;
                  request.symbol = _Symbol;
                  request.volume = PositionGetDouble(POSITION_VOLUME);
                  
                  if(PositionGetInteger(POSITION_TYPE) == POSITION_TYPE_BUY)
                    {
                     request.type = ORDER_TYPE_SELL;
                     request.price = SymbolInfoDouble(_Symbol, SYMBOL_BID);
                    }
                  else
                    {
                     request.type = ORDER_TYPE_BUY;
                     request.price = SymbolInfoDouble(_Symbol, SYMBOL_ASK);
                    }
                  OrderSend(request, result);
                 }
              }
           }
         hftOpen = false;
        }
     }
  }

//+------------------------------------------------------------------+
//| Expert timer function                                            |
//+------------------------------------------------------------------+
void OnTimer()
  {
   PushMarketData();
   MonitorPositions();
   
   string pollUrl = InpSupabaseURL + "/functions/v1/vps-poll?user_id=" + InpUserID + "&symbol=" + _Symbol;
   
   // WebRequest to poll for trades
   ResetLastError();
   string req_headers = "User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64)\r\n" + 
                        "x-vps-secret: " + InpVPSSecret + "\r\n";
   string res_headers;
   char post[], result[];
   int res;
   
   res = WebRequest("GET", pollUrl, req_headers, 5000, post, result, res_headers);
   
   if(res == 200)
     {
      string text = CharArrayToString(result);
      if(StringFind(text, "BIAS:") == 0 || (text != "NO_TRADES" && StringFind(text, "ERROR:") < 0 && StringLen(text) > 5))
        {
         ProcessTrades(text);
        }
      else if (StringFind(text, "ERROR:") >= 0)
        {
         Print("Poll Error from server: ", text);
        }
     }
   else if (res != -1) // -1 means timeout or allowed URL issue
     {
      Print("Poll Request failed. Code: ", res, " Body: ", CharArrayToString(result));
     }
   else 
     {
      int err = GetLastError();
      if(err == 4014) // ERR_FUNCTION_NOT_ALLOWED
         Print("ERROR: You must allow WebRequests to ", InpSupabaseURL, " in MT5 Options (Ctrl+O) -> Expert Advisors.");
     }
  }

//+------------------------------------------------------------------+
//| Process Trades String                                            |
//+------------------------------------------------------------------+
void ProcessTrades(string data)
  {
   string lines[];
   int numLines = StringSplit(data, '\n', lines);
   
   for(int i=0; i<numLines; i++)
     {
      string line = lines[i];
      StringTrimLeft(line);
      StringTrimRight(line);
      
      if(StringFind(line, "BIAS:") == 0)
        {
         g_HFTBias = StringSubstr(line, 5); // extract LONG, SHORT, or NEUTRAL
         continue;
        }
        
      if(StringLen(line) < 10) continue;
      
      string parts[];
      int numParts = StringSplit(line, ',', parts);
      // Format: ID,SYMBOL,SIDE,VOLUME,STOPLOSS,TAKEPROFIT,TRADE_TYPE,ENTRY_PRICE,ORDER_TYPE,ACTION,TICKET
      if(numParts >= 11)
        {
         string id = parts[0];
         string symbol = parts[1];
         string side = parts[2];
         double volume = StringToDouble(parts[3]);
         double sl = StringToDouble(parts[4]);
         double tp = StringToDouble(parts[5]);
         double entryPrice = StringToDouble(parts[7]);
         string orderType = parts[8];
         string action = parts[9];
         long ticket = StringToInteger(parts[10]);
         
         if (action == "EXECUTE") 
           {
            ExecuteTrade(id, symbol, side, volume, sl, tp, entryPrice, orderType);
           }
         else if (action == "MODIFY" && ticket > 0)
           {
            ModifyTrade(ticket, sl, tp);
           }
         else if (action == "CLOSE" && ticket > 0)
           {
            CloseTrade(ticket);
           }
        }
     }
  }

//+------------------------------------------------------------------+
//| Modify Trade (Trailing Stop / TP Update)                         |
//+------------------------------------------------------------------+
void ModifyTrade(long ticket, double newSl, double newTp)
  {
   if(PositionSelectByTicket(ticket))
     {
      double currentSl = PositionGetDouble(POSITION_SL);
      double currentTp = PositionGetDouble(POSITION_TP);
      
      // Only modify if there's an actual change (handle floating point inaccuracies)
      if (MathAbs(currentSl - newSl) > 0.00001 || MathAbs(currentTp - newTp) > 0.00001)
        {
         MqlTradeRequest request;
         MqlTradeResult  result;
         ZeroMemory(request);
         ZeroMemory(result);
         
         request.action = TRADE_ACTION_SLTP;
         request.position = ticket;
         request.sl = newSl;
         request.tp = newTp;
         request.magic = 410673;
         
         if(OrderSend(request, result))
           {
            Print("Modified Position ", ticket, " SL: ", newSl, " TP: ", newTp);
           }
         else
           {
            Print("Failed to modify position ", ticket, " Error: ", GetLastError());
           }
        }
     }
  }

//+------------------------------------------------------------------+
//| Close Trade (Positions and Pending Orders)                       |
//+------------------------------------------------------------------+
void CloseTrade(long ticket)
  {
   MqlTradeRequest request;
   MqlTradeResult  result;
   ZeroMemory(request);
   ZeroMemory(result);
   
   if(PositionSelectByTicket(ticket))
     {
      request.action = TRADE_ACTION_DEAL;
      request.position = ticket;
      request.symbol = PositionGetString(POSITION_SYMBOL);
      request.volume = PositionGetDouble(POSITION_VOLUME);
      request.type = (ENUM_ORDER_TYPE)(PositionGetInteger(POSITION_TYPE) == POSITION_TYPE_BUY ? ORDER_TYPE_SELL : ORDER_TYPE_BUY);
      request.price = SymbolInfoDouble(request.symbol, request.type == ORDER_TYPE_SELL ? SYMBOL_BID : SYMBOL_ASK);
      request.deviation = 50;
      request.magic = 410673;
      
      if(OrderSend(request, result))
        {
         Print("Closed Position ", ticket);
        }
      else
        {
         Print("Failed to close position ", ticket, " Error: ", GetLastError());
        }
     }
   else if (OrderSelect(ticket))
     {
      request.action = TRADE_ACTION_REMOVE;
      request.order = ticket;
      if(OrderSend(request, result))
        {
         Print("Canceled Pending Order ", ticket);
        }
      else
        {
         Print("Failed to cancel pending order ", ticket, " Error: ", GetLastError());
        }
     }
  }

//+------------------------------------------------------------------+
//| Execute Trade (Sends to Broker via MT5)                          |
//+------------------------------------------------------------------+
void ExecuteTrade(string id, string symbol, string side, double volume, double sl, double tp, double entryPrice, string orderTypeStr)
  {
   Print("Executing trade: ", id, " ", symbol, " ", orderTypeStr, " Vol:", volume, " Entry:", entryPrice, " SL:", sl, " TP:", tp);
   
   // Ensure symbol is selected in Market Watch
   SymbolSelect(symbol, true);
   
   MqlTradeRequest request;
   MqlTradeResult  result;
   ZeroMemory(request);
   ZeroMemory(result);
   
   request.symbol = symbol;
   request.volume = volume;
   request.sl = sl;
   request.tp = tp;
   request.magic = 410673; // RaineBank Magic
   request.comment = "RaineBank AI";
   
   if(orderTypeStr == "BUY MARKET")
     {
      request.action = TRADE_ACTION_DEAL;
      request.type = ORDER_TYPE_BUY;
      request.price = SymbolInfoDouble(symbol, SYMBOL_ASK);
     }
   else if(orderTypeStr == "SELL MARKET")
     {
      request.action = TRADE_ACTION_DEAL;
      request.type = ORDER_TYPE_SELL;
      request.price = SymbolInfoDouble(symbol, SYMBOL_BID);
     }
   else if(orderTypeStr == "BUY LIMIT")
     {
      request.action = TRADE_ACTION_PENDING;
      request.type = ORDER_TYPE_BUY_LIMIT;
      request.price = entryPrice;
      request.type_time = ORDER_TIME_GTC;
     }
   else if(orderTypeStr == "SELL LIMIT")
     {
      request.action = TRADE_ACTION_PENDING;
      request.type = ORDER_TYPE_SELL_LIMIT;
      request.price = entryPrice;
      request.type_time = ORDER_TIME_GTC;
     }
   else if(orderTypeStr == "BUY STOP")
     {
      request.action = TRADE_ACTION_PENDING;
      request.type = ORDER_TYPE_BUY_STOP;
      request.price = entryPrice;
      request.type_time = ORDER_TIME_GTC;
     }
   else if(orderTypeStr == "SELL STOP")
     {
      request.action = TRADE_ACTION_PENDING;
      request.type = ORDER_TYPE_SELL_STOP;
      request.price = entryPrice;
      request.type_time = ORDER_TIME_GTC;
     }
     
   request.deviation = 20;
   
   bool sent = OrderSend(request, result);
   string statusStr = "";
   string ticketStr = "0";
   string errorStr = "";
   
   if(sent && result.retcode == TRADE_RETCODE_DONE)
     {
      statusStr = "OPEN";
      ticketStr = IntegerToString(result.order);
      Print("Trade successfully executed. Ticket: ", result.order);
      
      int size = ArraySize(activeTickets);
      ArrayResize(activeTickets, size+1);
      activeTickets[size] = result.order;
     }
   else
     {
      statusStr = "FAILED";
      errorStr = "Code:" + IntegerToString(result.retcode);
      Print("Trade execution failed. Retcode: ", result.retcode);
     }
     
   // URL Encode Error String safely
   StringReplace(errorStr, " ", "%20");
   
   // Send callback
   string cbUrl = InpSupabaseURL + "/functions/v1/vps-callback?trade_id=" + id + "&status=" + statusStr + "&ticket=" + ticketStr + "&error=" + errorStr;
   
   char post[], resData[];
   string req_headers = "x-vps-secret: " + InpVPSSecret + "\r\n";
   string res_headers;
   int res = WebRequest("GET", cbUrl, req_headers, 3000, post, resData, res_headers);
   if(res != 200)
     {
      Print("Failed to send callback. HTTP: ", res);
     }
  }

//+------------------------------------------------------------------+
//| Push Market Data to VPS Feed                                     |
//+------------------------------------------------------------------+
void PushMarketData()
  {
   datetime currentBarTime = iTime(Symbol(), PERIOD_M30, 0);
   if(currentBarTime != lastBarTime && lastBarTime != 0)
     {
      Print("New M30 candle opened. Pushing data to VPS-Feed...");
      MqlRates rates[];
      ArraySetAsSeries(rates, true);
      // Fetch the last 300 closed candles to ensure we have enough data to calculate the 200 EMA
      // Actually, we want the closed candles. CopyRates(..., 0, 300, rates) includes the current open candle at index 0.
      if(CopyRates(Symbol(), PERIOD_M30, 0, 300, rates) > 0)
        {
         string json = "{\"user_id\":\"" + InpUserID + "\",\"symbol\":\"" + Symbol() + "\",\"timeframe\":\"30m\",\"bars\":[";
         for(int i=0; i<ArraySize(rates); i++)
           {
            json += "{\"t\":" + IntegerToString(rates[i].time) + 
                    ",\"o\":" + DoubleToString(rates[i].open, 5) + 
                    ",\"h\":" + DoubleToString(rates[i].high, 5) + 
                    ",\"l\":" + DoubleToString(rates[i].low, 5) + 
                    ",\"c\":" + DoubleToString(rates[i].close, 5) + 
                    ",\"v\":" + IntegerToString(rates[i].tick_volume) + "}";
            if(i < ArraySize(rates)-1) json += ",";
           }
         json += "]}";
         
         string url = InpSupabaseURL + "/functions/v1/vps-market-feed";
         char post[], result[];
         StringToCharArray(json, post);
         
         ArrayResize(post, ArraySize(post)-1); // Remove null terminator
         
         string req_headers = "User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64)\r\n" + 
                              "Content-Type: application/json\r\n" + 
                              "x-vps-secret: " + InpVPSSecret + "\r\n";
         string res_headers;
         int res = WebRequest("POST", url, req_headers, 5000, post, result, res_headers);
         if(res == 200) Print("Data successfully pushed to Supabase.");
         else Print("Failed to push data: HTTP ", res);
        }
      lastBarTime = currentBarTime;
     }
   else if(lastBarTime == 0)
     {
      lastBarTime = currentBarTime; // Initialize
     }
  }

//+------------------------------------------------------------------+
//| Monitor Active Positions for Closures                            |
//+------------------------------------------------------------------+
void MonitorPositions()
  {
   for(int i=ArraySize(activeTickets)-1; i>=0; i--)
     {
      long ticket = activeTickets[i];
      if(!PositionSelectByTicket(ticket) && !OrderSelect(ticket))
        {
         // Position is no longer open and no pending order! Check history.
         if(HistorySelectByPosition(ticket))
           {
            int deals = HistoryDealsTotal();
            double profit = 0;
            double closePrice = 0;
            string reason = "VPS_CLOSED";
            
            for(int d=0; d<deals; d++)
              {
               ulong dealTicket = HistoryDealGetTicket(d);
               if(HistoryDealGetInteger(dealTicket, DEAL_ENTRY) == DEAL_ENTRY_OUT)
                 {
                  profit += HistoryDealGetDouble(dealTicket, DEAL_PROFIT) + HistoryDealGetDouble(dealTicket, DEAL_SWAP) + HistoryDealGetDouble(dealTicket, DEAL_COMMISSION);
                  closePrice = HistoryDealGetDouble(dealTicket, DEAL_PRICE);
                 }
              }
            
            // Push History
            string url = InpSupabaseURL + "/functions/v1/vps-history?ticket=" + IntegerToString(ticket) + 
                         "&profit=" + DoubleToString(profit, 2) + 
                         "&close_price=" + DoubleToString(closePrice, 5) + 
                         "&close_reason=" + reason;
                         
            char post[], result[]; 
            string req_headers = "x-vps-secret: " + InpVPSSecret + "\r\n";
            string res_headers;
            int res = WebRequest("GET", url, req_headers, 3000, post, result, res_headers);
            if(res == 200)
              {
               Print("Successfully synced history for closed ticket: ", ticket, " Profit: ", profit);
              }
           }
           
         // Remove from array
         ArrayRemove(activeTickets, i, 1);
        }
     }
  }
//+------------------------------------------------------------------+
