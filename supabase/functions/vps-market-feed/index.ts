import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2.108.2";

async function hashBar(b: any) {
  const str = `${b.t}|${b.o}|${b.h}|${b.l}|${b.c}|${b.v}`;
  const buf = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(str),
  );
  return Array.from(new Uint8Array(buf))
    .map((n) => n.toString(16).padStart(2, "0"))
    .join("");
}

serve(async (req) => {
  try {
    if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });

    const payload = await req.json();
    const { user_id, symbol, timeframe, bars } = payload;

    if (!user_id || !symbol || !timeframe || !bars || !Array.isArray(bars)) {
      return new Response("Invalid payload", { status: 400 });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const supabase = createClient(supabaseUrl, supabaseKey);

    // 1. Update VPS Heartbeat
    await supabase.from("user_risk_settings").update({ vps_last_heartbeat: new Date().toISOString() }).eq("user_id", user_id);

    // 2. Save Bars to market_data_pti
    const tfLower = timeframe.toLowerCase();
    for (const b of bars) {
      const hash = await hashBar(b);
      const { data: existing } = await supabase
        .from("market_data_pti")
        .select("hash, revision")
        .eq("symbol", symbol)
        .eq("timeframe", tfLower)
        .eq("ts", b.t)
        .order("revision", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (existing && existing.hash === hash) continue;

      const revision = existing ? existing.revision + 1 : 0;
      await supabase.from("market_data_pti").insert({
        symbol,
        timeframe: tfLower,
        ts: b.t,
        o: b.o,
        h: b.h,
        l: b.l,
        c: b.c,
        v: b.v,
        revision,
        hash,
      });
    }

    // 3. Trigger research-run asynchronously so we don't block the MQL5 EA
    const researchUrl = `${supabaseUrl}/functions/v1/research-run?symbols=${symbol}&timeframe=${timeframe}`;
    fetch(researchUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${supabaseKey}`
      },
      body: JSON.stringify({ timeframe })
    }).catch(e => console.error("Failed to trigger research-run:", e));

    return new Response(JSON.stringify({ status: "success", message: `Saved ${bars.length} bars and triggered research for ${symbol}` }), {
      headers: { "Content-Type": "application/json" }
    });

  } catch (error: any) {
    console.error("Error in vps-market-feed:", error);
    return new Response(`ERROR: ${error.message}`, { status: 500 });
  }
});
