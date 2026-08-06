import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2.108.2";
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

    const authHeader = req.headers.get("Authorization");
    const cronSecretHeader = req.headers.get("x-cron-secret");
    const cronSecretEnv = Deno.env.get("CRON_SECRET");

    const isAuthorized =
      authHeader === `Bearer ${supabaseKey}` ||
      (cronSecretHeader && cronSecretEnv && cronSecretHeader === cronSecretEnv);

    if (!isAuthorized) {
      return new Response(JSON.stringify({ ok: false, error: "Unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }

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
      let entryPrice: number | null = null;
      let stopLoss: number | null = null;

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

      if (triggered && entryPrice !== null && stopLoss !== null) {
        console.log(`[Sniper] TRIGGERED ${watch.symbol} for ${watch.direction} at ${entryPrice}`);

        const risk = Math.abs(entryPrice - stopLoss);

        // ===================================================================
        // FEATURE 2: LTF DRILLDOWN INTEGRATION (agent-swing → agent-sniper)
        // ===================================================================
        // When a watchlist row originates from agent-swing (REQUIRE_LTF_DRILLDOWN),
        // inherit the swing's Fibonacci extension TPs from market_context instead
        // of the generic 1.5R / 2.5R / 4R multiples. This closes the full
        // swing → sniper S-Tier pipeline loop.
        let tp1!: number, tp2!: number, tp3!: number;
        let inheritedFromSwing = false;
        let inheritedTraceId: string | null = null;

        if (watch.source_agent === "agent-swing") {
          console.log(`[Sniper] [LTF Drilldown] Watchlist from agent-swing — fetching Fib TPs from market_context for ${watch.symbol}`);

          const { data: swingCtx } = await supabase
            .from("market_context")
            .select("key_levels, trace_id")
            .eq("symbol", watch.symbol)
            .eq("agent_persona", "SWING_TRADER")
            .gt("expires_at", new Date().toISOString())
            .order("created_at", { ascending: false })
            .limit(1)
            .single();

          if (swingCtx?.key_levels?.fib_extensions && Array.isArray(swingCtx.key_levels.fib_extensions)) {
            const extensions: Array<{ label: string; price: number }> = swingCtx.key_levels.fib_extensions;
            inheritedTraceId = swingCtx.trace_id ?? null;

            // Sort extension levels by proximity to current price, filtering to only
            // levels beyond the entry in the trade direction.
            const extLevels = extensions
              .filter((l) => l.price !== null && typeof l.price === "number")
              .filter((l) =>
                watch.direction === "LONG" ? l.price > entryPrice! : l.price < entryPrice!
              )
              .sort((a, b) =>
                watch.direction === "LONG"
                  ? a.price - b.price   // ascending: closest above entry first
                  : b.price - a.price   // descending: closest below entry first
              );

            if (extLevels.length >= 3) {
              tp1 = extLevels[0].price;
              tp2 = extLevels[1].price;
              tp3 = extLevels[2].price;
              inheritedFromSwing = true;
              console.log(`[Sniper] [LTF Drilldown] Inherited Fib TPs: TP1=${tp1}, TP2=${tp2}, TP3=${tp3}`);
            } else if (extLevels.length >= 1) {
              // Partial Fib data — use what we have and fall back for the rest
              const fallLong = (r: number) => entryPrice! + risk * r;
              const fallShort = (r: number) => entryPrice! - risk * r;
              tp1 = extLevels[0]?.price ?? (watch.direction === "LONG" ? fallLong(1.5) : fallShort(1.5));
              tp2 = extLevels[1]?.price ?? (watch.direction === "LONG" ? fallLong(2.5) : fallShort(2.5));
              tp3 = extLevels[2]?.price ?? (watch.direction === "LONG" ? fallLong(4.0) : fallShort(4.0));
              inheritedFromSwing = true;
            }
          }
        }

        // Fallback: generic R-multiple TPs for non-swing drilldowns or when swing ctx is unavailable
        if (!inheritedFromSwing) {
          if (watch.direction === "LONG") {
            tp1 = entryPrice + (risk * 1.5);
            tp2 = entryPrice + (risk * 2.5);
            tp3 = entryPrice + (risk * 4.0);
          } else {
            tp1 = entryPrice - (risk * 1.5);
            tp2 = entryPrice - (risk * 2.5);
            tp3 = entryPrice - (risk * 4.0);
          }
        }

        // Confidence: inherit swing's macro_score (minimum 90 for a swing-drilldown S-Tier signal)
        const inheritedScore = watch.macro_score ? parseInt(String(watch.macro_score), 10) : 0;
        const confidence = inheritedFromSwing
          ? Math.max(90, isNaN(inheritedScore) ? 90 : inheritedScore)
          : 95;

        const tag = inheritedFromSwing ? "[SWING→SNIPER][S-Tier]" : "[SNIPER][S-Tier]";
        const fibNote = inheritedFromSwing
          ? `Fib TPs inherited from swing analysis. TP1=${tp1.toFixed(2)}, TP2=${tp2.toFixed(2)}, TP3=${tp3.toFixed(2)}.`
          : `Algorithmic R-multiple TPs. TP2=${tp2.toFixed(2)}.`;

        // Insert trade opportunity, propagating the parent swing trace_id for full audit linkage
        await supabase.from("trade_opportunities").insert({
          symbol: watch.symbol,
          side: watch.direction,
          timeframe: "5Min",
          status: "APPROVED",
          ai_summary: `${tag} Algorithmic execution of LTF_ENTRY_WAIT watchlist. Macro score: ${watch.macro_score}. ${fibNote}`,
          ai_risks: "Managed by Sniper Algorithm",
          confidence,
          entry_plan_json: { price: entryPrice, order_type: watch.direction === "LONG" ? "BUY MARKET" : "SELL MARKET" },
          stop_plan_json: { atr, stop: stopLoss, initial: stopLoss },
          take_profit_json: { tp: tp2, tp1, tp2, tp3 },
          risk_summary: `Algorithmic LTF Trigger. ATR: ${atr}. Source: ${watch.source_agent ?? "unknown"}`,
          trace_id: inheritedTraceId ?? crypto.randomUUID(),
        });

        const alertText =
          `🎯 *${inheritedFromSwing ? "SWING→SNIPER DRILLDOWN" : "SNIPER"} EXECUTED*\n\n` +
          `*Asset:* ${watch.symbol}\n` +
          `*Side:* ${watch.direction} @ ${entryPrice}\n` +
          `*TP1:* ${tp1.toFixed(3)}\n` +
          `*TP2:* ${tp2.toFixed(3)}\n` +
          `*TP3:* ${tp3.toFixed(3)}\n` +
          `*Stop:* ${stopLoss}\n` +
          `*Confidence:* ${confidence}%\n\n` +
          (inheritedFromSwing
            ? `_Fib TPs inherited from swing analysis. Full S-Tier pipeline._`
            : `_Algorithmic execution from macro watchlist._`);

        await notifyTelegram(alertText);

        // Update Watchlist status
        await supabase.from("trade_watchlists").update({
          status: "TRIGGERED",
          triggered_at: new Date().toISOString()
        }).eq("id", watch.id);

        results.push({ symbol: watch.symbol, status: "TRIGGERED", inherited_from_swing: inheritedFromSwing, confidence });
      } else {
        results.push({ symbol: watch.symbol, status: "WATCHING", distance: "Waiting for level" });
      }
    }

    return new Response(JSON.stringify({ results }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 200,
    });
  } catch (error: any) {
    console.error("Sniper error:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500,
    });
  }
});
