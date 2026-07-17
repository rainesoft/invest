import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2.108.2";

serve(async (req) => {
  try {
    const url = new URL(req.url);
    const ticket = url.searchParams.get("ticket");
    const profit = url.searchParams.get("profit");
    const closePrice = url.searchParams.get("close_price");
    const reason = url.searchParams.get("close_reason") || "VPS_CLOSED";

    if (!ticket || !profit || !closePrice) {
      return new Response("Missing parameters", { status: 400 });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const supabase = createClient(supabaseUrl, supabaseKey);

    // 1. Find the trade in user_trades
    const { data: trades, error: findError } = await supabase
      .from("user_trades")
      .select("id")
      .eq("meta_api_order_id", ticket);

    if (findError) throw findError;
    if (!trades || trades.length === 0) {
       return new Response("Trade not found", { status: 404 });
    }

    const tradeId = trades[0].id;
    const updatePayload = {
      status: "CLOSED",
      close_reason: reason,
      close_price: Number(closePrice),
      realized_pnl: Number(profit),
      closed_at: new Date().toISOString()
    };

    // 2. Update user_trades
    const { error: updateError } = await supabase
      .from("user_trades")
      .update(updatePayload)
      .eq("id", tradeId);

    if (updateError) throw updateError;

    // 3. Update global trades tracking
    await supabase.from("trades").update(updatePayload).eq("id", tradeId);

    return new Response("OK", { headers: { "Content-Type": "text/plain" } });
  } catch (error: any) {
    console.error("Error updating VPS history:", error);
    return new Response(`ERROR: ${error.message}`, { status: 500 });
  }
});
