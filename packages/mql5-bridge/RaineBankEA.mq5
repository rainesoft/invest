//+------------------------------------------------------------------+
//|                                                   RaineBankEA.mq5|
//|                                                        RaineBank |
//|                                       https://www.rainebank.com/ |
//+------------------------------------------------------------------+
#property copyright "RaineBank"
#property link      "https://www.rainebank.com/"
#property version   "1.00"

input string InpSupabaseURL = "https://ktezlusdkqlfdwqrldtn.supabase.co"; // Supabase Project URL
input string InpUserID = ""; // Your User ID

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
     
   RecoverActiveTickets();
   EventSetTimer(1);
   Print("RaineBank VPS Bridge initialized. Polling every 1 second.");
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
   Print("Recovered ", ArraySize(activeTickets), " active positions.");
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

//+------------------------------------------------------------------+
//| Expert timer function                                            |
//+------------------------------------------------------------------+
void OnTimer()
  {
   PushMarketData();
   MonitorPositions();
   
   string cookie=NULL, headers;
   char post[], result[];
   int res;
   
   string pollUrl = InpSupabaseURL + "/functions/v1/vps-poll?user_id=" + InpUserID;
   
   // WebRequest to poll for trades
   ResetLastError();
   res = WebRequest("GET", pollUrl, cookie, NULL, 500, post, 0, result, headers);
   
   if(res == 200)
     {
      string text = CharArrayToString(result);
      if(text != "NO_TRADES" && StringFind(text, "ERROR:") < 0 && StringLen(text) > 5)
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
      Print("Poll Request failed. Code: ", res);
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
      
      if(StringLen(line) < 10) continue;
      
      string parts[];
      int numParts = StringSplit(line, ',', parts);
      // Format: ID,SYMBOL,SIDE,VOLUME,STOPLOSS,TAKEPROFIT,TRADE_TYPE
      if(numParts >= 6)
        {
         string id = parts[0];
         string symbol = parts[1];
         string side = parts[2];
         double volume = StringToDouble(parts[3]);
         double sl = StringToDouble(parts[4]);
         double tp = StringToDouble(parts[5]);
         
         ExecuteTrade(id, symbol, side, volume, sl, tp);
        }
     }
  }

//+------------------------------------------------------------------+
//| Execute Trade and Callback                                       |
//+------------------------------------------------------------------+
void ExecuteTrade(string id, string symbol, string side, double volume, double sl, double tp)
  {
   Print("Executing trade: ", id, " ", symbol, " ", side, " Vol:", volume, " SL:", sl, " TP:", tp);
   
   // Ensure symbol is selected in Market Watch
   SymbolSelect(symbol, true);
   
   MqlTradeRequest request;
   MqlTradeResult  result;
   ZeroMemory(request);
   ZeroMemory(result);
   
   request.action = TRADE_ACTION_DEAL;
   request.symbol = symbol;
   request.volume = volume;
   request.sl = sl;
   request.tp = tp;
   request.magic = 410673; // RaineBank Magic
   request.comment = "RaineBank AI";
   
   if(side == "LONG")
     {
      request.type = ORDER_TYPE_BUY;
      request.price = SymbolInfoDouble(symbol, SYMBOL_ASK);
     }
   else
     {
      request.type = ORDER_TYPE_SELL;
      request.price = SymbolInfoDouble(symbol, SYMBOL_BID);
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
   string headers;
   int res = WebRequest("GET", cbUrl, NULL, NULL, 3000, post, 0, resData, headers);
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
      // Fetch the last 100 closed candles (start from index 1, to get closed candles only, or start from 0 if you want current open)
      // Actually, we want the closed candles. CopyRates(..., 0, 100, rates) includes the current open candle at index 0.
      if(CopyRates(Symbol(), PERIOD_M30, 0, 100, rates) > 0)
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
         
         string headers = "Content-Type: application/json\r\n";
         int res = WebRequest("POST", url, headers, 3000, post, result, headers);
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
      if(!PositionSelectByTicket(ticket))
        {
         // Position is no longer open! Check history.
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
                         
            char post[], result[]; string headers;
            int res = WebRequest("GET", url, NULL, NULL, 3000, post, 0, result, headers);
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
