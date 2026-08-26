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

string TrackedSymbols[] = {"EURUSD", "GBPUSD", "USDJPY", "AUDUSD", "NZDUSD", "EURJPY", "GBPJPY", "XAUUSD", "XAGUSD", "BTCUSD", "UKOIL", "NAS100"};
datetime lastBarTimes[12];
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
                        "x-vps-secret: " + InpVPSSecret;
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
            CloseTrade(id, ticket);
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
      string symbol = PositionGetString(POSITION_SYMBOL);
      int symDigits = (int)SymbolInfoInteger(symbol, SYMBOL_DIGITS);
      
      double currentSl = NormalizeDouble(PositionGetDouble(POSITION_SL), symDigits);
      double currentTp = NormalizeDouble(PositionGetDouble(POSITION_TP), symDigits);
      
      double normNewSl = NormalizeDouble(newSl, symDigits);
      double normNewTp = NormalizeDouble(newTp, symDigits);
      
      // Only modify if there's an actual change after normalization
      if (currentSl != normNewSl || currentTp != normNewTp)
        {
         MqlTradeRequest request;
         MqlTradeResult  result;
         ZeroMemory(request);
         ZeroMemory(result);
         
         request.action = TRADE_ACTION_SLTP;
         request.symbol = symbol;
         request.position = ticket;
         request.sl = normNewSl;
         request.tp = normNewTp;
         request.magic = 410673;
         
         if(OrderSend(request, result))
           {
            Print("Modified Position ", ticket, " SL: ", request.sl, " TP: ", request.tp);
           }
         else
           {
            Print("Failed to modify position ", ticket, " Retcode: ", result.retcode, " Error: ", GetLastError());
           }
        }
     }
  }

//+------------------------------------------------------------------+
//| Close Trade (Positions and Pending Orders)                       |
//+------------------------------------------------------------------+
void CloseTrade(string id, long ticket)
  {
   MqlTradeRequest request;
   MqlTradeResult  result;
   ZeroMemory(request);
   ZeroMemory(result);
   
   string statusStr = "";
   string errorStr = "";
   bool executed = false;
   
   if(PositionSelectByTicket(ticket))
     {
      request.action = TRADE_ACTION_DEAL;
      request.position = ticket;
      request.symbol = PositionGetString(POSITION_SYMBOL);
      SymbolSelect(request.symbol, true); // Ensure it's in Market Watch
      
      // Wait for prices to become available in Market Watch
      int attempts = 0;
      while(SymbolInfoDouble(request.symbol, SYMBOL_ASK) == 0 && attempts < 10)
        {
         Sleep(100);
         attempts++;
        }
        
      request.volume = PositionGetDouble(POSITION_VOLUME);
      request.type = (ENUM_ORDER_TYPE)(PositionGetInteger(POSITION_TYPE) == POSITION_TYPE_BUY ? ORDER_TYPE_SELL : ORDER_TYPE_BUY);
      request.price = SymbolInfoDouble(request.symbol, request.type == ORDER_TYPE_SELL ? SYMBOL_BID : SYMBOL_ASK);
      request.deviation = 50;
      request.magic = 410673;
      
      if(OrderSend(request, result))
        {
         Print("Closed Position ", ticket);
         statusStr = "CLOSED";
         executed = true;
        }
      else
        {
         Print("Failed to close position ", ticket, " Error: ", GetLastError());
         statusStr = "VPS_CLOSE"; // Leave it as VPS_CLOSE to retry later
         errorStr = "Code:" + IntegerToString(GetLastError());
        }
     }
   else if (OrderSelect(ticket))
     {
      request.action = TRADE_ACTION_REMOVE;
      request.order = ticket;
      if(OrderSend(request, result))
        {
         Print("Canceled Pending Order ", ticket);
         statusStr = "CLOSED";
         executed = true;
        }
      else
        {
         Print("Failed to cancel pending order ", ticket, " Error: ", GetLastError());
         statusStr = "VPS_CLOSE"; 
         errorStr = "Code:" + IntegerToString(GetLastError());
        }
     }
     
   if (executed || statusStr != "")
     {
      StringReplace(errorStr, " ", "%20");
      string cbUrl = InpSupabaseURL + "/functions/v1/vps-callback?trade_id=" + id + "&status=" + statusStr + "&ticket=" + IntegerToString(ticket) + "&error=" + errorStr;
      
      char post[], resData[];
      string req_headers = "x-vps-secret: " + InpVPSSecret + "\r\n";
      string res_headers;
      int res = WebRequest("GET", cbUrl, req_headers, 3000, post, resData, res_headers);
      if(res != 200)
        {
         Print("Failed to send close callback. HTTP: ", res);
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
   
   int symDigits = (int)SymbolInfoInteger(symbol, SYMBOL_DIGITS);
   double point = SymbolInfoDouble(symbol, SYMBOL_POINT);
   int stopsLevel = (int)SymbolInfoInteger(symbol, SYMBOL_TRADE_STOPS_LEVEL);
   double minStopDist = (stopsLevel + 5) * point;
   
   // Volume Normalization
   double minLot = SymbolInfoDouble(symbol, SYMBOL_VOLUME_MIN);
   double maxLot = SymbolInfoDouble(symbol, SYMBOL_VOLUME_MAX);
   double lotStep = SymbolInfoDouble(symbol, SYMBOL_VOLUME_STEP);
   if (lotStep <= 0) lotStep = 0.01;
   if (minLot <= 0) minLot = 0.01;
   if (maxLot <= 0) maxLot = 100.0;
   
   double normVolume = MathFloor(volume / lotStep) * lotStep;
   normVolume = MathMax(minLot, MathMin(maxLot, normVolume));
   normVolume = NormalizeDouble(normVolume, 2);
   
   // Price & Stop Normalization
   double normSl = (sl > 0) ? NormalizeDouble(sl, symDigits) : 0;
   double normTp = (tp > 0) ? NormalizeDouble(tp, symDigits) : 0;
   double normEntry = (entryPrice > 0) ? NormalizeDouble(entryPrice, symDigits) : 0;
   
   double ask = SymbolInfoDouble(symbol, SYMBOL_ASK);
   double bid = SymbolInfoDouble(symbol, SYMBOL_BID);
   
   MqlTradeRequest request;
   MqlTradeResult  result;
   ZeroMemory(request);
   ZeroMemory(result);
   
   request.symbol = symbol;
   request.volume = normVolume;
   request.magic = 410673; // RaineBank Magic
   request.comment = "RaineBank AI";
   request.deviation = 30;
   
   // Adaptive Order Type & Price Routing (Prevents Error 10015 on slipped pending orders)
   if(orderTypeStr == "BUY MARKET")
     {
      request.action = TRADE_ACTION_DEAL;
      request.type = ORDER_TYPE_BUY;
      request.price = ask;
     }
   else if(orderTypeStr == "SELL MARKET")
     {
      request.action = TRADE_ACTION_DEAL;
      request.type = ORDER_TYPE_SELL;
      request.price = bid;
     }
   else if(orderTypeStr == "BUY LIMIT")
     {
      if(normEntry >= ask - minStopDist)
        {
         // Price has already dipped below/at limit (favorable execution) -> Execute at Market
         request.action = TRADE_ACTION_DEAL;
         request.type = ORDER_TYPE_BUY;
         request.price = ask;
         Print("BUY LIMIT entry ", normEntry, " >= live Ask ", ask, ". Adaptively executed as BUY MARKET.");
        }
      else
        {
         request.action = TRADE_ACTION_PENDING;
         request.type = ORDER_TYPE_BUY_LIMIT;
         request.price = normEntry;
         request.type_time = ORDER_TIME_GTC;
        }
     }
   else if(orderTypeStr == "SELL LIMIT")
     {
      if(normEntry <= bid + minStopDist)
        {
         // Price has already risen above/at limit (favorable execution) -> Execute at Market
         request.action = TRADE_ACTION_DEAL;
         request.type = ORDER_TYPE_SELL;
         request.price = bid;
         Print("SELL LIMIT entry ", normEntry, " <= live Bid ", bid, ". Adaptively executed as SELL MARKET.");
        }
      else
        {
         request.action = TRADE_ACTION_PENDING;
         request.type = ORDER_TYPE_SELL_LIMIT;
         request.price = normEntry;
         request.type_time = ORDER_TIME_GTC;
        }
     }
   else if(orderTypeStr == "BUY STOP")
     {
      if(normEntry <= ask + minStopDist)
        {
         // Price has already broken past stop entry -> Execute at Market
         request.action = TRADE_ACTION_DEAL;
         request.type = ORDER_TYPE_BUY;
         request.price = ask;
         Print("BUY STOP entry ", normEntry, " <= live Ask ", ask, ". Adaptively executed as BUY MARKET.");
        }
      else
        {
         request.action = TRADE_ACTION_PENDING;
         request.type = ORDER_TYPE_BUY_STOP;
         request.price = normEntry;
         request.type_time = ORDER_TIME_GTC;
        }
     }
   else if(orderTypeStr == "SELL STOP")
     {
      if(normEntry >= bid - minStopDist)
        {
         // Price has already broken down past stop entry -> Execute at Market
         request.action = TRADE_ACTION_DEAL;
         request.type = ORDER_TYPE_SELL;
         request.price = bid;
         Print("SELL STOP entry ", normEntry, " >= live Bid ", bid, ". Adaptively executed as SELL MARKET.");
        }
      else
        {
         request.action = TRADE_ACTION_PENDING;
         request.type = ORDER_TYPE_SELL_STOP;
         request.price = normEntry;
         request.type_time = ORDER_TIME_GTC;
        }
     }
   else
     {
      // Fallback
      if(side == "LONG" || side == "BUY")
        {
         request.action = TRADE_ACTION_DEAL;
         request.type = ORDER_TYPE_BUY;
         request.price = ask;
        }
      else
        {
         request.action = TRADE_ACTION_DEAL;
         request.type = ORDER_TYPE_SELL;
         request.price = bid;
        }
     }

   // Pre-flight Stop & TP Alignment Guard (Prevents Error 10016)
   if(request.type == ORDER_TYPE_BUY || request.type == ORDER_TYPE_BUY_LIMIT || request.type == ORDER_TYPE_BUY_STOP)
     {
      if(normSl > 0 && normSl >= request.price - minStopDist)
         normSl = NormalizeDouble(request.price - minStopDist, symDigits);
      if(normTp > 0 && normTp <= request.price + minStopDist)
         normTp = NormalizeDouble(request.price + minStopDist, symDigits);
     }
   else
     {
      if(normSl > 0 && normSl <= request.price + minStopDist)
         normSl = NormalizeDouble(request.price + minStopDist, symDigits);
      if(normTp > 0 && normTp >= request.price - minStopDist)
         normTp = NormalizeDouble(request.price - minStopDist, symDigits);
     }

   request.sl = normSl;
   request.tp = normTp;
   
   bool sent = OrderSend(request, result);
   string statusStr = "";
   string ticketStr = "0";
   string errorStr = "";
   
   if(sent && (result.retcode == TRADE_RETCODE_DONE || result.retcode == TRADE_RETCODE_PLACED))
     {
      statusStr = "OPEN";
      ticketStr = IntegerToString(result.order);
      Print("Trade successfully executed. Ticket: ", result.order, " Action: ", request.action, " Type: ", request.type);
      
      int size = ArraySize(activeTickets);
      ArrayResize(activeTickets, size+1);
      activeTickets[size] = result.order;
     }
   else
     {
      statusStr = "FAILED";
      errorStr = "Code:" + IntegerToString(result.retcode);
      Print("Trade execution failed. Retcode: ", result.retcode, " (Error 10015/10016 prevented where possible)");
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
   for (int s = 0; s < ArraySize(TrackedSymbols); s++)
     {
      string sym = TrackedSymbols[s];
      SymbolSelect(sym, true); // Ensure symbol is available in Market Watch
      
      datetime currentBarTime = iTime(sym, PERIOD_M30, 0);
      if(currentBarTime != lastBarTimes[s] && lastBarTimes[s] != 0)
        {
         Print("New M30 candle opened for ", sym, ". Pushing data to VPS-Feed...");
         MqlRates rates[];
         ArraySetAsSeries(rates, true);
         // Fetch the last 300 closed candles to ensure we have enough data to calculate the 200 EMA
         // Actually, we want the closed candles. CopyRates(..., 0, 300, rates) includes the current open candle at index 0.
         if(CopyRates(sym, PERIOD_M30, 0, 300, rates) > 0)
           {
            string json = "{\"user_id\":\"" + InpUserID + "\",\"symbol\":\"" + sym + "\",\"timeframe\":\"30m\",\"bars\":[";
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
                                 "x-vps-secret: " + InpVPSSecret;
            string res_headers;
            int res = WebRequest("POST", url, req_headers, 5000, post, result, res_headers);
            if(res == 200) Print("Data successfully pushed to Supabase for ", sym);
            else Print("Failed to push data for ", sym, ": HTTP ", res, " Body: ", CharArrayToString(result));
            
            // Push D1 Data
            MqlRates ratesD1[];
            ArraySetAsSeries(ratesD1, true);
            if(CopyRates(sym, PERIOD_D1, 0, 100, ratesD1) > 0)
              {
               string jsonD1 = "{\"user_id\":\"" + InpUserID + "\",\"symbol\":\"" + sym + "\",\"timeframe\":\"1d\",\"bars\":[";
               for(int i=0; i<ArraySize(ratesD1); i++)
                 {
                  jsonD1 += "{\"t\":" + IntegerToString(ratesD1[i].time) + 
                          ",\"o\":" + DoubleToString(ratesD1[i].open, 5) + 
                          ",\"h\":" + DoubleToString(ratesD1[i].high, 5) + 
                          ",\"l\":" + DoubleToString(ratesD1[i].low, 5) + 
                          ",\"c\":" + DoubleToString(ratesD1[i].close, 5) + 
                          ",\"v\":" + IntegerToString(ratesD1[i].tick_volume) + "}";
                  if(i < ArraySize(ratesD1)-1) jsonD1 += ",";
                 }
               jsonD1 += "]}";
               
               char postD1[], resultD1[];
               StringToCharArray(jsonD1, postD1);
               ArrayResize(postD1, ArraySize(postD1)-1);
               
               int resD1 = WebRequest("POST", url, req_headers, 5000, postD1, resultD1, res_headers);
               if(resD1 == 200) Print("D1 Data successfully pushed to Supabase for ", sym);
               else Print("Failed to push D1 data for ", sym, ": HTTP ", resD1, " Body: ", CharArrayToString(resultD1));
              }
              
            // Push H1 and H4 Data for specific symbols
            if (sym == "XAUUSD" || sym == "BTCUSD" || sym == "XAGUSD" || sym == "US30" || sym == "NAS100")
              {
               // H1
               MqlRates ratesH1[];
               ArraySetAsSeries(ratesH1, true);
               if(CopyRates(sym, PERIOD_H1, 0, 300, ratesH1) > 0)
                 {
                  string jsonH1 = "{\"user_id\":\"" + InpUserID + "\",\"symbol\":\"" + sym + "\",\"timeframe\":\"1h\",\"bars\":[";
                  for(int i=0; i<ArraySize(ratesH1); i++)
                    {
                     jsonH1 += "{\"t\":" + IntegerToString(ratesH1[i].time) + 
                             ",\"o\":" + DoubleToString(ratesH1[i].open, 5) + 
                             ",\"h\":" + DoubleToString(ratesH1[i].high, 5) + 
                             ",\"l\":" + DoubleToString(ratesH1[i].low, 5) + 
                             ",\"c\":" + DoubleToString(ratesH1[i].close, 5) + 
                             ",\"v\":" + IntegerToString(ratesH1[i].tick_volume) + "}";
                     if(i < ArraySize(ratesH1)-1) jsonH1 += ",";
                    }
                  jsonH1 += "]}";
                  
                  char postH1[], resultH1[];
                  StringToCharArray(jsonH1, postH1);
                  ArrayResize(postH1, ArraySize(postH1)-1);
                  
                  int resH1 = WebRequest("POST", url, req_headers, 5000, postH1, resultH1, res_headers);
                  if(resH1 == 200) Print("H1 Data successfully pushed to Supabase for ", sym);
                  else Print("Failed to push H1 data for ", sym, ": HTTP ", resH1, " Body: ", CharArrayToString(resultH1));
                 }
               
               // H4
               MqlRates ratesH4[];
               ArraySetAsSeries(ratesH4, true);
               if(CopyRates(sym, PERIOD_H4, 0, 300, ratesH4) > 0)
                 {
                  string jsonH4 = "{\"user_id\":\"" + InpUserID + "\",\"symbol\":\"" + sym + "\",\"timeframe\":\"4h\",\"bars\":[";
                  for(int i=0; i<ArraySize(ratesH4); i++)
                    {
                     jsonH4 += "{\"t\":" + IntegerToString(ratesH4[i].time) + 
                             ",\"o\":" + DoubleToString(ratesH4[i].open, 5) + 
                             ",\"h\":" + DoubleToString(ratesH4[i].high, 5) + 
                             ",\"l\":" + DoubleToString(ratesH4[i].low, 5) + 
                             ",\"c\":" + DoubleToString(ratesH4[i].close, 5) + 
                             ",\"v\":" + IntegerToString(ratesH4[i].tick_volume) + "}";
                     if(i < ArraySize(ratesH4)-1) jsonH4 += ",";
                    }
                  jsonH4 += "]}";
                  
                  char postH4[], resultH4[];
                  StringToCharArray(jsonH4, postH4);
                  ArrayResize(postH4, ArraySize(postH4)-1);
                  
                  int resH4 = WebRequest("POST", url, req_headers, 5000, postH4, resultH4, res_headers);
                  if(resH4 == 200) Print("H4 Data successfully pushed to Supabase for ", sym);
                  else Print("Failed to push H4 data for ", sym, ": HTTP ", resH4, " Body: ", CharArrayToString(resultH4));
                 }
              }
           }
         lastBarTimes[s] = currentBarTime;
        }
      else if(lastBarTimes[s] == 0)
        {
         lastBarTimes[s] = 1; // Set to 1 to force an immediate mismatch and push on the very next timer tick, ensuring instant backfill on startup.
        }
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
