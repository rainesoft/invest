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
     
   EventSetTimer(1);
   Print("RaineBank VPS Bridge initialized. Polling every 1 second.");
   return(INIT_SUCCEEDED);
  }

//+------------------------------------------------------------------+
//| Expert deinitialization function                                 |
//+------------------------------------------------------------------+
void OnDeinit(const int reason)
  {
   EventKillTimer();
   Print("RaineBank VPS Bridge stopped.");
  }

//+------------------------------------------------------------------+
//| Expert timer function                                            |
//+------------------------------------------------------------------+
void OnTimer()
  {
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
