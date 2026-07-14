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
  // Route Crypto/Forex/Commodity/Indices pairs away from Alpaca US Stocks
  const isForexOrCrypto = symbol === 'XAUUSD' || symbol === 'UKOIL' || symbol === 'US30' || symbol === 'NAS100' || symbol.includes('USD') || symbol.includes('/');
  
  if (isForexOrCrypto) {
    // 1. Try MetaTrader (MetaApi) First if configured
    const metaToken = Deno.env.get("META_API_TOKEN");
    const metaAccountId = Deno.env.get("META_API_ACCOUNT_ID");
    
    if (metaToken && metaAccountId) {
      // --- Symbol remapping: translate internal names to broker symbol names ---
      const META_SYMBOL_MAP: Record<string, string> = {
        'NAS100': 'US100',   // Exness/MT4 uses US100 for Nasdaq 100
        'US30': 'US30',      // Confirmed correct
        'UKOIL': 'UKOIL',    // Confirmed correct
        'XAGUSD': 'XAGUSD',  // Confirmed correct on most brokers
        'BTCUSD': 'BTCUSD',  // Confirmed correct
      };
      const brokerSymbol = META_SYMBOL_MAP[symbol] ?? symbol;

      let metaTimeframe = '1d';
      if (timeframe === '1D') metaTimeframe = '1d';
      else if (timeframe === '4H') metaTimeframe = '4h';
      else if (timeframe === '1H') metaTimeframe = '1h';
      else if (timeframe === '15Min') metaTimeframe = '15m';

      const baseUrl = Deno.env.get("META_API_BASE_URL") || "https://mt-client-api-v1.new-york.agiliumtrade.ai";
      const marketDataUrl = baseUrl.replace("mt-client-api-v1", "mt-market-data-client-api-v1");
      const metaUrl = `${marketDataUrl}/users/current/accounts/${metaAccountId}/historical-market-data/symbols/${brokerSymbol}/timeframes/${metaTimeframe}/candles?limit=${limit}`;
      
      // --- Retry logic: 2 attempts with 500ms backoff ---
      let lastMetaError: unknown;
      for (let attempt = 1; attempt <= 2; attempt++) {
        try {
          if (attempt > 1) {
            console.warn(`[Data Fetch] MetaAPI attempt ${attempt} for ${brokerSymbol}...`);
            await new Promise(r => setTimeout(r, 500));
          }

          const metaRes = await fetch(metaUrl, {
            headers: { 'auth-token': metaToken }
          });

          if (metaRes.ok) {
            const metaCandles = await metaRes.json();
            const bars: Bar[] = metaCandles.map((c: any) => ({
              t: new Date(c.time).toISOString(),
              o: c.open,
              h: c.high,
              l: c.low,
              c: c.close,
              v: c.tickVolume || c.volume || 0
            })).sort((a: Bar, b: Bar) => new Date(a.t).getTime() - new Date(b.t).getTime());

            if (bars.length > 0) {
              console.log(`[Data Fetch] Pulled ${bars.length} bars from MetaTrader Broker Feed for ${brokerSymbol}`);
              return { source: 'MetaAPI', bars };
            }
          } else {
            console.warn(`MetaApi returned ${metaRes.status} for ${brokerSymbol} (attempt ${attempt}).`);
            lastMetaError = `HTTP ${metaRes.status}`;
          }
        } catch (err) {
          console.warn(`MetaApi fetch failed for ${brokerSymbol} (attempt ${attempt}):`, err);
          lastMetaError = err;
        }
      }
      console.error(`[Data Fetch] MetaAPI exhausted all retries for ${brokerSymbol}. Last error:`, lastMetaError);
    }

    // 2. Fallback to Yahoo Finance (ONLY IN DEV MODE)
    const isDev = Deno.env.get("ENV") === "development" || Deno.env.get("NODE_ENV") === "development";
    if (!isDev) {
      throw new Error(`Data feed failure for ${symbol}. Yahoo Finance fallback is disabled in production to prevent misaligned execution.`);
    }
    console.warn(`Falling back to Yahoo Finance for ${symbol} (Development Mode)...`);
    let yfSymbol = symbol;
    const isCrypto = symbol.startsWith('BTC') || symbol.startsWith('ETH') || symbol.startsWith('SOL');

    if (symbol === 'UKOIL') {
      yfSymbol = 'BZ=F'; // Brent Crude Oil Futures as proxy for UKOIL
    } else if (symbol === 'XAUUSD') {
      yfSymbol = 'GC=F'; // Gold Futures as proxy for XAUUSD
    } else if (symbol === 'US30') {
      yfSymbol = '^DJI'; // Dow Jones Industrial Average
    } else if (symbol === 'NAS100') {
      yfSymbol = '^NDX'; // Nasdaq 100
    } else if (isCrypto && symbol.endsWith('USD')) {
      // BTCUSD -> BTC-USD
      yfSymbol = symbol.replace('USD', '') + '-USD';
    } else if (symbol.includes('/')) {
      yfSymbol = symbol.replace('/', '') + '=X'; // EUR/USD -> EURUSD=X
    } else if (symbol.length === 6 && (symbol.endsWith('USD') || symbol.startsWith('USD'))) {
      yfSymbol = symbol + '=X'; // EURUSD -> EURUSD=X, USDJPY -> USDJPY=X
    }
    
    // Yahoo Finance timeframe mapping
    let yfInterval = '1d';
    let yfRange = '2y';
    if (timeframe === '1D') { yfInterval = '1d'; yfRange = '2y'; }
    if (timeframe === '1H') { yfInterval = '60m'; yfRange = '60d'; }
    if (timeframe === '15Min') { yfInterval = '15m'; yfRange = '60d'; }

    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${yfSymbol}?interval=${yfInterval}&range=${yfRange}`;
    
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0'
      }
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Yahoo Finance data error ${res.status}: ${text}`);
    }

    const data = await res.json();
    const result = data.chart?.result?.[0];
    if (!result) return { source: 'Yahoo Finance', bars: [] };

    const timestamps = result.timestamp || [];
    const quote = result.indicators.quote[0];
    
    const bars: Bar[] = [];
    for (let i = 0; i < timestamps.length; i++) {
      if (quote.open[i] === null) continue;
      
      const t = new Date(timestamps[i] * 1000).toISOString();
      bars.push({
        t: t,
        o: quote.open[i],
        h: quote.high[i],
        l: quote.low[i],
        c: quote.close[i],
        v: quote.volume[i] || 0
      });
    }
    
    return { source: 'Yahoo Finance', bars: bars.slice(-limit) };
  }

  // Fallback to original Alpaca fetcher for US Stocks
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
    .select("id, user_id, meta_api_order_id")
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

    const cancelPayload = {
      actionType: "ORDER_CANCEL",
      orderId: trade.meta_api_order_id
    };

    try {
      const cancelUrl = `${baseUrl}/users/current/accounts/${userConfig.meta_api_account_id}/trade`;
      const response = await fetch(cancelUrl, {
        method: "POST",
        headers: {
          "auth-token": userConfig.meta_api_token,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(cancelPayload),
      });

      if (response.ok) {
        console.log(`[Broker Sync] Successfully cancelled pending order ${trade.meta_api_order_id} for user ${trade.user_id}`);
        await supabase.from("user_trades").update({ status: "CANCELLED" }).eq("id", trade.id);
      } else {
        const errorText = await response.text();
        console.error(`[Broker Sync] Failed to cancel order ${trade.meta_api_order_id}: ${errorText}`);
        
        // Push to retry queue
        await supabase.from("meta_api_retry_queue").insert({
          user_id: trade.user_id,
          meta_api_account_id: userConfig.meta_api_account_id,
          request_type: "ORDER_CANCEL",
          api_payload: cancelPayload,
          last_error: errorText
        });
      }
    } catch (e: any) {
      console.error(`[Broker Sync] Exception cancelling order ${trade.meta_api_order_id}: ${e.message}`);
      await supabase.from("meta_api_retry_queue").insert({
        user_id: trade.user_id,
        meta_api_account_id: userConfig.meta_api_account_id,
        request_type: "ORDER_CANCEL",
        api_payload: cancelPayload,
        last_error: e.message
      });
    }
  }
}

