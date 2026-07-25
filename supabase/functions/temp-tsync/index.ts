import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2.108.2";

serve(async (req) => {
  const META_TOKEN = Deno.env.get("META_API_TOKEN") || "";
  const META_ACCOUNT = Deno.env.get("META_API_ACCOUNT_ID") || "";
  const META_BASE = Deno.env.get("META_API_BASE_URL") || "https://mt-client-api-v1.london.agiliumtrade.ai";
  const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
  const SUPABASE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  
  const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
  
  const url = `${META_BASE}/users/current/accounts/${META_ACCOUNT}/positions`;
  const res = await fetch(url, { headers: { "auth-token": META_TOKEN } });
  const positions = await res.json();
  
  const results = [];
  
  for (const pos of positions) {
     // Lookup in user_trades
     const { data: trades } = await supabase.from("user_trades").select("opportunity_id").eq("meta_api_order_id", pos.id).limit(1);
     let atr = 0;
     
     if (trades && trades.length > 0) {
        const oppId = trades[0].opportunity_id;
        const { data: opps } = await supabase.from("trade_opportunities").select("stop_plan_json").eq("id", oppId).limit(1);
        if (opps && opps.length > 0 && opps[0].stop_plan_json && opps[0].stop_plan_json.atr) {
            atr = opps[0].stop_plan_json.atr;
        }
     }
     
     // Fallback calculations if ATR is missing
     if (atr === 0) {
        if (pos.symbol.includes("US30")) atr = 250;
        else if (pos.symbol.includes("BTC")) atr = 2784;
        else atr = 0; // Default or skip
     }
     
     if (atr > 0) {
         const distance = Number((atr * 2.0).toFixed(5));
         const modifyUrl = `${META_BASE}/users/current/accounts/${META_ACCOUNT}/trade`;
         const payload = {
            actionType: "POSITION_MODIFY",
            positionId: pos.id,
            trailingStopLoss: { distance: { distance: distance, units: "RELATIVE_PRICE" } }
         };
         const modRes = await fetch(modifyUrl, { method: "POST", headers: { "auth-token": META_TOKEN, "Content-Type": "application/json" }, body: JSON.stringify(payload) });
         results.push({ id: pos.id, symbol: pos.symbol, distance, status: modRes.status, body: await modRes.text() });
     }
  }
  
  return new Response(JSON.stringify(results), { status: 200, headers: { "Content-Type": "application/json" } });
});
