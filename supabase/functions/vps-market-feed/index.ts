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
    if (req.headers.get("x-vps-secret") !== Deno.env.get("VPS_SECRET_KEY")) {
      return new Response("Unauthorized", { status: 401 });
    }

    const payload = await req.json();
    const { symbol, timeframe, bars } = payload;

    if (!symbol || !timeframe || !bars || !Array.isArray(bars)) {
      return new Response("Invalid payload", { status: 400 });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const supabase = createClient(supabaseUrl, supabaseKey);

    // 1. Update VPS Heartbeat for all users (since it's a single-bot central architecture)
    await supabase.from("user_risk_settings").update({ vps_last_heartbeat: new Date().toISOString() }).neq("user_id", "00000000-0000-0000-0000-000000000000");

    // 2. Save Bars to market_data_pti (Optimized Bulk Insert)
    const tfLower = timeframe.toLowerCase();
    
    // Map timestamps
    const mappedBars = await Promise.all(bars.map(async (b: any) => {
      const isoTime = typeof b.t === 'number' ? new Date(b.t * 1000).toISOString() : new Date(b.t).toISOString();
      const hash = await hashBar({ ...b, t: isoTime });
      return { ...b, isoTime, hash };
    }));

    if (mappedBars.length > 0) {
      const minTime = mappedBars.reduce((min, curr) => curr.isoTime < min ? curr.isoTime : min, mappedBars[0].isoTime);
      const maxTime = mappedBars.reduce((max, curr) => curr.isoTime > max ? curr.isoTime : max, mappedBars[0].isoTime);

      const { data: existingRows } = await supabase
        .from("market_data_pti")
        .select("ts, hash, revision")
        .eq("symbol", symbol)
        .eq("timeframe", tfLower)
        .gte("ts", minTime)
        .lte("ts", maxTime);

      const latestExisting = new Map<string, { hash: string, revision: number }>();
      if (existingRows) {
        for (const row of existingRows) {
          const normalizedTs = new Date(row.ts).toISOString();
          const current = latestExisting.get(normalizedTs);
          if (!current || row.revision > current.revision) {
            latestExisting.set(normalizedTs, { hash: row.hash, revision: row.revision });
          }
        }
      }

      const rowsToInsert = [];
      for (const b of mappedBars) {
        const existing = latestExisting.get(b.isoTime);
        if (existing && existing.hash === b.hash) continue;
        
        const revision = existing ? existing.revision + 1 : 0;
        rowsToInsert.push({
          symbol,
          timeframe: tfLower,
          ts: b.isoTime,
          o: b.o,
          h: b.h,
          l: b.l,
          c: b.c,
          v: b.v,
          revision,
          hash: b.hash,
        });
      }

      if (rowsToInsert.length > 0) {
        const { error: insertErr } = await supabase.from("market_data_pti").insert(rowsToInsert);
        if (insertErr) {
          throw new Error(`DB Bulk Insert Error: ${insertErr.message}`);
        }
      }
    }


    return new Response(JSON.stringify({ status: "success", message: `Saved ${bars.length} bars and triggered research for ${symbol}` }), {
      headers: { "Content-Type": "application/json" }
    });

  } catch (error: any) {
    console.error("Error in vps-market-feed:", error);
    return new Response(`ERROR: ${error.message}`, { status: 500 });
  }
});
