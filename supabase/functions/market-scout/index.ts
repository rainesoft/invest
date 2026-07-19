import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2.108.2";

/**
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║           MARKET SCOUT — Supabase Edge Function                        ║
 * ║  Scheduled via pg_cron. Temporary — delete after all setups close.     ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 *
 * Polls XAUUSD + XAGUSD for 4 manual setups and fires live MetaAPI orders
 * when entry conditions are confirmed. Each fired trade is written to the
 * vault ledger: trade_opportunities → user_trades → orders.
 *
 * Scheduled: every 5 minutes from 20:00–00:00 UTC Sunday–Friday
 * (pg_cron: "* /5 20-23 * * 0-4" — runs during active Asian/London overlap)
 *
 * Can also be triggered manually via POST /market-scout with an
 * x-webhook-secret header matching WEBHOOK_SECRET env var.
 *
 * SETUPS:
 *  #1 XAUUSD LONG  — "The 50% Fib Defence"
 *  #2 XAUUSD SHORT — "The 38.2% Fib Rejection"
 *  #3 XAGUSD LONG  — "The Double Bottom"
 *  #4 XAGUSD SHORT — "The Dead Cat into Channel"
 */

const SUPABASE_URL             = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const META_TOKEN               = Deno.env.get("META_API_TOKEN") ?? "";
const META_ACCOUNT             = Deno.env.get("META_API_ACCOUNT_ID") ?? "";
const REGION                   = Deno.env.get("METAAPI_REGION") ?? "new-york";
const WEBHOOK_SECRET           = Deno.env.get("WEBHOOK_SECRET") ?? "";
const TG_TOKEN                 = Deno.env.get("TELEGRAM_BOT_TOKEN") ?? "";
const TG_CHAT                  = Deno.env.get("TELEGRAM_CHAT_ID") ?? "";
const RISK_USD                 = parseFloat(Deno.env.get("SCOUT_RISK_USD") ?? "500");  // $ to risk per trade
const DRY_RUN                  = Deno.env.get("SCOUT_DRY_RUN") === "true";

// ── LOT SIZE CALCULATOR ───────────────────────────────────────────────────────
// Dollar value per lot for a $1 price move:
//   XAUUSD: 100 oz/lot  → $100/lot per $1
//   XAGUSD: 5000 oz/lot → $5000/lot per $1
const CONTRACT_DOLLARS_PER_LOT: Record<string, number> = {
  XAUUSD: 100,
  XAGUSD: 5000,
};

function calcLots(symbol: string, entryPrice: number, sl: number): number {
  const perLot      = CONTRACT_DOLLARS_PER_LOT[symbol] ?? 100;
  const slDistance  = Math.abs(entryPrice - sl);
  if (slDistance === 0) return 0.01;
  const raw = RISK_USD / (slDistance * perLot);
  // Round to 2 decimal places, min 0.01, max 50
  return Math.min(50, Math.max(0.01, Math.round(raw * 100) / 100));
}

const MT_CLIENT = `https://mt-client-api-v1.${REGION}.agiliumtrade.ai/users/current/accounts/${META_ACCOUNT}`;
const MT_DATA   = `https://mt-market-data-client-api-v1.${REGION}.agiliumtrade.ai/users/current/accounts/${META_ACCOUNT}`;
const MT_HDR    = { "auth-token": META_TOKEN, "Content-Type": "application/json" };

// ── CANDLE HELPERS ────────────────────────────────────────────────────────────
function isBullishEngulfing(prev: any, curr: any) {
  return (
    prev.c < prev.o &&
    curr.c > curr.o &&
    curr.o <= prev.c &&
    curr.c >= prev.o
  );
}

function isBearishRejection(prev: any, curr: any) {
  const body      = Math.abs(curr.c - curr.o);
  const upperWick = curr.h - Math.max(curr.o, curr.c);
  const isStar    = upperWick > body * 1.5 && curr.c < curr.o;
  const isEngulf  = curr.o >= prev.c && curr.c <= prev.o && prev.c > prev.o && curr.c < curr.o;
  return isStar || isEngulf;
}

// ── SETUP DEFINITIONS ─────────────────────────────────────────────────────────
const SETUPS = [
  {
    id:       "XAUUSD-LONG-FIB50",
    label:    "#1 GOLD LONG",
    name:     "The 50% Fib Defence",
    symbol:   "XAUUSD",
    side:     "LONG",
    emoji:    "📈",
    rr:       "1:3.7",
    candleTf: "4h",
    conditions: [
      {
        label:      "Hold $4,000 + H4 Bullish Engulfing",
        entryType:  "market",
        entryPrice: null as number | null,
        sl: 3950, tp1: 4080, tp2: 4185, tp3: 4300,  // widened from 3980 → 3950 for room through Asian noise
        check: ({ mid, prev, curr }: any) => mid >= 4000 && isBullishEngulfing(prev, curr),
      },
      {
        label:      "Dip $3,950–$3,965 Fib Zone + Reversal Wick",
        entryType:  "limit",
        entryPrice: 3963,
        sl: 3898, tp1: 4080, tp2: 4185, tp3: 4300,
        check: ({ mid, curr }: any) =>
          mid >= 3950 && mid <= 3985 && curr.c > curr.o && curr.l <= 3965 && curr.c >= 3950,
      },
    ],
    abortBelow: 3898,
    abortAbove: undefined as number | undefined,
  },
  {
    id:       "XAUUSD-SHORT-FIB382",
    label:    "#2 GOLD SHORT",
    name:     "The 38.2% Fib Rejection",
    symbol:   "XAUUSD",
    side:     "SHORT",
    emoji:    "📉",
    rr:       "1:4.6",
    candleTf: "4h",
    conditions: [
      {
        label:      "$4,280–$4,340 Supply Zone + H4 Bearish Rejection",
        entryType:  "market",
        entryPrice: null as number | null,
        sl: 4420, tp1: 4080, tp2: 3900, tp3: 3627,
        check: ({ mid, prev, curr }: any) =>
          mid >= 4280 && mid <= 4360 && isBearishRejection(prev, curr),
      },
    ],
    abortBelow: undefined as number | undefined,
    abortAbove: 4420,
  },
  {
    id:       "XAGUSD-LONG-DOUBLEBOTTOM",
    label:    "#3 SILVER LONG",
    name:     "The Double Bottom at Structural Floor",
    symbol:   "XAGUSD",
    side:     "LONG",
    emoji:    "📈",
    rr:       "1:5.6",
    candleTf: "1d",
    conditions: [
      {
        label:      "$54.50–$55.20 Double Bottom + Daily Close Above $55.50",
        entryType:  "limit",
        entryPrice: 55.10,
        sl: 53.20, tp1: 58.50, tp2: 60.50, tp3: 65.00,
        check: ({ mid, curr }: any) =>
          mid >= 54.50 && mid <= 56.00 && curr.c > 55.50 && curr.l <= 55.20,
      },
    ],
    abortBelow: 53.20,
    abortAbove: undefined as number | undefined,
  },
  {
    id:       "XAGUSD-SHORT-DEADCAT",
    label:    "#4 SILVER SHORT",
    name:     "The Dead Cat into Descending Channel Resistance",
    symbol:   "XAGUSD",
    side:     "SHORT",
    emoji:    "📉",
    rr:       "1:4.0",
    candleTf: "4h",
    conditions: [
      {
        label:      "$59.80–$61.00 EMA Resistance + H4 Bearish Rejection",
        entryType:  "market",
        entryPrice: null as number | null,
        sl: 62.50, tp1: 57.00, tp2: 55.00, tp3: 50.00,
        check: ({ mid, prev, curr }: any) =>
          mid >= 59.80 && mid <= 61.20 && isBearishRejection(prev, curr),
      },
    ],
    abortBelow: undefined as number | undefined,
    abortAbove: 62.50,
  },
];

// ── API HELPERS ───────────────────────────────────────────────────────────────
async function mtGet(base: string, path: string) {
  const r = await fetch(`${base}${path}`, { headers: MT_HDR as HeadersInit });
  if (!r.ok) throw new Error(`MetaAPI [${r.status}] ${path}: ${await r.text()}`);
  return r.json();
}

async function mtPost(path: string, body: object) {
  const r = await fetch(`${MT_CLIENT}${path}`, {
    method: "POST", headers: MT_HDR as HeadersInit, body: JSON.stringify(body),
  });
  const json = await r.json();
  if (!r.ok) throw new Error(`MetaAPI [${r.status}] ${path}: ${JSON.stringify(json)}`);
  return json;
}

async function getCandles(symbol: string, tf: string, limit = 3) {
  const data = await mtGet(MT_DATA, `/historical-market-data/symbols/${symbol}/timeframes/${tf}/candles?limit=${limit}`);
  return (data || []).map((c: any) => ({ t: c.time, o: c.open, h: c.high, l: c.low, c: c.close }));
}

// ── NOTIFICATIONS ─────────────────────────────────────────────────────────────
async function notify(msg: string) {
  if (!TG_TOKEN || !TG_CHAT) return;
  try {
    await fetch(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: TG_CHAT, text: msg, parse_mode: "HTML" }),
    });
  } catch (_) {}
}

// ── LEDGER ────────────────────────────────────────────────────────────────────
async function registerOpportunity(supabase: any, setup: any, cond: any) {
  const { data, error } = await supabase
    .from("trade_opportunities")
    .insert({
      symbol:          setup.symbol,
      side:            setup.side,
      timeframe:       setup.candleTf,
      ai_summary:      `${setup.emoji} ${setup.label} — ${setup.name}: ${cond.label}`,
      risk_summary:    `[SCOUT:${setup.id}] R:R ${setup.rr} | SL $${cond.sl} | TP1 $${cond.tp1} | TP2 $${cond.tp2} | TP3 $${cond.tp3}`,
      expected_return: cond.tp3,
      r_multiple:      parseFloat(setup.rr.split(":")[1]),
      entry_plan_json: { type: cond.entryType, price: cond.entryPrice, condition: cond.label },
      stop_plan_json:  { price: cond.sl },
      take_profit_json:{ tp1: cond.tp1, tp2: cond.tp2, tp3: cond.tp3 },
      status:          "ACTIVE",
    })
    .select("id")
    .single();

  if (error) throw new Error(`trade_opportunities: ${error.message}`);
  return data.id as string;
}

async function recordTradeAndOrder(supabase: any, opportunityId: string, setup: any, cond: any, orderRes: any, volume: number) {
  // Fetch admin user to satisfy NOT NULL on user_trades.user_id
  let userId: string | null = null;
  try {
    const { data } = await supabase.from("users").select("id").eq("is_admin", true).limit(1).single();
    if (data) userId = data.id;
  } catch (_) {}

  let tradeId: string | null = null;

  if (userId) {
    const { data, error } = await supabase
      .from("user_trades")
      .insert({
        opportunity_id:    opportunityId,
        user_id:           userId,
        symbol:            setup.symbol,
        side:              setup.side,
        volume:            volume,
        risk_amount:       Math.abs((cond.entryPrice ?? 0) - cond.sl),
        status:            "ACTIVE",
        meta_api_order_id: orderRes?.orderId ?? null,
        trade_type:        "SCOUT",
      })
      .select("id")
      .single();

    if (!error) tradeId = data.id;
  }

  // Short order ID — MetaAPI limit: clientId ≤ 31 chars
  const shortId = `SC${Date.now().toString(36).slice(-10)}`;
  await supabase.from("orders").insert({
    trade_id:        tradeId,
    broker:          "METAAPI",
    client_order_id: shortId,
    type:            cond.entryType,
    side:            setup.side === "LONG" ? "buy" : "sell",
    qty:             VOLUME,
    status:          DRY_RUN ? "DRY_RUN" : "FILLED",
    raw_request:     { symbol: setup.symbol, sl: cond.sl, tp1: cond.tp1, tp2: cond.tp2, tp3: cond.tp3 },
    raw_response:    orderRes ?? { dry_run: true },
  });

  return tradeId;
}

// ── TRADE EXECUTION ───────────────────────────────────────────────────────────
async function fireTrade(setup: any, cond: any, entryPx: number, volume: number) {
  if (DRY_RUN) {
    console.log(`[DRY-RUN] Would fire ${setup.side} ${setup.symbol} @ ${cond.entryPrice ?? entryPx.toFixed(3)} SL=${cond.sl} TP3=${cond.tp3} vol=${volume}`);
    return { orderId: "DRY_RUN", stringCode: "ERR_NO_ERROR" };
  }

  const isBuy  = setup.side === "LONG";
  const isLimit = cond.entryType === "limit";
  // MetaAPI requires clientId: strategyId_positionId_orderId (exactly 2 underscores, max 26 chars)
  const ts = Date.now().toString(36).toUpperCase().slice(-6);
  const clientId = `SCT_${setup.id.slice(0, 10).replace(/[^A-Z0-9]/gi, '')}_${ts}`; // e.g. SCT_XAUUSDLONG_1R9F2K

  const body: Record<string, unknown> = {
    actionType:      isLimit ? (isBuy ? "ORDER_TYPE_BUY_LIMIT" : "ORDER_TYPE_SELL_LIMIT")
                             : (isBuy ? "ORDER_TYPE_BUY"       : "ORDER_TYPE_SELL"),
    symbol:          setup.symbol,
    volume:          volume,
    stopLoss:        cond.sl,
    stopLossUnits:   "ABSOLUTE_PRICE",
    takeProfit:      cond.tp3,
    takeProfitUnits: "ABSOLUTE_PRICE",
    clientId,
  };

  if (isLimit && cond.entryPrice != null) {
    body.openPrice = cond.entryPrice;
  }

  return mtPost("/trade", body);
}

// ── CHECK ALREADY FIRED (idempotency) ─────────────────────────────────────────
async function isAlreadyFired(supabase: any, setupId: string): Promise<boolean> {
  // We embed the setupId in the risk_summary field for reliable idempotency matching
  // e.g. risk_summary starts with "[SCOUT:XAGUSD-LONG-DOUBLEBOTTOM]"
  const startOfToday = new Date();
  startOfToday.setUTCHours(0, 0, 0, 0);
  const { count } = await supabase
    .from("trade_opportunities")
    .select("id", { count: "exact", head: true })
    .like("risk_summary", `[SCOUT:${setupId}]%`)
    .in("status", ["ACTIVE", "EXECUTED", "WON", "LOST"])
    .gte("created_at", startOfToday.toISOString());
  return (count ?? 0) > 0;
}

// ── MARKET HOURS GUARD ───────────────────────────────────────────────────────
// Forex: Sun 22:00 UTC to Fri 22:00 UTC. We guard Sat 00:00–Sun 20:00 UTC.
function isForexMarketOpen(): boolean {
  const now = new Date();
  const day = now.getUTCDay();   // 0=Sun, 6=Sat
  const hr  = now.getUTCHours();
  if (day === 6) return false;                   // All day Saturday — closed
  if (day === 0 && hr < 20) return false;        // Sunday before 20:00 UTC — closed
  if (day === 5 && hr >= 22) return false;       // Friday after 22:00 UTC — closed
  return true;
}

// ── MAIN HANDLER ──────────────────────────────────────────────────────────────
serve(async (req) => {
  // Auth: cron invocations come with a secret, direct calls with Bearer JWT or secret
  const secret = req.headers.get("x-webhook-secret");
  const auth   = req.headers.get("authorization");

  if (WEBHOOK_SECRET && secret !== WEBHOOK_SECRET) {
    // Also allow service-role JWT from Supabase scheduler
    if (!auth?.startsWith("Bearer ")) {
      return new Response("Unauthorized", { status: 401 });
    }
  }

  // Guard: do nothing if market is closed (prevents stale ledger entries)
  if (!isForexMarketOpen()) {
    console.log("[Market Scout] Market is closed — skipping poll");
    return new Response(JSON.stringify({ ok: true, skipped: "MARKET_CLOSED" }), {
      headers: { "Content-Type": "application/json" },
    });
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const results: Record<string, string> = {};

  console.log(`[Market Scout] Poll started — ${new Date().toISOString()} | dry_run=${DRY_RUN}`);

  for (const setup of SETUPS) {
    try {
      // Idempotency: skip if this setup already fired today
      const alreadyFired = await isAlreadyFired(supabase, setup.id);
      if (alreadyFired) {
        results[setup.id] = "ALREADY_FIRED";
        continue;
      }

      // Fetch live price
      const priceData = await mtGet(MT_CLIENT, `/symbols/${setup.symbol}/current-price`);
      const mid       = (priceData.bid + priceData.ask) / 2;

      // Fetch candles
      const candles = await getCandles(setup.symbol, setup.candleTf, 3);
      const prev    = candles[candles.length - 2];
      const curr    = candles[candles.length - 1];

      if (!prev || !curr) { results[setup.id] = "NO_CANDLES"; continue; }

      console.log(`  [${setup.label}] mid=${mid.toFixed(3)} | ${setup.candleTf} O=${curr.o} H=${curr.h} L=${curr.l} C=${curr.c}`);

      // Abort checks
      if (setup.abortBelow !== undefined && mid < setup.abortBelow) {
        console.log(`  [${setup.label}] Bear abort at ${mid.toFixed(2)}`);
        await notify(`⛔ <b>${setup.label} ABORTED</b>\nBear level $${setup.abortBelow} broken at $${mid.toFixed(2)}.`);
        // Register an aborted opportunity in ledger for the record
        await supabase.from("trade_opportunities").insert({
          symbol: setup.symbol, side: setup.side, timeframe: setup.candleTf,
          ai_summary: `⛔ ${setup.id} — ABORTED: bear level $${setup.abortBelow} broken`,
          status: "EXPIRED",
        });
        results[setup.id] = "ABORTED_BEAR";
        continue;
      }
      if (setup.abortAbove !== undefined && mid > setup.abortAbove) {
        console.log(`  [${setup.label}] Structure abort at ${mid.toFixed(2)}`);
        await notify(`⛔ <b>${setup.label} ABORTED</b>\nAbove $${setup.abortAbove} — structure broken.`);
        await supabase.from("trade_opportunities").insert({
          symbol: setup.symbol, side: setup.side, timeframe: setup.candleTf,
          ai_summary: `⛔ ${setup.id} — ABORTED: above $${setup.abortAbove}`,
          status: "EXPIRED",
        });
        results[setup.id] = "ABORTED_STRUCTURE";
        continue;
      }

      // Condition checks
      let triggered: any = null;
      for (const cond of setup.conditions) {
        if (cond.check({ mid, bid: priceData.bid, ask: priceData.ask, prev, curr })) {
          triggered = cond;
          break;
        }
      }

      if (!triggered) {
        results[setup.id] = "WATCHING";
        continue;
      }

      console.log(`  ✅ [${setup.label}] TRIGGERED: ${triggered.label}`);

      // Calculate lot size based on $RISK_USD and SL distance
      const entryPx = triggered.entryType === "limit"
        ? (triggered.entryPrice ?? priceData.ask)
        : priceData.ask;
      const volume  = calcLots(setup.symbol, entryPx, triggered.sl);
      console.log(`  [${setup.label}] Volume: ${volume} lots (risk $${RISK_USD}, SL distance $${Math.abs(entryPx - triggered.sl).toFixed(2)})`);

      // 1. Ledger first
      const opportunityId = await registerOpportunity(supabase, setup, triggered);

      // 2. Fire order
      const orderRes   = await fireTrade(setup, triggered, entryPx, volume);
      const metaOrderId = orderRes?.orderId ?? null;

      // 3. Record trail
      const tradeId = await recordTradeAndOrder(supabase, opportunityId, setup, triggered, orderRes, volume);

      // 4. Notify
      await notify(
        `✅ <b>${setup.emoji} ${setup.label} OPENED</b>\n` +
        `<b>${setup.name}</b>\n` +
        `<i>${triggered.label}</i>\n\n` +
        `📊 Entry: ${triggered.entryType === "limit" ? `Limit @ $${triggered.entryPrice}` : `Market @ ~$${priceData.ask.toFixed(3)}`}\n` +
        `🛑 SL: $${triggered.sl}\n` +
        `🎯 TP1: $${triggered.tp1} | TP2: $${triggered.tp2} | TP3: $${triggered.tp3}\n` +
        `⚖️ R:R: ${setup.rr}\n` +
        `📦 Volume: ${volume} lots (risk ~$${RISK_USD})\n` +
        `📋 Ledger: ${opportunityId}\n` +
        `🆔 MetaAPI: ${metaOrderId ?? "N/A"}`
      );

      results[setup.id] = `FIRED:${opportunityId}`;

    } catch (err: any) {
      console.error(`  ⚠️  [${setup.id}] Error: ${err.message}`);
      results[setup.id] = `ERROR:${err.message}`;
    }
  }

  console.log("[Market Scout] Poll complete:", results);
  return new Response(JSON.stringify({ ok: true, dry_run: DRY_RUN, results }), {
    headers: { "Content-Type": "application/json" },
  });
});
