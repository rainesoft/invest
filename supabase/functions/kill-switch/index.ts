import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2.108.2";

async function alpacaFetch(path: string, opts: RequestInit = {}) {
  const base = Deno.env.get('BROKER_BASE_URL') ?? 'https://paper-api.alpaca.markets/v2';
  const headers = {
    'APCA-API-KEY-ID': Deno.env.get('BROKER_KEY') ?? '',
    'APCA-API-SECRET-KEY': Deno.env.get('BROKER_SECRET') ?? '',
    ...(opts.headers ?? {})
  } as Record<string, string>;
  const res = await fetch(`${base}${path}`, { ...opts, headers });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Alpaca error ${res.status}: ${text}`);
  }
  if (res.status === 204) return null;
  return res.json();
}

serve(async (_req) => {

  const url = Deno.env.get('SUPABASE_URL');
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !key) {
    return new Response(
      JSON.stringify({ ok: false, error: 'missing env' }),
      { status: 500, headers: { 'content-type': 'application/json' } },
    );
  }
  const supabase = createClient(url, key);

  let ordersCanceled = 0;
  let positionsClosed = 0;
  try {
    await alpacaFetch('/orders', { method: 'DELETE' });
    ordersCanceled = 1;
  } catch (e) {
    console.error(e);
  }
  try {
    await alpacaFetch('/positions', { method: 'DELETE' });
    positionsClosed = 1;
  } catch (e) {
    console.error(e);
  }

  const { error } = await supabase
    .from('trades')
    .update({
      status: 'CLOSED',
      close_reason: 'KILL_SWITCH',
      closed_at: new Date().toISOString(),
    })
    .neq('status', 'CLOSED');
  if (error) {
    console.error("Failed to update trades table:", error);
  }

  // --- MetaApi (Exness) Kill Switch ---
  let metaApiOrdersCanceled = 0;
  let metaApiPositionsClosed = 0;

  const META_API_TOKEN = Deno.env.get("META_API_TOKEN");
  const META_API_ACCOUNT_ID = Deno.env.get("META_API_ACCOUNT_ID");
  const metaBaseUrl = Deno.env.get("META_API_BASE_URL") || "https://mt-client-api-v1.london.agiliumtrade.ai";

  if (META_API_TOKEN && META_API_ACCOUNT_ID) {
    try {
      // 1. Cancel Pending Orders
      const ordersUrl = `${metaBaseUrl}/users/current/accounts/${META_API_ACCOUNT_ID}/orders`;
      const ordersRes = await fetch(ordersUrl, { headers: { "auth-token": META_API_TOKEN } });
      if (ordersRes.ok) {
        const orders = await ordersRes.json();
        for (const order of orders) {
          await fetch(`${metaBaseUrl}/users/current/accounts/${META_API_ACCOUNT_ID}/trade`, {
            method: "POST",
            headers: { "auth-token": META_API_TOKEN, "Content-Type": "application/json" },
            body: JSON.stringify({ actionType: "ORDER_CANCEL", orderId: order.id })
          });
          metaApiOrdersCanceled++;
        }
      }

      // 2. Close Open Positions
      const posUrl = `${metaBaseUrl}/users/current/accounts/${META_API_ACCOUNT_ID}/positions`;
      const posRes = await fetch(posUrl, { headers: { "auth-token": META_API_TOKEN } });
      if (posRes.ok) {
        const positions = await posRes.json();
        for (const pos of positions) {
          await fetch(`${metaBaseUrl}/users/current/accounts/${META_API_ACCOUNT_ID}/trade`, {
            method: "POST",
            headers: { "auth-token": META_API_TOKEN, "Content-Type": "application/json" },
            body: JSON.stringify({ actionType: "POSITION_CLOSE_ID", positionId: pos.id })
          });
          metaApiPositionsClosed++;
        }
      }
    } catch (err) {
      console.error("[Kill Switch] MetaApi execution failed:", err);
    }
  }

  return new Response(
    JSON.stringify({ 
      ok: true, 
      alpaca: { ordersCanceled, positionsClosed },
      exness: { ordersCanceled: metaApiOrdersCanceled, positionsClosed: metaApiPositionsClosed }
    }),
    { headers: { 'content-type': 'application/json' } },
  );
});
