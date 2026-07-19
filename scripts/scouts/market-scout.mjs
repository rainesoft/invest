#!/usr/bin/env node
/**
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║              RAINEBANK — MARKET SCOUT v1.0                             ║
 * ║  Temporary isolated script — DELETE after all setups close             ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 *
 * Monitors 4 manual setups at market open and fires live orders via MetaAPI
 * when entry conditions are confirmed. All activity is recorded in the vault
 * ledger (trade_opportunities → user_trades → orders).
 *
 * SETUPS WATCHED:
 *  #1 XAUUSD LONG  — "The 50% Fib Defence"         ($3,950–$3,965 or $4,000 hold)
 *  #2 XAUUSD SHORT — "The 38.2% Fib Rejection"     ($4,280–$4,340 supply zone)
 *  #3 XAGUSD LONG  — "The Double Bottom"            ($54.50–$55.20 structural floor)
 *  #4 XAGUSD SHORT — "The Dead Cat into Channel"    ($59.80–$61.00 descending resistance)
 *
 * USAGE:
 *  node scripts/scouts/market-scout.mjs
 *  node scripts/scouts/market-scout.mjs  (with SCOUT_DRY_RUN=true for testing)
 *
 * ENV REQUIRED (loaded from .env.local + .env):
 *  META_API_TOKEN, META_API_ACCOUNT_ID,
 *  SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL), SUPABASE_SERVICE_ROLE_KEY
 *
 * ENV OPTIONAL:
 *  TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID  — push notifications
 *  METAAPI_REGION                        — defaults to 'new-york'
 *  SCOUT_DRY_RUN=true                    — log conditions without placing trades
 *  SCOUT_VOLUME=0.01                     — lot size per trade (default 0.01)
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

// ── ENV LOADING ───────────────────────────────────────────────────────────────
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');
dotenv.config({ path: path.join(ROOT, 'apps/rainebank/.env.local') });
dotenv.config({ path: path.join(ROOT, '.env'), override: false });

// ── RUNTIME CONFIG ────────────────────────────────────────────────────────────
const DRY_RUN        = process.env.SCOUT_DRY_RUN === 'true';
const VOLUME         = parseFloat(process.env.SCOUT_VOLUME || '0.01');
const POLL_MS        = 5 * 60 * 1000;
const MAX_RUNTIME_MS = 4 * 60 * 60 * 1000;
const REGION         = process.env.METAAPI_REGION || 'new-york';

// ── ENV VALIDATION ────────────────────────────────────────────────────────────
const META_TOKEN   = process.env.META_API_TOKEN;
const META_ACCOUNT = process.env.META_API_ACCOUNT_ID;
const SUPA_URL     = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPA_KEY     = process.env.SUPABASE_SERVICE_ROLE_KEY;
const TG_TOKEN     = process.env.TELEGRAM_BOT_TOKEN;
const TG_CHAT      = process.env.TELEGRAM_CHAT_ID;

if (!META_TOKEN || !META_ACCOUNT) { console.error('❌ META_API_TOKEN and META_API_ACCOUNT_ID required'); process.exit(1); }
if (!SUPA_URL   || !SUPA_KEY)     { console.error('❌ SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY required'); process.exit(1); }

const supabase = createClient(SUPA_URL, SUPA_KEY);

// ── METAAPI CLIENTS ───────────────────────────────────────────────────────────
const MT_CLIENT = `https://mt-client-api-v1.${REGION}.agiliumtrade.ai/users/current/accounts/${META_ACCOUNT}`;
const MT_DATA   = `https://mt-market-data-client-api-v1.${REGION}.agiliumtrade.ai/users/current/accounts/${META_ACCOUNT}`;
const MT_HDR    = { 'auth-token': META_TOKEN, 'Content-Type': 'application/json' };

async function mtGet(base, path) {
  const r = await fetch(`${base}${path}`, { headers: MT_HDR });
  if (!r.ok) throw new Error(`MetaAPI [${r.status}] ${path}: ${await r.text()}`);
  return r.json();
}

async function mtPost(path, body) {
  const r = await fetch(`${MT_CLIENT}${path}`, { method: 'POST', headers: MT_HDR, body: JSON.stringify(body) });
  const json = await r.json();
  if (!r.ok) throw new Error(`MetaAPI [${r.status}] ${path}: ${JSON.stringify(json)}`);
  return json;
}

// ── CANDLE PATTERN HELPERS ────────────────────────────────────────────────────
function isBullishEngulfing(prev, curr) {
  return (
    prev.c < prev.o &&
    curr.c > curr.o &&
    curr.o <= prev.c &&
    curr.c >= prev.o
  );
}

function isBearishRejection(prev, curr) {
  const body      = Math.abs(curr.c - curr.o);
  const upperWick = curr.h - Math.max(curr.o, curr.c);
  const isStar    = upperWick > body * 1.5 && curr.c < curr.o;
  const isEngulf  = curr.o >= prev.c && curr.c <= prev.o && prev.c > prev.o && curr.c < curr.o;
  return isStar || isEngulf;
}

// ── SETUP DEFINITIONS ─────────────────────────────────────────────────────────
const SETUPS = [
  {
    id:     'XAUUSD-LONG-FIB50',
    label:  '#1 GOLD LONG',
    name:   'The 50% Fib Defence',
    symbol: 'XAUUSD',
    side:   'LONG',
    emoji:  '📈',
    rr:     '1:3.7',
    candleTf: '4h',

    conditions: [
      {
        label:      'Hold $4,000 + H4 Bullish Engulfing',
        entryType:  'market',
        entryPrice: null,
        sl: 3980, tp1: 4080, tp2: 4185, tp3: 4300,
        check: ({ mid, prev, curr }) => mid >= 4000 && isBullishEngulfing(prev, curr),
      },
      {
        label:      'Dip $3,950–$3,965 Fib Zone + Reversal Wick',
        entryType:  'limit',
        entryPrice: 3963,
        sl: 3898, tp1: 4080, tp2: 4185, tp3: 4300,
        check: ({ mid, curr }) =>
          mid >= 3950 && mid <= 3985 && curr.c > curr.o && curr.l <= 3965 && curr.c >= 3950,
      },
    ],

    abortBelow: 3898,
  },

  {
    id:     'XAUUSD-SHORT-FIB382',
    label:  '#2 GOLD SHORT',
    name:   'The 38.2% Fib Rejection',
    symbol: 'XAUUSD',
    side:   'SHORT',
    emoji:  '📉',
    rr:     '1:4.6',
    candleTf: '4h',

    conditions: [
      {
        label:      '$4,280–$4,340 Supply Zone + H4 Bearish Rejection Candle',
        entryType:  'market',
        entryPrice: null,
        sl: 4420, tp1: 4080, tp2: 3900, tp3: 3627,
        check: ({ mid, prev, curr }) =>
          mid >= 4280 && mid <= 4360 && isBearishRejection(prev, curr),
      },
    ],

    abortAbove: 4420,
  },

  {
    id:     'XAGUSD-LONG-DOUBLEBOTTOM',
    label:  '#3 SILVER LONG',
    name:   'The Double Bottom at Structural Floor',
    symbol: 'XAGUSD',
    side:   'LONG',
    emoji:  '📈',
    rr:     '1:5.6',
    candleTf: '1d',  // daily close confirmation required

    conditions: [
      {
        label:      '$54.50–$55.20 Double Bottom + Daily Close Above $55.50',
        entryType:  'limit',
        entryPrice: 55.10,
        sl: 53.20, tp1: 58.50, tp2: 60.50, tp3: 65.00,
        check: ({ mid, curr }) =>
          mid >= 54.50 && mid <= 56.00 && curr.c > 55.50 && curr.l <= 55.20,
      },
    ],

    abortBelow: 53.20,
  },

  {
    id:     'XAGUSD-SHORT-DEADCAT',
    label:  '#4 SILVER SHORT',
    name:   'The Dead Cat into Descending Channel Resistance',
    symbol: 'XAGUSD',
    side:   'SHORT',
    emoji:  '📉',
    rr:     '1:4.0',
    candleTf: '4h',

    conditions: [
      {
        label:      '$59.80–$61.00 EMA Resistance + H4 Bearish Rejection Candle',
        entryType:  'market',
        entryPrice: null,
        sl: 62.50, tp1: 57.00, tp2: 55.00, tp3: 50.00,
        check: ({ mid, prev, curr }) =>
          mid >= 59.80 && mid <= 61.20 && isBearishRejection(prev, curr),
      },
    ],

    abortAbove: 62.50,
  },
];

// ── LEDGER ────────────────────────────────────────────────────────────────────

async function registerOpportunity(setup, cond) {
  const { data, error } = await supabase
    .from('trade_opportunities')
    .insert({
      symbol:          setup.symbol,
      side:            setup.side,
      timeframe:       setup.candleTf,
      ai_summary:      `${setup.emoji} ${setup.label} — ${setup.name}: ${cond.label}`,
      risk_summary:    `R:R ${setup.rr} | SL $${cond.sl} | TP1 $${cond.tp1} | TP2 $${cond.tp2} | TP3 $${cond.tp3}`,
      expected_return: cond.tp3,
      r_multiple:      parseFloat(setup.rr.split(':')[1]),
      entry_plan_json: { type: cond.entryType, price: cond.entryPrice, condition: cond.label },
      stop_plan_json:  { price: cond.sl },
      take_profit_json:{ tp1: cond.tp1, tp2: cond.tp2, tp3: cond.tp3 },
      status:          'ACTIVE',
    })
    .select('id')
    .single();

  if (error) throw new Error(`trade_opportunities insert: ${error.message}`);
  return data.id;
}

async function recordUserTrade(opportunityId, setup, cond, metaOrderId) {
  // Fetch the platform admin user id (service role can see it)
  let systemUserId = null;
  try {
    const { data } = await supabase.from('users').select('id').eq('is_admin', true).limit(1).single();
    if (data) systemUserId = data.id;
  } catch (_) {}

  if (!systemUserId) {
    // If no admin user found, skip user_trades row (opportunity row is already recorded)
    log(`  [Ledger] No admin user found — skipping user_trades row, opportunity is recorded`);
    return null;
  }

  const { data, error } = await supabase
    .from('user_trades')
    .insert({
      opportunity_id:    opportunityId,
      user_id:           systemUserId,
      symbol:            setup.symbol,
      side:              setup.side,
      volume:            VOLUME,
      risk_amount:       Math.abs((cond.entryPrice || 0) - cond.sl),
      status:            'ACTIVE',
      meta_api_order_id: metaOrderId || null,
      trade_type:        'SCOUT',
    })
    .select('id')
    .single();

  if (error) throw new Error(`user_trades insert: ${error.message}`);
  return data.id;
}

async function recordOrder(tradeId, setup, cond, orderRes) {
  // clientId must be ≤31 chars total (MetaAPI hard limit)
  const shortId = `SC${setup.id.slice(-8)}${Date.now().toString(36).slice(-4)}`;
  await supabase.from('orders').insert({
    trade_id:       tradeId,
    broker:         'METAAPI',
    client_order_id: shortId,
    type:           cond.entryType,
    side:           setup.side === 'LONG' ? 'buy' : 'sell',
    qty:            VOLUME,
    status:         DRY_RUN ? 'DRY_RUN' : 'FILLED',
    raw_request:    { symbol: setup.symbol, sl: cond.sl, tp1: cond.tp1, tp2: cond.tp2, tp3: cond.tp3, volume: VOLUME },
    raw_response:   orderRes || { dry_run: true },
  });
}

// ── NOTIFICATIONS ─────────────────────────────────────────────────────────────
async function notify(msg) {
  log(msg.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&'));
  if (!TG_TOKEN || !TG_CHAT) return;
  try {
    await fetch(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: TG_CHAT, text: msg, parse_mode: 'HTML' }),
    });
  } catch (e) { log(`[Telegram] ${e.message}`); }
}

function log(msg) { console.log(`[${new Date().toISOString()}] ${msg}`); }

// ── EXECUTION ─────────────────────────────────────────────────────────────────
async function fireTrade(setup, cond, liveAsk) {
  if (DRY_RUN) {
    log(`[DRY-RUN] Would fire ${setup.side} ${setup.symbol} @ ${cond.entryPrice || liveAsk.toFixed(3)} SL=${cond.sl} TP3=${cond.tp3}`);
    return { orderId: 'DRY_RUN', stringCode: 'ERR_NO_ERROR' };
  }

  const isBuy = setup.side === 'LONG';
  // clientId ≤31 chars; comment must be empty or very short when clientId is used
  const clientId = `SC${Date.now().toString(36).slice(-8)}`; // e.g. SC1r9f2k8z = 10 chars
  const body = {
    actionType:      cond.entryType === 'limit'
      ? (isBuy ? 'ORDER_TYPE_BUY_LIMIT'  : 'ORDER_TYPE_SELL_LIMIT')
      : (isBuy ? 'ORDER_TYPE_BUY'        : 'ORDER_TYPE_SELL'),
    symbol:          setup.symbol,
    volume:          VOLUME,
    openPrice:       cond.entryType === 'limit' ? cond.entryPrice : undefined,
    stopLoss:        cond.sl,
    stopLossUnits:   'ABSOLUTE_PRICE',
    takeProfit:      cond.tp3,
    takeProfitUnits: 'ABSOLUTE_PRICE',
    clientId,
    // No comment field — clientId alone uses the 31-char budget
  };

  return mtPost('/trade', body);
}

async function getCandles(symbol, tf, limit = 3) {
  const data = await mtGet(MT_DATA, `/historical-market-data/symbols/${symbol}/timeframes/${tf}/candles?limit=${limit}`);
  return (data || []).map(c => ({ t: c.time, o: c.open, h: c.high, l: c.low, c: c.close }));
}

// ── MAIN ──────────────────────────────────────────────────────────────────────
async function main() {
  const startTime = Date.now();
  const fired     = new Set(); // tracks which setup IDs have already triggered or aborted

  const mode = DRY_RUN ? '🧪 DRY RUN — no orders will be placed' : '🔴 LIVE — orders will fire on MetaAPI';
  log(`╔══════════════════════════════════════════════════════╗`);
  log(`║   RAINEBANK MARKET SCOUT v1.0                       ║`);
  log(`║   ${mode.padEnd(51)}║`);
  log(`╚══════════════════════════════════════════════════════╝`);
  log(`Setups: ${SETUPS.length} | Poll: 5min | Timeout: 4h | Volume: ${VOLUME} lots`);
  SETUPS.forEach(s => log(`  ${s.emoji} ${s.label} — ${s.name} (${s.symbol})`));
  log('');

  await notify(
    `🔍 <b>Market Scout Active</b> ${DRY_RUN ? '[DRY RUN]' : '[LIVE]'}\n\n` +
    `📈 <b>#1</b> XAUUSD LONG — "The 50% Fib Defence"\n` +
    `📉 <b>#2</b> XAUUSD SHORT — "The 38.2% Fib Rejection"\n` +
    `📈 <b>#3</b> XAGUSD LONG — "The Double Bottom"\n` +
    `📉 <b>#4</b> XAGUSD SHORT — "The Dead Cat"\n\n` +
    `⏰ Timeout: 4 hours`
  );

  let poll = 0;

  while (fired.size < SETUPS.length && (Date.now() - startTime) < MAX_RUNTIME_MS) {
    poll++;
    log(`── Poll #${poll} — ${fired.size}/${SETUPS.length} setups closed ──────────────────`);

    for (const setup of SETUPS) {
      if (fired.has(setup.id)) continue;

      try {
        // Fetch live price
        const priceData = await mtGet(MT_CLIENT, `/symbols/${setup.symbol}/current-price`);
        const bid = priceData.bid, ask = priceData.ask, mid = (bid + ask) / 2;

        // Fetch candles (timeframe depends on setup)
        const candles = await getCandles(setup.symbol, setup.candleTf, 3);
        const prev    = candles[candles.length - 2];
        const curr    = candles[candles.length - 1];

        if (!prev || !curr) {
          log(`  [${setup.id}] Not enough candles`);
          continue;
        }

        log(`  [${setup.label}] mid=$${mid.toFixed(3)} | ${setup.candleTf} C: O=${curr.o} H=${curr.h} L=${curr.l} C=${curr.c}`);

        // ── ABORT CHECK ──────────────────────────────────────────────
        if (setup.abortBelow !== undefined && mid < setup.abortBelow) {
          await notify(`⛔ <b>${setup.label} ABORTED</b>\nBear level $${setup.abortBelow} broken — setup invalidated.`);
          fired.add(setup.id);
          continue;
        }
        if (setup.abortAbove !== undefined && mid > setup.abortAbove) {
          await notify(`⛔ <b>${setup.label} ABORTED</b>\nAbove $${setup.abortAbove} — structure broken.`);
          fired.add(setup.id);
          continue;
        }

        // ── CONDITION CHECK ──────────────────────────────────────────
        let triggered = null;
        for (const cond of setup.conditions) {
          if (cond.check({ mid, bid, ask, prev, curr })) { triggered = cond; break; }
        }

        if (!triggered) {
          log(`  [${setup.label}] No condition met`);
          continue;
        }

        log(`  ✅ [${setup.label}] TRIGGERED: ${triggered.label}`);

        // Record in ledger FIRST (before firing, so it exists even if order fails)
        const opportunityId = await registerOpportunity(setup, triggered);

        // Fire order
        const orderRes   = await fireTrade(setup, triggered, ask);
        const metaOrderId = orderRes.orderId || null;

        // Record execution trail
        const tradeId = await recordUserTrade(opportunityId, setup, triggered, metaOrderId);
        await recordOrder(tradeId, setup, triggered, orderRes);

        // Notify
        await notify(
          `✅ <b>${setup.emoji} ${setup.label} OPENED</b>\n` +
          `<b>${setup.name}</b>\n` +
          `<i>${triggered.label}</i>\n\n` +
          `📊 Entry: ${triggered.entryType === 'limit' ? `Limit @ $${triggered.entryPrice}` : `Market @ ~$${ask.toFixed(3)}`}\n` +
          `🛑 SL: $${triggered.sl}\n` +
          `🎯 TP1: $${triggered.tp1} | TP2: $${triggered.tp2} | TP3: $${triggered.tp3}\n` +
          `⚖️ R:R: ${setup.rr}\n` +
          `📋 Ledger: ${opportunityId}\n` +
          `🆔 MetaAPI: ${metaOrderId || 'N/A'}`
        );

        fired.add(setup.id);

      } catch (err) {
        log(`  ⚠️  [${setup.label}] Error: ${err.message}`);
      }

      // Brief pause between symbols
      await new Promise(r => setTimeout(r, 1200));
    }

    const remaining = SETUPS.length - fired.size;
    if (remaining > 0) {
      log(`  ${remaining} setup(s) still watching. Next poll in ${POLL_MS / 60000} min...\n`);
      await new Promise(r => setTimeout(r, POLL_MS));
    }
  }

  const elapsed = ((Date.now() - startTime) / 3600000).toFixed(1);
  if (fired.size >= SETUPS.length) {
    log(`\n🏁 All setups resolved in ${elapsed}h.`);
    await notify(`🏁 <b>Scout Complete</b> — all ${SETUPS.length} setups resolved in ${elapsed}h.`);
  } else {
    log(`\n⏰ Scout timed out after ${elapsed}h — ${fired.size}/${SETUPS.length} fired.`);
    await notify(`⏰ <b>Scout Timeout</b> — ${fired.size}/${SETUPS.length} triggered after ${elapsed}h.`);
  }
}

main().catch(async err => {
  console.error('FATAL:', err.message);
  if (TG_TOKEN && TG_CHAT) {
    await fetch(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: TG_CHAT, text: `🚨 <b>Scout Fatal Error</b>\n${err.message}`, parse_mode: 'HTML' }),
    }).catch(() => {});
  }
  process.exit(1);
});
