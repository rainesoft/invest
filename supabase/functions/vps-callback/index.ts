import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2.108.2";

serve(async (req) => {
  try {
    if (req.headers.get("x-vps-secret") !== Deno.env.get("VPS_SECRET_KEY")) {
      return new Response("Unauthorized", { status: 401 });
    }
    const url = new URL(req.url);
    const tradeId = url.searchParams.get("trade_id");
    const status = url.searchParams.get("status");
    const ticket = url.searchParams.get("ticket");
    const errorMsg = url.searchParams.get("error");

    if (!tradeId || !status) {
      return new Response("Missing parameters", { status: 400 });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    const updatePayload: any = { status };
    if (ticket && ticket !== "0") updatePayload.meta_api_order_id = ticket;
    if (errorMsg) updatePayload.error_message = errorMsg;

    const { data: tradeData, error: fetchError } = await supabase.from("user_trades").select("opportunity_id").eq("id", tradeId).single();
    if (fetchError) throw fetchError;

    const { error } = await supabase.from("user_trades").update(updatePayload).eq("id", tradeId);
    if (error) throw error;

    if (status === "OPEN" && tradeData?.opportunity_id) {
      await supabase.from("trade_opportunities").update({ 
        status: "ACTIVE",
        ai_summary: `[VPS Engine] Trade executed successfully. Ticket: ${ticket}`
      }).eq("id", tradeData.opportunity_id);
    }

    if (error) throw error;

    return new Response("OK", { headers: { "Content-Type": "text/plain" } });
  } catch (error: any) {
    console.error("Error updating VPS callback:", error);
    return new Response(`ERROR:${error.message}`, { status: 500 });
  }
});
