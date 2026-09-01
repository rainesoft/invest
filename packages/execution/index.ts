import { createClient, SupabaseClient } from "npm:@supabase/supabase-js@2.108.2";
import { insertAuditLog } from "../core/audit.ts";

function getEnv(name: string): string | undefined {
  const _Deno = (globalThis as any).Deno;
  if (typeof _Deno !== "undefined" && typeof _Deno.env?.get === "function") {
    return _Deno.env.get(name) ?? undefined;
  }
  if (typeof process !== "undefined") {
    return process.env[name];
  }
  return undefined;
}

export function makeClientOrderId(tradeId: string, n = 1) {
  // MetaAPI requires clientId to match the pattern: strategyId_positionId_orderId (exactly 2 underscores) and max 26 chars total
  const cleanId = tradeId.replace(/[^a-zA-Z0-9]/g, '');
  return `RNE_${n}_${cleanId.substring(0, 16)}`;
}

export interface OrderRequest {
  symbol: string;
  side: 'buy' | 'sell';
  qty: number;
  type: 'market' | 'limit' | 'stop' | 'stop_limit';
  limitPrice?: number;
  stopPrice?: number;
  takeProfit?: number;
  stopLoss?: number;
  tif?: 'day' | 'ioc' | 'fok';
  clientOrderId?: string;
}

async function metaApiFetch(path: string, opts: RequestInit, token: string, accountId: string) {
  const region = getEnv('METAAPI_REGION') || 'new-york';
  const base = `https://mt-client-api-v1.${region}.agiliumtrade.ai`;
  
  const headers = {
    'auth-token': token,
    ...(opts.headers || {}),
  } as Record<string, string>;
  
  const fullPath = path.startsWith('/users') 
    ? `${base}${path}` 
    : `${base}/users/current/accounts/${accountId}${path}`;
    
  const res = await fetch(fullPath, { ...opts, headers });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`MetaAPI error ${res.status}: ${text}`);
  }
  return res.json();
}

/**
 * Historical market data uses a separate API host: mt-market-data-client-api-v1.
 * Timeframes MUST be lowercase MT5 format: 1m, 5m, 15m, 30m, 1h, 4h, 1d, 1w, 1mn
 */
async function metaApiMarketDataFetch(path: string, token: string, accountId: string) {
  const region = getEnv('METAAPI_REGION') || 'new-york';
  const base = `https://mt-market-data-client-api-v1.${region}.agiliumtrade.ai`;
  const fullPath = `${base}/users/current/accounts/${accountId}${path}`;
  const res = await fetch(fullPath, { headers: { 'auth-token': token } });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`MetaAPI Market Data error ${res.status}: ${text}`);
  }
  return res.json();
}

async function alpacaFetch(path: string, opts: RequestInit, key: string, secret: string) {
  const base = 'https://paper-api.alpaca.markets/v2';
  const headers = {
    'APCA-API-KEY-ID': key,
    'APCA-API-SECRET-KEY': secret,
    ...(opts.headers || {}),
  } as Record<string, string>;
  const res = await fetch(`${base}${path}`, { ...opts, headers });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Alpaca error ${res.status}: ${text}`);
  }
  return res.json();
}

export async function getAccountInformation(settings: any) {
  if (settings.active_broker !== 'METAAPI') {
    return null;
  }
  const token = settings.meta_api_token || getEnv('META_API_TOKEN') || '';
  const account = settings.meta_api_account_id || getEnv('META_API_ACCOUNT_ID') || '';
  return metaApiFetch('/accountInformation', { method: 'GET' }, token, account);
}

export async function placePaperOrder(
  order: OrderRequest,
  supabase: SupabaseClient,
  settings: any
) {
  const { supabase: _supa, ...safeOrder } = order as any;
  await insertAuditLog(supabase, {
    actor_type: 'SYSTEM',
    action: 'PLACE_ORDER',
    entity_type: 'order',
    payload_json: safeOrder as unknown as Record<string, unknown>,
  });

  const isMetaApi = settings.active_broker === 'METAAPI';
  let res: any;

  if (isMetaApi) {
    let actionType = 'ORDER_TYPE_BUY';
    if (order.type === 'market') {
      actionType = order.side === 'buy' ? 'ORDER_TYPE_BUY' : 'ORDER_TYPE_SELL';
    } else if (order.type === 'limit') {
      actionType = order.side === 'buy' ? 'ORDER_TYPE_BUY_LIMIT' : 'ORDER_TYPE_SELL_LIMIT';
    } else if (order.type === 'stop') {
      actionType = order.side === 'buy' ? 'ORDER_TYPE_BUY_STOP' : 'ORDER_TYPE_SELL_STOP';
    }

    const token = settings.meta_api_token || getEnv('META_API_TOKEN') || '';
    const account = settings.meta_api_account_id || getEnv('META_API_ACCOUNT_ID') || '';

    res = await metaApiFetch('/trade', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        actionType,
        symbol: order.symbol,
        volume: order.qty,
        openPrice: order.limitPrice || order.stopPrice,
        stopLoss: order.stopLoss,
        stopLossUnits: order.stopLoss ? 'ABSOLUTE_PRICE' : undefined,
        takeProfit: order.takeProfit,
        takeProfitUnits: order.takeProfit ? 'ABSOLUTE_PRICE' : undefined,
        clientId: order.clientOrderId,
      }),
    }, token, account);
  } else {
    // Fallback to Alpaca
    res = await alpacaFetch('/orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        symbol: order.symbol,
        side: order.side,
        qty: order.qty,
        type: order.type,
        time_in_force: order.tif || 'day',
        limit_price: order.limitPrice,
        stop_price: order.stopPrice,
        stop_loss: order.stopLoss ? { stop_price: order.stopLoss } : undefined,
        take_profit: order.takeProfit ? { limit_price: order.takeProfit } : undefined,
        client_order_id: order.clientOrderId,
        order_class: (order.stopLoss || order.takeProfit) ? 'bracket' : undefined,
      }),
    }, settings.alpaca_key || getEnv('BROKER_KEY') || '', settings.alpaca_secret || getEnv('BROKER_SECRET') || '');
  }

  await insertAuditLog(supabase, {
    actor_type: 'SYSTEM',
    action: 'ORDER_RESPONSE',
    entity_type: 'order',
    payload_json: res,
  });
  
  return { res, broker: isMetaApi ? 'METAAPI' : 'ALPACA' };
}

export interface TrackedOrderRequest extends OrderRequest {
  tradeId: string;
  supabase: any;
  n?: number;
  userId?: string;
}

export async function placeAndTrackOrder(req: TrackedOrderRequest) {
  const clientOrderId = req.clientOrderId || makeClientOrderId(req.tradeId, req.n);
  
  let query = req.supabase.from('user_risk_settings').select('*').limit(1);
  if (req.userId) {
    query = query.eq('user_id', req.userId);
  }
  const { data: settings } = await query.single();
  const activeSettings = settings || { active_broker: 'ALPACA' };

  const { res: orderRes, broker } = await placePaperOrder({ ...req, clientOrderId }, req.supabase, activeSettings);

  let isFilled = false;
  let status = 'NEW';
  let filledQty = 0;
  let price = undefined;

  if (broker === 'METAAPI') {
    isFilled = orderRes.stringCode === 'ERR_NO_ERROR' || orderRes.orderId;
    status = isFilled ? 'FILLED' : 'FAILED';
    price = orderRes.price;
    filledQty = isFilled ? req.qty : 0;
  } else {
    status = (orderRes.status || 'new').toUpperCase();
  }

  const { data: orderRow } = await req.supabase
    .from('orders')
    .insert({
      trade_id: req.tradeId,
      broker,
      client_order_id: clientOrderId,
      type: req.type,
      side: req.side,
      qty: req.qty,
      status: status,
      price: price,
      raw_request: {
        symbol: req.symbol,
        side: req.side,
        qty: req.qty,
        type: req.type,
        client_order_id: clientOrderId,
      },
      raw_response: orderRes,
    })
    .select('id')
    .single();

  if (!orderRow) {
    throw new Error('Failed to insert order into database');
  }

  if (broker === 'METAAPI' && isFilled && price) {
    await req.supabase.from('executions').insert({
      order_id: orderRow.id,
      user_id: req.userId,
      price: Number(price),
      qty: req.qty,
      raw_fill: orderRes,
    });
  } else if (broker === 'ALPACA') {
    // Poll for Alpaca execution
    let currentStatus = orderRes.status as string;
    let last = orderRes;
    let loops = 0;
    while (currentStatus !== 'filled' && currentStatus !== 'canceled' && loops < 10) {
      await new Promise((r) => setTimeout(r, 1000));
      const upd = await alpacaFetch(`/orders/${orderRes.id}`, { method: 'GET' }, activeSettings.alpaca_key || getEnv('BROKER_KEY') || '', activeSettings.alpaca_secret || getEnv('BROKER_SECRET') || '');
      currentStatus = upd.status;
      const newFilled = Number(upd.filled_qty || 0);
      if (newFilled > filledQty) {
        const diff = newFilled - filledQty;
        await req.supabase.from('executions').insert({
          order_id: orderRow.id,
          user_id: req.userId,
          price: Number(upd.filled_avg_price),
          qty: diff,
          raw_fill: upd,
        });
        filledQty = newFilled;
      }
      last = upd;
      loops++;
    }

    await req.supabase
      .from('orders')
      .update({
        status: currentStatus.toUpperCase(),
        price: filledQty ? Number(last.filled_avg_price) : undefined,
      })
      .eq('id', orderRow.id);
      
    status = currentStatus.toUpperCase();
  }

  return { 
    orderId: orderRow.id, 
    clientOrderId, 
    filledQty, 
    status,
    errorMsg: status === 'FAILED' ? (orderRes?.message || 'Broker execution failed') : undefined 
  };
}

export interface Bar {
  t: string;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
}

export function resampleBars(bars30m: any[], targetTimeframe: string): Bar[] {
  const tf = targetTimeframe.toLowerCase();
  if (tf === '30m') {
    return bars30m.map((b: any) => ({
      t: b.ts || b.t,
      o: Number(b.o),
      h: Number(b.h),
      l: Number(b.l),
      c: Number(b.c),
      v: Number(b.v || 0)
    }));
  }

  const sorted = [...bars30m].sort((a, b) => new Date(a.ts || a.t).getTime() - new Date(b.ts || b.t).getTime());
  const buckets = new Map<string, any[]>();

  for (const bar of sorted) {
    const d = new Date(bar.ts || bar.t);
    let key = '';

    if (tf === '1h') {
      d.setUTCMinutes(0, 0, 0);
      key = d.toISOString();
    } else if (tf === '4h') {
      const h = Math.floor(d.getUTCHours() / 4) * 4;
      d.setUTCHours(h, 0, 0, 0);
      key = d.toISOString();
    } else if (tf === '1d' || tf === 'd' || tf === '1day') {
      d.setUTCHours(0, 0, 0, 0);
      key = d.toISOString();
    } else if (tf === '1w' || tf === 'w' || tf === '1week') {
      const day = d.getUTCDay();
      d.setUTCDate(d.getUTCDate() - day);
      d.setUTCHours(0, 0, 0, 0);
      key = d.toISOString();
    } else {
      d.setUTCHours(0, 0, 0, 0);
      key = d.toISOString();
    }

    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key)!.push(bar);
  }

  const resampled: Bar[] = [];
  for (const [bucketTime, bList] of buckets.entries()) {
    const open = Number(bList[0].o);
    const high = Math.max(...bList.map((b) => Number(b.h)));
    const low = Math.min(...bList.map((b) => Number(b.l)));
    const close = Number(bList[bList.length - 1].c);
    const volume = bList.reduce((sum, b) => sum + Number(b.v || 0), 0);

    resampled.push({
      t: bucketTime,
      o: open,
      h: high,
      l: low,
      c: close,
      v: volume
    });
  }

  return resampled;
}

export async function fetchPaperBars(
  symbol: string,
  timeframe = '1h',
  limit = 100,
  supabase?: any
): Promise<Bar[]> {
  try {
    let settings = { active_broker: 'ALPACA' } as any;
    
    if (supabase) {
      const { data } = await supabase.from('user_risk_settings').select('*').limit(1).single();
      if (data) settings = data;
      
      // Zero-MetaAPI Cache Check: Check if VPS pushed fresh data for this timeframe
      const { data: cachedBars } = await supabase
        .from('market_data_pti')
        .select('*')
        .eq('symbol', symbol)
        .eq('timeframe', timeframe.toLowerCase())
        .order('ts', { ascending: false })
        .limit(limit);
        
      // If we have cached bars, ensure they are not stale before using them
      if (cachedBars && cachedBars.length > 0) {
        const latestTs = new Date(cachedBars[0].ts).getTime();
        const now = new Date().getTime();
        
        const tfLower = timeframe.toLowerCase();
        
        // Dynamically enforce timeframe-appropriate cache freshness limits
        let maxAgeMs = 4 * 60 * 60 * 1000; // Default: 4 hours for intraday (1m, 5m, 15m, 30m, 1h)
        if (tfLower.includes('d')) {
          maxAgeMs = 48 * 60 * 60 * 1000; // 48 hours for Daily candles
        } else if (tfLower.includes('w')) {
          maxAgeMs = 14 * 24 * 60 * 60 * 1000; // 14 days for Weekly candles
        } else if (tfLower.includes('4h')) {
          maxAgeMs = 12 * 60 * 60 * 1000; // 12 hours for 4H candles
        }
        
        // Check if today is a weekend
        const today = new Date().getUTCDay(); // 0 = Sunday, 6 = Saturday
        const isWeekend = today === 0 || today === 6;
        
        if (isWeekend) {
          const isCrypto = symbol.includes("BTC") || symbol.includes("ETH") || symbol.includes("XRP") || symbol.includes("SOL") || symbol.includes("ADA");
          if (!isCrypto && !tfLower.includes('d') && !tfLower.includes('w')) {
            maxAgeMs = 72 * 60 * 60 * 1000; // Cap weekend gap to 72h (preventing 7-day stale freezes)
          }
        }

        if (now - latestTs < maxAgeMs) {
          // Reverse because we want oldest first for the indicator logic
          return cachedBars.reverse().map((b: any) => ({
            t: b.ts, o: Number(b.o), h: Number(b.h), l: Number(b.l), c: Number(b.c), v: Number(b.v)
          }));
        } else {
          console.log(`[Cache Stale] ${symbol} ${timeframe} data is ${Math.round((now - latestTs) / 3600000)}h old. Falling back to MetaApi.`);
        }
      }

      // If direct cached bars for the requested timeframe are missing or cold:
      // Try resampling from 30m candles available in market_data_pti
      const { data: base30mBars } = await supabase
        .from('market_data_pti')
        .select('*')
        .eq('symbol', symbol)
        .eq('timeframe', '30m')
        .order('ts', { ascending: false })
        .limit(Math.max(limit * 48, 500));

      if (base30mBars && base30mBars.length > 0) {
        const resampled = resampleBars(base30mBars, timeframe.toLowerCase());
        if (resampled && resampled.length > 0) {
          const latestTs = new Date(resampled[resampled.length - 1].t).getTime();
          const now = new Date().getTime();
          let maxAgeMs = 4 * 60 * 60 * 1000;
          const today = new Date().getUTCDay();
          const isWeekend = today === 0 || today === 6;
          if (isWeekend) {
            const isCrypto = symbol.includes("BTC") || symbol.includes("ETH") || symbol.includes("XRP") || symbol.includes("SOL") || symbol.includes("ADA");
            if (!isCrypto) maxAgeMs = 48 * 60 * 60 * 1000;
          }
          if (now - latestTs < maxAgeMs || resampled.length >= 10) {
            return resampled.slice(-limit);
          }
        }
      }
    }

    if (settings.active_broker === 'METAAPI') {
      // Normalize timeframe to lowercase MT5 format required by the Market Data API
      let tfNorm = timeframe.toLowerCase(); // e.g. '1D' → '1d', '1H' → '1h'
      if (tfNorm.startsWith('m') && tfNorm.length > 1 && !isNaN(Number(tfNorm[1]))) {
        tfNorm = tfNorm.replace('m', '') + 'm'; // 'm5' -> '5m'
      } else if (tfNorm.startsWith('h') && tfNorm.length > 1) {
        tfNorm = tfNorm.replace('h', '') + 'h'; // 'h1' -> '1h'
      } else if (tfNorm.startsWith('d') && tfNorm.length > 1) {
        tfNorm = tfNorm.replace('d', '') + 'd'; // 'd1' -> '1d'
      }
      const token = settings.meta_api_token || getEnv('META_API_TOKEN') || '';
      const account = settings.meta_api_account_id || getEnv('META_API_ACCOUNT_ID') || '';

      const BROKER_SYMBOL_ALIASES: Record<string, string[]> = {
        NAS100: ['NAS100', 'USTEC', 'USTECm', 'USTEC_m', 'NAS100m'],
        GER30: ['GER30', 'DE30', 'DE30m', 'DE30_m', 'GER30m', 'GER40'],
        SPX500: ['SPX500', 'US500', 'US500m', 'US500_m', 'SPX500m'],
        JP225: ['JP225', 'JP225m', 'NIKKEI', 'JPN225'],
        US30: ['US30', 'US30m', 'DJ30', 'WS30'],
        UKOIL: ['UKOIL', 'UKOILm', 'BRENT'],
        USOIL: ['USOIL', 'USOILm', 'WTI'],
      };

      const candidates = BROKER_SYMBOL_ALIASES[symbol] || [symbol];
      let res: any = null;
      for (const candidateSym of candidates) {
        try {
          res = await metaApiMarketDataFetch(
            `/historical-market-data/symbols/${candidateSym}/timeframes/${tfNorm}/candles?limit=${limit}`,
            token,
            account
          );
          if (res && Array.isArray(res) && res.length > 0) break;
        } catch (_) {
          // Try next candidate alias
        }
      }
      
      const bars = (res || []).map((c: any) => ({
        t: c.time,
        o: c.open,
        h: c.high,
        l: c.low,
        c: c.close,
        v: c.tickVolume || c.volume || 0,
      }));

      if (bars.length > 0 && supabase) {
        (async () => {
          try {
            const rows = bars.map((b: any) => ({
              symbol,
              timeframe: tfNorm,
              ts: b.t, o: b.o, h: b.h, l: b.l, c: b.c, v: b.v,
              revision: 0, hash: `${b.t}_${b.o}_${b.c}`,
            }));
            const CHUNK = 200;
            for (let i = 0; i < rows.length; i += CHUNK) {
              await supabase.from('market_data_pti').upsert(
                rows.slice(i, i + CHUNK),
                { onConflict: 'symbol,timeframe,ts', ignoreDuplicates: true }
              );
            }
          } catch (e) {
            console.warn(`[Cache Write-back] Failed for ${symbol}: ${e}`);
          }
        })();
      }
      return bars;
    }

    // ── PERMANENT METAAPI FALLBACK ───────────────────────────────────────────
    // Regardless of active_broker setting, always try MetaAPI via environment
    // variables (META_API_TOKEN + META_API_ACCOUNT_ID Supabase secrets).
    // This ensures agents never fail from missing price data even when
    // active_broker is set to ALPACA or the cache is cold.
    const envToken     = getEnv('META_API_TOKEN');
    const envAccountId = getEnv('META_API_ACCOUNT_ID');

    if (envToken && envAccountId) {
      try {
        let tfNorm = timeframe.toLowerCase();
        if (tfNorm.startsWith('m') && tfNorm.length > 1 && !isNaN(Number(tfNorm[1]))) {
          tfNorm = tfNorm.replace('m', '') + 'm'; // 'm5' -> '5m'
        } else if (tfNorm.startsWith('h') && tfNorm.length > 1) {
          tfNorm = tfNorm.replace('h', '') + 'h'; // 'h1' -> '1h'
        } else if (tfNorm.startsWith('d') && tfNorm.length > 1) {
          tfNorm = tfNorm.replace('d', '') + 'd'; // 'd1' -> '1d'
        }
        
        const BROKER_SYMBOL_ALIASES: Record<string, string[]> = {
          NAS100: ['NAS100', 'USTEC', 'USTECm', 'USTEC_m', 'NAS100m'],
          GER30: ['GER30', 'DE30', 'DE30m', 'DE30_m', 'GER30m', 'GER40'],
          SPX500: ['SPX500', 'US500', 'US500m', 'US500_m', 'SPX500m'],
          JP225: ['JP225', 'JP225m', 'NIKKEI', 'JPN225'],
          US30: ['US30', 'US30m', 'DJ30', 'WS30'],
          UKOIL: ['UKOIL', 'UKOILm', 'BRENT'],
          USOIL: ['USOIL', 'USOILm', 'WTI'],
        };

        const candidates = BROKER_SYMBOL_ALIASES[symbol] || [symbol];
        let res: any = null;
        for (const candidateSym of candidates) {
          try {
            res = await metaApiMarketDataFetch(
              `/historical-market-data/symbols/${candidateSym}/timeframes/${tfNorm}/candles?limit=${limit}`,
              envToken,
              envAccountId
            );
            if (res && Array.isArray(res) && res.length > 0) break;
          } catch (_) {
            // Try next candidate alias
          }
        }

        const bars: Bar[] = (res || []).map((c: any) => ({
          t: c.time,
          o: c.open,
          h: c.high,
          l: c.low,
          c: c.close,
          v: c.tickVolume || c.volume || 0,
        }));

        if (bars.length > 0) {
          // Write-back to cache so the next call is instant (fire-and-forget)
          if (supabase) {
            (async () => {
              try {
                const rows = bars.map(b => ({
                  symbol,
                  timeframe: tfNorm,
                  ts: b.t,
                  o: b.o,
                  h: b.h,
                  l: b.l,
                  c: b.c,
                  v: b.v,
                  revision: 0,
                  hash: `${b.t}_${b.o}_${b.c}`,
                }));
                // Insert in chunks, ignoring conflicts (rows may already exist)
                const CHUNK = 200;
                for (let i = 0; i < rows.length; i += CHUNK) {
                  await supabase.from('market_data_pti').upsert(
                    rows.slice(i, i + CHUNK),
                    { onConflict: 'symbol,timeframe,ts', ignoreDuplicates: true }
                  );
                }
                console.log(`[Cache Write-back] Stored ${bars.length} bars for ${symbol}/${tfNorm}`);
              } catch (e) {
                console.warn(`[Cache Write-back] Failed for ${symbol}: ${e}`);
              }
            })();
          }
          return bars;
        }
      } catch (metaErr) {
        console.warn(`[MetaAPI Fallback] Failed for ${symbol}/${timeframe}: ${metaErr}`);
      }
    }

    // ── ALPACA FALLBACK (stock symbols only) ─────────────────────────────────
    // Removed based on user request to stick to MetaAPI exclusively.
    return [];
  } catch (err) {
    console.warn(`Failed to fetch bars for ${symbol}:`, err);
    return [];
  }
}


export async function syncBrokerPosition(
  symbol: string,
  settings: any
): Promise<{ isOpen: boolean; pl: number; positionId?: string }> {
  try {
    if (settings.active_broker === 'MT5_VPS') {
      // VPS entirely manages physical execution and closures locally.
      // We assume it's open until the VPS specifically fires a vps-history or vps-callback.
      return { isOpen: true, pl: 0 };
    }
    
    if (settings.active_broker === 'METAAPI') {
      const token = settings.meta_api_token || getEnv('META_API_TOKEN') || '';
      const account = settings.meta_api_account_id || getEnv('META_API_ACCOUNT_ID') || '';
      const res = await metaApiFetch(`/positions`, { method: 'GET' }, token, account);
      const position = (res || []).find((p: any) => p.symbol === symbol);
      if (position) {
        return { isOpen: true, pl: position.unrealizedProfit || 0, positionId: position.id };
      }
      return { isOpen: false, pl: 0 };
    } else {
      const key = settings.alpaca_key || getEnv('BROKER_KEY') || '';
      const secret = settings.alpaca_secret || getEnv('BROKER_SECRET') || '';
      try {
        const res = await alpacaFetch(`/positions/${symbol}`, { method: 'GET' }, key, secret);
        if (res && res.symbol === symbol) {
          return { isOpen: true, pl: Number(res.unrealized_pl || 0) };
        }
      } catch (err: any) {
        if (err.message.includes('404')) {
          return { isOpen: false, pl: 0 }; // 404 means no open position
        }
        throw err;
      }
      return { isOpen: false, pl: 0 };
    }
  } catch (err) {
    console.warn(`Failed to sync broker position for ${symbol}:`, err);
    return { isOpen: true, pl: 0 }; // Assume open on error to prevent accidental closure
  }
}

export async function updateBrokerStopLoss(
  symbol: string,
  newStop: number,
  settings: any,
  positionId?: string
): Promise<boolean> {
  try {
    if (settings.active_broker === 'MT5_VPS') {
      console.log(`[MT5_VPS] Mathematical trailing stop updated to ${newStop} for ${symbol} in DB. VPS EA manages physical stop locally.`);
      return false; 
    }
    
    if (settings.active_broker === 'METAAPI' && positionId) {
      const token = settings.meta_api_token || getEnv('META_API_TOKEN') || '';
      const account = settings.meta_api_account_id || getEnv('META_API_ACCOUNT_ID') || '';

      await metaApiFetch('/trade', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          actionType: 'POSITION_MODIFY',
          positionId: positionId,
          stopLoss: newStop,
          stopLossUnits: 'ABSOLUTE_PRICE'
        }),
      }, token, account);
      return true;
    } else {
      // For Alpaca, bracket orders must be replaced via the orders API. 
      // For simplicity in this engine, we rely on the database simulated stop if bracket manipulation fails.
      console.log(`[ALPACA] Trailing stop updated mathematically in DB to ${newStop} for ${symbol}. (Requires bracket replacement for physical sync)`);
      return false; 
    }
  } catch (err) {
    console.warn(`Failed to update broker stop loss for ${symbol}:`, err);
    return false;
  }
}