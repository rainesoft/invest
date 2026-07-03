import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { insertAuditLog } from "../core/audit";

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
    }, settings.meta_api_token, settings.meta_api_account_id);
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
}

export async function placeAndTrackOrder(req: TrackedOrderRequest) {
  const clientOrderId = req.clientOrderId || makeClientOrderId(req.tradeId, req.n);
  
  const { data: settings } = await req.supabase.from('user_risk_settings').select('*').limit(1).single();
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
    }

    if (settings.active_broker === 'METAAPI') {
      const res = await metaApiFetch(`/historical-market-data/symbols/${symbol}/timeframes/${timeframe}/candles?limit=${limit}`, {
        method: 'GET'
      }, settings.meta_api_token, settings.meta_api_account_id);
      
      return (res || []).map((c: any) => ({
        t: c.time,
        o: c.open,
        h: c.high,
        l: c.low,
        c: c.close,
        v: c.tickVolume || c.volume || 0,
      }));
    } else {
      const tfMap: Record<string, string> = { '1h': '1Hour', '1d': '1Day', '15m': '15Min', '1m': '1Min' };
      const alpacaTf = tfMap[timeframe.toLowerCase()] || '1Day';
      const key = settings.alpaca_key || getEnv('BROKER_KEY') || '';
      const secret = settings.alpaca_secret || getEnv('BROKER_SECRET') || '';
      
      const res = await alpacaFetch(`/stocks/${symbol}/bars?timeframe=${alpacaTf}&limit=${limit}`, {
        method: 'GET'
      }, key, secret);
      
      return (res.bars || []).map((b: any) => ({
        t: b.t,
        o: b.o,
        h: b.h,
        l: b.l,
        c: b.c,
        v: b.v
      }));
    }
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
    if (settings.active_broker === 'METAAPI') {
      const res = await metaApiFetch(`/positions`, { method: 'GET' }, settings.meta_api_token, settings.meta_api_account_id);
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
    if (settings.active_broker === 'METAAPI' && positionId) {
      await metaApiFetch('/trade', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          actionType: 'POSITION_MODIFY',
          positionId: positionId,
          stopLoss: newStop,
          stopLossUnits: 'ABSOLUTE_PRICE'
        }),
      }, settings.meta_api_token, settings.meta_api_account_id);
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