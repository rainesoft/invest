import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2.108.2";
import { fetchPaperBars } from "../../../packages/execution/index.ts";
import { getContextSnapshot } from "../../../packages/strategy/indicators.ts";

/**
 * POSITION MANAGER — Automated Trade Protection Agent
 *
 * Runs every 30 minutes on weekdays via pg_cron.
 * Performs three key functions:
 *   1. Break-Even Move: When profit ≥ 1R → move SL to entry
 *   2. Lock-in Move:    When profit ≥ 2R → move SL to entry + 1R (guaranteed profit)
 *   3. Runner Trailing: For RUNNER trades → trail SL at max(original_SL, price - 1.5×ATR)
 *
 * All moves are reported to Telegram.
 */

const META_TOKEN = Deno.env.get("META_API_TOKEN") || "";
const META_ACCOUNT = Deno.env.get("META_API_ACCOUNT_ID") || "";
const META_BASE_URL = Deno.env.get("META_API_BASE_URL") || "https://mt-client-api-v1.london.agiliumtrade.ai";
const TG_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN") ?? "";
const TG_CHAT = Deno.env.get("TELEGRAM_CHAT_ID") ?? "";

async function notifyTelegram(text: string) {
  if (!TG_TOKEN || !TG_CHAT) return;
  await fetch(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: TG_CHAT, text, parse_mode: "HTML" }),
  }).catch(() => {});
}

async function modifyPosition(positionId: string, stopLoss: number, takeProfit?: number): Promise<boolean> {
  if (!META_TOKEN || !META_ACCOUNT) return false;
  const res = await fetch(`${META_BASE_URL}/users/current/accounts/${META_ACCOUNT}/trade`, {
    method: "POST",
    headers: { "auth-token": META_TOKEN, "Content-Type": "application/json" },
    body: JSON.stringify({
      actionType: "POSITION_MODIFY",
      positionId,
      stopLoss: Number(stopLoss.toFixed(5)),
      ...(takeProfit ? { takeProfit: Number(takeProfit.toFixed(5)) } : {})
    })
  });
  return res.ok;
}

async function getBrokerPosition(positionId: string): Promise<any | null> {
  if (!META_TOKEN || !META_ACCOUNT) return null;
  const res = await fetch(
    `${META_BASE_URL}/users/current/accounts/${META_ACCOUNT}/positions/${positionId}`,
    { headers: { "auth-token": META_TOKEN } }
  );
  if (!res.ok) return null;
  const data = await res.json();
  return data?.error ? null : data;
}

serve(async (req) => {
  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    if (!META_TOKEN || !META_ACCOUNT) {
      return new Response("Missing MetaAPI credentials. Set META_API_TOKEN and META_API_ACCOUNT_ID.", { status: 500 });
    }

    // Fetch all OPEN trades with their opportunity data
    const { data: openTrades, error } = await supabase
      .from("user_trades")
      .select(`
        id, meta_api_order_id, symbol, side, status, trade_type, user_id,
        trade_opportunities (
          entry_plan_json, stop_plan_json, take_profit_json
        )
      `)
      .eq("status", "OPEN")
      .not("meta_api_order_id", "is", null);

    if (error) throw error;
    if (!openTrades || openTrades.length === 0) {
      return new Response(JSON.stringify({ message: "No open trades to manage" }), { status: 200 });
    }

    // Deduplicate: one MetaAPI position may have multiple user_trade rows (RUNNER + QUICK_EXIT)
    // Use a map of orderId → best trade_type (prefer RUNNER for trailing logic)
    const orderMap = new Map<string, any>();
    for (const trade of openTrades) {
      const id = trade.meta_api_order_id;
      if (!id) continue;
      const existing = orderMap.get(id);
      if (!existing || trade.trade_type === "RUNNER") {
        orderMap.set(id, trade);
      }
    }

    const moves: { symbol: string; action: string; from: number; to: number }[] = [];
    const errors: string[] = [];

    // Prefetch ATR for each unique symbol
    const atrCache = new Map<string, number>();
    const uniqueSymbols = [...new Set([...orderMap.values()].map(t => t.symbol))];
    for (const symbol of uniqueSymbols) {
      try {
        const bars = await fetchPaperBars(symbol, "30m", 50, supabase);
        if (bars.length >= 14) {
          const snap = getContextSnapshot(
            bars.map((b: any) => b.t),
            bars.map((b: any) => b.o),
            bars.map((b: any) => b.h),
            bars.map((b: any) => b.l),
            bars.map((b: any) => b.c)
          );
          atrCache.set(symbol, snap.atr_14 || 0);
        }
      } catch (_) { /* non-fatal */ }
    }

    for (const [orderId, trade] of orderMap) {
      try {
        const opp = trade.trade_opportunities;
        if (!opp) continue;

        const entryPrice = opp.entry_plan_json?.price || opp.entry_plan_json?.entry_price;
        const originalSl = opp.stop_plan_json?.initial || opp.stop_plan_json?.stop;
        const originalTp = opp.take_profit_json?.tp;

        if (!entryPrice || !originalSl) {
          console.log(`[Position Manager] Skipping ${trade.symbol} ${orderId}: missing entry or SL.`);
          continue;
        }

        // Fetch live broker position
        const position = await getBrokerPosition(orderId);
        if (!position) {
          console.log(`[Position Manager] Position ${orderId} not on broker — marking closed.`);
          await supabase.from("user_trades").update({ status: "CLOSED" }).eq("meta_api_order_id", orderId).eq("status", "OPEN");
          continue;
        }

        const currentPrice = Number(position.currentPrice);
        const currentSl = Number(position.stopLoss) || originalSl;
        const profit = Number(position.profit) || 0;

        // Calculate R values
        const riskDist = Math.abs(entryPrice - originalSl);
        if (riskDist === 0) continue;

        const isLong = trade.side === "LONG";
        const priceMoveInR = isLong
          ? (currentPrice - entryPrice) / riskDist
          : (entryPrice - currentPrice) / riskDist;

        const atr = atrCache.get(trade.symbol) || riskDist;

        let newSl: number | null = null;
        let action = "";

        if (trade.trade_type === "RUNNER") {
          // RUNNER: Trail at 1.5×ATR behind current price
          const trailSl = isLong
            ? currentPrice - (atr * 1.5)
            : currentPrice + (atr * 1.5);

          const isImprovement = isLong ? trailSl > currentSl : trailSl < currentSl;
          // Only trail if it's an improvement AND above original SL
          const isSafeFromOriginal = isLong ? trailSl > originalSl : trailSl < originalSl;

          if (isImprovement && isSafeFromOriginal && profit > 0) {
            newSl = Number(trailSl.toFixed(5));
            action = `TRAIL_RUNNER (+${priceMoveInR.toFixed(1)}R)`;
          }
        }

        if (!newSl) {
          // 2R → Lock in 1R profit
          if (priceMoveInR >= 2.0) {
            const lockSl = isLong
              ? Number((entryPrice + riskDist).toFixed(5))
              : Number((entryPrice - riskDist).toFixed(5));
            const isImprovement = isLong ? lockSl > currentSl : lockSl < currentSl;
            if (isImprovement) {
              newSl = lockSl;
              action = `LOCK_IN_1R (profit +${priceMoveInR.toFixed(1)}R)`;
            }
          }
          // 1R → Break-even
          else if (priceMoveInR >= 1.0) {
            const beSl = Number(entryPrice.toFixed(5));
            const isImprovement = isLong ? beSl > currentSl : beSl < currentSl;
            if (isImprovement) {
              newSl = beSl;
              action = `BREAK_EVEN (profit +${priceMoveInR.toFixed(1)}R)`;
            }
          }
        }

        if (newSl !== null) {
          console.log(`[Position Manager] ${trade.symbol} ${orderId}: ${action} — SL ${currentSl} → ${newSl}`);
          const ok = await modifyPosition(orderId, newSl, originalTp || undefined);
          if (ok) {
            moves.push({ symbol: trade.symbol, action, from: currentSl, to: newSl });
          } else {
            errors.push(`${trade.symbol} ${orderId}: MetaAPI modify failed`);
          }
        } else {
          console.log(`[Position Manager] ${trade.symbol} ${orderId}: No action needed. Profit=${priceMoveInR.toFixed(2)}R, SL=${currentSl}`);
        }

        // Rate limit between MetaAPI calls
        await new Promise(r => setTimeout(r, 300));

      } catch (err: any) {
        console.error(`[Position Manager] Error on ${orderId}: ${err.message}`);
        errors.push(`${orderId}: ${err.message}`);
      }
    }

    // Telegram report (only if there are moves to report)
    if (moves.length > 0) {
      const lines = [
        `📐 <b>Position Manager — SL Updates</b>`,
        ``,
        ...moves.map(m => `• <b>${m.symbol}</b> ${m.action}: ${m.from} → <b>${m.to}</b>`),
      ];
      if (errors.length > 0) lines.push(``, `⚠️ ${errors.length} errors — check logs`);
      await notifyTelegram(lines.join("\n"));
    }

    const result = { evaluated: orderMap.size, moves: moves.length, errors: errors.length, details: moves };
    console.log("[Position Manager] Complete:", result);
    return new Response(JSON.stringify(result), { status: 200, headers: { "Content-Type": "application/json" } });

  } catch (err: any) {
    console.error("[Position Manager] Fatal error:", err);
    return new Response(`Error: ${err.message}`, { status: 500 });
  }
});
