import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2.108.2";

const baseUrl = Deno.env.get("META_API_BASE_URL") || "https://mt-client-api-v1.london.agiliumtrade.ai";

serve(async (req) => {
  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!supabaseUrl || !supabaseKey) {
      return new Response("Server Configuration Error", { status: 500 });
    }

    const authHeader = req.headers.get("Authorization");
    const cronSecretHeader = req.headers.get("x-cron-secret");
    const cronSecretEnv = Deno.env.get("CRON_SECRET");
    
    const isAuthorized = 
      authHeader === `Bearer ${supabaseKey}` || 
      (cronSecretHeader && cronSecretEnv && cronSecretHeader === cronSecretEnv);

    if (!isAuthorized) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
    }

    const supabase = createClient(supabaseUrl, supabaseKey);

    // Fetch all currently OPEN trades
    const { data: openTrades, error: tradesError } = await supabase
      .from("user_trades")
      .select("id, user_id, symbol, meta_api_order_id, created_at")
      .eq("status", "OPEN");

    if (tradesError || !openTrades || openTrades.length === 0) {
      return new Response(JSON.stringify({ success: true, message: "No OPEN trades to sync." }), { status: 200 });
    }

    // Fetch user tokens for these specific users
    const userIds = [...new Set(openTrades.map(t => t.user_id))];
    const { data: userSettings, error: settingsError } = await supabase
      .from("user_risk_settings")
      .select("user_id, meta_api_token, meta_api_account_id, active_broker")
      .in("user_id", userIds);

    if (settingsError || !userSettings) {
      return new Response(JSON.stringify({ error: "Failed to fetch user settings." }), { status: 500 });
    }

    const settingsMap = new Map();
    for (const s of userSettings) {
      settingsMap.set(s.user_id, s);
    }

    // Group by user account to minimize MetaAPI calls
    const userGroups = new Map();
    for (const t of openTrades) {
      const u = settingsMap.get(t.user_id);
      if (!u || u.active_broker === 'MT5_VPS' || !u.meta_api_token || !u.meta_api_account_id) continue;

      if (!userGroups.has(u.meta_api_account_id)) {
        userGroups.set(u.meta_api_account_id, {
          token: u.meta_api_token,
          userId: t.user_id,
          trades: []
        });
      }
      userGroups.get(u.meta_api_account_id).trades.push(t);
    }

    const report = [];

    const now = new Date();
    // Query last 72 hours of history just to be safe
    const startTime = new Date(now.getTime() - 72 * 60 * 60 * 1000).toISOString();
    const endTime = now.toISOString();

    for (const [accountId, data] of userGroups.entries()) {
      const { token, trades } = data;

      try {
        const historyUrl = `${baseUrl}/users/current/accounts/${accountId}/history-positions/time?startTime=${startTime}&endTime=${endTime}`;
        const historyRes = await fetch(historyUrl, { headers: { "auth-token": token } });

        if (!historyRes.ok) {
          console.error(`[History Sync] Failed to fetch history for ${accountId}: ${await historyRes.text()}`);
          continue;
        }

        const historyPositions = await historyRes.json();
        
        // Convert history to a map indexed by clientId
        const closedTradesByClientId = new Map();
        // Also map by platform positionId as fallback for older trades that didn't have clientId
        const closedTradesByOrderId = new Map();

        for (const pos of historyPositions) {
          if (pos.clientId) closedTradesByClientId.set(pos.clientId, pos);
          if (pos.id) closedTradesByOrderId.set(String(pos.id), pos);
        }

        for (const dbTrade of trades) {
          let matchedPos = closedTradesByClientId.get(dbTrade.id);
          
          if (!matchedPos && dbTrade.meta_api_order_id) {
             matchedPos = closedTradesByOrderId.get(String(dbTrade.meta_api_order_id));
          }

          if (matchedPos) {
            console.log(`[History Sync] Found closed trade ${dbTrade.id} (${dbTrade.symbol}) in MetaAPI history.`);
            const pnl = matchedPos.profit || matchedPos.realizedProfit || 0;
            const newStatus = pnl > 0 ? "WON" : "LOST";
            
            await supabase.from("user_trades").update({
               status: newStatus
            }).eq("id", dbTrade.id);
            
            report.push({ id: dbTrade.id, symbol: dbTrade.symbol, status: newStatus, profit: pnl });
          }
        }
      } catch (e) {
        console.error(`[History Sync] Exception for account ${accountId}:`, e);
      }
    }

    return new Response(JSON.stringify({ success: true, report }), { status: 200, headers: { "Content-Type": "application/json" }});

  } catch (err: any) {
    console.error(`[History Sync] Global Exception:`, err);
    return new Response(`Server error: ${err.message}`, { status: 500 });
  }
});
