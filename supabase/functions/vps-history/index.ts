import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2.108.2";

serve(async (req) => {
  try {
    if (req.headers.get("x-vps-secret") !== Deno.env.get("VPS_SECRET_KEY")) {
      return new Response("Unauthorized", { status: 401 });
    }
    const url = new URL(req.url);
    const ticket = url.searchParams.get("ticket");
    const profit = url.searchParams.get("profit");
    const closePrice = url.searchParams.get("close_price");
    const reason = url.searchParams.get("close_reason") || "VPS_CLOSED";

    if (!ticket || !profit || !closePrice) {
      return new Response("Missing parameters", { status: 400 });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const supabase = createClient(supabaseUrl, supabaseKey);

    // 1. Find the trade in user_trades
    const { data: trades, error: findError } = await supabase
      .from("user_trades")
      .select("id, user_id, opportunity_id, symbol, volume, risk_amount")
      .eq("meta_api_order_id", ticket);

    if (findError) throw findError;
    if (!trades || trades.length === 0) {
       return new Response("Trade not found", { status: 404 });
    }

    const trade = trades[0];
    const profitUsd = Number(profit);
    const isWin = profitUsd > 0;
    const finalStatus = isWin ? "WON" : "LOST";
    const closedAt = new Date().toISOString();

    const updatePayload: any = {
      status: finalStatus,
      close_price: Number(closePrice),
      profit_usd: profitUsd,
      closed_at: closedAt,
      error_message: reason
    };

    // 2. Update user_trades
    const { error: updateError } = await supabase
      .from("user_trades")
      .update(updatePayload)
      .eq("id", trade.id);

    if (updateError) throw updateError;

    // 3. Update user_risk_settings (Drawdown Breaker: Capital & HWM)
    if (trade.user_id) {
      const { data: userRisk } = await supabase
        .from("user_risk_settings")
        .select("portfolio_capital, high_water_mark_equity")
        .eq("user_id", trade.user_id)
        .single();
        
      if (userRisk) {
        const newCapital = Number(userRisk.portfolio_capital || 0) + profitUsd;
        const newHighWaterMark = Math.max(Number(userRisk.high_water_mark_equity) || 0, newCapital);
        
        await supabase
          .from("user_risk_settings")
          .update({
            portfolio_capital: newCapital,
            high_water_mark_equity: newHighWaterMark
          })
          .eq("user_id", trade.user_id);
      }
    }

    // 4. Reconcile parent trade_opportunity if all legs closed
    if (trade.opportunity_id) {
      const { data: siblingTrades } = await supabase
        .from("user_trades")
        .select("id, status, profit_usd, risk_amount")
        .eq("opportunity_id", trade.opportunity_id);

      if (siblingTrades && siblingTrades.length > 0) {
        const hasActiveLegs = siblingTrades.some(st => ["OPEN", "PENDING", "VPS_PENDING", "VPS_PROCESSING"].includes(st.status));
        if (!hasActiveLegs) {
          const totalNetProfit = siblingTrades.reduce((acc, st) => acc + (Number(st.profit_usd) || 0), 0);
          const totalRisk = siblingTrades.reduce((acc, st) => acc + (Number(st.risk_amount) || 0), 0);
          const oppOutcome = totalNetProfit > 0 ? "WON" : (totalNetProfit < 0 ? "LOST" : "EXPIRED");
          const rMultiple = totalRisk > 0 ? Number((totalNetProfit / totalRisk).toFixed(2)) : (totalNetProfit > 0 ? 1.0 : -1.0);

          await supabase
            .from("trade_opportunities")
            .update({
              status: oppOutcome,
              r_multiple: rMultiple,
              closed_at: closedAt
            })
            .eq("id", trade.opportunity_id)
            .in("status", ["ACTIVE", "APPROVED", "QUEUED"]);

          console.log(`[VPS History] Reconciled opportunity ${trade.opportunity_id} -> ${oppOutcome} (Net: $${totalNetProfit.toFixed(2)})`);
        }
      }
    }

    return new Response("OK", { headers: { "Content-Type": "text/plain" } });
  } catch (error: any) {
    console.error("Error updating VPS history:", error);
    return new Response(`ERROR: ${error.message}`, { status: 500 });
  }
});
