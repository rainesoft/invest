import { createClient, SupabaseClient } from "npm:@supabase/supabase-js@2.108.2";
import { insertAuditLog } from "./audit.ts";

export function makeClientOrderId(tradeId: string, n = 1) {
  return `${tradeId}-${n}`;
}

export interface OrderRequest {
  symbol: string;
  side: 'buy' | 'sell';
  qty: number;
  type: 'market' | 'limit' | 'stop' | 'stop_limit';
  limitPrice?: number;
  stopPrice?: number;
  tif?: 'day' | 'ioc' | 'fok';
}

async function alpacaFetch(path: string, opts: RequestInit) {
  const base = Deno.env.get('BROKER_BASE_URL') ?? 'https://paper-api.alpaca.markets/v2';
  const headers = {
    'APCA-API-KEY-ID': process.env.BROKER_KEY,
    'APCA-API-SECRET-KEY': process.env.BROKER_SECRET,
    ...(opts.headers ?? {})
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
  supabase?: SupabaseClient,
) {
  const client =
    supabase ||
    (() => {
      const url = Deno.env.get('SUPABASE_URL');
      const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
      return url && key ? createClient(url, key) : undefined;
    })();

  if (client) {
    await insertAuditLog(client, {
      actor_type: 'SYSTEM',
      action: 'PLACE_ORDER',
      entity_type: 'order',
      payload_json: order,
    });
  }

  const res = await alpacaFetch('/orders', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      symbol: order.symbol,
      side: order.side,
      qty: order.qty,
      type: order.type,
      time_in_force: order.tif ?? 'day',
      limit_price: order.limitPrice,
      stop_price: order.stopPrice,
    }),
  });

  if (client) {
    await insertAuditLog(client, {
      actor_type: 'SYSTEM',
      action: 'ORDER_RESPONSE',
      entity_type: 'order',
      payload_json: res,
    });
  }
  return res;
}

export interface Bar {
  t: string;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
}

export async function fetchPaperBars(symbol: string, timeframe = '1D', limit = 300): Promise<{source: string, bars: Bar[]}> {
  // Route Crypto/Forex/Commodity/Indices pairs to the local VPS Bridge database
  const isForexOrCrypto = symbol === 'XAUUSD' || symbol === 'UKOIL' || symbol === 'US30' || symbol === 'NAS100' || symbol.includes('USD') || symbol.includes('/');
  
  if (isForexOrCrypto) {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !supabaseKey) throw new Error("Missing Supabase credentials for VPS Market Feed");
    
    const supabase = createClient(supabaseUrl, supabaseKey);
    
    const { data: dbBars, error } = await supabase
      .from('market_data_pti')
      .select('ts, o, h, l, c, v')
      .eq('symbol', symbol)
      .eq('timeframe', timeframe.toLowerCase())
      .order('ts', { ascending: false })
      .limit(limit);
      
    if (error || !dbBars || dbBars.length === 0) {
      console.error(`[Data Fetch Debug] Symbol: ${symbol}, Timeframe: ${timeframe.toLowerCase()}, Error: ${JSON.stringify(error)}, dbBars length: ${dbBars?.length}`);
      console.warn(`[Data Fetch] No data found in market_data_pti for ${symbol} ${timeframe}`);
      throw new Error(`NO_VPS_DATA_FOR_${symbol} | ERR: ${JSON.stringify(error)} | LEN: ${dbBars?.length}`);
    }
    
    const bars: Bar[] = dbBars.map((b: any) => ({
      t: b.ts,
      o: b.o,
      h: b.h,
      l: b.l,
      c: b.c,
      v: b.v
    })).reverse(); // Reverse to chronological order for indicators
    
    console.log(`[Data Fetch] Pulled ${bars.length} bars from VPS Bridge Feed (market_data_pti) for ${symbol}`);
    return { source: 'VPS_Bridge', bars };
  }
  const base = 'https://data.alpaca.markets/v2';
  const key = Deno.env.get('BROKER_KEY') || Deno.env.get('APCA_API_KEY_ID') || '';
  const secret = Deno.env.get('BROKER_SECRET') || Deno.env.get('APCA_API_SECRET_KEY') || '';
  
  const res = await fetch(
    `${base}/stocks/${symbol}/bars?timeframe=${timeframe}&limit=${limit}`,
    {
      headers: {
        'APCA-API-KEY-ID': key,
        'APCA-API-SECRET-KEY': secret,
      },
    },
  );
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Alpaca data error ${res.status}: ${text}`);
  }
  const json = await res.json();
  return { source: 'Alpaca', bars: json.bars ?? [] };
}

/**
 * Cancels any pending broker orders (MetaAPI) tied to an invalidated or expired opportunity.
 */
export async function cancelBrokerOrdersForOpportunity(supabase: SupabaseClient, opportunityId: string): Promise<void> {
  // 1. Fetch all OPEN trades for this opportunity that have a broker order ID
  const { data: activeTrades, error: tradesErr } = await supabase
    .from("user_trades")
    .select("id, user_id, meta_api_order_id, status")
    .eq("opportunity_id", opportunityId)
    .eq("status", "OPEN")
    .not("meta_api_order_id", "is", null);

  if (tradesErr || !activeTrades || activeTrades.length === 0) {
    return;
  }

  // 2. Extract unique user IDs to fetch their MetaAPI tokens
  const userIds = [...new Set(activeTrades.map(t => t.user_id))];
  const { data: userSettings, error: settingsErr } = await supabase
    .from("user_risk_settings")
    .select("user_id, meta_api_token, meta_api_account_id")
    .in("user_id", userIds);

  if (settingsErr || !userSettings) {
    return;
  }

  const settingsMap = new Map(userSettings.map(s => [s.user_id, s]));
  const baseUrl = Deno.env.get("META_API_BASE_URL") || "https://mt-client-api-v1.new-york.agiliumtrade.ai";

  // 3. Loop through and cancel each pending order
  for (const trade of activeTrades) {
    const userConfig = settingsMap.get(trade.user_id);
    if (!userConfig || !userConfig.meta_api_token || !userConfig.meta_api_account_id) {
      continue;
    }

    const success = await cancelMetaApiOrder(supabase, trade.user_id, userConfig.meta_api_account_id, userConfig.meta_api_token, trade.meta_api_order_id, trade.status || "OPEN");
    if (success) {
      await supabase.from("user_trades").update({ status: "CANCELLED" }).eq("id", trade.id);
    }
  }
}

/**
 * Generic utility to cancel a MetaAPI order (attempts ORDER_CANCEL, falls back to POSITION_CLOSE_ID)
 */
export async function cancelMetaApiOrder(supabase: SupabaseClient, userId: string, accountId: string, token: string, orderId: string, tradeStatus: string = "OPEN"): Promise<boolean> {
  const baseUrl = Deno.env.get("META_API_BASE_URL") || "https://mt-client-api-v1.new-york.agiliumtrade.ai";
  const url = `${baseUrl}/users/current/accounts/${accountId}/trade`;

  // If the trade is purely pending, use ORDER_CANCEL.
  // If the trade is ACTIVE, OPEN, or PAPER_OPEN, use POSITION_CLOSE_ID explicitly.
  const isPending = tradeStatus === "PENDING";
  const primaryPayload = isPending 
    ? { actionType: "ORDER_CANCEL", orderId } 
    : { actionType: "POSITION_CLOSE_ID", positionId: orderId };

  try {
    let res = await fetch(url, {
      method: "POST",
      headers: { "auth-token": token, "Content-Type": "application/json" },
      body: JSON.stringify(primaryPayload)
    });

    if (res.ok) {
      console.log(`[Broker Sync] Successfully executed ${primaryPayload.actionType} for ${orderId}`);
      return true;
    }

    // Fallback logic: If we thought it was a position but it's actually an order (or vice versa), try the other.
    const fallbackPayload = isPending 
      ? { actionType: "POSITION_CLOSE_ID", positionId: orderId }
      : { actionType: "ORDER_CANCEL", orderId };

    res = await fetch(url, {
      method: "POST",
      headers: { "auth-token": token, "Content-Type": "application/json" },
      body: JSON.stringify(fallbackPayload)
    });

    if (res.ok) {
      console.log(`[Broker Sync] Fallback successful: Executed ${fallbackPayload.actionType} for ${orderId}`);
      return true;
    }

    const errText = await res.text();
    console.error(`[Broker Sync] Failed to cancel/close ${orderId} (Status: ${tradeStatus}): ${errText}`);
    
    await supabase.from("meta_api_retry_queue").insert({
      user_id: userId,
      meta_api_account_id: accountId,
      request_type: "ORDER_CANCEL_FALLBACK_CLOSE",
      api_payload: primaryPayload,
      last_error: errText
    });
    return false;
  } catch (e: any) {
    console.error(`[Broker Sync] Exception cancelling ${orderId}: ${e.message}`);
    await supabase.from("meta_api_retry_queue").insert({
      user_id: userId,
      meta_api_account_id: accountId,
      request_type: "ORDER_CANCEL_EXCEPTION",
      api_payload: primaryPayload,
      last_error: e.message
    });
    return false;
  }
}

