import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { fetchPaperBars } from "../../../packages/execution/index.ts";
import { getContextSnapshot } from "../../../packages/strategy/indicators.ts";
import { isAutoTradingEnabled } from "../../../packages/core/settings.ts";

async function notifyTelegram(text: string) {
  const TG_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN");
  const TG_CHAT = Deno.env.get("TELEGRAM_CHAT_ID");
  if (!TG_TOKEN || !TG_CHAT) return;
  const url = `https://api.telegram.org/bot${TG_TOKEN}/sendMessage`;
  await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: TG_CHAT, text, parse_mode: "Markdown" }),
  }).catch(() => {});
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const isAutoTrading = await isAutoTradingEnabled(supabase);
    if (!isAutoTrading) {
      console.log("[Sniper] Auto-trading is disabled globally.");
      return new Response(JSON.stringify({ message: "Auto trading disabled" }), { headers: corsHeaders });
    }

    // 1. Fetch active watchlists
    const { data: watchlists, error: wlError } = await supabase
      .from("trade_watchlists")
      .select("*")
      .eq("status", "WATCHING");

    if (wlError) throw wlError;
    if (!watchlists || watchlists.length === 0) {
      return new Response(JSON.stringify({ message: "No active watchlists" }), { headers: corsHeaders });
    }

    const now = new Date();
    const results = [];

    for (const watch of watchlists) {
      const expiresAt = new Date(watch.expires_at);
      if (now > expiresAt) {
        await supabase.from("trade_watchlists").update({ status: "EXPIRED" }).eq("id", watch.id);
        results.push({ symbol: watch.symbol, status: "EXPIRED" });
        continue;
      }

      // Fetch 5m candles
      const bars = await fetchPaperBars(watch.symbol, "5Min", 200, supabase);
      if (!bars || bars.length < 50) continue;

      const snapshot = getContextSnapshot(
        bars.map((b: any) => b.t),
        bars.map((b: any) => b.o),
        bars.map((b: any) => b.h),
        bars.map((b: any) => b.l),
        bars.map((b: any) => b.c)
      );

      const currentPrice = snapshot.current_price;
      const atr = snapshot.atr_14;
      let triggered = false;
      let entryPrice = null;
      let stopLoss = null;

      if (watch.direction === "LONG") {
        const fvg = snapshot.bullish_fvg_nearest;
        const ob = snapshot.bullish_ob_nearest;
        const targetLevel = fvg || ob;

        if (targetLevel) {
          const distPct = Math.abs(currentPrice - targetLevel) / targetLevel;
          if (distPct <= 0.001 || currentPrice <= targetLevel) {
            triggered = true;
            entryPrice = currentPrice;
            stopLoss = snapshot.recent_swing_low || (entryPrice - (atr * 2));
          }
        }
      } else {
        const fvg = snapshot.bearish_fvg_nearest;
        const ob = snapshot.bearish_ob_nearest;
        const targetLevel = fvg || ob;

        if (targetLevel) {
          const distPct = Math.abs(currentPrice - targetLevel) / targetLevel;
          if (distPct <= 0.001 || currentPrice >= targetLevel) {
            triggered = true;
            entryPrice = currentPrice;
            stopLoss = snapshot.recent_swing_high || (entryPrice + (atr * 2));
          }
        }
      }

      if (triggered) {
        console.log(`[Sniper] TRIGGERED ${watch.symbol} for ${watch.direction} at ${entryPrice}`);
        
        // Calculate Take Profits
        const risk = Math.abs(entryPrice - stopLoss);
        let tp1, tp2, tp3;
        if (watch.direction === "LONG") {
           tp1 = entryPrice + (risk * 1.5);
           tp2 = entryPrice + (risk * 2.5);
           tp3 = entryPrice + (risk * 4.0);
        } else {
           tp1 = entryPrice - (risk * 1.5);
           tp2 = entryPrice - (risk * 2.5);
           tp3 = entryPrice - (risk * 4.0);
        }

        // Insert Opportunity
        await supabase.from("trade_opportunities").insert({
          symbol: watch.symbol,
          side: watch.direction,
          timeframe: "5Min",
          status: "APPROVED",
          ai_summary: `[SNIPER][S-Tier] Algorithmic execution of LTF_ENTRY_WAIT watchlist. Macro score: ${watch.macro_score}`,
          ai_risks: "Managed by Sniper Algorithm",
          confidence: 95,
          entry_plan_json: { price: entryPrice, order_type: watch.direction === "LONG" ? "BUY MARKET" : "SELL MARKET" },
          stop_plan_json: { atr, stop: stopLoss, initial: stopLoss },
          take_profit_json: { tp: tp2, tp1, tp2, tp3 },
          risk_summary: `Algorithmic LTF Trigger. ATR: ${atr}`
        });

        const alertText = `🎯 *SNIPER EXECUTED*\n\n` +
                          `*Asset:* ${watch.symbol}\n` +
                          `*Side:* ${watch.direction} @ ${entryPrice}\n` +
                          `*Target:* ${tp2}\n` +
                          `*Stop:* ${stopLoss}\n\n` +
                          `_Algorithmic execution from macro watchlist._`;
        await notifyTelegram(alertText);

        // Update Watchlist
        await supabase.from("trade_watchlists").update({ 
            status: "TRIGGERED", 
            triggered_at: new Date().toISOString() 
        }).eq("id", watch.id);

        results.push({ symbol: watch.symbol, status: "TRIGGERED" });
      } else {
        results.push({ symbol: watch.symbol, status: "WATCHING", distance: "Waiting for level" });
      }
    }

    return new Response(JSON.stringify({ results }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 200,
    });
  } catch (error) {
    console.error("Sniper error:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500,
    });
  }
});
