import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2.108.2";

async function hashBar(b: any) {
  const str = `${b.t}|${b.o}|${b.h}|${b.l}|${b.c}|${b.v}`;
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(str));
  return Array.from(new Uint8Array(buf)).map((n) => n.toString(16).padStart(2, "0")).join("");
}

serve(async (req) => {
  try {
    const symbol = "XAUUSDm"; // MetaApi often uses XAUUSDm
    const timeframe = "5m";

    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const supabase = createClient(supabaseUrl, supabaseKey);

    const baseUrl = Deno.env.get("META_API_BASE_URL");
    const accountId = Deno.env.get("META_API_ACCOUNT_ID");
    const token = Deno.env.get("META_API_TOKEN");

    // Get time 12 hours ago
    const startTime = new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString();
    const url = `${baseUrl}/users/current/accounts/${accountId}/historical-market-data/symbols/${symbol}/timeframes/${timeframe}/candles?startTime=${startTime}&limit=100`;

    console.log(`Fetching from MetaApi: ${url}`);
    const res = await fetch(url, { headers: { "auth-token": token! } });
    
    if (!res.ok) {
      return new Response(`Failed to fetch MetaApi: ${await res.text()}`, { status: 500 });
    }

    const candles = await res.json();
    console.log(`Fetched ${candles.length} candles from MetaAPI`);

    for (const c of candles) {
      const isoTime = new Date(c.time).toISOString();
      const b = { t: isoTime, o: c.open, h: c.high, l: c.low, c: c.close, v: c.tickVolume };
      const hash = await hashBar(b);

      const { data: existing } = await supabase
        .from("market_data_pti")
        .select("hash, revision")
        .eq("symbol", "XAUUSD")
        .eq("timeframe", timeframe)
        .eq("ts", isoTime)
        .maybeSingle();

      if (existing && existing.hash === hash) continue;

      const revision = existing ? existing.revision + 1 : 0;
      await supabase.from("market_data_pti").insert({
        symbol: "XAUUSD",
        timeframe: timeframe,
        ts: isoTime,
        o: b.o,
        h: b.h,
        l: b.l,
        c: b.c,
        v: b.v,
        revision,
        hash,
      });
    }

    // Now invoke the scalper
    const scalperRes = await supabase.functions.invoke('agent-scalper', {
      body: { symbol: 'XAUUSD', timeframe: 'M5' }
    });

    return new Response(JSON.stringify({ 
      success: true, 
      candles_fetched: candles.length, 
      scalper: scalperRes.data,
      scalper_error: scalperRes.error
    }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });

  } catch (error: any) {
    return new Response(`Error: ${error.message}`, { status: 500 });
  }
});
