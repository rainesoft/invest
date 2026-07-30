import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2.108.2";

// HFT Director - Analyzes market momentum on the 5M chart and updates HFT bias
serve(async (req) => {
  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    // 1. In a production setting, this agent would fetch price history from an API (e.g. Alpaca/FMP)
    // and analyze M5 volume profiles, EMA crossovers, and VWAP.
    // For this boilerplate, we'll set it up to accept a webhook payload or default to NEUTRAL.
    
    let requestedBias = "NEUTRAL";
    let requestedSymbol = "BTCUSD";
    if (req.method === "POST") {
      try {
        const body = await req.json();
        if (body.symbol) requestedSymbol = body.symbol;
        if (body.bias && ["LONG", "SHORT", "NEUTRAL"].includes(body.bias)) {
          requestedBias = body.bias;
        }
      } catch (e) {
        // Not a JSON payload, default to NEUTRAL
      }
    }

    // Fetch the current bias map
    const { data: riskSettings } = await supabase
      .from("user_risk_settings")
      .select("hft_bias")
      .eq("user_id", "912d249b-9be8-4691-a11b-5b00f386a804") // central user
      .single();
    
    let currentBiasMap: Record<string, string> = {};
    if (riskSettings && typeof riskSettings.hft_bias === "object" && riskSettings.hft_bias !== null) {
      currentBiasMap = riskSettings.hft_bias as Record<string, string>;
    }

    // Merge the new symbol's bias
    currentBiasMap[requestedSymbol] = requestedBias;

    // 2. Update the HFT bias in the user_risk_settings table for active VPS users
    const { error: updateError } = await supabase
      .from("user_risk_settings")
      .update({ hft_bias: currentBiasMap })
      .eq("hft_enabled", true)
      .neq("user_id", "00000000-0000-0000-0000-000000000000");

    if (updateError) {
      console.error("Failed to update HFT bias:", updateError);
      return new Response(`Error updating bias: ${updateError.message}`, { status: 500 });
    }

    console.log(`HFT Bias successfully updated to ${requestedBias} for ${requestedSymbol}`);
    return new Response(JSON.stringify({ success: true, symbol: requestedSymbol, bias: requestedBias, fullMap: currentBiasMap }), { 
      headers: { "Content-Type": "application/json" }
    });
    
  } catch (error: any) {
    console.error("Agent HFT Error:", error);
    return new Response(`ERROR: ${error.message}`, { status: 500 });
  }
});
